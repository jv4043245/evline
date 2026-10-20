// Run locally only. Reads the bank-supplied archive as data, never executes its files.
// No secret values are printed or passed as command-line arguments.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

const zipPath=process.argv[2];
if(!zipPath) throw new Error('Usage: node scripts/prepare-pumb-secrets.mjs /absolute/path/PUMB_API.zip');
const dir=resolve('.local-data/pumb'),pagesPath=join(dir,'pages-secrets.json'),workerPath=join(dir,'worker-secrets.json');
if(existsSync(pagesPath) || existsSync(workerPath)) throw new Error('Private secret files already exist. Reuse them; never rotate the encryption key without migrating stored credentials.');
const archive=unzipSync(new Uint8Array(readFileSync(zipPath)),{filter:file=>file.name==='PUMB_API/settings.txt'});
if(!archive['PUMB_API/settings.txt'])throw new Error('Expected bank settings file is missing');
const settings={};
for(const line of strFromU8(archive['PUMB_API/settings.txt']).split(/\r?\n/)) {
  const match=/^\s*(client_id|client_secret)\s*[:=]\s*(\S+)\s*$/.exec(line);
  if(match)settings[match[1]]=match[2];
}
if(!settings.client_id || !settings.client_secret)throw new Error('Bank settings format was not recognized; values were not printed');
const secrets={PUMB_CLIENT_ID:settings.client_id,PUMB_CLIENT_SECRET:settings.client_secret,PUMB_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PUMB_CRON_TOKEN:randomBytes(32).toString('base64url')};
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
writeFileSync(pagesPath,JSON.stringify(secrets),{flag:'wx',mode:0o600});
writeFileSync(workerPath,JSON.stringify({PUMB_CRON_TOKEN:secrets.PUMB_CRON_TOKEN}),{flag:'wx',mode:0o600});
console.log('Private Pages and cron secret files prepared (0600). No bank login/password included.');
