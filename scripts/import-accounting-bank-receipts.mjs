#!/usr/bin/env node
// Operator-only import: verify actual private image bytes, then retain only
// basename/SHA metadata and reviewed financial facts. No image is published.
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBankReceiptImportSql } from '../functions/_lib/accounting-bank-receipts.js';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--output') {
  console.error('Usage: node scripts/import-accounting-bank-receipts.mjs --manifest /private/path/receipts.json --output /private/path/receipts.sql'); process.exitCode = 1;
} else {
  try {
    const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const outside = path => path !== repo && !path.startsWith(`${repo}${sep}`);
    const manifestPath = await realpath(resolve(args[1])), output = resolve(await realpath(dirname(resolve(args[3]))), basename(resolve(args[3])));
    if (![manifestPath, output].every(outside)) throw new Error('Private inputs and outputs must be outside the site repository');
    if ((await stat(manifestPath)).size > 65536) throw new Error('accounting_bank_receipt_invalid_manifest');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).some(key => !['batch_id','actor_id','receipts','confirmations'].includes(key))
        || manifest.receipts !== undefined && !Array.isArray(manifest.receipts) || manifest.confirmations !== undefined && !Array.isArray(manifest.confirmations)
        || (manifest.receipts?.length || 0) + (manifest.confirmations?.length || 0) > 100) throw new Error('accounting_bank_receipt_invalid_manifest');
    async function evidence(path) {
      if (typeof path !== 'string') throw new Error('accounting_bank_receipt_invalid_source');
      const actual = await realpath(resolve(path)), info = await stat(actual);
      if (!outside(actual)) throw new Error('Private inputs and outputs must be outside the site repository');
      if (!info.isFile() || info.size < 12 || info.size > 20 * 1024 * 1024) throw new Error('accounting_bank_receipt_invalid_source');
      const bytes = await readFile(actual), name = basename(path), ext = name.split('.').at(-1).toLowerCase();
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
      if (!(ext === 'png' && png || ['jpg','jpeg'].includes(ext) && jpeg || ext === 'webp' && webp)) throw new Error('accounting_bank_receipt_invalid_source');
      return { source_filename: name, source_id: createHash('sha256').update(bytes).digest('hex') };
    }
    async function confirmation(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['receipt_id','amount_minor','source_kind','source_path','note'].includes(key))) throw new Error('accounting_bank_receipt_invalid_manifest');
      const { source_path, ...value } = item;
      return { ...value, ...(source_path === undefined ? {} : await evidence(source_path)) };
    }
    const receipts = [];
    for (const item of manifest.receipts || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['source_path','transaction_date','date_basis','description','original_amount_minor','original_currency','service_original_minor','fee_original_minor','classification_note','confirmation'].includes(key))) throw new Error('accounting_bank_receipt_invalid_manifest');
      const { source_path, confirmation: supplied, ...value } = item;
      receipts.push({ ...value, ...await evidence(source_path), ...(supplied === undefined ? {} : { confirmation: await confirmation(supplied) }) });
    }
    const confirmations = [];
    for (const item of manifest.confirmations || []) confirmations.push(await confirmation(item));
    const result = await buildBankReceiptImportSql({ batch_id: manifest.batch_id, actor_id: manifest.actor_id, receipts, confirmations });
    await writeFile(output, result.sql, { mode: 0o600, flag: 'wx', encoding: 'utf8' });
    console.log(JSON.stringify({ ok: true, receipt_count: result.receipt_count, confirmation_count: result.confirmation_count, receipt_ids: result.receipt_ids, output }));
  } catch (error) {
    console.error(error.message?.startsWith('accounting_bank_receipt_') || error.message?.startsWith('Private ') ? error.message : 'Private receipt import could not be prepared; inspect manifest and source paths locally.'); process.exitCode = 1;
  }
}
