import { cents, totals, money, dateLabel, escapeHtml as esc, kindLabels, invoiceAmount, invoiceModes } from './model.js?v=20260924-invoice';

const value = v => String(v || '').trim() || '________________';
const p = text => ({ type: 'p', text });
const heading = text => ({ type: 'heading', text });
const field = (label, text) => ({ type: 'field', label, text: value(text) });
const signatures = () => ({ type: 'signatures' });
const party = d => [
  field('Продавець', `${value(d.seller.name)}. РНОКПП: ${value(d.seller.tax_id)}. Адреса: ${value(d.seller.address)}. IBAN: ${value(d.seller.iban)}. Банк: ${value(d.seller.bank)}. Телефон: ${value(d.seller.phone)}.${d.seller.email ? ` Email: ${d.seller.email}.` : ''}`),
  field('Покупець', `${value(d.buyer.name)}. Адреса: ${value(d.buyer.address)}. Телефон: ${value(d.buyer.phone)}.${d.buyer.contact ? ` Email / месенджер: ${d.buyer.contact}.` : ''}${d.buyer.code ? ` Код / РНОКПП: ${d.buyer.code}.` : ''}`),
];
const pdfText = text => String(text).replace(/[^\s\u200b]{35,}/gu, word => word.match(/.{1,24}/gu).join('\u200b'));

