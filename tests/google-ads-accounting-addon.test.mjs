import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../docs/google-ads-accounting-addon.js', import.meta.url), 'utf8');
function execute({ rows = [], preview = false, currency = 'UAH', customer = '402-848-8894', failed = false } = {}) {
  const requests = [];
  const context = {
    Date, Number, Object, JSON, Math, Error, SYNC_TOKEN: 'test-only',
    AdsApp: { currentAccount: () => ({getCustomerId:()=>customer,getCurrencyCode:()=>currency,getTimeZone:()=> 'Europe/Kiev'}),
      getExecutionInfo:()=>({isPreview:()=>preview}), search: query => {
        assert.match(query,/FROM customer/); if(failed) throw Error('upstream failed');
        let i=0; return {hasNext:()=>i<rows.length,next:()=>rows[i++]};
      } },
    Utilities: { formatDate:()=> '2026-10-09' }, Logger: {log:()=>{}},
    UrlFetchApp: {fetch: (url, options) => {requests.push({url,...options}); return {getResponseCode:()=>200,getContentText:()=>'{"ok":true,"run_id":"test"}'};}}
  };
  vm.runInNewContext(source, context); context.evlineAccountingSync(); return requests;
}
test('full account snapshot explicitly covers zero days and omits today',()=>{
  const sent = execute({rows:[{segments:{date:'2026-10-08'},metrics:{costMicros:1351690000}}]});
  assert.equal(sent.length,1); const p=JSON.parse(sent[0].payload);
  assert.equal(p.days.length,30);assert.equal(p.days[29].spend_minor,135169);
  assert.equal(p.days[0].spend_minor,0);assert.equal(p.to,'2026-10-08');
  assert.equal(sent[0].followRedirects,false);
});
test('preview never imports',()=>assert.equal(execute({preview:true}).length,0));
test('failed query, foreign account, currency, invalid/duplicate cost fail closed',()=>{
  assert.throws(()=>execute({failed:true})); assert.throws(()=>execute({customer:'123'}));
  assert.throws(()=>execute({currency:'USD'}));
  assert.throws(()=>execute({rows:[{segments:{date:'2026-10-08'},metrics:{costMicros:-1}}]}));
  const row={segments:{date:'2026-10-08'},metrics:{costMicros:1}};
  assert.throws(()=>execute({rows:[row,row]}));
});
