import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { AGREEMENT_TERMS } from '../admin/documents/agreement-template.js';
import { agreementTemplateBlocks } from '../scripts/build-agreement-template.mjs';

test('Word template contains the exact current admin clauses, specification and no invented money received', async () => {
  const archive = unzipSync(await readFile(new URL('../docs/evline-order-agreement-2026-11-03.docx', import.meta.url)));
  const dom = new JSDOM(strFromU8(archive['word/document.xml']), { contentType: 'application/xml' });
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = [...dom.window.document.getElementsByTagNameNS(ns, 'p')].map(p => [...p.getElementsByTagNameNS(ns, 't')].map(t => t.textContent).join(''));
  for (const section of AGREEMENT_TERMS) {
    assert.ok(paragraphs.includes(section.title));
    for (const text of section.text.split('\n\n')) assert.ok(paragraphs.includes(text.replace('дані —', 'дані -')), section.title);
  }
  assert.ok(paragraphs.includes('Специфікація замовлення'));
  assert.ok(!paragraphs.some(p => /Отримано від Покупця:|0,00 грн/.test(p)));
  const blocks = agreementTemplateBlocks();
  assert.equal(blocks.filter(b => b.type === 'table')[0].rows.length, 3);
  assert.match(blocks.find(b => b.label === 'Погоджений строк виконання').text, /3\.3/);
  dom.window.close();
});
