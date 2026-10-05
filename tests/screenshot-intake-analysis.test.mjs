import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScreenshotDraft, downloadScreenshot, validateScreenshotAnalysis } from '../functions/_lib/screenshot-intake-analysis.js';

const transcript = 'Клієнт: BYD Yuan Plus 2023. Потрібна права передня дверка, 1 штука. Мій телефон +380000000001.';
const input = [{ id: '1', text: transcript }];
const field = value => ({ value, evidence: [{ source_id: '1', quote: value }] });
const output = (more = {}) => ({ intent: 'parts', multiple_customers: false, multiple_vehicles: false, ambiguous: false, warnings: [],
  fields: { car: field('BYD Yuan Plus 2023'), customer_phone: field('+380000000001'), item_name: field('права передня дверка, 1 штука') }, ...more });

test('extracts only evidence-backed draft fields and ignores payment/status instructions', () => {
  const data = output();
  data.fields.payment_status = field('paid'); data.fields.revenue_uah = field('5000'); data.fields.telegram_chat_id = field('manager-id');
  const result = validateScreenshotAnalysis(data, input);
  assert.equal(result.fields.item_name, 'права передня дверка, 1 штука');
  assert.equal(result.fields.customer_phone, '+380000000001');
  assert.equal(result.fields.payment_status, undefined); assert.equal(result.fields.telegram_chat_id, undefined);
  assert.equal(result.blocking, false);
});

test('fabricated side and unknown source quotes cannot become a confirmed field', () => {
  const data = output();
  data.fields.item_name.value = 'ліва передня дверка';
  data.fields.customer_name = { value: 'Вигаданий клієнт', evidence: [{ source_id: '99', quote: 'Вигаданий клієнт' }] };
  const result = validateScreenshotAnalysis(data, input);
  assert.equal(result.fields.item_name, undefined); assert.equal(result.fields.customer_name, undefined); assert.equal(result.blocking, true);
});

test('mixed customers, multiple VINs and unreadable OCR require explicit manual review', () => {
  assert.equal(validateScreenshotAnalysis(output({ multiple_customers: true }), input).blocking, true);
  const sources = [{ id: '1', text: `${transcript} LTEST123456789012 LTEST123456789045` }];
  assert.equal(validateScreenshotAnalysis(output(), sources).blocking, true);
  assert.equal(validateScreenshotAnalysis(output(), [{ id: '1', text: `${transcript} [UNREADABLE]` }]).blocking, true);
});

test('VIN validation never repairs ambiguous characters or invents a missing telephone', () => {
  const vin = 'LTEST123456789O123';
  const result = validateScreenshotAnalysis(output({ fields: { vin: field(vin) } }), [{ id: '1', text: vin }]);
  assert.equal(result.fields.vin, undefined); assert.equal(result.fields.customer_phone, undefined);
  assert.equal(result.blocking, true); assert.ok(result.warnings.some(s => /Телефону/.test(s)));
});

test('VIN digits and numbers from different lines do not prove a customer phone', () => {
  for (const [quote, phone] of [['VIN: LTEST123456789012', '123456789012'], ['Авто 2023. Артикул 12345678', '202312345678']]) {
    const result = validateScreenshotAnalysis(output({ fields: { customer_phone: { value: phone, evidence: [{ source_id: '1', quote }] } } }), [{ id: '1', text: quote }]);
    assert.equal(result.fields.customer_phone, undefined); assert.equal(result.blocking, true);
  }
});

test('phone evidence cannot join separate spans or slice digits out of a VIN', () => {
  const scenarios = [
    { sources: [{ id: '1', text: 'Артикул 12345' }, { id: '2', text: 'Номер 678901. Фара' }],
      value: '12345678901', evidence: [{ source_id: '1', quote: '12345' }, { source_id: '2', quote: '678901' }] },
    { sources: [{ id: '1', text: 'VIN LTEST1234567890123. Фара' }], value: '1234567890123', evidence: [{ source_id: '1', quote: '1234567890123' }] },
  ];
  for (const { sources, value, evidence } of scenarios) {
    const result = validateScreenshotAnalysis(output({ fields: { customer_phone: { value, evidence } } }), sources);
    assert.equal(result.fields.customer_phone, undefined); assert.equal(result.blocking, true);
  }
});

test('text intake uses existing AI binding without fetching Telegram or customer identifiers', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Text-only intake must not download files'));
  const env = { AI: { run: async (model, payload) => {
    assert.match(model, /llama-3.3/);
    const submitted = JSON.parse(payload.messages[1].content);
    assert.deepEqual(submitted.sources, input); assert.equal(submitted.manager_id, undefined);
    return { response: JSON.stringify(output()) };
  } } };
  const result = await analyzeScreenshotDraft(env, { manager_id: 'secret-manager-id', channel: 'whatsapp', sources: [{ kind: 'text', message_id: 1, text: transcript }] });
  assert.equal(result.fields.car, 'BYD Yuan Plus 2023');
});

test('image intake transcribes first then extracts, deduplicating identical bytes', async t => {
  const bytes = Uint8Array.from([255, 216, 255, 1, 2, 3]);
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/getFile') ? Response.json({ ok: true, result: { file_path: 'photos/synthetic.jpg', file_size: bytes.length } }) : new Response(bytes));
  let calls = 0;
  const env = { TELEGRAM_BOT_TOKEN: 'synthetic', AI: { run: async (model, payload) => {
    calls++;
    if (calls === 1) {
      assert.equal(payload.image, undefined); assert.equal(payload.prompt, undefined);
      assert.equal(payload.messages[0].role, 'user');
      assert.equal(payload.messages[0].content[0].type, 'text'); assert.match(payload.messages[0].content[0].text, /untrusted/);
      const part = payload.messages[0].content[1]; assert.equal(part.type, 'image_url');
      assert.match(part.image_url.url, /^data:image\/jpeg;base64,/);
      assert.deepEqual(new Uint8Array(Buffer.from(part.image_url.url.split(',')[1], 'base64')), bytes);
      assert.equal(payload.temperature, 0); assert.equal(payload.max_tokens, 2200);
      return { response: transcript };
    }
    assert.equal(JSON.parse(payload.messages[1].content).sources.length, 1);
    return { response: output() };
  } } };
  const result = await analyzeScreenshotDraft(env, { channel: 'viber', sources: [{ kind: 'image', message_id: 1, file_id: 'synthetic1' }, { kind: 'image', message_id: 2, file_id: 'synthetic2' }] });
  assert.equal(calls, 2); assert.equal(result.fields.customer_phone, '+380000000001');
});