export function documentBlocks(d, mode = 'all') {
  const t = totals(d);
  const itemsTable = { type: 'table', headers: ['№', 'Запчастина / артикул', 'К-сть', 'Ціна, грн/шт.', 'Сума, грн'], rows: d.items.map((r, i) => [String(i + 1), [r.title, r.sku && `Артикул: ${r.sku}`, kindLabels[r.kind], r.vin && `VIN: ${r.vin}`, r.notes].filter(Boolean).join('\n'), String(r.quantity), cents(r.price) == null ? '____' : money(cents(r.price)), cents(r.price) == null ? '____' : money(cents(r.price) * r.quantity)]) };
  const invoice = d.invoice?.enabled ? [
    { type: 'title', text: 'Рахунок на оплату' },
    p(`№ ${value(d.invoice.number)} від ${dateLabel(d.invoice.date)}`),
    field('Постачальник / одержувач коштів', d.seller.name),
    field('РНОКПП / ЄДРПОУ', d.seller.tax_id), field('IBAN', d.seller.iban), field('Банк', d.seller.bank),
    field('Адреса постачальника', d.seller.address), field('Телефон', d.seller.phone),
    ...(d.seller.tax_status ? [field('Податковий статус постачальника', d.seller.tax_status)] : []),
    field('Покупець', d.buyer.name), ...(d.buyer.code ? [field('Код / РНОКПП покупця', d.buyer.code)] : []),
    p(`Підстава: Договір № ${value(d.number)} від ${dateLabel(d.date)} та Специфікація № 1.`),
    itemsTable,
    ...d.extras.map(row => field(row.title || 'Погоджені витрати', `${money(cents(row.price))} грн`)),
    field('Повна вартість замовлення', `${money(t.total)} грн`), field('Податковий статус ціни', d.tax),
    field('Платіж', invoiceModes[d.invoice.mode]),
    { type: 'total', text: `До сплати за цим рахунком: ${invoiceAmount(d) == null ? '____' : money(invoiceAmount(d))} грн` },
    ...(d.invoice.due ? [field('Сплатити до', d.invoice.due)] : []),
    field('Призначення платежу', `Оплата автозапчастин за рахунком № ${value(d.invoice.number)}, Договором № ${value(d.number)} від ${dateLabel(d.date)}. ${value(d.tax)}.`),
    p('Рахунок не підтверджує отримання коштів. Договір і специфікація додаються.'),
  ] : [];
  const contract = [
    { type: 'title', text: 'Договір замовлення автозапчастин', pageBreak: mode === 'all' && invoice.length > 0 },
    p(`№ ${value(d.number)} від ${dateLabel(d.date)} · м. ${value(d.city)}`),
    p(`Продавець: ${value(d.seller.name)}, який працює під торговим найменуванням EVLine; реквізити наведені в розділі 7.`),
    p(`Покупець: ${value(d.buyer.name)}. Мета придбання: ${value(d.buyer.purpose)}.`),
    ...d.terms.flatMap(s => [heading(s.title), ...s.text.split(/\n\s*\n/).map(p)]),
    heading('7 Реквізити та підписи'), ...party(d), signatures(),
  ];
  const specification = [
    { type: 'title', text: 'Специфікація замовлення', pageBreak: mode === 'all' },
    p(`Додаток № 1 до Договору № ${value(d.number)} від ${dateLabel(d.date)}`),
    field('Автомобіль', d.car), ...(d.vin ? [field('VIN', d.vin)] : []),
    itemsTable,
    field('Стан та комплектність', d.condition), field('Гарантійні умови', d.warranty),
    field('Сума позицій, грн', money(t.items)), field('У ціну позицій включено', d.included),
    ...(d.extras.length ? [heading('Окремі погоджені складові'), ...d.extras.map(row => field(row.title || 'Складова', `${money(cents(row.price))} грн`)), field('Розподіл спільних витрат', d.allocation)] : [p('Окремо оплачувані складові: відсутні.')]),
    p('Складові, відсутні в цьому переліку, не можуть бути додані до рахунку без згоди Покупця.'),
    { type: 'total', text: `Загальна остаточна ціна: ${money(t.total)} грн` },
    field('Податковий статус ціни', d.tax),
    field('Погоджена передоплата', cents(d.prepayment) == null ? '' : `${money(cents(d.prepayment))} грн`), field('Строк передоплати', d.prepayment_due),
    field('Залишок після погодженої передоплати', cents(d.prepayment) == null ? '' : `${money(t.balance)} грн`), field('Умови сплати залишку', d.balance_due),
    field('Маршрут', d.route), field('Очікуваний період доставки, прогноз', d.forecast),
    field('Погоджений строк виконання', d.deadline_days ? `${d.deadline_days} календарних днів від події, визначеної пунктом 3.2 Договору, з продовженням лише за правилами пункту 3.3 або за згодою Сторін.` : ''),
    field('Місце і спосіб отримання', d.handover), field('Одержувач і телефон', d.recipient), field('Часткова передача', d.partial),
    ...(d.notes ? [field('Додаткові умови', d.notes)] : []),
    p('Сторони погодили перелік запчастин, їх тип, VIN, повну ціну, оплату та умови доставки.'),
    signatures(), p('Дата підписання ____________________'),
  ];
  const receipt = d.receipt.enabled ? [
    { type: 'title', text: 'Підтвердження отримання оплати', pageBreak: mode === 'all' },
    p(`До Договору № ${value(d.number)} від ${dateLabel(d.date)}`),
    field('Продавець', d.seller.name), field('Покупець', d.buyer.name),
    { type: 'total', text: `Отримано від Покупця: ${money(cents(d.receipt.amount))} грн` },
    field('Дата отримання', dateLabel(d.receipt.date)), field('Спосіб оплати', d.receipt.method), field('Підстава / номер платіжного документа', d.receipt.reference),
    field('Вартість замовлення', `${money(t.total)} грн`), field('Залишок до сплати', `${money(t.total - t.received)} грн`),
    p('Це підтвердження Продавця щодо отриманої оплати. Воно не є фіскальним чеком і не замінює розрахунковий документ у випадках, коли його видача передбачена законом.'),
    p('Продавець ____________________'),
  ] : [];
  return mode === 'invoice' ? invoice : mode === 'contract' ? contract : mode === 'specification' ? specification : mode === 'receipt' ? receipt : [...invoice, ...contract, ...specification, ...receipt];
}

