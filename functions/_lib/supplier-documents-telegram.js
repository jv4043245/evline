import { adminIdentities } from './auth.js';
import { all, first, run, fail, clean, digest, nowISO, DOCUMENT_KINDS, MAX_DOCUMENT_BYTES, uploadDocument, readOriginal, documentAudit, supplierFollowupText } from './supplier-documents.js';

export async function telegram(env, method, data) {
  if (!env.TELEGRAM_BOT_TOKEN) fail('Telegram-бот не налаштований.',503);
  try {
    const multipart = data instanceof FormData;
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(20000),
      headers:multipart ? {} : { 'content-type':'application/json' }, body:multipart ? data : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('telegram_failure');
    return result.result;
  } catch { fail('Telegram не підтвердив відправлення. Перевірте чат перед повторною спробою.',502); }
}
export async function ownTelegram(env, adminId) {
  if (!adminIdentities(env).some(u => u.id === adminId)) return null;
  return first(env,'SELECT admin_id,telegram_id,chat_id,display_name FROM supplier_document_telegram WHERE admin_id=?',adminId);
}
export async function pairingStatus(env, user) {
  const connected = await ownTelegram(env,user.id);
  const pending = await first(env,'SELECT telegram_id,display_name,expires_at FROM supplier_document_pairings WHERE admin_id=? AND expires_at>?',user.id,nowISO());
  return { connected, pending:pending?.telegram_id ? pending : null };
}
export async function botLink(env, parameter) {
  const bot = await telegram(env,'getMe',{});
  if (!/^\w+$/.test(bot.username || '')) fail('Не вдалося визначити адресу бота.',503);
  return `https://t.me/${bot.username}?start=${parameter}`;
}
export async function createPairing(env, user) {
  const token = crypto.randomUUID().replaceAll('-','');
  const link = await botLink(env,`sdlink_${token}`);
  await run(env,`INSERT INTO supplier_document_pairings(admin_id,token_hash,expires_at) VALUES(?,?,?) ON CONFLICT(admin_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,telegram_id=NULL,display_name=NULL`,user.id,await digest(token),new Date(Date.now()+600000).toISOString());
  return { link };
}
export async function confirmPairing(env,user,telegramId) {
  const pair = await first(env,'SELECT * FROM supplier_document_pairings WHERE admin_id=? AND expires_at>?',user.id,nowISO());
  if (!pair?.telegram_id || pair.telegram_id !== String(telegramId)) fail('Підключення застаріло. Повторіть його.',409);
  const other = await first(env,'SELECT admin_id FROM supplier_document_telegram WHERE telegram_id=? AND admin_id<>?',pair.telegram_id,user.id);
  if (other) fail('Цей Telegram уже закріплений за іншим менеджером.',409);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO supplier_document_telegram(admin_id,telegram_id,chat_id,display_name,created_at) VALUES(?,?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET telegram_id=excluded.telegram_id,chat_id=excluded.chat_id,display_name=excluded.display_name,created_at=excluded.created_at`).bind(user.id,pair.telegram_id,pair.telegram_id,pair.display_name,nowISO()),
    env.DB.prepare('DELETE FROM supplier_document_pairings WHERE admin_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM supplier_document_intakes WHERE admin_id=?').bind(user.id),
  ]);
  await documentAudit(env,user,'telegram_connect',null,null,{ telegram_id:pair.telegram_id });
}
export async function sendOriginal(env, chatId, row, caption = '') {
  const object = await readOriginal(env,row);
  const form = new FormData();
  form.set('chat_id',chatId);
  form.set('document',new Blob([await object.arrayBuffer()],{type:row.mime}),row.filename);
  form.set('caption',clean(caption,900));
  return telegram(env,'sendDocument',form);
}
export async function boundedBytes(response, limit) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) fail('Файл завеликий або недоступний.',413);
  const reader=response.body.getReader(), chunks=[];
  let size=0;
  try {
    while (true) {
      const { value,done }=await reader.read();
      if (done) break;
      size+=value.length;
      if (size>limit) { await reader.cancel(); fail('Максимум 10 МБ на файл.',413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { result.set(chunk,offset); offset+=chunk.length; }
  return result;
}

export async function handleSupplierDocumentsUpdate(env,update) {
  const message=update.message || update.callback_query?.message;
  const from=update.message?.from || update.callback_query?.from;
  if (message?.chat?.type !== 'private' || !from || from.is_bot || String(from.id)!==String(message.chat.id)) return {handled:false};
  const input=clean(update.message?.text,200), callback=clean(update.callback_query?.data,100);
  const pairMatch=input.match(/^\/start(?:@\w+)? sdlink_([a-f0-9]{32})$/);
  const intakeMatch=input.match(/^\/start(?:@\w+)? sddoc_([a-f0-9]{32})$/);
  const explicit=pairMatch || intakeMatch || callback.startsWith('sdf:') || /^\/docs_(done|cancel)(?:@\w+)?$/.test(input);
  const chatId=String(message.chat.id);
  let session;
  try {
    const linked=await first(env,'SELECT * FROM supplier_document_telegram WHERE telegram_id=?',chatId);
    const user=linked && adminIdentities(env).find(u=>u.id===linked.admin_id);
    if (user) session=await first(env,'SELECT * FROM supplier_document_intakes WHERE admin_id=? AND active=1 AND expires_at>?',user.id,nowISO());
    if (!explicit && !session) return {handled:false};
    const say=text=>telegram(env,'sendMessage',{chat_id:chatId,text,disable_web_page_preview:true});
    if (pairMatch) {
      const hash=await digest(pairMatch[1]);
      const pairing=await first(env,'SELECT * FROM supplier_document_pairings WHERE token_hash=? AND expires_at>?',hash,nowISO());
      if (!pairing || !adminIdentities(env).some(u=>u.id===pairing.admin_id)) { await say('Посилання застаріло. Створіть нове в адмінці.'); return {handled:true}; }
      const result=await run(env,'UPDATE supplier_document_pairings SET telegram_id=?,display_name=? WHERE token_hash=? AND telegram_id IS NULL',chatId,clean([from.first_name,from.last_name,from.username ? `@${from.username}` : ''].filter(Boolean).join(' ')),hash);
      await say(result.meta?.changes ? 'Поверніться в адмінку, оновіть підключення та підтвердьте свій Telegram. До підтвердження файли не надсилатимуться.' : 'Це посилання вже використане. Перевірте підключення в адмінці.');
      return {handled:true};
    }
    if (!user) { await say('Спочатку підключіть особистий Telegram в адмінці: Оплата → Документи постачальника.'); return {handled:true}; }
    if (callback.startsWith('sdf:')) {
      const [,action,paymentId]=callback.split(':');
      const followup=await first(env,'SELECT payment_id FROM supplier_document_followups WHERE payment_id=? AND admin_id=?',paymentId,user.id);
      if (!followup || !['asked','later','shipped'].includes(action)) fail('Нагадування недоступне.');
      const now=nowISO(), next=new Date(Date.now()+(action==='asked'?2:1)*86400000).toISOString();
      await run(env,`UPDATE supplier_document_followups SET state=?,due_at=?,last_asked_at=CASE WHEN ?='asked' THEN ? ELSE last_asked_at END,updated_at=? WHERE payment_id=? AND admin_id=?`,action==='shipped'?'shipped':'waiting',next,action,now,now,paymentId,user.id);
      await documentAudit(env,user,`reminder_${action}`,paymentId,null);
      await telegram(env,'answerCallbackQuery',{callback_query_id:update.callback_query.id,text:action==='shipped'?'Позначено відправленим':'Наступну перевірку перенесено'});
      await telegram(env,'editMessageReplyMarkup',{chat_id:chatId,message_id:message.message_id,reply_markup:{inline_keyboard:[]}});
      return {handled:true};
    }
    if (intakeMatch) {
      const draftTable=await first(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='screenshot_intake_drafts'");
      if (draftTable) {
        const draft=await first(env,"SELECT id FROM screenshot_intake_drafts WHERE manager_id=? AND status IN ('collecting','ready') AND expires_at>? LIMIT 1",chatId,nowISO());
        if (draft) { await say('Спочатку завершіть або скасуйте поточну заявку зі скриншотів командою /stop. Потім відкрийте посилання документа ще раз.'); return {handled:true}; }
      }
      const hash=await digest(intakeMatch[1]);
      const next=await first(env,'SELECT * FROM supplier_document_intakes WHERE token_hash=? AND admin_id=? AND expires_at>?',hash,user.id,nowISO());
      if (!next) fail('Посилання застаріло. Відкрийте завантаження з картки замовлення.');
      await env.DB.batch([
        env.DB.prepare('UPDATE supplier_document_intakes SET active=0 WHERE admin_id=?').bind(user.id),
        env.DB.prepare('UPDATE supplier_document_intakes SET active=1 WHERE token_hash=?').bind(hash),
      ]);
      const order=await first(env,'SELECT order_number FROM orders WHERE id=?',next.order_id);
      await say(`${order.order_number} · ${next.supplier_name}\n${DOCUMENT_KINDS[next.kind]}\n\nНадішліть фото або PDF (до 10 МБ). Це документ постачальника, не підтвердження оплати. Для оригінальної якості надішліть зображення як файл.\nЗавершити: /docs_done\nСкасувати режим: /docs_cancel`);
      return {handled:true};
    }
    if (/^\/docs_(done|cancel)(?:@\w+)?$/.test(input)) {
      await run(env,'DELETE FROM supplier_document_intakes WHERE admin_id=?',user.id);
      await say('Режим документів закрито. Уже збережені файли залишилися в замовленні.');
      return {handled:true};
    }
    const media=message.document || message.photo?.at(-1);
    if (!media) { await say('Зараз відкрито завантаження документа постачальника. Надішліть файл або /docs_done, щоб перейти до інших команд.'); return {handled:true}; }
    if (Number(media.file_size)>MAX_DOCUMENT_BYTES) fail('Максимум 10 МБ на файл.',413);
    const sourceKey=`telegram:${chatId}:${message.message_id}`;
    if (await first(env,'SELECT id FROM supplier_document_versions WHERE source_key=?',sourceKey)) return {handled:true,duplicate:true};
    const remote=await telegram(env,'getFile',{file_id:media.file_id});
    if (!/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(remote.file_path || '') || remote.file_path.includes('..')) fail('Некоректний файл Telegram.');
    const response=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${remote.file_path}`,{redirect:'error',signal:AbortSignal.timeout(20000)});
    const bytes=await boundedBytes(response,MAX_DOCUMENT_BYTES);
    await uploadDocument(env,user,session,new File([bytes],clean(media.file_name)||`telegram-${message.message_id}.jpg`),sourceKey);
    await say('Документ збережено. Суми оплати не змінені. Можна надіслати наступний файл або /docs_done.');
    return {handled:true};
  } catch(error) {
    // An unresolved intake must not fall through to payment receipt recognition.
    await telegram(env,'sendMessage',{chat_id:chatId,text:error.publicMessage || 'Документ не збережено. Спробуйте завантажити його через адмінку.'}).catch(()=>{});
    return {handled:true,error:true};
  }
}

