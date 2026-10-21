import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { priorityPartsPages, withPriorityPartsContent } from './lib/parts-priority-content.mjs';

const root = new URL('../', import.meta.url);
let changed = 0;
for (const page of priorityPartsPages) {
  for (const pathname of [page.uk, page.ru]) {
    const file = new URL(`${pathname.slice(1)}index.html`, root);
    const before = await readFile(file, 'utf8');
    const after = withPriorityPartsContent(before);
    if (before !== after) {
      changed++;
      if (!process.argv.includes('--check')) await writeFile(file, after);
      console.log(fileURLToPath(file));
    }
  }
}
if (changed && process.argv.includes('--check')) process.exitCode = 1;
console.log(`Priority parts pages: ${changed} changed.`);
