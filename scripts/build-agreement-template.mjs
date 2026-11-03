import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fromOrder } from '../admin/documents/model.js';
import { documentBlocks } from '../admin/documents/render.js';

export function agreementTemplateBlocks() {
  const d = fromOrder({ id: 'template' });
  Object.assign(d, { number: '', date: '', car: '', city: 'Київ', vin: '________________', deadline_days: '____' });
  d.seller = { name: '[ФОП / найменування продавця]' };
  d.buyer = { name: '[ПІБ / найменування покупця]', purpose: '[особисті потреби / господарська діяльність]' };
  d.invoice.enabled = false;
  const blocks = documentBlocks(d, 'agreement');
  for (const block of blocks) {
    if (block.type === 'table') block.rows = Array.from({ length: 3 }, (_, i) => [String(i + 1), '[найменування, артикул, тип, VIN за потреби]', '____', '________', '________']);
    if (block.type === 'total') block.text = 'Загальна остаточна ціна: ________________ грн';
    if (block.label === 'Сума позицій, грн') block.text = '________________';
    if (block.label === 'Погоджена передоплата' || block.label === 'Залишок після погодженої передоплати') block.text = '________________ грн';
    if (block.text) block.text = block.text.replace('дані —', 'дані -');
  }
  return blocks;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { python: { type: 'string' } } });
  if (!values.python) throw new Error('Pass --python with the bundled Python runtime path.');
  const output = new URL('../docs/evline-order-agreement-2026-11-03.docx', import.meta.url);
  const logo = (await readFile(new URL('../assets/logo.svg', import.meta.url), 'utf8')).trim();
  await writeFile(new URL('../admin/documents/agreement-logo.js', import.meta.url), `// Generated from assets/logo.svg by build-agreement-template.mjs.\nexport default ${JSON.stringify(logo)};\n`);
  const blocks = agreementTemplateBlocks();
  const result = spawnSync(values.python, [fileURLToPath(new URL('./build-agreement-docx.py', import.meta.url)), fileURLToPath(output)], { input: JSON.stringify(blocks), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Word build failed');
  const markdown = blocks.map(b => `${b.pageBreak ? '<!-- PAGE_BREAK -->\n\n' : ''}${b.type === 'title' ? '# ' + b.text : b.type === 'heading' ? '## ' + b.text : b.type === 'field' ? `**${b.label}:** ${b.text}` : b.type === 'signatures' ? 'Продавець ____________________             Покупець ____________________' : b.type === 'table' ? [b.headers, b.headers.map(() => '---'), ...b.rows].map(row => '| ' + row.join(' | ') + ' |').join('\n') : b.text}`).join('\n\n') + '\n';
  await writeFile(new URL('../docs/evline-order-agreement-2026-11-03.md', import.meta.url), markdown);
  console.log(fileURLToPath(output));
}
