import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function renderGoogleAdsKeywords('), source.indexOf('\nfunction rateFromMode('));
function render(data) {
  const nodes = Object.fromEntries(['status','summary',''].map(s => [`[data-google-ads-keywords${s ? `-${s}` : ''}]`, {textContent:'',innerHTML:''}]));
  const escapeHtml = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const context = { document: {querySelector: s => nodes[s]}, state: {}, numberFmt: new Intl.NumberFormat('uk-UA'), money: new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}), keywordLevelLabels:{keyword:'Ключ',search_term:'Запит'}, escapeHtml, textOrDash: s => escapeHtml(s || '—'), safeClass: s => s.replace(/[^a-z_]/g,'') };
  vm.createContext(context); vm.runInContext(renderSource, context); context.renderGoogleAdsKeywords(data); return nodes;
}
test('unknown economics and ambiguous CRM attribution remain dashes, not false zeros', () => {
  const result = render({summary:{rows:1,spend_uah:500,value_uah:null,profit_roas:null,traffic_level:'keyword'},keywords:[{level:'keyword',term:'тест',spend_uah:500,clicks:10,impressions:100,leads:null,paid_orders:null,value_uah:null,gross_profit_uah:null,google_conversion_value:1200,profit_roas:null,cpa_uah:null,crm_metrics_available:false,crm_match:'ambiguous_campaign_term'}]});
  const table = result['[data-google-ads-keywords]'].innerHTML;
  assert.match(table,/— лідів · — оплат/);
  assert.match(table,/точний розподіл невідомий/);
  assert.match(table,/ROAS —/);
  assert.doesNotMatch(table,/0\.0x|CPA 0/);
  assert.match(result['[data-google-ads-keywords-summary]'].innerHTML,/без повторного додавання/);
  assert.doesNotMatch(result['[data-google-ads-keywords-summary]'].innerHTML,/кандидати у мінус-слова/);
});
test('UTM aggregate keeps its true zero and does not invent traffic or render unsafe terms', () => {
  const result = render({summary:{},keywords:[{level:'utm_term',term:'<img onerror="x">',spend_uah:null,clicks:null,impressions:null,leads:2,paid_orders:0,crm_metrics_available:true,crm_match:'utm_term_only'}]});
  const table = result['[data-google-ads-keywords]'].innerHTML;
  assert.match(table,/2 лідів · 0 оплат клієнта/);
  assert.match(table,/— кліків · — показів/);
  assert.match(table,/CRM: UTM-ключ/);
  assert.doesNotMatch(table,/<img/);
});
