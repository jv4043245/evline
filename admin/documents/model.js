import { AGREEMENT_TERMS } from './agreement-template.js';

export const TEMPLATE_VERSION = '2026-09-23';
export const SELLER_FIELDS = ['name', 'tax_id', 'address', 'iban', 'bank', 'phone', 'email', 'tax_status'];
export const BUYER_FIELDS = ['name', 'address', 'code', 'phone', 'contact', 'purpose'];
export const TEXT_FIELDS = ['number', 'date', 'city', 'car', 'vin', 'condition', 'warranty', 'tax', 'included', 'allocation', 'prepayment_due', 'balance_due', 'route', 'forecast', 'deadline_days', 'handover', 'recipient', 'partial', 'notes'];
export const DEFAULT_SELLER = { name: 'ФОП Ванюшин Євген Анатолійович', phone: '+38 (093) 525-10-24', email: 'evlineukraine@gmail.com', tax_id: '', address: '', iban: '', bank: '' };
export const fieldLabels = { number: 'Номер договору', date: 'Дата договору', city: 'Місто', car: 'Авто / модель / рік', vin: 'VIN', condition: 'Стан та комплектність', warranty: 'Гарантійні умови', tax: 'Податковий статус ціни', included: 'Що включено в ціни позицій', allocation: 'Розподіл спільних витрат', prepayment_due: 'Строк передоплати', balance_due: 'Умови сплати залишку', route: 'Маршрут', forecast: 'Прогноз доставки', deadline_days: 'Погоджений строк, календарних днів', handover: 'Місце та спосіб отримання', recipient: 'Одержувач і телефон', partial: 'Часткова передача', notes: 'Додаткові умови' };
export const kindLabels = { original: 'Оригінал', oem: 'OEM', analog: 'Аналог' };
const mixedTerms = structuredClone(AGREEMENT_TERMS);
mixedTerms[0].text = mixedTerms[0].text.replace('Продавець гарантує оригінальність замовлених автозапчастин та їх відповідність', 'Продавець гарантує відповідність замовлених автозапчастин погодженому у Специфікації типу (оригінал, OEM або аналог), а також').replace('Оригінальними є запчастини', 'Оригінальність гарантується для позицій, прямо позначених у Специфікації як «Оригінал». Оригінальними є запчастини');
mixedTerms[3].text = mixedTerms[3].text.replace('Якщо передана автозапчастина не є оригінальною або не відповідає погодженій Специфікації', 'Якщо передана автозапчастина не відповідає погодженому типу або іншим умовам Специфікації').replace('на погоджену оригінальну запчастину', 'на запчастину погодженого у Специфікації типу');

export function syncStandardTerms(d) {
  const target = d.items.some(r => r.kind && r.kind !== 'original') ? mixedTerms : AGREEMENT_TERMS;
  for (const i of [0, 3]) if ([AGREEMENT_TERMS[i].text, mixedTerms[i].text].includes(d.terms[i].text)) d.terms[i].text = target[i].text;
}
export function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
const str = (v, max = 3000) => { if (v != null && typeof v !== 'string') throw fail('Некоректний текст документа.'); const s = String(v ?? '').trim(); if (s.length > max) throw fail(`Текст перевищує ${max} символів.`); return s; };
export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function cents(value, label = 'Сума') {
  if (value === '' || value == null) return null;
  const s = String(value).replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) throw fail(`${label}: введіть невід’ємну суму, не більше двох знаків після коми.`);
  return Math.round(Number(s) * 100);
}
export const money = value => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((value ?? 0) / 100);
export const amount = value => value == null ? '' : (Number(value) / 100).toFixed(2);
export const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : value || '________________';
export function cleanSeller(value = {}) { return Object.fromEntries(SELLER_FIELDS.map(k => [k, str(value[k], ['address', 'tax_status'].includes(k) ? 1000 : 200)])); }
export const invoiceModes = { total: 'Повна вартість', prepayment: 'Погоджена передоплата', balance: 'Залишок після отриманої оплати', custom: 'Інша погоджена сума' };
export function invoiceDefaults(d, enabled = false) { return { enabled, number: d.number || '', date: d.date || '', mode: 'total', amount: '', due: '' }; }
export function invoiceAmount(d) {
  const i = d.invoice || invoiceDefaults(d), t = totals(d);
  if (i.mode === 'prepayment') return cents(d.prepayment);
  if (i.mode === 'balance') return d.receipt.enabled && d.receipt.confirmed ? t.total - t.received : null;
  return i.mode === 'custom' ? cents(i.amount) : t.total;
}

