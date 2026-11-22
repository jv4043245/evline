export const internalInvoicePrefix = 'EVL-CN-';

export const templateFields = {
  supplier: 'Назва постачальника китайською',
  buyer: 'Покупець',
  contact: 'Контакт покупця',
  pickup: 'Спосіб отримання',
  warehouse: 'Склад',
  salesperson: 'Менеджер постачальника',
  preparedBy: 'Хто склав документ',
  settlement: 'Спосіб розрахунку',
  billing: 'Податковий рахунок',
  note: 'Примітки',
  address: 'Адреса і телефони постачальника',
  terms: 'Умови з шаблону',
};

export const isInternalInvoice = row => row?.kind === 'other' && String(row.reference || '').startsWith(internalInvoicePrefix);
export const sharedTemplateFields = ['contact','warehouse'];
const cleanText = value => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : '';

export function validateSupplierInvoiceTemplate(data) {
  const fields = Object.entries(templateFields);
  const template = Object.fromEntries(fields.map(([key]) => [key,cleanText(data?.[key])]));
  template.english = {};
  for (const [key, label] of fields) {
    const maximum = ['note', 'address', 'terms'].includes(key) ? 220 : 48;
    if (template[key].length > maximum || (['supplier', 'buyer'].includes(key) && !template[key])) {
      throw new Error(`Перевірте поле «${label}».`);
    }
    const english = sharedTemplateFields.includes(key) ? template[key] : cleanText(data?.english?.[key]);
    if (english.length > maximum * 2 || (template[key] && !english)) {
      throw new Error(`Додайте англійський відповідник поля «${label}».`);
    }
    template.english[key] = english;
  }
  return template;
}

export function invoiceInput(data) {
  const part = String(data.part || '').trim().replace(/\s+/g, ' ');
  if (!part || part.length > 180) throw new Error('Вкажіть назву запчастини (до 180 символів).');
  const date = String(data.date || '');
  const parsedDate = new Date(date);
  if (!/^20\d\d-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date) {
    throw new Error('Вкажіть коректну дату.');
  }
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(String(data.amount || '').trim());
  const cents = match ? Number(match[1])*100 + Number((match[2] || '').padEnd(2,'0')) : 0;
  if (!cents) throw new Error('Вкажіть додатну суму в CNY, до двох знаків після коми.');
  return { part, date, cents, total: (cents / 100).toFixed(2) };
}

export function chineseMoney(cents) {
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const units = ['', '拾', '佰', '仟', '万', '拾', '佰', '仟', '亿'];
  const yuan = Math.floor(cents / 100), jiao = Math.floor(cents / 10) % 10, fen = cents % 10;
  let text = '', pendingZero = false;
  String(yuan).split('').forEach((digit, index, all) => {
    const position = all.length - index - 1;
    if (+digit) {
      if (pendingZero && text) text += '零';
      text += digits[digit] + units[position];
      pendingZero = false;
    } else {
      if (position === 4 && !text.endsWith('亿')) { text += '万'; pendingZero = false; }
      else pendingZero = true;
    }
  });
  return (text || '零') + '元'
    + (jiao ? digits[jiao] + '角' : yuan && fen ? '零' : '')
    + (fen ? digits[fen] + '分' : jiao ? '' : '整');
}

function englishMoney(cents) {
  const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function words(n) {
    for (const [size,label] of [[1000000,'million'],[1000,'thousand'],[100,'hundred']]) {
      if (n >= size) return words(Math.floor(n / size)) + ' ' + label + (n % size ? ' ' + words(n % size) : '');
    }
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  }
  const result = words(Math.floor(cents / 100)) + ' yuan' + (cents % 100 ? ' and ' + words(cents % 100) + ' fen' : ' only');
  return result[0].toUpperCase() + result.slice(1);
}

