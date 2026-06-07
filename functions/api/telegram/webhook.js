import { json, readPayload, text } from "../../_lib/http.js";
import { loadOrder, retryLatestOrderNotification } from "../../_lib/crm.js";

function extractOrderId(value) {
  const input = text(value);
  const match = input.match(/(?:^|\s)(?:\/start\s+)?order[_:-]([0-9a-fA-F-]{36})(?:\s|$)/);
  return match ? match[1] : "";
}

function isSetupCommand(value) {
  const input = text(value).toLowerCase();
  return /^\/(?:start|help|chatid)(?:@\w+)?(?:\s|$)/.test(input);
}

function buildSetupMessage(message, chatId) {
  const chatType = text(message.chat?.type);
  const title = text(message.chat?.title);
  const lines = [
    "EVLine CRM бот на зв'язку.",
    `Chat ID: ${chatId}`,
  ];

  if (title) lines.push(`Чат: ${title}`);
  if (chatType) lines.push(`Тип: ${chatType}`);

  lines.push(
    "",
    "Для менеджерського чату скопіюйте цей Chat ID у Cloudflare:",
    "• запчастини: TELEGRAM_PARTS_CHAT_ID",
    "• програмування BYD: TELEGRAM_TECH_CHAT_ID",
    "",
    "Для клієнта використовуйте команду з картки замовлення:",
    "/start order_<id>"
  );

  return lines.join("\n");
}

async function sendTelegram(env, chatId, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });
}

export async function onRequestPost({ request, env }) {
  const expectedSecret = text(env.TELEGRAM_WEBHOOK_SECRET);
  const actualSecret = text(request.headers.get("x-telegram-bot-api-secret-token"));
  if (expectedSecret && actualSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = await readPayload(request);
  const message = update.message || update.edited_message || update.callback_query?.message || {};
  const chatId = text(message.chat?.id);
  const incomingText = text(update.message?.text || update.callback_query?.data);
  const orderId = extractOrderId(incomingText);

  if (!chatId) return json({ ok: true, skipped: "no_chat_id" });

  if (!orderId) {
    const fallbackMessage = isSetupCommand(incomingText)
      ? buildSetupMessage(message, chatId)
      : "Добрий день! Це бот EVLine для статусів замовлення. Щоб підключити повідомлення, надішліть команду, яку дав менеджер.";

    await sendTelegram(
      env,
      chatId,
      fallbackMessage
    ).catch(() => {});
    return json({ ok: true, skipped: "no_order_id" });
  }

  const order = await loadOrder(env, orderId);
  if (!order) {
    await sendTelegram(env, chatId, "Не знайшли замовлення EVLine за цією командою. Перевірте її з менеджером.").catch(() => {});
    return json({ ok: true, skipped: "order_not_found" });
  }

  const now = new Date().toISOString();
  const username = text(message.chat?.username || update.message?.from?.username);
  const telegramUsername = username ? `@${username.replace(/^@/, "")}` : order.customer_telegram || "";

  await env.DB.prepare(
    `UPDATE orders SET
      updated_at = ?,
      telegram_chat_id = ?,
      customer_telegram = COALESCE(NULLIF(?, ''), customer_telegram)
    WHERE id = ?`
  )
    .bind(now, chatId, telegramUsername, orderId)
    .run();

  if (order.customer_id) {
    await env.DB.prepare(
      `UPDATE customers SET
        updated_at = ?,
        telegram_chat_id = ?,
        telegram_username = COALESCE(NULLIF(?, ''), telegram_username)
      WHERE id = ?`
    )
      .bind(now, chatId, telegramUsername, order.customer_id)
      .run();
  }

  await sendTelegram(
    env,
    chatId,
    "Telegram-повідомлення EVLine підключено. Тепер ми зможемо автоматично надсилати статуси вашого замовлення."
  ).catch(() => {});

  const retry = await retryLatestOrderNotification(env, orderId).catch((error) => ({
    ok: false,
    status: "retry_failed",
    error: error.message || String(error),
  }));

  return json({ ok: true, order_id: orderId, retry });
}
