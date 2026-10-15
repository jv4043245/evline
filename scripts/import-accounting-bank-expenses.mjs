#!/usr/bin/env node
// Validates a private reviewed JSON receipt and writes a private SQL import.
// Does not connect to production or print individual transactions.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBankExpenseImportSql } from '../functions/_lib/accounting-bank-expenses.js';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') {
  console.error('Usage: node scripts/import-accounting-bank-expenses.mjs --input /private/path/reviewed.json --output /private/path/import.sql');
  process.exitCode = 1;
} else {
  try {
    const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const input = await realpath(resolve(args[1])), outputDirectory = await realpath(dirname(resolve(args[3]))), output = resolve(outputDirectory, resolve(args[3]).split(sep).at(-1));
    if ([input, output].some(path => path === repo || path.startsWith(`${repo}${sep}`))) throw new Error('Private input and output must be outside the site repository');
    const result = await buildBankExpenseImportSql(JSON.parse(await readFile(input, 'utf8')));
    await writeFile(output, result.sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, batch_id: result.batch_id, row_count: result.row_count, content_hash: result.content_hash, output }));
  } catch (error) {
    console.error(error.message?.startsWith('accounting_bank_') || error.message?.startsWith('Private ') ? error.message : 'Private import could not be prepared; inspect input and output paths locally.');
    process.exitCode = 1;
  }
}
