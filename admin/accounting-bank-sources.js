const BASE = '/api/admin/accounting/bank-sources';
const HEX = /^[a-f0-9]{64}$/;
const MIME = new Set(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']);
const sizeNumber = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const kyivTime = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
const fullTimestamp = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateText = value => validDate(value) ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
const safeFilename = value => String(value).split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').slice(0, 180) || 'bank-statement';
const bytesText = value => value < 1024 ? `${value} Б` : value < 1024 * 1024 ? `${sizeNumber.format(value / 1024)} КБ` : `${sizeNumber.format(value / (1024 * 1024))} МБ`;

function validate(data, now) {
  if (!data || typeof data.allowed !== 'boolean' || typeof data.locked !== 'boolean' || !Array.isArray(data.files)) throw new Error('invalid_bank_sources_response');
  if (!data.allowed || data.locked) {
    if (!data.locked || data.files.length || data.expires_at !== null) throw new Error('invalid_bank_sources_locked_response');
    return data;
  }
  if (typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= now().getTime() ||
      data.files.length > 100 || new Set(data.files.map(file => file?.id)).size !== data.files.length ||
      data.files.some(file => !file || !HEX.test(file.id) || !HEX.test(file.sha256) || typeof file.filename !== 'string' ||
        !file.filename || file.filename.length > 512 || !/\.(csv|xlsx|xls)$/i.test(file.filename) || !MIME.has(file.mime) ||
        !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
        (file.date_from !== null && file.date_from !== undefined && !validDate(file.date_from)) ||
        (file.date_to !== null && file.date_to !== undefined && !validDate(file.date_to)) ||
        (file.date_from && file.date_to && file.date_from > file.date_to))) throw new Error('invalid_bank_sources_files');
  return data;
}

const markup = `
  <div class="accounting-bank-sources__heading"><div><h1>Банківські виписки · оригінали</h1><p>Оригінальні файли з банку для перевірки оплат</p></div><span class="accounting-bank-sources__badge">Особистий доступ</span></div>
  <section class="accounting-bank-sources__panel">
    <div class="accounting-bank-sources__loading" data-sources-loading hidden>Перевірка доступу…</div>
    <div class="accounting-bank-sources__locked" data-sources-locked hidden>
      <div class="accounting-bank-sources__lock-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/></svg></div>
      <div class="accounting-bank-sources__lock-copy"><h2>Відкрити оригінали виписок</h2><p>Файли доступні лише власнику облікового запису. Для відкриття потрібен додатковий пароль.</p></div>
      <form class="accounting-bank-sources__unlock-form" data-sources-form autocomplete="off" novalidate><label>Додатковий пароль<input name="password" type="password" autocomplete="off" spellcheck="false" maxlength="512" required></label><button class="admin-btn admin-btn--primary" type="submit" data-sources-unlock>Відкрити виписки</button></form>
      <small class="accounting-bank-sources__hint">Доступ тимчасовий. Після перегляду натисніть «Закрити доступ».</small>
    </div>
    <div data-sources-unlocked hidden>
      <div class="accounting-bank-sources__toolbar"><div><h2>Файли виписок</h2><p data-sources-expiry></p></div><button class="admin-btn admin-btn--small" type="button" data-sources-lock>Закрити доступ</button></div>
      <div class="accounting-bank-sources__files" data-sources-files></div>
      <p class="accounting-bank-sources__note">Завантажуються оригінальні CSV та Excel. Це банківські джерела; аналітична таблиця з підсумками зберігається окремо.</p>
    </div>
    <div class="accounting-bank-sources__feedback"><p data-sources-message role="status" aria-live="polite"></p><button class="admin-btn admin-btn--small" type="button" data-sources-retry hidden>Спробувати ще</button></div>
  </section>`;

export function createAccountingBankSourcesView(container, { api, request, onAccessChange = () => {}, now = () => new Date() } = {}) {
  const noop = { load: async () => false, probeAccess: async () => false, hide() {}, lock: async () => false, reset() {}, isAllowed: () => false, isBusy: () => false, hasChanges: () => false, canLeave: () => true };
  if (!container || typeof api !== 'function' || typeof request !== 'function') return noop;
  const document = container.ownerDocument, window = document.defaultView;
  container.classList.add('accounting-bank-sources'); container.innerHTML = markup;
  const find = name => container.querySelector(`[data-sources-${name}]`), form = find('form'), password = form.elements.namedItem('password');
  let allowed = null, locked = true, files = [], session = '', expiresAt = null, expiryTimer = null, sequence = 0, pending = null, busy = false, loaded = false, accessSequence = 0, accessPending = null;
  const blobUrls = new Map();
  // Revocation survives local navigation/reset. Forgetting the token must not
  // make a second hide() abort the request that invalidates it on the server.
  const revocations = new Map();
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const headers = token => token ? { 'x-bank-source-session': token } : {};
  const notify = (text = '', error = false, retry = false) => { find('message').textContent = text; find('message').dataset.error = String(error); find('retry').hidden = !retry; };
  const setBusy = value => {
    busy = value; container.setAttribute('aria-busy', String(value));
    password.disabled = value; find('unlock').disabled = value; find('retry').disabled = value;
    find('lock').disabled = value && locked;
    container.querySelectorAll('[data-sources-download]').forEach(button => { button.disabled = value; });
  };
  const cancelPending = () => { sequence += 1; pending?.controller.abort(); pending = null; };
  const cancelAccess = () => { accessSequence += 1; accessPending?.controller.abort(); accessPending = null; };
  const clearExpiry = () => { if (expiryTimer !== null) window.clearTimeout(expiryTimer); expiryTimer = null; };
  const clearBlobs = () => { for (const [url, timer] of blobUrls) { window.clearTimeout(timer); window.URL.revokeObjectURL(url); } blobUrls.clear(); };
  const forgetSession = () => { session = ''; expiresAt = null; locked = true; files = []; password.value = ''; clearExpiry(); clearBlobs(); };
  const setAllowed = value => { const changed = allowed !== value; allowed = value; container.hidden = value === false; if (changed) onAccessChange(value === true); };
  function renderFiles() {
    const mount = find('files'); mount.replaceChildren();
    for (const file of files) {
      const article = element('article', undefined, 'accounting-bank-sources__file'), type = file.filename.split('.').at(-1).toUpperCase();
      const icon = element('span', type, 'accounting-bank-sources__file-type'), content = element('div', undefined, 'accounting-bank-sources__file-content');
      const title = element('h3', file.filename), dates = element('p', validDate(file.date_from) && validDate(file.date_to) ? `${dateText(file.date_from)} — ${dateText(file.date_to)}` : 'Період у виписці не зазначено');
      const meta = element('small', `${type} · ${bytesText(file.bytes)} · оригінал`);
      const details = element('details', undefined, 'accounting-bank-sources__file-details'); details.append(element('summary', 'Дані файлу'));
      const list = element('dl');
      const add = (label, value, className) => { const row = element('div'); row.append(element('dt', label), element('dd', value, className)); list.append(row); };
      add('Розмір', `${file.bytes.toLocaleString('uk-UA')} байт`); add('SHA-256', file.sha256, 'accounting-bank-sources__sha');
      if (typeof file.created_at === 'string' && Number.isFinite(Date.parse(file.created_at))) add('Додано', `${fullTimestamp.format(new Date(file.created_at))} · Київ`);
      details.append(list); content.append(title, dates, meta, details);
      const button = element('button', 'Завантажити', 'admin-btn admin-btn--small'); button.type = 'button'; button.dataset.sourcesDownload = file.id;
      button.setAttribute('aria-label', `Завантажити ${file.filename}`); article.append(icon, content, button); mount.append(article);
    }
    if (!files.length) mount.append(element('p', 'Оригінали виписок ще не додано.', 'accounting-bank-sources__empty'));
  }
  function render() {
    find('locked').hidden = allowed !== true || !locked;
    find('unlocked').hidden = allowed !== true || locked;
    if (!locked && expiresAt) { find('expiry').textContent = `${files.length} файли · доступ до ${kyivTime.format(new Date(expiresAt))} за Києвом`; renderFiles(); }
    else { find('files').replaceChildren(); find('expiry').textContent = ''; }
  }
  function scheduleExpiry() {
    clearExpiry();
    if (locked || !expiresAt) return;
    const delay = Date.parse(expiresAt) - now().getTime();
    if (delay <= 0) { lock({ expired: true }).catch(() => {}); return; }
    expiryTimer = window.setTimeout(() => { expiryTimer = null; lock({ expired: true }).catch(() => {}); }, Math.min(delay, 2147483647));
  }
  function accept(result, { unlock = false } = {}) {
    const data = validate(result, now);
    if (unlock && (data.locked || !data.allowed || typeof data.session_token !== 'string' || !data.session_token || data.session_token.length > 4096)) throw new Error('invalid_bank_source_session');
    if (!data.locked && !unlock && !session) throw new Error('missing_bank_source_session');
    setAllowed(data.allowed); locked = data.locked; files = data.files; expiresAt = data.expires_at;
    if (unlock) session = data.session_token;
    if (locked || !allowed) forgetSession();
    loaded = true; render(); scheduleExpiry(); return data.allowed;
  }
  async function probeAccess() {
    if (accessPending) return accessPending.promise;
    const current = ++accessSequence, controller = new window.AbortController();
    const promise = Promise.resolve().then(() => api(BASE, { signal: controller.signal, cache: 'no-store' })).then(result => {
      if (current !== accessSequence) return false;
      if (!result || typeof result.allowed !== 'boolean') throw new Error('invalid_bank_sources_access');
      setAllowed(result.allowed);
      if (!result.allowed) { cancelPending(); forgetSession(); loaded = false; render(); setBusy(false); }
      return result.allowed;
    }).catch(error => {
      if (current !== accessSequence || error?.name === 'AbortError') return false;
      setAllowed(false); cancelPending(); forgetSession(); loaded = false; render(); setBusy(false);
      if (error?.status === 401) throw error;
      return false;
    }).finally(() => { if (current === accessSequence) accessPending = null; });
    accessPending = { promise, controller }; return promise;
  }
  async function load({ force = false } = {}) {
    if (pending) return pending.promise;
    if (busy && revocations.size) return Promise.all([...revocations.values()]).then(results => results.every(Boolean));
    if (loaded && !force) { if (!locked && Date.parse(expiresAt) <= now().getTime()) return lock({ expired: true }); render(); return allowed === true; }
    cancelPending(); const current = sequence, controller = new window.AbortController();
    find('loading').hidden = false; notify(); setBusy(true);
    const promise = Promise.resolve().then(() => api(BASE, { headers: headers(session), signal: controller.signal, cache: 'no-store' })).then(result => {
      if (current !== sequence) return false; return accept(result);
    }).catch(error => {
      if (current !== sequence || error?.name === 'AbortError') return false;
      forgetSession(); render();
      if (error?.status === 401 || error?.status === 403 || error?.status === 503) setAllowed(false);
      else notify('Не вдалося завантажити виписки. Спробуйте ще раз.', true, true);
      if (error?.status === 401) throw error;
      return false;
    }).finally(() => { if (current === sequence) { pending = null; find('loading').hidden = true; setBusy(false); } });
    pending = { promise, controller }; return promise;
  }
  async function unlock() {
    if (busy || allowed !== true || !locked) return false;
    const value = password.value; password.value = '';
    if (!value) { notify('Введіть додатковий пароль.', true); password.focus(); return false; }
    cancelPending(); const current = sequence, controller = new window.AbortController(); setBusy(true); notify('Перевірка пароля…');
    const promise = Promise.resolve().then(() => api(`${BASE}/unlock`, { method: 'POST', body: JSON.stringify({ password: value }), signal: controller.signal, cache: 'no-store' })).then(result => {
      if (current !== sequence) return false;
      const accepted = accept(result, { unlock: true }); notify(); return accepted;
    }).catch(error => {
      if (current !== sequence || error?.name === 'AbortError') return false;
      forgetSession(); render();
      if (error?.status === 401) { setAllowed(false); throw error; }
      notify(error?.status === 403 ? 'Не вдалося відкрити виписки. Перевірте пароль.' : error?.status === 429 ? 'Забагато спроб. Спробуйте пізніше.' : 'Не вдалося відкрити виписки. Спробуйте ще раз.', true);
      return false;
    }).finally(() => { if (current === sequence) { pending = null; setBusy(false); } });
    pending = { promise, controller }; return promise;
  }
  async function lock({ expired = false } = {}) {
    const token = session; cancelPending(); const current = sequence, controller = new window.AbortController();
    forgetSession(); render(); find('loading').hidden = true; setBusy(true); notify(expired ? 'Час доступу завершився. Введіть пароль ще раз.' : 'Доступ закрито.');
    if (!token) {
      if (!revocations.size) { setBusy(false); return true; }
      return Promise.all([...revocations.values()]).then(results => results.every(Boolean)).finally(() => { if (current === sequence) setBusy(false); });
    }
    const promise = Promise.resolve().then(() => api(`${BASE}/lock`, { method: 'POST', body: '{}', headers: headers(token), signal: controller.signal, cache: 'no-store' })).then(result => {
      if (current === sequence) accept(result); return true;
    }).catch(error => { if (current === sequence && error?.status === 401) setAllowed(false); return false; }).finally(() => {
      revocations.delete(token);
      if (current === sequence) setBusy(false);
    });
    revocations.set(token, promise); return promise;
  }
  async function download(id) {
    const file = files.find(item => item.id === id);
    if (!file || locked || busy || allowed !== true) return;
    if (Date.parse(expiresAt) <= now().getTime()) { await lock({ expired: true }); return; }
    cancelPending(); const current = sequence, controller = new window.AbortController(); setBusy(true); notify(`Завантаження ${file.filename}…`);
    const promise = Promise.resolve().then(async () => {
      const response = await request(`${BASE}/${encodeURIComponent(id)}/download`, { headers: headers(session), signal: controller.signal, cache: 'no-store' });
      if (current !== sequence) return false;
      if (!response?.ok) throw Object.assign(new Error('bank_source_download_failed'), { status: response?.status });
      const blob = await response.blob();
      if (current !== sequence) return false;
      if (blob.size !== file.bytes) throw new Error('bank_source_size_mismatch');
      if (Date.parse(expiresAt) <= now().getTime()) { await lock({ expired: true }); return false; }
      const url = window.URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = safeFilename(file.filename); document.body.append(link);
      try { link.click(); } finally {
        link.remove(); blobUrls.set(url, window.setTimeout(() => { window.URL.revokeObjectURL(url); blobUrls.delete(url); }, 1000));
      }
      notify(); return true;
    }).catch(error => {
      if (current !== sequence || error?.name === 'AbortError') return false;
      if (error?.status === 401 || error?.status === 403 || error?.status === 423) { forgetSession(); render(); if (error.status === 401) setAllowed(false); notify('Доступ завершився. Введіть пароль ще раз.', true); }
      else notify('Не вдалося завантажити оригінал. Спробуйте ще раз.', true);
      return false;
    }).finally(() => { if (current === sequence) { pending = null; setBusy(false); } });
    pending = { promise, controller }; return promise;
  }
  const visibility = () => { if (!locked && expiresAt && Date.parse(expiresAt) <= now().getTime()) lock({ expired: true }).catch(() => {}); };
  document.addEventListener('visibilitychange', visibility);
  form.addEventListener('submit', event => { event.preventDefault(); unlock().catch(() => {}); });
  find('lock').addEventListener('click', () => { lock().catch(() => {}); });
  find('retry').addEventListener('click', () => { load({ force: true }).catch(() => {}); });
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-sources-download]'); if (button && container.contains(button)) download(button.dataset.sourcesDownload).catch(() => {});
  });
  return {
    load, lock, probeAccess,
    hide({ lock: shouldLock = true } = {}) {
      password.value = ''; if (shouldLock) return lock(); cancelPending(); setBusy(false); find('loading').hidden = true;
    },
    reset() { cancelAccess(); cancelPending(); forgetSession(); loaded = false; setAllowed(false); render(); notify(); find('loading').hidden = true; setBusy(false); },
    isAllowed: () => allowed === true, isBusy: () => busy, hasChanges: () => false, isDirty: () => false, canLeave: () => true,
    destroy() { cancelAccess(); cancelPending(); forgetSession(); document.removeEventListener('visibilitychange', visibility); },
  };
}
