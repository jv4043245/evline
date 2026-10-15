import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAccountingBankSourcesView } from '../admin/accounting-bank-sources.js';

const BASE = '/api/admin/accounting/bank-sources', token = 'temporary-session-only-in-memory';
const tick = () => new Promise(resolve => setImmediate(resolve));
const locked = (allowed = true) => ({ allowed, locked: true, files: [], expires_at: null });
const file = (extra = {}) => ({ id: 'a'.repeat(64), filename: 'report.csv', mime: 'text/csv', bytes: 3, sha256: 'b'.repeat(64), date_from: '2025-09-14', date_to: '2026-10-07', created_at: '2026-10-15T09:30:00Z', ...extra });
const unlocked = (extra = {}) => ({ allowed: true, locked: false, files: [file()], expires_at: '2026-10-15T10:15:00Z', session_token: token, ...extra });
function mount(t, { api, request, ...options } = {}) {
  const window = new JSDOM('<section id="root"></section>', { url: 'https://evline.test/admin/' }).window;
  const root = window.document.querySelector('#root'), calls = [], rawCalls = [], downloads = [], revoked = [], access = [];
  let clock = new Date('2026-10-15T10:00:00Z');
  window.URL.createObjectURL = () => 'blob:private-bank-original'; window.URL.revokeObjectURL = url => revoked.push(url);
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, filename: this.download }); };
  const controller = createAccountingBankSourcesView(root, {
    api: async (...args) => { calls.push(args); return api ? api(...args) : args[0].endsWith('/unlock') ? unlocked() : locked(); },
    request: async (...args) => { rawCalls.push(args); return request ? request(...args) : new Response('abc'); },
    onAccessChange: value => access.push(value), now: () => clock, ...options,
  });
  t.after(() => { controller.destroy(); window.close(); });
  return { window, root, controller, calls, rawCalls, downloads, revoked, access, form: root.querySelector('form'), get: key => root.querySelector(`[data-sources-${key}]`), setNow: value => { clock = new Date(value); } };
}
async function submit(view, password = 'private-test-password') {
  view.form.elements.password.value = password;
  view.form.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

test('capability probe stays quiet and other administrators receive no source controls or metadata', async t => {
  const view = mount(t, { api: async () => locked(false) });
  assert.equal(await view.controller.probeAccess(), false);
  assert.equal(view.root.hidden, true); assert.equal(view.get('locked').hidden, true); assert.equal(view.get('unlocked').hidden, true);
  assert.deepEqual(view.access, [false]); assert.equal(view.controller.isAllowed(), false);
  assert.equal(view.calls[0][0], BASE); assert.equal(view.calls[0][1].headers, undefined);
  assert.equal(view.get('files').children.length, 0);
  const owner = mount(t); assert.equal(await owner.controller.probeAccess(), true);
  assert.equal(owner.get('locked').hidden, true); assert.equal(owner.get('unlocked').hidden, true);
  assert.deepEqual(owner.access, [true]);
  await owner.controller.load(); assert.equal(owner.get('locked').hidden, false);
});

test('unlock clears password immediately and keeps session exclusively in memory and protected request headers', async t => {
  const view = mount(t); await view.controller.load();
  await submit(view);
  const [url, options] = view.calls[1];
  assert.equal(url, `${BASE}/unlock`); assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { password: 'private-test-password' });
  assert.equal(view.form.elements.password.value, ''); assert.equal(view.get('locked').hidden, true); assert.equal(view.get('unlocked').hidden, false);
  assert.equal(view.window.localStorage.length, 0); assert.equal(view.window.sessionStorage.length, 0); assert.equal(view.window.document.cookie, '');
  assert.doesNotMatch(view.root.outerHTML, /temporary-session-only-in-memory|private-test-password/);
  assert.match(view.get('files').textContent, /report\.csv/); assert.match(view.get('files').textContent, /14\.09\.2025 — 07\.10\.2026/);
  assert.match(view.get('expiry').textContent, /13:15 за Києвом/);
  await view.controller.load({ force: true });
  assert.deepEqual(view.calls.at(-1)[1].headers, { 'x-bank-source-session': token });
});