export async function dispatchSupplierReminders(env, time=nowISO()) {
  const admins=adminIdentities(env).map(user=>user.id);
  if (!admins.length) return {sent:0,failed:0};
  await run(env,"UPDATE supplier_document_followups SET state='failed' WHERE state='sending' AND last_attempt_at<?",new Date(Date.parse(time)-10*60000).toISOString());
  const rows=await all(env,`SELECT f.*,p.order_id,p.payment_number,p.supplier_name,p.paid_at,o.order_number
    FROM supplier_document_followups f JOIN supplier_payments p ON p.id=f.payment_id JOIN orders o ON o.id=p.order_id
    JOIN supplier_document_telegram t ON t.admin_id=f.admin_id
    WHERE f.state='waiting' AND p.status='paid' AND p.paid_at IS NOT NULL
    AND f.admin_id IN (${admins.map(()=>'?').join(',')})
    AND COALESCE(f.due_at,strftime('%Y-%m-%dT%H:%M:%fZ',p.paid_at,'+5 days'))<=?
    AND o.status NOT IN ('china_warehouse','left_china','in_ukraine','ready_for_pickup','completed','cancelled','canceled','received','delivered')
    ORDER BY COALESCE(f.due_at,p.paid_at) LIMIT 5`,...admins,time);
  let sent=0,failed=0;
  for (const row of rows) {
    const recipient=await ownTelegram(env,row.admin_id);
    if (!recipient) continue;
    const claim=await run(env,"UPDATE supplier_document_followups SET state='sending',last_attempt_at=? WHERE payment_id=? AND state='waiting' AND updated_at=?",time,row.payment_id,row.updated_at);
    if (!claim.meta?.changes) continue;
    const user=adminIdentities(env).find(u=>u.id===row.admin_id);
    try {
      const docs=await all(env,`SELECT v.*,d.reference,d.kind,d.supplier_name FROM supplier_document_links l JOIN supplier_documents d ON d.id=l.document_id JOIN supplier_document_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE l.payment_id=? AND l.archived_at IS NULL AND d.kind='invoice' ORDER BY d.created_at DESC LIMIT 4`,row.payment_id);
      const link=`https://evline.com.ua/admin/?order=${encodeURIComponent(row.order_id)}&panel=supplier-documents`;
      await telegram(env,'sendMessage',{chat_id:recipient.chat_id,text:`Перевірити відправлення\n${row.order_number} · ${row.payment_number} · ${row.supplier_name}\n\n${supplierFollowupText({...row,reference:docs[0]?.reference})}\n\n${link}${docs.length>3?'\nРешта рахунків доступна в картці.':''}`,disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'Запитав · +2 дні',callback_data:`sdf:asked:${row.payment_id}`},{text:'Завтра',callback_data:`sdf:later:${row.payment_id}`}],[{text:'Товар відправлено',callback_data:`sdf:shipped:${row.payment_id}`}]]}});
      for (const doc of docs.slice(0,3)) await sendOriginal(env,recipient.chat_id,doc,`${row.order_number} · ${row.supplier_name}`);
      // Do not overwrite a manager's action while Telegram requests were in flight.
      await run(env,"UPDATE supplier_document_followups SET state='notified' WHERE payment_id=? AND state='sending' AND last_attempt_at=?",row.payment_id,time);
      await documentAudit(env,user,'reminder_sent',row.payment_id,row.order_id);
      sent++;
    } catch {
      await run(env,"UPDATE supplier_document_followups SET state='failed' WHERE payment_id=? AND state='sending' AND last_attempt_at=?",row.payment_id,time);
      failed++;
    }
  }
  return {sent,failed};
}