test('modern vision input round-trips PNG bytes up to the 8 MB limit without an external image URL', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let calls = 0;
  const env = { AI: { run: async (model, payload) => {
    calls++;
    if (calls === 1) {
      assert.match(model, /llama-4-scout-17b-16e/);
      const uri = payload.messages[0].content[1].image_url.url;
      assert.match(uri, /^data:image\/png;base64,/);
      assert.deepEqual(new Uint8Array(Buffer.from(uri.split(',')[1], 'base64')), bytes);
      return { response: transcript };
    }
    return { response: output() };
  } } };
  const result = await analyzeScreenshotDraft(env, { sources: [{ kind: 'image', message_id: 1, file_id: 'synthetic' }] }, { download: async () => bytes });
  assert.equal(calls, 2); assert.equal(result.fields.customer_phone, '+380000000001');
});

test('modern image messages keep explicit OCR timeout and sanitized provider error codes', async t => {
  const draft = { sources: [{ kind: 'image', message_id: 1, file_id: 'synthetic' }] };
  const download = async () => Uint8Array.from([255, 216, 255, 1]);
  for (const [message, code] of [['transport https://secret.invalid/bot-token', 'ocr_unavailable'], ['Accept model license at https://secret.invalid', 'ocr_license_required']]) {
    let calls = 0;
    await assert.rejects(analyzeScreenshotDraft({ AI: { run: async () => { calls++; throw new Error(message); } } }, draft, { download }),
      error => error.code === code && error.status === 503 && !/secret|https|token|license/i.test(error.message));
    assert.equal(calls, 1);
  }
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 45000); queueMicrotask(callback); });
  await assert.rejects(analyzeScreenshotDraft({ AI: { run: () => new Promise(() => {}) } }, draft, { download }),
    error => error.code === 'ocr_timeout' && error.status === 503);
});

test('unsafe Telegram paths and oversized files are rejected before download', async t => {
  for (const result of [{ file_path: '../secret' }, { file_path: '/photos/a.jpg' }, { file_path: 'https://evil.test/a' }, { file_path: 'photos/a.jpg', file_size: 9 * 1024 * 1024 }]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ ok: true, result }); });
    await assert.rejects(downloadScreenshot({ TELEGRAM_BOT_TOKEN: 'synthetic' }, 'file1'), /недоступний|перевищує/);
    assert.equal(calls, 1); mock.mock.restore();
  }
});

test('PDF disguised as an image and invalid file IDs are rejected', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/getFile') ? Response.json({ ok: true, result: { file_path: 'documents/test.png' } }) : new Response('%PDF-test'));
  await assert.rejects(downloadScreenshot({ TELEGRAM_BOT_TOKEN: 'synthetic' }, 'file1'), /JPEG або PNG/);
  await assert.rejects(downloadScreenshot({ TELEGRAM_BOT_TOKEN: 'synthetic' }, '../not-file'), /недоступний/);
});

test('provider failures do not expose secrets or trigger automatic license acceptance', async () => {
  let calls = 0;
  const env = { AI: { run: async () => { calls++; throw new Error('https://api.telegram.org/bot-secret LICENSE agree'); } } };
  await assert.rejects(analyzeScreenshotDraft(env, { sources: [{ kind: 'text', message_id: 1, text: transcript }] }), error => !/secret|LICENSE|https/.test(error.message) && error.status === 503);
  assert.equal(calls, 1);
});

test('coded transport errors cannot expose a Telegram download URL', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/a.jpg' } });
    throw Object.assign(new Error(`transport ${url}`), { code: 'ECONNRESET' });
  });
  await assert.rejects(downloadScreenshot({ TELEGRAM_BOT_TOKEN: 'synthetic-secret' }, 'file1'), error =>
    !/secret|https|ECONNRESET/.test(error.message) && error.code === 'image_download' && error.status === 503);
});

test('Workers-compatible manual mode refuses redirects instead of following credential URLs', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/a.jpg' } });
    return new Response('', { status: 302, headers: { location: 'https://example.invalid/' } });
  });
  await assert.rejects(downloadScreenshot({ TELEGRAM_BOT_TOKEN: 'synthetic' }, 'file1'), error => error.code === 'image_download');
  assert.equal(calls, 2);
});

test('oversized context, missing AI and invalid structured outputs remain uncommitted', async () => {
  await assert.rejects(analyzeScreenshotDraft({}, { sources: Array.from({ length: 7 }, () => ({})) }), /від 1 до 6/);
  await assert.rejects(analyzeScreenshotDraft({}, { sources: [{ kind: 'text', text: 'x'.repeat(20001) }] }), /Забагато/);
  await assert.rejects(analyzeScreenshotDraft({}, { sources: [{ kind: 'text', text: transcript }] }), /не підключене/);
  await assert.rejects(analyzeScreenshotDraft({ AI: { run: async () => ({ response: 'not-json' }) } }, { sources: [{ kind: 'text', text: transcript }] }), /неповні дані/);
});