test('wrong password and rate errors clear inputs, show no source metadata and never expose server details', async t => {
  for (const status of [403, 429, 500]) {
    const view = mount(t, { api: async path => { if (path.endsWith('/unlock')) throw Object.assign(new Error('SECRET internal owner password details'), { status }); return locked(); } });
    await view.controller.load(); await submit(view);
    assert.equal(view.form.elements.password.value, ''); assert.equal(view.get('locked').hidden, false); assert.equal(view.get('unlocked').hidden, true);
    assert.equal(view.get('files').children.length, 0); assert.doesNotMatch(view.root.textContent, /SECRET|internal owner/);
    assert.match(view.get('message').textContent, status === 429 ? /Забагато спроб/ : status === 403 ? /Перевірте пароль/ : /Спробуйте ще раз/);
  }
});

test('original filename and SHA render as text; downloads use authenticated Blob fetch and sanitize filename', async t => {
  const name = '../../<img src=x>.csv';
  const view = mount(t, { api: async path => path.endsWith('/unlock') ? unlocked({ files: [file({ filename: name })] }) : locked() });
  await view.controller.load(); await submit(view);
  assert.equal(view.root.querySelector('img'), null); assert.ok(view.get('files').textContent.includes(name));
  assert.ok(view.get('files').textContent.includes('b'.repeat(64)));
  view.root.querySelector('[data-sources-download]').click(); await tick();
  assert.equal(view.rawCalls.length, 1); assert.equal(view.rawCalls[0][0], `${BASE}/${'a'.repeat(64)}/download`);
  assert.deepEqual(view.rawCalls[0][1].headers, { 'x-bank-source-session': token });
  assert.equal(view.rawCalls[0][1].cache, 'no-store');
  assert.deepEqual(view.downloads, [{ href: 'blob:private-bank-original', filename: '<img src=x>.csv' }]);
  assert.equal(view.root.querySelector('a'), null);
  await view.controller.hide();
  assert.deepEqual(view.revoked, ['blob:private-bank-original']);
  const call = view.calls.at(-1); assert.equal(call[0], `${BASE}/lock`); assert.equal(call[1].method, 'POST'); assert.deepEqual(call[1].headers, { 'x-bank-source-session': token });
  assert.equal(view.get('unlocked').hidden, true); assert.equal(view.get('files').children.length, 0);
});

test('leaving the source tab locks it; reopening and logout cannot reuse a forgotten token', async t => {
  const view = mount(t); await view.controller.load(); await submit(view); await view.controller.hide();
  assert.equal(view.get('locked').hidden, false); assert.equal(view.get('files').children.length, 0);
  await view.controller.load({ force: true }); assert.deepEqual(view.calls.at(-1)[1].headers, {});
  await submit(view); view.controller.reset();
  assert.equal(view.controller.isAllowed(), false); assert.equal(view.root.hidden, true); assert.equal(view.get('files').children.length, 0);
  await view.controller.load({ force: true }); assert.deepEqual(view.calls.at(-1)[1].headers, {});
});

test('expiry closes originals and revokes access even after a suspended background tab resumes', async t => {
  const view = mount(t); await view.controller.load(); await submit(view);
  view.setNow('2026-10-15T10:15:01Z'); view.window.document.dispatchEvent(new view.window.Event('visibilitychange')); await tick();
  assert.equal(view.get('unlocked').hidden, true); assert.equal(view.get('files').children.length, 0);
  assert.match(view.get('message').textContent, /Час доступу завершився/);
  assert.equal(view.calls.at(-1)[0], `${BASE}/lock`); assert.deepEqual(view.calls.at(-1)[1].headers, { 'x-bank-source-session': token });
});

test('repeated hide/lock and a quick reopen share one unabortable server revocation', async t => {
  let finish;
  const view = mount(t, { api: async path => path.endsWith('/unlock') ? unlocked() : path.endsWith('/lock') ? new Promise(resolve => { finish = resolve; }) : locked() });
  await view.controller.load(); await submit(view);
  const first = view.controller.hide(), second = view.controller.lock(), third = view.controller.hide(); await tick();
  const locking = view.calls.filter(([path]) => path.endsWith('/lock'));
  assert.equal(locking.length, 1); assert.equal(locking[0][1].signal.aborted, false); assert.equal(view.get('lock').disabled, true);
  const reopen = view.controller.load({ force: true }); await tick();
  assert.equal(view.calls.length, 3); assert.equal(locking[0][1].signal.aborted, false);
  finish(locked()); assert.deepEqual(await Promise.all([first, second, third, reopen]), [true, true, true, true]);
  assert.equal(view.get('unlocked').hidden, true); assert.equal(view.get('files').children.length, 0); assert.equal(view.controller.isBusy(), false);
});

