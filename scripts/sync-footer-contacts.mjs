import { fileURLToPath } from 'node:url';
import { syncFooterContacts } from './lib/footer-contacts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const changed = await syncFooterContacts(root, { check });
console.log(JSON.stringify({ check, changedCount: changed.length, files: changed }, null, 2));
if (check && changed.length) process.exitCode = 1;
