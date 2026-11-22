import test from 'node:test';
import assert from 'node:assert/strict';
import { chineseMoney, invoiceInput, invoiceDefinition, validateSupplierInvoiceTemplate } from '../admin/supplier-invoice-model.js';
import { suggestInvoicePart } from '../admin/supplier-invoice-terms.js';

test('template keeps only owner-editable requisites and bounds all fields',()=>{
  const meta=validateSupplierInvoiceTemplate({supplier:' 测试供应商 ',buyer:'EVLine QA', contact:'55', unknown:'x',english:{supplier:'Test Supplier',buyer:'EVLine QA'}});
  assert.equal(meta.supplier,'测试供应商');
  assert.equal(meta.unknown,undefined);
  assert.equal(meta.english.contact,'55');
  assert.throws(()=>validateSupplierInvoiceTemplate({...meta,english:{}}),/англійський/);
  assert.throws(()=>validateSupplierInvoiceTemplate({}),/постачальника/);
  assert.throws(()=>validateSupplierInvoiceTemplate({...meta,terms:'x'.repeat(221)}),/Умови/);
});

test('amount and date validation do not silently round or roll over',()=>{
  const good={part:'  左前翼子板   BYD ',amount:'2035,05',date:'2026-11-22'};
  assert.deepEqual(invoiceInput(good),{part:'左前翼子板 BYD',cents:203505,total:'2035.05',date:'2026-11-22'});
  for(const amount of ['0','-40','2.005','1e4','1,400.00','1000000000']) assert.throws(()=>invoiceInput({...good,amount}),/суму/);
  assert.throws(()=>invoiceInput({...good,date:'2026-02-30'}),/дату/);
  assert.doesNotThrow(()=>invoiceInput({...good,date:'2028-02-29'}));
});

test('Chinese uppercase totals handle gaps, decimals and unit group boundaries',()=>{
  const cases=[[203500,'贰仟零叁拾伍元整'],[203505,'贰仟零叁拾伍元零伍分'],[109,'壹元零玖分'],
    [5,'零元伍分'],[210,'贰元壹角'],[100100100,'壹佰万壹仟零壹元整'],
    [10000000100,'壹亿零壹元整'],[11000000000,'壹亿壹仟万元整']];
  for(const [cents,expected] of cases) assert.equal(chineseMoney(cents),expected);
});

test('PDF uses the supplier table with the three inputs and no example transaction',()=>{
  const template=validateSupplierInvoiceTemplate({supplier:'测试供应商',buyer:'EVLine QA',warehouse:'BC',english:{supplier:'Test Supplier',buyer:'EVLine QA'}});
  const data={...invoiceInput({part:'Переднє крило',amount:'812.49',date:'2026-11-22'}),partZh:'前翼子板',partEn:'front fender'};
  const pdf=invoiceDefinition(template,data,'EVL-CN-O-TEST-20261122-abcd1234');
  const json=JSON.stringify(pdf);
  assert.match(json,/内部使用/);
  assert.match(json,/购货日期：2026-11-22/);
  assert.match(json,/打印日期：2026-11-22/);
  assert.deepEqual(pdf.content[3].table.body[1].map(cell=>cell.text),[
    '1','','前翼子板','','BC','1','812.49','812.49','',
  ]);
  assert.match(json,/Test Supplier - Sales Invoice/);
  assert.match(json,/Total in words: Eight hundred twelve yuan and forty-nine fen/);
  assert.match(json,/front fender/);
  assert.doesNotMatch(json,/XS26492|2035\.00/);
});

test('local vocabulary preserves the part and side and never guesses an unknown term',()=>{
  assert.deepEqual(suggestInvoicePart('Переднє ліве крило'),{partZh:'左前翼子板',partEn:'front left fender'});
  assert.deepEqual(suggestInvoicePart('右后尾灯'),{partZh:'右后尾灯',partEn:'rear right tail light'});
  assert.deepEqual(suggestInvoicePart('Front bumper'),{partZh:'前保险杠',partEn:'Front bumper'});
  assert.deepEqual(suggestInvoicePart('Переднє крило BYD'),{partZh:'',partEn:''});
});
