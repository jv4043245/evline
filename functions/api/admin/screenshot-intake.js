import { json, readPayload } from '../../_lib/http.js';
import { adminUser, unauthorized } from '../../_lib/auth.js';
import { auditActor, recordAuditEvent } from '../../_lib/audit-log.js';
import {
  ensureScreenshotIntake, screenshotOverview, getScreenshotDraft, screenshotManager,
  setScreenshotManager, cancelScreenshotDraft, updateScreenshotFields,
  findScreenshotDuplicates, confirmScreenshotDraft, saveScreenshotAnalysis,
  claimScreenshotAnalysis, releaseScreenshotAnalysis,
} from '../../_lib/screenshot-intake-store.js';
import { analyzeScreenshotDraft } from '../../_lib/screenshot-intake-analysis.js';

const HOOK = 'https://evline.com.ua/api/telegram/webhook';
const UPDATES = ['message', 'edited_message', 'callback_query'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = value => typeof value === 'string' && /^[\da-f-]{36}$/i.test(value);

async function telegram(env, method, body = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) throw fail('Telegram-бот не підключений.', 503);
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'manual',
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error();
    return data.result;
  } catch { throw fail('Telegram не підтвердив дію. Спробуйте ще раз.', 503); }
}

async function draftResult(env, id) {
  const draft = await getScreenshotDraft(env, id);
  if (!draft) throw fail('Чернетку не знайдено.', 404);
  const manager = await screenshotManager(env, draft.manager_id);
  return { draft, duplicates: manager?.status === 'approved' ? await findScreenshotDuplicates(env, draft) : [] };
}

export async function onRequestGet({ request, env }) {
  if (!adminUser(request, env)) return unauthorized();
  await ensureScreenshotIntake(env);
  const params = new URL(request.url).searchParams;
  if (params.has('setup')) {
    const [bot, hook] = await Promise.all([telegram(env, 'getMe'), telegram(env, 'getWebhookInfo')]);
    return json({ username: bot.username, webhook_matches: hook.url === HOOK && (!hook.allowed_updates?.length || UPDATES.every(type => hook.allowed_updates.includes(type))),
      manager_username_hint: 'evline_support', start_url: `https://t.me/${bot.username}?start=intake`, ai_available: Boolean(env.AI?.run) });
  }
  if (params.has('id')) {
    if (!validId(params.get('id'))) throw fail('Некоректний номер чернетки.');
    return json(await draftResult(env, params.get('id')));
  }
  if (params.has('order')) {
    const number = params.get('order').trim().toUpperCase();
    if (!/^O-\d{1,12}$/.test(number)) throw fail('Вкажіть номер замовлення, наприклад O-000123.');
    const order = await env.DB.prepare('SELECT id, order_number, car, item_name, updated_at, status FROM orders WHERE order_number=?').bind(number).first();
    if (!order) throw fail('Замовлення з таким номером не знайдено.', 404);
    return json({ order });
  }
  return json({ ...await screenshotOverview(env), ai_available: Boolean(env.AI?.run) });
}

