#!/usr/bin/env node
// Originals remain outside the public repository. This prepares a private,
// immutable D1 import and never uploads files or prints their contents.
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBankSourceImportSql, MAX_BANK_SOURCE_BYTES } from '../functions/_lib/accounting-bank-sources.js';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--output') {
  console.error('Usage: node scripts/import-accounting-bank-sources.mjs --manifest /private/path/sources.json --output /private/path/sources.sql');
  process.exitCode = 1;
} else {
  try {
    const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const outside = path => path !== repo && !path.startsWith(`${repo}${sep}`);
    const manifestPath = await realpath(resolve(args[1])), outputDirectory = await realpath(dirname(resolve(args[3]))), output = resolve(outputDirectory, basename(resolve(args[3])));
    if (![manifestPath, output].every(outside)) throw new Error('Private input and output must be outside the site repository');
    if ((await stat(manifestPath)).size > 16384) throw new Error('bank_sources_invalid_manifest');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).some(key => !['owner_id', 'files'].includes(key))
        || !Array.isArray(manifest.files) || manifest.files.length !== 3) throw new Error('bank_sources_invalid_manifest');
    const files = [];
    for (const item of manifest.files) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['path', 'date_from', 'date_to', 'sha256'].includes(key)) || typeof item.path !== 'string') throw new Error('bank_sources_invalid_manifest');
      const sourcePath = await realpath(resolve(item.path)), info = await stat(sourcePath);
      if (!outside(sourcePath)) throw new Error('Private input and output must be outside the site repository');
      if (!info.isFile() || info.size < 1 || info.size > MAX_BANK_SOURCE_BYTES) throw new Error('bank_sources_file_too_large');
      files.push({ filename: basename(item.path), bytes: new Uint8Array(await readFile(sourcePath)), date_from: item.date_from, date_to: item.date_to, ...(item.sha256 ? { sha256: item.sha256 } : {}) });
    }
    const result = await buildBankSourceImportSql(files, manifest.owner_id);
    await writeFile(output, result.sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, file_count: result.files.length, bytes: result.files.reduce((sum, file) => sum + file.bytes, 0), output }));
  } catch (error) {
    console.error(error.message?.startsWith('bank_sources_') || error.message?.startsWith('Private ') ? error.message : 'Private bank source import could not be prepared; inspect the manifest and paths locally.');
    process.exitCode = 1;
  }
}