test('logout clears local sources while allowing an already-issued server revocation to finish', async t => {
  let finish;
  const view = mount(t, { api: async path => path.endsWith('/unlock') ? unlocked() : path.endsWith('/lock') ? new Promise(resolve => { finish = resolve; }) : locked() });
  await view.controller.load(); await submit(view); const closing = view.controller.lock(); await tick();
  const revocation = view.calls.at(-1); view.controller.reset();
  assert.equal(revocation[1].signal.aborted, false); assert.equal(view.root.hidden, true);
  finish(locked()); assert.equal(await closing, true);
  assert.equal(view.root.hidden, true); assert.equal(view.controller.isAllowed(), false); assert.equal(view.get('files').children.length, 0);
});

test('a pending revocation cannot prevent hide from aborting a newer unlock after an auth reset', async t => {
  let finishRevoke, finishUnlock, unlockCount = 0;
  const view = mount(t, { api: async path => {
    if (path.endsWith('/lock')) return new Promise(resolve => { finishRevoke = resolve; });
    if (path.endsWith('/unlock')) { unlockCount += 1; return unlockCount === 1 ? unlocked() : new Promise(resolve => { finishUnlock = resolve; }); }
    return locked();
  } });
  await view.controller.load(); await submit(view); const revoking = view.controller.lock(); await tick();
  view.controller.reset(); await view.controller.load(); await submit(view); const hiding = view.controller.hide();
  assert.equal(view.calls.at(-1)[1].signal.aborted, true);
  finishUnlock(unlocked({ session_token: 'new-owner-session' })); await tick();
  assert.equal(view.get('unlocked').hidden, true); assert.equal(view.get('files').children.length, 0);
  finishRevoke(locked()); await Promise.all([revoking, hiding]); assert.equal(view.controller.isBusy(), false);
});

test('reset invalidates slow capability and unlock responses; stale sensitive data cannot reappear after logout', async t => {
  let finishProbe;
  const probe = mount(t, { api: async () => new Promise(resolve => { finishProbe = resolve; }) });
  const capability = probe.controller.probeAccess(); await tick(); probe.controller.reset();
  assert.equal(probe.calls[0][1].signal.aborted, true); finishProbe(locked()); assert.equal(await capability, false); assert.equal(probe.controller.isAllowed(), false);
  let finishUnlock;
  const view = mount(t, { api: async path => path.endsWith('/unlock') ? new Promise(resolve => { finishUnlock = resolve; }) : locked() });
  await view.controller.load(); await submit(view); view.controller.reset();
  assert.equal(view.calls[1][1].signal.aborted, true); finishUnlock(unlocked()); await tick();
  assert.equal(view.root.hidden, true); assert.equal(view.get('files').children.length, 0); assert.equal(view.controller.isBusy(), false);
});

test('failed integrity or expired authorization prevents download and handles source-session loss', async t => {
  const badSize = mount(t, { request: async () => new Response('truncated') });
  await badSize.controller.load(); await submit(badSize); badSize.root.querySelector('[data-sources-download]').click(); await tick();
  assert.equal(badSize.downloads.length, 0); assert.match(badSize.get('message').textContent, /Не вдалося завантажити/);
  for (const status of [403, 423]) {
    const expired = mount(t, { request: async () => new Response('', { status }) });
    await expired.controller.load(); await submit(expired); expired.root.querySelector('[data-sources-download]').click(); await tick();
    assert.equal(expired.downloads.length, 0); assert.equal(expired.get('unlocked').hidden, true); assert.equal(expired.get('files').children.length, 0);
    assert.match(expired.get('message').textContent, /Доступ завершився/);
    await expired.controller.load({ force: true }); assert.deepEqual(expired.calls.at(-1)[1].headers, {});
  }
});

test('invalid protected metadata fails closed and session/auth errors do not disclose originals', async t => {
  for (const data of [unlocked({ files: [file({ id: '../secret' })] }), unlocked({ expires_at: '2026-10-15T09:00:00Z' }), unlocked({ files: [file({ filename: 'bank.html' })] }), unlocked({ session_token: '' })]) {
    const view = mount(t, { api: async path => path.endsWith('/unlock') ? data : locked() });
    await view.controller.load(); await submit(view);
    assert.equal(view.get('unlocked').hidden, true); assert.equal(view.get('files').children.length, 0); assert.match(view.get('message').textContent, /Не вдалося/);
  }
  const denied = mount(t, { api: async () => { throw Object.assign(new Error('private'), { status: 401 }); } });
  await assert.rejects(denied.controller.probeAccess(), error => error.status === 401);
  assert.equal(denied.root.hidden, true); assert.doesNotMatch(denied.root.textContent, /private/);
});