export async function onRequestPost({ request, env }) {
  if (!adminUser(request, env)) return unauthorized();
  const payload = await readPayload(request);
  const actor = auditActor(request, env);
  await ensureScreenshotIntake(env);
  if (payload.action === 'manager_status') {
    const manager = await screenshotManager(env, String(payload.telegram_id || ''));
    if (!manager) throw fail('Спочатку менеджер має надіслати /intake боту.', 404);
    if (payload.status === 'approved') {
      const allowed = String(env.SCREENSHOT_INTAKE_ALLOWED_USERNAMES || 'evline_support').split(',').map(value => value.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
      if (!allowed.includes(String(manager.username || '').replace(/^@/, '').toLowerCase())) throw fail('Цей Telegram-акаунт ще не погоджений власником для запуску.', 403);
    }
    if (!['approved', 'paused'].includes(payload.status)) throw fail('Некоректний стан доступу.');
    await setScreenshotManager(env, { telegram_id: manager.telegram_id, status: payload.status }, actor);
    return json({ ok: true, ...await screenshotOverview(env), ai_available: Boolean(env.AI?.run) });
  }
  if (payload.action === 'prepare_webhook') {
    const hook = await telegram(env, 'getWebhookInfo');
    if (hook.url !== HOOK || !env.TELEGRAM_WEBHOOK_SECRET || hook.has_custom_certificate) throw fail('Webhook потребує ручної перевірки. Поточне підключення не змінено.', 409);
    await telegram(env, 'setWebhook', {
      url: hook.url, secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: hook.allowed_updates?.length ? [...new Set([...hook.allowed_updates, ...UPDATES])] : [],
      max_connections: hook.max_connections || 40, drop_pending_updates: false,
    });
    await recordAuditEvent(env, { actor, action: 'screenshot.webhook.prepare', entity_type: 'telegram', entity_id: 'screenshot_intake' });
    return json({ ok: true });
  }
  if (payload.action === 'test_analysis') {
    let image;
    if (payload.vision === true) {
      const response = await fetch('https://evline.com.ua/assets/images/admin/screenshot-intake-demo.png', { signal: AbortSignal.timeout(10000), redirect: 'manual' });
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 200000) throw fail('Тестове зображення поки недоступне.', 503);
      image = new Uint8Array(await response.arrayBuffer());
      if (image.length > 200000) throw fail('Некоректний тестовий файл.', 503);
    }
    const result = await analyzeScreenshotDraft(env, { channel: 'whatsapp', sources: image
      ? [{ kind: 'image', message_id: 1, file_id: 'synthetic-demo' }]
      : [{ kind: 'text', message_id: 1, text: 'Клієнт: BYD Yuan Plus 2023. Потрібна права передня дверка, 1 штука. Мій телефон +380000000001. Менеджер: Добре, перевіримо.' }] },
      image ? { download: async () => image } : {});
    return json({ ok: true, result, checks: { phone: result.fields.customer_phone === '+380000000001', parts: /двер/iu.test(result.fields.item_name || ''), car: /BYD/iu.test(result.fields.car || '') } });
  }
  if (!validId(payload.id) || !Number.isSafeInteger(payload.revision) || payload.revision < 0) throw fail('Оновіть чернетку перед дією.');
  const draft = await getScreenshotDraft(env, payload.id);
  if (!draft) throw fail('Чернетку не знайдено.', 404);
  const owner = draft.manager_id;
  if (payload.action === 'analyze') {
    const claimed = await claimScreenshotAnalysis(env, draft.id, owner, payload.revision);
    try {
      const result = await analyzeScreenshotDraft(env, claimed);
      await saveScreenshotAnalysis(env, draft.id, owner, payload.revision, { ...result, analysis_token: claimed.analysis_token });
    } finally { await releaseScreenshotAnalysis(env, draft.id, owner, payload.revision, claimed.analysis_token); }
  } else if (payload.action === 'save') {
    await updateScreenshotFields(env, draft.id, owner, payload.revision, payload.fields);
  } else if (payload.action === 'confirm') {
    if (!['create', 'append'].includes(payload.mode)) throw fail('Оберіть створення або доповнення замовлення.');
    const result = await confirmScreenshotDraft(env, draft.id, owner, payload.revision, {
      mode: payload.mode, order_id: payload.order_id, order_updated_at: payload.order_updated_at, allow_duplicate: payload.allow_duplicate === true,
    }, actor);
    return json({ ...result, ...await draftResult(env, draft.id) });
  } else if (payload.action === 'cancel') {
    if (draft.revision !== payload.revision) throw fail('Чернетка змінилася. Оновіть її перед скасуванням.', 409);
    await cancelScreenshotDraft(env, draft.id, owner);
  } else throw fail('Невідома дія.');
  return json({ ok: true, ...await draftResult(env, draft.id) });
}
