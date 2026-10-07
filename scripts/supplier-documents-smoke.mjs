import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(import.meta.dirname,'..'),output=process.env.SMOKE_OUTPUT || '/tmp/evline-supplier-documents-smoke';
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.join(root,pathname.endsWith('/')?`${pathname}index.html`:pathname);
    if(!file.startsWith(`${root}/`)) throw new Error('outside root');
    res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)] || 'application/octet-stream'});
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
const png=await readFile(path.join(root,'assets/images/logo.png'));
try {
  for(const width of [1440,1024,768,390,320]) {
    const context=await browser.newContext({viewport:{width,height:950},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.emulateMedia({reducedMotion:'reduce'});
    page.on('dialog',d=>d.accept());
    await page.addInitScript(()=>localStorage.setItem('evline_admin_token','isolated-test'));
    const order={id:'11111111-1111-1111-1111-111111111111',order_number:'O-900001',customer_name:'Тестовий клієнт',customer_phone:'+380000000001',type:'parts',status:'paid',item_name:'Фара права',car:'BYD Yuan Plus',created_at:new Date().toISOString(),revenue_uah:20000};
    const payment={id:'pay1',payment_number:'P-900001',supplier_name:'BYD',requested_amount:1000,requested_currency:'CNY',paid_amount:1000,paid_currency:'CNY',status:'paid',paid_at:'2026-10-01T10:00:00.000Z'};
    let documents=[],followups=[],patches=0,uploads=0;
    const managers=[{id:'andrii',name:'Андрій',telegram_ready:true},{id:'ihor',name:'Ігор',telegram_ready:false}];
    const selectedRequests=[];
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());let body={};
      if(url.pathname==='/api/admin/supplier-documents') {
        const action=url.searchParams.get('action'),data=req.method()==='POST' && action!=='upload'?req.postDataJSON():{};
        if(action==='setup') body={user:managers[0],managers,storage_ready:true,cron_ready:true,connected:{display_name:'Test Manager',telegram_id:'1001'}};
        else if(action==='list') body={documents,followups};
        else if(action==='counts') body={counts:documents.length?[{order_id:order.id,count:documents.filter(d=>!d.archived_at).length}]:[]};
        else if(action==='upload') {
          const form=await new Response(req.postDataBuffer(),{headers:{'content-type':req.headers()['content-type']}}).formData();
          const file=form.get('file');assert.equal(form.get('order_id'),order.id);assert.equal(form.get('payment_id'),'pay1');
          uploads++;
          if(form.get('document_id')) documents[0]={...documents[0],current_version:2,filename:file.name};
          else documents.push({id:'doc1',supplier_name:'BYD',kind:form.get('kind'),reference:form.get('reference'),payment_id:'pay1',current_version:1,filename:file.name,mime:file.type,bytes:file.size,version_created_at:new Date().toISOString(),version_created_by:'andrii',linked_orders:1});
          body={ok:true};
        } else if(action==='archive' || action==='restore') {documents[0].archived_at=action==='archive'?new Date().toISOString():null;body={ok:true};}
        else if(action==='versions') body={versions:[{version:2,filename:'updated.png',created_at:new Date().toISOString()},{version:1,filename:'invoice.png',created_at:new Date().toISOString()}]};
        else if(action==='file') return route.fulfill({contentType:'image/png',body:png});
        else if(action==='send') {selectedRequests.push(data);body={sent:data.ids,failed:[],uncertain:false};}
        else if(action==='followup') {followups=[{...data,effective_due_at:data.due_at}];body={ok:true};}
        else if(action==='search') body={documents:[{id:'shared',order_number:'O-900002',supplier_name:'BYD',kind:'invoice',filename:'shared.pdf'}]};
        else if(action==='link') {assert.equal(data.id,'shared');body={ok:true};}
        else if(action==='intake') body={link:'https://t.me/fixture_bot?start=sddoc_test'};
        else throw new Error(`Unhandled document action: ${action}`);
      } else if(url.pathname==='/api/admin/orders') body={orders:[order],total:1};
      else if(url.pathname===`/api/admin/orders/${order.id}`) {if(req.method()==='PATCH') patches++;body={order,supplier_payments:[payment],supplier_requests:[],events:[],notifications:[],tracking_events:[]};}
      else if(url.pathname==='/api/admin/session') body={user:managers[0]};
      else if(url.pathname==='/api/admin/summary') body={totals:{},sources:[],campaigns:[],daily:[]};
      else if(url.pathname==='/api/admin/suppliers') body={suppliers:[{id:'byd',name:'BYD',active:1}]};
      else if(url.pathname==='/api/admin/shipping') body={carriers:[],rates:[]};
      return route.fulfill({json:body});
    });
    await page.goto(`${origin}/admin/`);
    await page.locator(`[data-open-order="${order.id}"]`).click();
    await page.locator('[data-order-tab="payment"]').click();
    await page.locator('[data-sd-payment-open="pay1"]').click();
    const panel=page.locator('[data-supplier-documents]');
    await panel.locator('[data-sd-reference]').fill('CN-100');
    await panel.locator('[data-sd-reference]').press('Enter');
    assert.equal(patches,0,'document Enter must not submit the order');
    await panel.locator('[data-sd-file]').setInputFiles({name:'invoice.png',mimeType:'image/png',buffer:png});
    assert.equal(await page.locator('[data-order-save-bar] button').isEnabled(),true,'pending files enable common save');
    await page.locator('[data-order-save-bar] button').click();
    await panel.locator('[data-sd-row="doc1"]').waitFor();
    assert.equal(uploads,1);
    assert.equal(patches,0,'attachment-only save must not patch order or notify customer');
    // Clipboard/drop events use browser-local synthetic files, not the system clipboard.
    for(const type of ['paste','drop']) {
      await panel.locator('.sd-drop').evaluate((node,type)=>{
        const transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'pasted.png',{type:'image/png'}));
        const event=type==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});
        node.dispatchEvent(event);
      },type);
      assert.match(await panel.locator('[data-sd-pending]').textContent(),/pasted.png/);
      await panel.locator('[data-sd-action="cancel-upload"]').click();
      assert.equal(uploads,1,'paste/drop must wait for explicit save');
    }
    assert.equal(await page.locator('[data-order-save-bar] button').isDisabled(),true,'document inputs must not dirty order');
    await panel.locator('[data-sd-action="preview"]').click();
    await page.locator('.sd-preview img').waitFor();
    assert.ok(await page.locator('.sd-preview img').evaluate(img=>img.complete && img.naturalWidth>0));
    await page.locator('.sd-preview [data-close]').click();
    await panel.locator('[data-sd-action="replace"]').click();
    await panel.locator('[data-sd-file]').setInputFiles({name:'updated.png',mimeType:'image/png',buffer:png});
    await panel.locator('[data-sd-action="upload"]').click();
    await panel.getByText(/v2 ·/).waitFor();
    await panel.locator('[data-sd-action="versions"]').click();
    await panel.locator('[data-sd-versions] [data-version="1"]').first().waitFor();
    await panel.locator('[data-sd-select]').check();
    await panel.locator('[data-sd-action="send-followup"]').click();
    await panel.getByText('Надіслано файлів: 1.',{exact:true}).waitFor();
    assert.deepEqual(selectedRequests[0].ids,['doc1']);assert.equal(selectedRequests[0].followup_text,true);
    await panel.locator('[data-sd-action="archive"]').click();
    await panel.locator('[data-sd-archived-count]').getByText('· 1').waitFor();
    await panel.getByText('Вилучені з цього замовлення',{exact:false}).click();
    await panel.locator('[data-sd-action="restore"]').click();
    await panel.locator('[data-sd-list] [data-sd-row]').waitFor();
    await panel.locator('[data-sd-action="asked"]').click();
    await panel.getByText('Контроль відправлення оновлено.',{exact:true}).waitFor();
    assert.ok(followups[0].asked);
    await panel.locator('[data-sd-upload]').evaluate(node=>node.open=false);
    await panel.scrollIntoViewIfNeeded();
    const overflows=await panel.evaluate(root=>[...root.querySelectorAll('*')].filter(el=>el.getClientRects().length && el.getBoundingClientRect().right>root.getBoundingClientRect().right+2).map(el=>el.tagName+':'+el.className));
    assert.deepEqual(overflows,[],`panel overflow at ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`page overflow at ${width}`);
    await page.screenshot({path:`${output}/documents-${width}.png`});
    await context.close();console.log(`PASS documents ${width}px`);
  }
  assert.deepEqual(errors,[]);console.log(`Screenshots: ${output}`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
