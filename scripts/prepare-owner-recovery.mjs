// Explicit owner-authorized recovery only. No token values in stdout or argv.
import {mkdirSync,chmodSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';

const dir=resolve('.local-data/admin-owner-recovery-20261021');
if(existsSync(dir)) throw new Error('Recovery material already exists. Reuse it; do not silently rotate again.');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const token=randomBytes(32).toString('base64url');
writeFileSync(join(dir,'pages-secrets.json'),JSON.stringify({ADMIN_OWNER_TOKEN:token}),{flag:'wx',mode:0o600});
writeFileSync(join(dir,'owner-token.txt'),token+'\n',{flag:'wx',mode:0o600});
console.log('Owner recovery files created in ignored private directory (0700/0600). Token not printed.');
