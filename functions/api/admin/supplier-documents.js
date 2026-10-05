import { zipSync } from 'fflate';
import { adminUser, adminIdentities, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';
import { all, first, run, fail, clean, nowISO, digest, DOCUMENT_KINDS, MAX_DOCUMENT_BYTES, orderAndPayment, uploadDocument, listDocuments, documentVersion, selectedDocuments, readOriginal, listFollowups, saveFollowup, documentAudit, supplierFollowupText, watchPayment } from '../../_lib/supplier-documents.js';
import { boundedBytes, ownTelegram, pairingStatus, createPairing, confirmPairing, botLink, sendOriginal } from '../../_lib/supplier-documents-telegram.js';

function fileResponse(body,mime,filename,inline=false) {
  return new Response(body,{headers:{'content-type':mime,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none';",'content-disposition':`${inline?'inline':'attachment'}; filename="document"; filename*=UTF-8''${encodeURIComponent(filename)}`}});
}
export async function onRequest({request,env}) {
  const user=adminUser(request,env);
  if (!user) return unauthorized();
  const url=new URL(request.url), action=url.searchParams.get('action') || 'list', orderId=clean(url.searchParams.get('order_id'));
  try {
    if (request.method==='GET') {
      if (action==='setup') {
        const cron=await first(env,"SELECT value FROM supplier_document_runtime WHERE key='cron_last_run_at'");
        const linked=new Set((await all(env,'SELECT admin_id FROM supplier_document_telegram')).map(row=>row.admin_id));
        const managers=adminIdentities(env).map(manager=>({...manager,telegram_ready:linked.has(manager.id)}));
        return json({storage_ready:Boolean(env.SUPPLIER_DOCUMENTS),cron_ready:Boolean(cron?.value && Date.now()-Date.parse(cron.value)<86400000),cron_last_run_at:cron?.value || null,user,managers,...await pairingStatus(env,user)});
      }
      if (action==='counts') {
        const ids=(url.searchParams.get('ids') || '').split(',').filter(Boolean);
        if (!ids.length || ids.length>100) fail('Некоректний список замовлень.');
        return json({counts:await all(env,`SELECT order_id,COUNT(*) AS count FROM supplier_document_links WHERE archived_at IS NULL AND order_id IN (${ids.map(()=>'?').join(',')}) GROUP BY order_id`,...ids)});
      }
      if (action==='search') {
        const q=clean(url.searchParams.get('q'),100);
        if (q.length<2) return json({documents:[]});
        return json({documents:await all(env,`SELECT DISTINCT d.id,d.supplier_name,d.kind,d.reference,v.filename,o.order_number FROM supplier_documents d JOIN supplier_document_links l ON l.document_id=d.id JOIN orders o ON o.id=l.order_id JOIN supplier_document_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE l.archived_at IS NULL AND (d.reference LIKE ? OR v.filename LIKE ? OR o.order_number LIKE ? OR d.supplier_name LIKE ?) ORDER BY d.created_at DESC LIMIT 30`,...Array(4).fill(`%${q}%`))});
      }
      if (action==='list') return json({documents:await listDocuments(env,orderId),followups:await listFollowups(env,orderId)});
      if (action==='versions') {
        const documentId=clean(url.searchParams.get('id'));
        await documentVersion(env,orderId,documentId);
        return json({versions:await all(env,'SELECT version,filename,mime,bytes,created_at,created_by FROM supplier_document_versions WHERE document_id=? ORDER BY version DESC',documentId)});
      }
      if (action==='file') {
        const row=await documentVersion(env,orderId,clean(url.searchParams.get('id')),url.searchParams.get('version'));
        const object=await readOriginal(env,row);
        await documentAudit(env,user,'download',row.document_id,orderId,{version:row.version});
        return fileResponse(object.body,row.mime,row.filename,url.searchParams.get('inline')==='1');
      }
      fail('Невідома дія.',404);
    }
    if (request.method!=='POST') return json({error:'Method not allowed'},{status:405,headers:{allow:'GET, POST'}});
    // Bound the entire request, not just the declared file size or Content-Length.
    const bytes=await boundedBytes(new Response(request.body),action==='upload'?MAX_DOCUMENT_BYTES+65536:65536);
    if (action==='upload') {
      const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type') || ''}}).formData();
      const data=Object.fromEntries([...form].filter(([key])=>key!=='file'));
      return json({ok:true,...await uploadDocument(env,user,data,form.get('file'))});
    }
    const data=bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    if (action==='connect') return json(await createPairing(env,user));
    if (action==='confirm') { await confirmPairing(env,user,data.telegram_id); return json({ok:true}); }
    if (action==='disconnect') {
      await env.DB.batch(['supplier_document_telegram','supplier_document_pairings','supplier_document_intakes'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE admin_id=?`).bind(user.id)));
      await documentAudit(env,user,'telegram_disconnect',null,null);
      return json({ok:true});
    }
    if (action==='followup') { await saveFollowup(env,user,data); return json({ok:true}); }
    const {order,payment}=await orderAndPayment(env,clean(data.order_id),clean(data.payment_id));
    if (action==='intake') {
      if (!env.SUPPLIER_DOCUMENTS) fail('Приватне сховище ще не підключене.',503);
      if (!await ownTelegram(env,user.id)) fail('Підключіть свій Telegram.');
      if (!DOCUMENT_KINDS[data.kind]) fail('Оберіть тип документа.');
      const supplier=clean(payment?.supplier_name || data.supplier_name);
      if (!supplier) fail('Оберіть постачальника.');
      const token=crypto.randomUUID().replaceAll('-','');
      const link=await botLink(env,`sddoc_${token}`);
      await run(env,'DELETE FROM supplier_document_intakes WHERE admin_id=? AND (active=0 OR expires_at<?)',user.id,nowISO());
      await run(env,'INSERT INTO supplier_document_intakes(token_hash,admin_id,order_id,payment_id,supplier_name,kind,expires_at) VALUES(?,?,?,?,?,?,?)',await digest(token),user.id,order.id,payment?.id || null,supplier,data.kind,new Date(Date.now()+20*60000).toISOString());
      return json({link});
    }
    if (action==='archive' || action==='restore') {
      await documentVersion(env,order.id,clean(data.id));
      await run(env,'UPDATE supplier_document_links SET archived_at=? WHERE document_id=? AND order_id=?',action==='archive'?nowISO():null,data.id,order.id);
      await documentAudit(env,user,action,data.id,order.id);
      return json({ok:true});
    }
    if (action==='link') {
      const doc=await first(env,'SELECT id,supplier_name FROM supplier_documents WHERE id=?',clean(data.id));
      if (!doc) fail('Документ не знайдений.',404);
      if (payment && payment.supplier_name!==doc.supplier_name) fail('Постачальник документа та оплати має збігатися.');
      await run(env,`INSERT INTO supplier_document_links(document_id,order_id,payment_id,created_at,created_by) VALUES(?,?,?,?,?) ON CONFLICT(document_id,order_id) DO UPDATE SET payment_id=excluded.payment_id,archived_at=NULL`,doc.id,order.id,payment?.id || null,nowISO(),user.id);
      await documentAudit(env,user,'link',doc.id,order.id,{payment_id:payment?.id || null});
      await watchPayment(env,payment?.id,user.id);
      return json({ok:true});
    }
    if (action==='bundle' || action==='send') {
      const rows=await selectedDocuments(env,order.id,data.ids);
      if (action==='bundle') {
        const files={};
        for (const [index,row] of rows.entries()) files[`${String(index+1).padStart(2,'0')}-${row.filename}`]=new Uint8Array(await (await readOriginal(env,row)).arrayBuffer());
        const archive=zipSync(files,{level:0});
        await documentAudit(env,user,'bundle',null,order.id,{ids:data.ids});
        return fileResponse(archive,'application/zip',`${order.order_number}-supplier-documents.zip`);
      }
      const recipient=await ownTelegram(env,user.id);
      if (!recipient) fail('Спочатку підключіть свій особистий Telegram.');
      const sent=[],failed=[];
      for (const row of rows) {
        try {
          await sendOriginal(env,recipient.chat_id,row,`${order.order_number} · ${row.supplier_name} · ${DOCUMENT_KINDS[row.kind]}${data.followup_text?`\n\n${supplierFollowupText(row)}`:''}`);
          sent.push(row.document_id);
        } catch { failed.push(row.document_id); break; }
      }
      await documentAudit(env,user,'telegram_send',null,order.id,{sent,failed});
      return json({sent,failed,uncertain:failed.length>0});
    }
    fail('Невідома дія.',404);
  } catch(error) {
    return json({error:error.publicMessage || 'Не вдалося виконати дію з документами. Спробуйте ще раз.'},{status:error.status || 500});
  }
}
