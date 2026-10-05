import {
  requestScreenshotAccess, screenshotManager, activeScreenshotDraft,
  createScreenshotDraft, getScreenshotDraft, cancelScreenshotDraft,
  addScreenshotSource, saveScreenshotAnalysis, findScreenshotDuplicates,
  confirmScreenshotDraft, claimScreenshotAnalysis, releaseScreenshotAnalysis,
} from './screenshot-intake-store.js';
import { analyzeScreenshotDraft } from './screenshot-intake-analysis.js';

const ADMIN_URL = 'https://evline.com.ua/admin/screenshot-intake/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['analyze', 'create', 'separate', 'cancel', 'status']);
const CHANNELS = { viber: 'Viber', whatsapp: 'WhatsApp', other: 'Інший канал' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 4000;
const defaults = {
  requestScreenshotAccess, screenshotManager, activeScreenshotDraft,
  createScreenshotDraft, getScreenshotDraft, cancelScreenshotDraft,
  addScreenshotSource, saveScreenshotAnalysis, findScreenshotDuplicates,
  confirmScreenshotDraft, analyzeScreenshotDraft, claimScreenshotAnalysis, releaseScreenshotAnalysis,
};
const clean = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
const isApproved = manager => manager?.status === 'approved';
const active = draft => draft && ['collecting', 'ready'].includes(draft.status);
const adminLink = draft => `${ADMIN_URL}?draft=${encodeURIComponent(draft.id)}`;

// Neither Telegram/API error bodies nor URLs containing bot credentials leave this module.
async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('screenshot_telegram_unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error('screenshot_telegram_unavailable');
    return data.result;
  } catch {
    throw new Error('screenshot_telegram_unavailable');
  } finally { clearTimeout(timer); }
}

export function screenshotCallback(action, draft) {
  if (!ACTIONS.has(action) || !UUID.test(draft?.id || '') || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || draft.revision > 999999999) {
    throw new Error('invalid_screenshot_callback');
  }
  const value = `sd:${action}:${draft.id}:${draft.revision}`;
  if (new TextEncoder().encode(value).length > 64) throw new Error('invalid_screenshot_callback');
  return value;
}

function parseCallback(value) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > 64) return null;
  const [prefix, action, id, revision, extra] = value.split(':');
  if (prefix !== 'sd' || !ACTIONS.has(action) || !UUID.test(id || '') || !/^\d{1,9}$/.test(revision || '') || extra !== undefined) return null;
  return { action, id, revision: Number(revision) };
}

function button(text, action, draft) { return { text, callback_data: screenshotCallback(action, draft) }; }
function collectionButtons(draft) {
  return { inline_keyboard: [
    ...(draft.sources?.length ? [[button('Розібрати', 'analyze', draft)]] : []),
    [button('Скасувати чернетку', 'cancel', draft)],
  ] };
}

