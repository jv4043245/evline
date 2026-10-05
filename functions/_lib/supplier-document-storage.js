const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP = 'evline-supplier-documents';
const MAX_BYTES = 10 * 1024 * 1024;
const SETTINGS = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'];
const tokens = new WeakMap();
const value = (env, key) => String(env[key] || '').trim();
const validId = id => /^[A-Za-z0-9_-]{10,200}$/.test(id);
function fail(message, status = 503) { throw Object.assign(new Error(message), { publicMessage: message, status }); }

export function documentStorageStatus(env) {
  if (SETTINGS.some(key => value(env, key))) {
    return { provider: 'google_drive', ready: SETTINGS.every(key => value(env, key)) && validId(value(env, 'GOOGLE_DRIVE_FOLDER_ID')) };
  }
  return { provider: env.SUPPLIER_DOCUMENTS ? 'r2' : null, ready: Boolean(env.SUPPLIER_DOCUMENTS) };
}

async function boundedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > limit) fail('Google Диск повернув файл завеликого розміру.');
      chunks.push(chunk);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function json(response) {
  try { return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 32768))); }
  catch { fail('Не вдалося прочитати відповідь Google Диска.'); }
}
async function request(url, options = {}) {
  try { return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) }); }
  catch { fail('Google Диск тимчасово недоступний. Спробуйте пізніше.'); }
}
async function token(env) {
  const settings = SETTINGS.slice(0, 3).map(key => value(env, key));
  const cached = tokens.get(env);
  if (cached && cached.settings.every((setting, i) => setting === settings[i]) && cached.expires > Date.now()) return cached.token;
  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: settings[0], client_secret: settings[1], refresh_token: settings[2], grant_type: 'refresh_token' }),
  });
  const data = await json(response);
  if (!response.ok || !data.access_token) fail('Потрібно повторно підключити Google Диск. Зверніться до адміністратора.');
  if (data.scope && !data.scope.split(' ').includes(SCOPE)) fail('Google Диск не надав доступ до файлів CRM.');
  tokens.set(env, { settings, token: data.access_token, expires: Date.now() + Math.max(0, Math.min(Number(data.expires_in) || 0, 3600) - 60) * 1000 });
  return data.access_token;
}
async function drive(env, url, options = {}) {
  if (!SETTINGS.every(key => value(env, key)) || !validId(value(env, 'GOOGLE_DRIVE_FOLDER_ID'))) fail('Приватне сховище Google Диск ще не підключене.');
  const response = await request(url, { ...options, headers: { ...options.headers, authorization: `Bearer ${await token(env)}` } });
  if (response.ok) return response;
  if (response.status === 401) tokens.delete(env);
  const data = await json(response);
  const reasons = (data.error?.errors || []).map(error => error.reason);
  if (reasons.includes('storageQuotaExceeded')) fail('На Google Диску закінчилося місце. Звільніть місце перед завантаженням.', 507);
  if (response.status === 429 || reasons.some(reason => /rateLimit/i.test(reason))) fail('Google Диск тимчасово обмежив кількість запитів. Спробуйте пізніше.', 429);
  if ([401, 403, 404].includes(response.status)) fail('Немає доступу до папки або файла Google Диска. Перевірте підключення.');
  fail('Не вдалося виконати дію з Google Диском. Спробуйте пізніше.');
}
function privateFile(file) {
  if (file.trashed || !Array.isArray(file.permissions) || file.permissions.some(p => ['anyone', 'domain'].includes(p.type))) {
    fail('Папка або файл мають бути приватними та не перебувати в кошику.');
  }
}
async function folder(env) {
  const file = await json(await drive(env, `${API}/${value(env, 'GOOGLE_DRIVE_FOLDER_ID')}?fields=id,mimeType,trashed,permissions(type)`));
  privateFile(file);
  if (file.mimeType !== 'application/vnd.google-apps.folder') fail('Для сховища потрібно вибрати папку Google Диска.');
}
function driveId(key) {
  const id = String(key).slice('gdrive:'.length);
  if (!String(key).startsWith('gdrive:') || !validId(id)) fail('Некоректне посилання на оригінал документа.');
  return id;
}

export async function storeDocumentOriginal(env, key, bytes, metadata) {
  const status = documentStorageStatus(env);
  if (!status.ready) fail('Приватне сховище ще не підключене.');
  if (status.provider === 'r2') {
    await env.SUPPLIER_DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: metadata.mime } });
    return key;
  }
  if (!bytes.length || bytes.length > MAX_BYTES) fail('Максимум 10 МБ на файл.', 413);
  await folder(env);
  // Allocate the ID first so an interrupted upload can be cleaned up without listing private files.
  const generated = await json(await drive(env, `${API}/generateIds?count=1&space=drive&type=files`));
  const id = generated.ids?.[0];
  if (!validId(id)) fail('Google Диск не створив ідентифікатор файла.');
  try {
    const response = await drive(env, `${UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-upload-content-type': metadata.mime, 'x-upload-content-length': String(bytes.length) },
      body: JSON.stringify({ id, name: metadata.name, mimeType: metadata.mime, parents: [value(env, 'GOOGLE_DRIVE_FOLDER_ID')], appProperties: { application: APP, version_key: key } }),
    });
    const location = response.headers.get('location');
    let upload;
    try { upload = new URL(location); } catch { fail('Google Диск не створив сеанс завантаження.'); }
    if (upload.origin !== 'https://www.googleapis.com' || upload.pathname !== '/upload/drive/v3/files' || upload.username || upload.password || upload.hash) fail('Некоректна адреса завантаження Google Диска.');
    const result = await json(await drive(env, upload.href, { method: 'PUT', headers: { 'content-type': metadata.mime }, body: bytes }));
    if (result.id !== id) fail('Google Диск не підтвердив збереження файла.');
    return `gdrive:${id}`;
  } catch (error) {
    await removeDocumentOriginal(env, `gdrive:${id}`).catch(() => {});
    throw error;
  }
}

export async function loadDocumentOriginal(env, row) {
  if (!String(row.object_key).startsWith('gdrive:')) {
    if (!env.SUPPLIER_DOCUMENTS) fail('Сховище оригіналу тимчасово недоступне.');
    const result = await env.SUPPLIER_DOCUMENTS.get(row.object_key);
    if (!result) fail('Оригінал тимчасово недоступний.');
    return result;
  }
  const id = driveId(row.object_key);
  const file = await json(await drive(env, `${API}/${id}?fields=id,parents,trashed,size,appProperties,permissions(type)`));
  privateFile(file);
  if (!file.parents?.includes(value(env, 'GOOGLE_DRIVE_FOLDER_ID')) || file.appProperties?.application !== APP) fail('Файл не належить сховищу документів CRM.');
  if (Number(file.size) !== row.bytes || row.bytes > MAX_BYTES || row.bytes < 1) fail('Розмір оригіналу змінився. Завантажте нову версію через CRM.');
  const bytes = await boundedBytes(await drive(env, `${API}/${id}?alt=media`), Math.min(row.bytes, MAX_BYTES));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== row.bytes || hash !== row.sha256) fail('Оригінал змінено поза CRM. Завантажте його як нову версію.');
  return new Response(bytes);
}

export async function removeDocumentOriginal(env, key) {
  if (!String(key).startsWith('gdrive:')) return env.SUPPLIER_DOCUMENTS.delete(key);
  // Failed uploads go to Trash, never permanent deletion; archived CRM links retain originals.
  await drive(env, `${API}/${driveId(key)}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}