export function previewHtml(data, mode, isDraft) {
  return `<article class="paper">${isDraft ? '<div class="draft-mark">Чернетка</div>' : ''}${documentBlocks(data, mode).map(b => {
    const page = b.pageBreak ? ' class="page-break"' : '';
    if (b.type === 'title') return `<h2${page}>${esc(b.text)}</h2>`;
    if (b.type === 'heading') return `<h3>${esc(b.text)}</h3>`;
    if (b.type === 'field') return `<p><strong>${esc(b.label)}:</strong> ${esc(b.text)}</p>`;
    if (b.type === 'total') return `<p class="document-total">${esc(b.text)}</p>`;
    if (b.type === 'signatures') return '<div class="signatures"><span>Продавець ____________________</span><span>Покупець ____________________</span></div>';
    if (b.type === 'table') return `<div class="spec-table-wrap"><table class="spec-table"><thead><tr>${b.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map(c => `<td>${esc(c).replaceAll('\n', '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<p>${esc(b.text).replaceAll('\n', '<br>')}</p>`;
  }).join('')}</article>`;
}

export function pdfDefinition(data, { mode = 'all', draft = false, revision = 0 } = {}) {
  const blocks = documentBlocks(data, mode);
  const content = blocks.map(b => {
    if (b.type === 'title') return { text: b.text, style: 'title', pageBreak: b.pageBreak ? 'before' : undefined };
    if (b.type === 'heading') return { text: b.text, style: 'heading', headlineLevel: 1 };
    if (b.type === 'total') return { text: b.text, bold: true, fontSize: 12, margin: [0, 8, 0, 10] };
    if (b.type === 'field') return { text: [{ text: `${pdfText(b.label)}: `, bold: true }, pdfText(b.text)], margin: [0, 0, 0, 5] };
    if (b.type === 'signatures') return { columns: [{ text: 'Продавець ____________________' }, { text: 'Покупець ____________________', alignment: 'right' }], margin: [0, 20, 0, 14], unbreakable: true };
    if (b.type === 'table') return { table: { headerRows: 1, widths: [16, '*', 28, 65, 65], body: [b.headers.map(text => ({ text, bold: true, fillColor: '#f0f4f2' })), ...b.rows.map(row => row.map((text, i) => ({ text: pdfText(text), alignment: i > 1 ? 'right' : 'left' })))] }, fontSize: 9, layout: { hLineColor: () => '#c9d4cf', vLineColor: () => '#c9d4cf', paddingTop: () => 7, paddingBottom: () => 7, paddingLeft: () => 5, paddingRight: () => 5 }, margin: [0, 10, 0, 12] };
    return { text: pdfText(b.text), margin: [0, 0, 0, 7] };
  });
  const deliveryStart = blocks.findIndex(b => b.type === 'field' && b.label === 'Маршрут');
  const deliveryEnd = blocks.findIndex(b => b.type === 'p' && b.text === 'Дата підписання ____________________');
  // Keep the short delivery/signature tail together; long custom clauses can still flow across pages.
  if (deliveryStart >= 0 && deliveryEnd > deliveryStart && blocks.slice(deliveryStart, deliveryEnd + 1).reduce((n, b) => n + (b.text?.length || 0), 0) < 1800) {
    const tail = content.splice(deliveryStart, deliveryEnd - deliveryStart + 1);
    content.splice(deliveryStart, 0, { stack: tail, unbreakable: true });
  }
  return { info: { title: `EVLine ${data.number}`, author: 'EVLine' }, pageSize: 'A4', pageMargins: [42, 50, 42, 46],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2, color: '#17221e' },
    styles: { title: { fontSize: 19, bold: true, margin: [0, 0, 0, 13] }, heading: { fontSize: 11, bold: true, margin: [0, 10, 0, 7] } },
    header: { text: 'EVLine', color: '#08754f', bold: true, fontSize: 11, margin: [42, 22, 0, 0] },
    footer: (page, pages) => ({ columns: [{ text: pdfText(`${data.number} · версія ${revision}${draft ? ' · ЧЕРНЕТКА' : ''}`) }, { text: `${page} / ${pages}`, alignment: 'right' }], fontSize: 8, color: '#5e6a65', margin: [42, 12, 42, 0] }),
    ...(draft ? { watermark: { text: 'ЧЕРНЕТКА', color: '#84948d', opacity: 0.12, bold: true } } : {}),
    pageBreakBefore: (node, following) => node.headlineLevel === 1 && following.length === 0,
    content,
  };
}
