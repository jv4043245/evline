import { json } from '../../_lib/http.js';
import { digest,first,run,nowISO } from '../../_lib/supplier-documents.js';
import { dispatchSupplierReminders } from '../../_lib/supplier-documents-telegram.js';

export async function onRequestPost({request,env}) {
  const token=(request.headers.get('authorization') || '').replace(/^Bearer /,'');
  if (!token || token.length>200) return json({error:'Unauthorized'},{status:401});
  try {
    const expected=env.SUPPLIER_DOCS_CRON_TOKEN ? await digest(env.SUPPLIER_DOCS_CRON_TOKEN)
      : (await first(env,"SELECT value FROM supplier_document_runtime WHERE key='cron_token_sha256'"))?.value;
    if (!expected || await digest(token)!==expected) return json({error:'Unauthorized'},{status:401});
    const result=await dispatchSupplierReminders(env);
    await run(env,"INSERT INTO supplier_document_runtime(key,value) VALUES('cron_last_run_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",nowISO());
    return json({ok:true,...result});
  }
  catch { return json({error:'Supplier reminder dispatch unavailable'},{status:503}); }
}
