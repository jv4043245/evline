import { parseMarketProducts } from '../functions/_lib/market-products.js';
import { fetchMarketPage } from '../functions/_lib/market-fetch.js';

// Opt-in public reads only; no admin API, orders, payments or bot messages.
if (!process.argv.includes('--live')) throw new Error('Pass --live for public source checks.');
const cases = [
  { key: 'mahina', home: 'https://mahina.in.ua/', url: 'https://mahina.in.ua/ua/catalog/byd-yuan-pro/bamper_zadniy_bid_yuan_pro_aftermarket_11515426_00/' },
  { key: 'evox', home: 'https://evox.com.ua/', url: 'https://evox.com.ua/katalog/zapchastyny/byd/sea-lion-06/optyka-ta-ositlennia/fary-peredni/' },
  { key: 'kitaec', home: 'https://kitaec.ua/', url: 'https://kitaec.ua/bamper-zadniy-11515426-00/' },
];
for (const source of cases) {
  try {
    const page = await fetchMarketPage(source.url, source, { requests: 0, deadline: Date.now() + 15000 });
    const rows = parseMarketProducts(source.key, page.body, page.url, { productPage: source.key !== 'evox' });
    console.log(JSON.stringify({ source: source.key, count: rows.length, rows: rows.slice(0, 3) }, null, 2));
  } catch (error) { console.log(JSON.stringify({ source: source.key, error: error.message })); }
}