function section(template, data, reference, english) {
  const label = (ch,en) => english ? en : ch;
  const info = (ch,en,value) => label(ch,en) ? label(ch,en) + (english ? ': ' : '：') + (value || '') : '';
  const columns = (pairs, widths = ['*', '*', '*']) => ({
    table: {
      widths,
      body: pairs.map(row => row.map(args => info(...args))),
    },
    layout: { hLineWidth: (i, node) => i === 0 || i === node.table.body.length ? 0.6 : 0,
      vLineWidth: (i, node) => i === 0 || i === node.table.widths.length ? 0.6 : 0,
      paddingTop: () => 1, paddingBottom: () => 1 },
    margin: [0, 0, 0, 5],
  });
  return [
      { text: `${template.supplier} - ${label('销售单','Sales Invoice')}`, alignment: 'center', fontSize: 16 },
      { text: label('EVLine · 内部使用','EVLine · Internal use only'), alignment: 'center', fontSize: 8, color: '#45504b', margin: [0, 0, 0, 4] },
      columns([
        [['购货单位','Buyer',template.buyer], ['联系方式','Contact',template.contact], ['销售单号','Sales document no.',reference]],
        [['送货地址','Delivery address',''], ['', '', ''], ['货站方式','Collection method',template.pickup]],
        [['购货日期','Purchase date',data.date], ['打印日期','Print date',data.date], ['运输方式','Transport method','']],
      ], ['*', '*', 244]),
      {
        table: {
          headerRows: 1, dontBreakRows: true,
          widths: [24, 70, '*', 58, 34, 32, 64, 64, 45],
          body: [
            [['序号','No.'],['原厂编码','OEM code'],['零件名','Part name'],['车型','Vehicle'],['仓位','Bin'],['数量','Qty'],['售价','Unit price'],['金额','Amount'],['配件品质','Part grade']]
              .map(names => ({ text: label(...names), alignment: 'center', fillColor: '#f4f5f4' })),
            ['1', '', english ? data.partEn : data.partZh, '', template.warehouse, '1', data.total, data.total, '']
              .map((text, i) => ({ text, alignment: i === 2 ? 'left' : i === 6 || i === 7 ? 'right' : 'center' })),
          ],
        },
        layout: { hLineWidth: () => 0.55, vLineWidth: () => 0.55, paddingTop: () => 2, paddingBottom: () => 2 },
        margin: [0, 0, 0, 4],
      },
      columns([
        [['合计大写','Total in words',english ? englishMoney(data.cents) : chineseMoney(data.cents)], ['配件总数','Total quantity','1'], ['总计金额','Total amount',`${data.total} CNY`]],
      ], ['*', 120, 175]),
      {
        columns: [
          info('营业人员','Salesperson',template.salesperson), info('制单人员','Prepared by',template.preparedBy),
          info('结算方式','Settlement',template.settlement), info('是否开票','Tax invoice',template.billing),
        ], margin: [0, 0, 0, 3],
      },
      { text: [
        info('送货信息','Delivery notes',''), info('备注信息','Remarks',template.note),
        ...(template.address ? [info('地址','Address',template.address)] : []),
        ...(template.terms ? [template.terms] : []),
      ].join('\n'), margin: [0, 0, 0, 4] },
      { columns: [['提货人员','Collected by'],['打包人员','Packed by'],['发货人员','Dispatched by'],['客户签字','Customer signature']].map(labels=>info(...labels,'')) },
    ];
}

export function invoiceDefinition(template, data, reference) {
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [36, 21, 36, 21],
    info: { title: reference, author: 'EVLine' },
    defaultStyle: { font: 'SupplierSC', fontSize: 8.5, lineHeight: 1.02 },
    content: [
      ...section(template,data,reference,false),
      { canvas:[{type:'line',x1:0,y1:0,x2:769,y2:0,lineWidth:.65,lineColor:'#a0a9a4'}], margin:[0,6,0,6] },
      ...section(template.english,data,reference,true),
    ],
  };
}
