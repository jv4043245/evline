#!/usr/bin/env node
// Fresh independent password; write once to a private file, never stdout/Git.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { writeFile, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--owner' || args[2] !== '--output') {
  console.error('Usage: node scripts/prepare-accounting-bank-source-password.mjs --owner owner --output /private/path/access.json'); process.exitCode = 1;
} else {
  try {
    const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const output = resolve(await realpath(dirname(resolve(args[3]))), basename(resolve(args[3]))), owner = args[1];
    if (output === repo || output.startsWith(`${repo}${sep}`)) throw new Error('Private credentials must be outside the site repository');
    if (!owner || owner.trim() !== owner || owner.length > 200 || /[\u0000-\u0020\u007f-\u009f]/u.test(owner)) throw new Error('Invalid owner identity');
    const password = randomBytes(32).toString('base64url'), salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const credential = { BANK_SOURCE_OWNER_ID: owner, BANK_SOURCE_PASSWORD_HASH: `pbkdf2-sha256$100000$${salt.toString('base64url')}$${hash.toString('base64url')}`, password };
    await writeFile(output, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, output, owner_id: owner }));
  } catch { console.error('Private credentials could not be prepared; use a new private output path and a valid owner identity.'); process.exitCode = 1; }
}