export function fromOrder(order, rows = [], seller = DEFAULT_SELLER) {
  const d = Object.fromEntries(TEXT_FIELDS.map(k => [k, '']));
  const price = Number(order.revenue_uah) > 0 ? Number(order.revenue_uah).toFixed(2) : '';
  const result = { ...d, schema: 1, template_version: TEMPLATE_VERSION, seller_profile_id: '',
    number: `EV-${order.order_number || order.id}`, date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()), city: 'Київ',
    seller: { ...DEFAULT_SELLER, ...seller }, buyer: { name: order.customer_name || '', phone: order.customer_phone || '', contact: order.customer_email || order.customer_telegram || '', address: '', code: '', purpose: '' },
    car: order.car || '', vin: order.vin || '', recipient: [order.customer_name, order.customer_phone].filter(Boolean).join(', '),
    route: { air: 'Авіа', sea: 'Море', combined: 'Комбінований' }[order.shipping_mode] || '',
    items: rows.length ? rows.map(row => ({ title: row.title || '', sku: row.sku || '', quantity: Number(row.quantity) || 1, price: Number(row.unit_price_uah) > 0 ? Number(row.unit_price_uah).toFixed(2) : '', kind: '', vin: '', notes: '' })) : [{ title: order.item_name || order.service_name || '', sku: '', quantity: 1, price, kind: '', vin: '', notes: '' }],
    extras: [], prepayment: '', receipt: { enabled: false, amount: '', date: '', method: '', reference: '', confirmed: false },
    terms: structuredClone(AGREEMENT_TERMS), reviewed: false,
  };
  result.invoice = invoiceDefaults(result, true);
  return result;
}

export function normalizeDocument(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Документ відсутній.');
  const d = { schema: 1, template_version: TEMPLATE_VERSION, seller: cleanSeller(input.seller), seller_profile_id: str(input.seller_profile_id, 80), buyer: {}, reviewed: input.reviewed === true };
  for (const key of TEXT_FIELDS) d[key] = str(input[key], ['number', 'date', 'deadline_days'].includes(key) ? 80 : 3000);
  for (const key of BUYER_FIELDS) d.buyer[key] = str(input.buyer?.[key], 1000);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40) throw fail('У специфікації має бути від 1 до 40 позицій.');
  d.items = input.items.map(row => {
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw fail('Кількість: ціле число від 1 до 1000.');
    const kind = str(row.kind, 20);
    if (kind && !kindLabels[kind]) throw fail('Невідомий тип запчастини.');
    return { title: str(row.title, 2000), sku: str(row.sku, 160), quantity, price: amount(cents(row.price, 'Ціна позиції')), kind, vin: str(row.vin, 200), notes: str(row.notes, 1500) };
  });
  if (!Array.isArray(input.extras) || input.extras.length > 10) throw fail('Не більше 10 окремих витрат.');
  d.extras = input.extras.map(row => ({ title: str(row.title, 300), price: amount(cents(row.price, 'Окремі витрати')) }));
  d.prepayment = amount(cents(input.prepayment, 'Передоплата'));
  d.receipt = { enabled: input.receipt?.enabled === true, amount: amount(cents(input.receipt?.amount, 'Отримано від клієнта')), date: str(input.receipt?.date, 20), method: str(input.receipt?.method, 200), reference: str(input.receipt?.reference, 300), confirmed: input.receipt?.confirmed === true };
  const invoice = input.invoice || invoiceDefaults(d);
  if (!invoiceModes[invoice.mode]) throw fail('Невідомий тип суми рахунку.');
  d.invoice = { enabled: invoice.enabled === true, number: str(invoice.number, 80), date: str(invoice.date, 20), mode: invoice.mode, amount: amount(cents(invoice.amount, 'Сума рахунку')), due: str(invoice.due, 300) };
  if (!Array.isArray(input.terms) || input.terms.length !== AGREEMENT_TERMS.length) throw fail('Некоректні розділи договору.');
  d.terms = input.terms.map((s, i) => ({ title: AGREEMENT_TERMS[i].title, text: str(s.text, 15000) }));
  syncStandardTerms(d);
  if (JSON.stringify(d).length > 100000) throw fail('Документ завеликий.');
  if (totals(d).total > 9999999999) throw fail('Загальна ціна завелика.');
  return d;
}

