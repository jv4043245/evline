import { json, readPayload } from '../../_lib/http.js';
import { auditActor, recordAuditEvent } from '../../_lib/audit-log.js';
import { analyzeTelegramMessages, telegramIntakeAction, telegramIntakeOverview } from '../../_lib/telegram-intake.js';

async function telegram(env, method, body = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram-бот не налаштований.');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error('Telegram не підтвердив дію. Перевірте підключення бота.');
  return data.result;
}
const EXPECTED_WEBHOOK = 'https://evline.com.ua/api/telegram/webhook';
const BUSINESS_UPDATES = ['business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'];

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  if (params.has('setup')) {
    const bot = await telegram(env, 'getMe');
    const hook = await telegram(env, 'getWebhookInfo');
    return json({ username: bot.username, business_capable: Boolean(bot.can_connect_to_business),
      webhook_matches: hook.url === EXPECTED_WEBHOOK,
      business_updates_enabled: !hook.allowed_updates?.length || BUSINESS_UPDATES.every(type => hook.allowed_updates.includes(type)),
      pending_updates: hook.pending_update_count || 0 });
  }
  return json(await telegramIntakeOverview(env, params.get('chat')));
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const actor = auditActor(request, env);
  if (payload.action === 'test_analysis') {
    // Fixed synthetic examples exercise the actual binding without creating CRM entities.
    const messages = [{ message_id: 1, role: 'customer', body: 'BYD Yuan Plus 2023. Нужна правая дверь. Телефон +380000000001' }];
    const first = await analyzeTelegramMessages(env, messages);
    messages.push({ message_id: 2, role: 'manager', body: 'Уточните сторону' }, { message_id: 3, role: 'customer', body: 'Ошибся, нужна левая дверь' });
    const second = await analyzeTelegramMessages(env, messages, first.fields);
    return json({ checks: [
      { name: 'Нова заявка', passed: first.intent === 'parts' && !first.review && /правая дверь/iu.test(first.fields.item_name || '') && first.fields.customer_phone === '+380000000001' },
      { name: 'Уточнення сторони', passed: second.intent === 'parts' && !second.review && /левая дверь/iu.test(second.fields.item_name || '') && !/правая/iu.test(second.fields.item_name || '') },
    ] });
  }
  if (payload.action === 'prepare_webhook') {
    const hook = await telegram(env, 'getWebhookInfo');
    if (hook.url !== EXPECTED_WEBHOOK || !env.TELEGRAM_WEBHOOK_SECRET || hook.has_custom_certificate) {
      return json({ error: 'Поточний webhook потребує ручної перевірки. Його не змінено.' }, { status: 409 });
    }
    await telegram(env, 'setWebhook', {
      url: hook.url, secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: hook.allowed_updates?.length ? [...new Set([...hook.allowed_updates, ...BUSINESS_UPDATES])] : [],
      max_connections: hook.max_connections || 40, drop_pending_updates: false,
    });
    await recordAuditEvent(env, { actor, action: 'telegram.webhook.prepare', entity_type: 'telegram', entity_id: 'business_intake' });
    return json({ ok: true });
  }
  return json(await telegramIntakeAction(env, payload, actor));
}
