const forms = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
const units = ['', 'один', 'два', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'];
const teens = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', 'п’ятнадцять', 'шістнадцять', 'сімнадцять', 'вісімнадцять', 'дев’ятнадцять'];
const tens = ['', '', 'двадцять', 'тридцять', 'сорок', 'п’ятдесят', 'шістдесят', 'сімдесят', 'вісімдесят', 'дев’яносто'];
const hundreds = ['', 'сто', 'двісті', 'триста', 'чотириста', 'п’ятсот', 'шістсот', 'сімсот', 'вісімсот', 'дев’ятсот'];
function group(n, feminine) {
  const words = [hundreds[Math.floor(n / 100)]], rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(teens[rest - 10]);
  else words.push(tens[Math.floor(rest / 10)], feminine && rest % 10 === 1 ? 'одна' : feminine && rest % 10 === 2 ? 'дві' : units[rest % 10]);
  return words.filter(Boolean).join(' ');
}
export function amountWords(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > 9999999999) throw new Error('Некоректна сума для запису словами.');
  const hryvnias = Math.floor(minor / 100), parts = [];
  for (const [divisor, feminine, names] of [[1000000, false, ['мільйон', 'мільйони', 'мільйонів']], [1000, true, ['тисяча', 'тисячі', 'тисяч']], [1, true, []]]) {
    const n = Math.floor(hryvnias / divisor) % 1000;
    if (n) parts.push(group(n, feminine), ...(names.length ? [forms(n, ...names)] : []));
  }
  const result = `${parts.join(' ') || 'нуль'} ${forms(hryvnias, 'гривня', 'гривні', 'гривень')} ${String(minor % 100).padStart(2, '0')} ${forms(minor % 100, 'копійка', 'копійки', 'копійок')}`;
  return result[0].toUpperCase() + result.slice(1);
}