export function totals(d) {
  const items = d.items.reduce((sum, row) => sum + (cents(row.price) || 0) * Number(row.quantity), 0);
  const extras = d.extras.reduce((sum, row) => sum + (cents(row.price) || 0), 0);
  const total = items + extras;
  return { items, extras, total, balance: total - (cents(d.prepayment) || 0), received: d.receipt.enabled ? cents(d.receipt.amount) || 0 : 0 };
}

export function validateReady(d) {
  const errors = [];
  const required = (v, label) => { if (!String(v ?? '').trim()) errors.push(label); };
  for (const k of ['number', 'date', 'city', 'car', 'condition', 'warranty', 'tax', 'included', 'prepayment_due', 'balance_due', 'route', 'forecast', 'deadline_days', 'handover', 'recipient', 'partial']) required(d[k], fieldLabels[k]);
  for (const [k, label] of Object.entries({ name: 'ПІБ / назва покупця', address: 'Адреса покупця', phone: 'Телефон покупця', purpose: 'Мета придбання' })) required(d.buyer[k], label);
  for (const [k, label] of Object.entries({ name: 'Продавець', tax_id: 'РНОКПП продавця', address: 'Адреса продавця', iban: 'IBAN продавця', bank: 'Банк', phone: 'Телефон продавця' })) required(d.seller[k], label);
  if (d.seller.iban && !validIban(d.seller.iban)) errors.push('Коректний український IBAN');
  if (d.date && !validDate(d.date)) errors.push('Коректна дата договору');
  if (d.deadline_days && !/^[1-9]\d{0,3}$/.test(d.deadline_days)) errors.push('Строк: від 1 до 9999 календарних днів');
  for (const [i, row] of d.items.entries()) {
    required(row.title, `Позиція ${i + 1}: назва`); required(row.kind, `Позиція ${i + 1}: оригінал / OEM / аналог`);
    if (cents(row.price) == null) errors.push(`Позиція ${i + 1}: ціна`);
  }
  for (const [i, row] of d.extras.entries()) if (!row.title || cents(row.price) == null) errors.push(`Окремі витрати ${i + 1}: назва і сума`);
  if (d.extras.length && !d.allocation) errors.push('Розподіл спільних витрат');
  const t = totals(d);
  if (t.total <= 0) errors.push('Загальна ціна більше нуля');
  if (cents(d.prepayment) == null || t.balance < 0) errors.push('Передоплата від 0 до загальної ціни');
  if (d.terms.some(s => !s.text)) errors.push('Текст усіх розділів договору');
  if (d.receipt.enabled) {
    if (!cents(d.receipt.amount) || cents(d.receipt.amount) > t.total) errors.push('Отримано від клієнта: сума від 0,01 до загальної ціни');
    if (!validDate(d.receipt.date)) errors.push('Дата отримання оплати');
    required(d.receipt.method, 'Спосіб оплати клієнта'); required(d.receipt.reference, 'Підстава підтвердження оплати');
    if (!d.receipt.confirmed) errors.push('Підтвердження перевірки надходження від клієнта');
  }
  if (d.invoice?.enabled) {
    required(d.invoice.number, 'Номер рахунку');
    if (!validDate(d.invoice.date)) errors.push('Дата рахунку');
    const payable = invoiceAmount(d);
    if (payable == null || payable <= 0 || payable > t.total) errors.push('Сума рахунку від 0,01 до вартості замовлення');
    if (d.invoice.mode === 'balance' && (!d.receipt.enabled || !d.receipt.confirmed)) errors.push('Перевірена отримана оплата для рахунку на залишок');
  }
  if (!d.reviewed) errors.push('Перевірка менеджером');
  return errors;
}
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function validIban(value) {
  const v = value.replace(/\s/g, '').toUpperCase();
  if (!/^UA\d{27}$/.test(v)) return false;
  const digits = `${v.slice(4)}${v.slice(0, 4)}`.replace(/[A-Z]/g, x => String(x.charCodeAt(0) - 55));
  let rem = 0; for (const digit of digits) rem = (rem * 10 + Number(digit)) % 97;
  return rem === 1;
}
