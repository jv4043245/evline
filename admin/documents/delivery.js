import { documentModes, invoiceAmount, money } from './model.js?v=20261027-delivery';

export function contactEmail(value) {
  const match = String(value || '').match(/(?:^|[\s,;<(])([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+)(?=$|[\s,;>)])/i);
  return match?.[1] || '';
}
export function contactPhone(value) {
  let phone = String(value || '').replace(/[\s()+.-]/g, '');
  if (/^0\d{9}$/.test(phone)) phone = `38${phone}`;
  return /^[1-9]\d{9,14}$/.test(phone) ? phone : '';
}
export function telegramContact(value) {
  const match = String(value || '').trim().match(/^(?:@|https:\/\/t\.me\/)([a-z][a-z0-9_]{4,31})\/?$/i);
  return match ? `https://t.me/${match[1]}` : '';
}
export function deliveryDetails(data, mode) {
  const title = `${documentModes[mode]}${mode === 'invoice' ? ` № ${data.invoice.number}` : data.number ? ` № ${data.number}` : ''}`;
  const payable = mode === 'invoice' ? invoiceAmount(data) : null;
  return { title, subject: `${title} · EVLine`, text: `Добрий день!\n\n${title}${payable == null ? '' : ` на суму ${money(payable)} грн`}.\nДокумент у вкладенні.\n\nEVLine` };
}
export function emailAddress(email) {
  const address = String(email || '').trim();
  if (!address || address.length > 254 || contactEmail(address) !== address || /[\r\n]/.test(String(email))) throw new Error('Вкажіть коректну адресу email.');
  return address;
}
export function emailDraftUrl(email, details) {
  const address = emailAddress(email);
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(details.subject)}&body=${encodeURIComponent(details.text)}`;
}
export function manualChatLinks(buyer, details) {
  const phone = contactPhone(buyer.phone), telegram = telegramContact(buyer.contact);
  return [
    ...(telegram ? [{ name: 'Telegram', url: telegram }] : []),
    ...(phone ? [
      { name: 'WhatsApp', url: `https://wa.me/${phone}?text=${encodeURIComponent(details.text)}` },
      { name: 'Viber', url: `viber://chat?number=${encodeURIComponent(`+${phone}`)}` },
    ] : []),
  ];
}
