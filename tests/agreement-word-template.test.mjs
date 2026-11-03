import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { AGREEMENT_TERMS } from '../admin/documents/agreement-template.js';
import { agreementTemplateBlocks } from '../scripts/build-agreement-template.mjs';
import { fromOrder } from '../admin/documents/model.js';
import { pdfDefinition, previewHtml } from '../admin/documents/render.js';
import agreementLogo from '../admin/documents/agreement-logo.js';

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
test('Word uses the website logo, correct URL, centered title and right-aligned money and signatures', async () => {
  const archive = unzipSync(await readFile(new URL('../docs/evline-order-agreement-2026-11-03.docx', import.meta.url)));
  const image = Object.entries(archive).find(([name]) => name.startsWith('word/media/'))[1];
  assert.deepEqual(Buffer.from(image), await readFile(new URL('../assets/images/logo.png', import.meta.url)));
  const headerRelationships = Object.keys(archive).filter(n => /word\/_rels\/header\d+\.xml\.rels$/.test(n)).map(n => strFromU8(archive[n])).join('');
  assert.match(headerRelationships, /https:\/\/evline\.com\.ua\//);
  const styles = new JSDOM(strFromU8(archive['word/styles.xml']), {contentType:'application/xml'});
  const titleStyle=[...styles.window.document.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','style')].find(s=>s.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','styleId')==='Title');
  assert.equal(titleStyle.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','jc')[0].getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val'),'center');
  styles.window.close();
  const dom = new JSDOM(strFromU8(archive['word/document.xml']), {contentType:'application/xml'}), ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = [...dom.window.document.getElementsByTagNameNS(ns,'p')];
  const alignment = p=>p.getElementsByTagNameNS(ns,'jc')[0]?.getAttributeNS(ns,'val');
  const total = paragraphs.find(p=>p.textContent.startsWith('Загальна остаточна ціна:'));
  assert.equal(alignment(total),'right');
  const signature = paragraphs.find(p=>p.textContent.startsWith('Продавець ___'));
  assert.equal(signature.getElementsByTagNameNS(ns,'tab').length,2);
  assert.equal(signature.getElementsByTagNameNS(ns,'tab')[0].getAttributeNS(ns,'val'),'right');
  for(const footer of Object.keys(archive).filter(n=>/word\/footer\d+\.xml$/.test(n))) {
    const xml = strFromU8(archive[footer]);assert.match(xml,/PAGE/);assert.match(xml,/w:val="right"/);
  }
  dom.window.close();
});
test('PDF branding is generated from the actual website SVG and leaves invoice-only and legacy layout unchanged', async () => {
  assert.equal(agreementLogo,(await readFile(new URL('../assets/logo.svg', import.meta.url),'utf8')).trim());
  const d=fromOrder({id:'TEST'}), branded=pdfDefinition(d,{mode:'agreement'});
  assert.equal(branded.header(1).columns[0].svg,agreementLogo);
  assert.equal(branded.header(2).columns[0].text,'EVLine');
  assert.equal(branded.header(2).columns[1].link,'https://evline.com.ua/');
  assert.equal(branded.content[0].alignment,'center');
  const preview=previewHtml(d,'agreement',false);assert.match(preview,/src="\/assets\/logo\.svg"/);assert.match(preview,/class="agreement-title"/);assert.match(preview,/class="document-total agreement-total"/);
  const table=branded.content.find(b=>b.table).table;
  assert.equal(table.body[1][2].alignment,'center');assert.equal(table.body[1][4].alignment,'right');
  assert.equal(pdfDefinition(d,{mode:'invoice'}).header.text,'EVLine');
  d.template_version='2026-09-23';assert.equal(pdfDefinition(d,{mode:'agreement'}).header.text,'EVLine');
});
