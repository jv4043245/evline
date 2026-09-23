import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentDeliveryCopy } from './lib/delivery-copy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const skip = new Set(['.git', 'node_modules', 'admin', 'tests', 'functions', 'docs', 'migrations', 'workers', 'scripts']);
const changed = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory() && !skip.has(entry.name)) await visit(filename);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const before = await readFile(filename, 'utf8');
      const after = currentDeliveryCopy(before);
      if (before !== after) {
        if (!process.argv.includes('--check')) await writeFile(filename, after);
        changed.push(path.relative(root, filename));
      }
    }
  }
}
await visit(root);
console.log(JSON.stringify({ mode: process.argv.includes('--check') ? 'check' : 'sync', changed }, null, 2));
if (process.argv.includes('--check') && changed.length) process.exitCode = 1;