function usablePhone(value) {
  const phone = clean(value, 40);
  const digits = phone.replace(/\D/g, '');
  return /^\+?[\d ().-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15;
}

export function screenshotPreview(draft, duplicates = []) {
  const fields = draft.fields || {};
  const lines = [
    `Чернетка заявки · ${CHANNELS[draft.channel] || 'Інший канал'}`,
    'Перевірте дані перед створенням:',
    `Клієнт: ${clean(fields.customer_name, 160) || 'не вказано'}`,
    `Телефон: ${clean(fields.customer_phone, 48) || 'не вказано'}`,
    `Авто: ${clean(fields.car, 240) || 'не вказано'}`,
    `VIN: ${clean(fields.vin, 32) || 'не вказано'}`,
    `Запчастини: ${clean(fields.item_name, 2000) || 'не вказано'}`,
    ...(fields.request_text && fields.request_text !== fields.item_name ? [`Деталі запиту: ${clean(fields.request_text, 4000)}`] : []),
    '', 'Звірте VIN, ліву/праву сторону, перед/зад, кількість і артикул з оригіналом.',
  ];
  const warnings = (Array.isArray(draft.warnings) ? draft.warnings : []).slice(0, 6);
  if (warnings.length) lines.push('', ...warnings.map(value => `Увага: ${clean(value, 220)}`));
  if (draft.blocking) lines.push('', 'Створення заблоковано: перевірте неоднозначні дані та підтвердьте виправлення в адмінці.');
  const complete = usablePhone(fields.customer_phone) && Boolean(clean(fields.item_name));
  if (!complete) lines.push('', 'Для створення потрібні телефон клієнта та запчастини. Доповніть їх через «Виправити в адмінці».');
  if (duplicates.length) lines.push('', 'Знайдено схожі заявки. Перевірте наявні в адмінці. Окрему заявку створюйте лише якщо це справді нове замовлення.');
  lines.push('', 'Це лише заявка: без оплати, зміни фінансів чи повідомлення клієнту.');
  const create = complete && !draft.blocking && draft.status === 'ready';
  const rows = [
    ...(create ? [[button(duplicates.length ? 'Створити окрему заявку' : 'Створити заявку', duplicates.length ? 'separate' : 'create', draft)]] : []),
    [{ text: 'Виправити в адмінці', url: adminLink(draft) }],
    [{ text: 'Вибрати наявну заявку', url: adminLink(draft) }],
    [button('Оновити перегляд', 'status', draft), button('Скасувати', 'cancel', draft)],
  ];
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

function sourceFromMessage(message) {
  const text = String(message.text || message.caption || '').trim();
  if (text.length > MAX_TEXT) return { error: 'Повідомлення завелике. Надішліть до 4000 символів одним повідомленням; текст не збережено.' };
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const image = photos.at(-1) || message.document;
  if (image) {
    if (!photos.length && !['image/jpeg', 'image/png'].includes(message.document?.mime_type)) {
      return { error: 'Надішліть скрин як фото або файл JPEG/PNG. Інші файли не зберігаються.' };
    }
    if (Number(image.file_size || 0) > MAX_IMAGE_BYTES) return { error: 'Зображення завелике. Максимум 8 МБ; файл не збережено.' };
    if (!/^[\w-]{1,256}$/.test(String(image.file_id || '')) || !image.file_unique_id || String(image.file_unique_id).length > 256) {
      return { error: 'Не вдалося отримати зображення. Надішліть його ще раз.' };
    }
    return { source: { message_id: message.message_id, kind: 'image', text, file_id: String(image.file_id), file_unique_id: String(image.file_unique_id || '') } };
  }
  if (message.voice || message.audio || message.video || message.video_note || message.sticker || message.animation || message.contact) {
    return { error: 'У цьому режимі приймаємо лише скрини та текст. Контакт клієнта можна написати текстом.' };
  }
  return text ? { source: { message_id: message.message_id, kind: 'text', text } } : { error: 'Надішліть скрин або текст запиту одного клієнта.' };
}

/** Private, explicitly started manager intake; ordinary and Business traffic is untouched. */
export async function handleScreenshotIntakeUpdate(env, update, overrides = {}) {
  if (['business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'].some(key => update?.[key])) return { handled: false };
  const api = { ...defaults, ...overrides };
  const callback = update?.callback_query;
  const message = update?.message || update?.edited_message || callback?.message;
  const from = callback?.from || message?.from;
  const body = typeof message?.text === 'string' ? message.text.trim() : '';
  const commandBody = /^\/start(?:@[a-z0-9_]+)?\s+intake\s*$/i.test(body) ? '/intake' : body;
  const command = commandBody.match(/^\/(intake|newlead|stop|help)(?:@[a-z0-9_]+)?(?:\s+([^\s]+))?\s*$/i);
  const starting = command && ['intake', 'newlead'].includes(command[1].toLowerCase());
  const screenshotAction = typeof callback?.data === 'string' && callback.data.startsWith('sd:');
  if (callback && !screenshotAction) return { handled: false };
  const recognized = Boolean(starting || screenshotAction);
  if (!message || !from || from.is_bot || message.via_bot || message.sender_business_bot || message.chat?.type !== 'private'
      || !/^[1-9]\d{0,15}$/.test(String(from.id || '')) || String(from.id) !== String(message.chat.id)) {
    return { handled: recognized, ...(recognized ? { skipped: 'private_manager_chat_required' } : {}) };
  }
  const managerId = String(from.id), chatId = String(message.chat.id);
  const send = async (text, reply_markup) => {
    // Long previews are split, never silently truncated before the confirmation buttons.
    const points = Array.from(clean(text, 16000));
    let result;
    for (let start = 0; start < points.length; start += 3900) {
      result = await telegram(env, 'sendMessage', {
        chat_id: chatId, text: points.slice(start, start + 3900).join(''), disable_web_page_preview: true,
        ...(reply_markup && start + 3900 >= points.length ? { reply_markup } : {}),
        // Deliberately no parse_mode: all customer/model strings are plain text.
      });
    }
    return result;
  };
  const acknowledge = () => callback?.id ? telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {}) : Promise.resolve();
  let manager;
  try { manager = await api.screenshotManager(env, managerId); }
  catch {
    if (!recognized) return { handled: false };
    await acknowledge();
    await send('Приймання заявок тимчасово недоступне. Спробуйте /intake пізніше.').catch(() => {});
    return { handled: true, skipped: 'intake_unavailable' };
  }
  if (!isApproved(manager)) {
    if (!recognized) return { handled: false };
    await acknowledge();
    if (starting) {
      try { await api.requestScreenshotAccess(env, { id: from.id, username: clean(from.username, 100), first_name: clean(from.first_name, 100), last_name: clean(from.last_name, 100) }); }
      catch {
        await send('Не вдалося зареєструвати запит доступу. Повторіть /intake пізніше.').catch(() => {});
        return { handled: true, skipped: 'access_request_failed' };
      }
    }
    await send(`Доступ до приймання заявок має підтвердити адміністратор.\nВаш Telegram ID: ${managerId}\nПередайте цей ID адміністратору та дочекайтеся підтвердження. Скрини й дані клієнтів поки не надсилайте.`).catch(() => {});
    return { handled: true, skipped: 'manager_not_approved' };
  }

  let draft;
  try { draft = await api.activeScreenshotDraft(env, managerId); }
  catch {
    // A known manager's media must not fall into receipt routing when intake state is unavailable.
    await acknowledge();
    await send('Не вдалося відкрити чернетку. Повторіть /intake пізніше.').catch(() => {});
    return { handled: true, skipped: 'intake_unavailable' };
  }
  if (!recognized && !active(draft)) return { handled: false };
  await acknowledge();
  try {
    const show = async ownDraft => {
      const current = await api.getScreenshotDraft(env, ownDraft.id, managerId);
      if (!current) throw new Error('draft_unavailable');
      if (current.status === 'applied') {
        await send(`Заявку ${clean(current.order_number, 40) || 'CRM'} вже збережено. Повторно її не створено.\nНова заявка: /intake`, { inline_keyboard: [[{ text: 'Відкрити в адмінці', url: adminLink(current) }]] });
      } else if (current.status === 'ready') {
        const duplicates = await api.findScreenshotDuplicates(env, current);
        const preview = screenshotPreview(current, Array.isArray(duplicates) ? duplicates : []);
        await send(preview.text, preview.reply_markup);
      } else if (current.status === 'collecting') {
        await send(`Чернетка · ${CHANNELS[current.channel] || 'Інший канал'}. Отримано ${current.sources?.length || 0} із 6 повідомлень.\nНадішліть усі скрини й текст одного клієнта, потім натисніть «Розібрати». До цього заявка в CRM не створюється.\nНе змішуйте різних клієнтів. Скасування: /stop.`, collectionButtons(current));
      } else {
        await send('Ця чернетка вже закрита або строк її дії сплив. Почніть нову: /intake.');
      }
    };

    if (screenshotAction) {
      const parsed = parseCallback(callback.data);
      if (!parsed) { await send('Ця кнопка недійсна. Відкрийте актуальну чернетку командою /intake.'); return { handled: true, skipped: 'invalid_callback' }; }
      draft = await api.getScreenshotDraft(env, parsed.id, managerId);
      if (!draft) { await send('Чернетка недоступна. Скористайтеся /intake.'); return { handled: true, skipped: 'draft_unavailable' }; }
      if (draft.status === 'applied') { await show(draft); return { handled: true, already_applied: true }; }
      if (!active(draft)) { await show(draft); return { handled: true, skipped: 'closed_draft' }; }
      if (parsed.action === 'status') { await show(draft); return { handled: true }; }
      if (draft.revision !== parsed.revision) {
        await send('Чернетка змінилася. Стара кнопка не виконала дію; перевірте нову версію нижче.');
        await show(draft); return { handled: true, skipped: 'stale_revision' };
      }
      if (parsed.action === 'cancel') {
        await api.cancelScreenshotDraft(env, draft.id, managerId);
        await send('Непідтверджену чернетку скасовано. Замовлення CRM не змінювалися. Нова заявка: /intake.', { remove_keyboard: true });
        return { handled: true };
      }
      if (parsed.action === 'analyze') {
        if (!draft.sources?.length) { await show(draft); return { handled: true }; }
        if (draft.status === 'ready') { await show(draft); return { handled: true, already_analyzed: true }; }
        const claimed = await api.claimScreenshotAnalysis(env, draft.id, managerId, parsed.revision);
        try {
          await send('Розбираю матеріали. Заявку буде створено тільки після вашого підтвердження.');
          const analysis = await api.analyzeScreenshotDraft(env, claimed);
          await api.saveScreenshotAnalysis(env, draft.id, managerId, parsed.revision, { ...analysis, analysis_token: claimed.analysis_token });
        } finally {
          await api.releaseScreenshotAnalysis(env, draft.id, managerId, parsed.revision, claimed.analysis_token).catch(() => {});
        }
        await show(draft);
        return { handled: true };
      }
      if (['create', 'separate'].includes(parsed.action)) {
        if (draft.status !== 'ready' || draft.blocking || !usablePhone(draft.fields?.customer_phone) || !clean(draft.fields?.item_name)) {
          await send('Спочатку перевірте й доповніть чернетку в адмінці. Заявку не створено.');
          await show(draft); return { handled: true, skipped: 'incomplete_draft' };
        }
        const duplicates = await api.findScreenshotDuplicates(env, draft);
        if (duplicates?.length && parsed.action !== 'separate') { await show(draft); return { handled: true, skipped: 'duplicate_confirmation_required' }; }
        const result = await api.confirmScreenshotDraft(env, draft.id, managerId, parsed.revision,
          { mode: 'create', ...(parsed.action === 'separate' ? { allow_duplicate: true } : {}) }, `Telegram manager ${managerId}`);
        await send(`Заявку ${clean(result.order_number, 40) || 'CRM'} ${result.already_applied ? 'вже було збережено — повторно не створено' : 'створено'}.\nБез оплати та повідомлення клієнту. Нова заявка: /intake.`,
          { inline_keyboard: [[{ text: 'Відкрити в адмінці', url: adminLink(draft) }]] });
        return { handled: true, applied: Boolean(result.applied), already_applied: Boolean(result.already_applied) };
      }
    }

    if (update.edited_message) {
      if (draft.sources?.some(source => String(source.message_id) === String(message.message_id))) {
        await api.cancelScreenshotDraft(env, draft.id, managerId);
        await send('Вихідне повідомлення було змінено. Щоб не підтвердити старі дані, непідтверджену чернетку скасовано. Замовлення CRM не змінювалися. Почніть /intake та надішліть актуальні матеріали знову.');
      } else {
        await send('Редаговані повідомлення не додаються до чернетки. Надішліть актуальний текст або скрин новим повідомленням.');
      }
      return { handled: true };
    }
    if (starting) {
      if (active(draft)) { await show(draft); return { handled: true }; }
      const channel = (command[2] || '').toLowerCase();
      if (!Object.hasOwn(CHANNELS, channel)) {
        await send('Нова заявка зі скринів. Оберіть справжній канал звернення клієнта. Надсилайте лише матеріали одного клієнта, без зайвих персональних даних.\nСкрини й текст розбирає Cloudflare Workers AI. Перед надсиланням повідомте клієнта про автоматизовану обробку; перевірка менеджером обов’язкова. Оригінали в Telegram залишаються, доки ви їх не видалите.', {
          keyboard: [[{ text: '/intake viber' }, { text: '/intake whatsapp' }], [{ text: '/intake other' }]],
          resize_keyboard: true, one_time_keyboard: true,
        });
        return { handled: true };
      }
      draft = await api.createScreenshotDraft(env, { manager_id: managerId, chat_id: chatId, channel });
      await show(draft);
      return { handled: true };
    }
    if (command?.[1].toLowerCase() === 'stop') {
      await api.cancelScreenshotDraft(env, draft.id, managerId);
      await send('Непідтверджену чернетку скасовано. Замовлення CRM не змінювалися. Нова заявка: /intake.', { remove_keyboard: true });
      return { handled: true };
    }
    if (body.startsWith('/')) {
      await send('Зараз збираємо одну заявку. Надішліть скрини/текст, потім «Розібрати». /intake — поточна чернетка; /stop — скасувати. Інші команди не виконано.', collectionButtons(draft));
      return { handled: true };
    }
    if (!Number.isSafeInteger(message.message_id) || message.message_id <= 0) return { handled: true, skipped: 'invalid_message_id' };
    const input = sourceFromMessage(message);
    if (input.error) { await send(input.error, collectionButtons(draft)); return { handled: true, skipped: 'unsupported_input' }; }
    if ((draft.sources?.length || 0) >= 6 && !draft.sources.some(source => String(source.message_id) === String(message.message_id))) {
      await send('Ліміт цієї чернетки — 6 повідомлень зі скринами/текстом. Новий матеріал не збережено. Натисніть «Розібрати» або /stop, щоб почати заново.', collectionButtons(draft));
      return { handled: true, skipped: 'source_limit' };
    }
    await api.addScreenshotSource(env, draft.id, managerId, input.source);
    await show(draft);
    return { handled: true };
  } catch (error) {
    if (error?.code === 'duplicate_detected') {
      await send('Знайдено схожу заявку. Нову не створено. Відкрийте /intake та перевірте дублікати перед окремим підтвердженням.').catch(() => {});
    } else {
      await send('Дію не завершено або чернетка змінилася. Не створюйте повторну заявку навмання: відкрийте /intake, перевірте стан і повторіть потрібну дію. Технічні деталі приховано.').catch(() => {});
    }
    return { handled: true, skipped: 'intake_action_failed' };
  }
}
