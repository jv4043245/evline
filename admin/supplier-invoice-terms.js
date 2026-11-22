const parts = [
  ['翼子板','fender',/^(?:крыл[оа]|крило|fender)$/iu],
  ['保险杠','bumper',/^(?:бампер|bumper)$/iu],
  ['尾灯','tail light',/^(?:фонарь|ліхтар|tail light|taillight)$/iu],
  ['大灯','headlight',/^(?:фара|headlight|headlamp)$/iu],
  ['引擎盖','hood',/^(?:капот|hood|bonnet)$/iu],
  ['后视镜','side mirror',/^(?:дзеркало|зеркало|side mirror)$/iu],
  ['车门','door',/^(?:дверь|двері|door)$/iu],
  ['减震器','shock absorber',/^(?:амортизатор|shock absorber)$/iu],
  ['摆臂','control arm',/^(?:рычаг(?: подвески)?|важіль(?: підвіски)?|control arm)$/iu],
  ['轮毂轴承','wheel hub bearing',/^(?:ступица|маточина|wheel hub bearing)$/iu],
  ['挡风玻璃','windshield',/^(?:лобовое стекло|лобове скло|windshield|windscreen)$/iu],
  ['门把手','door handle',/^(?:ручка двери|ручка дверей|door handle)$/iu],
  ['散热器','radiator',/^(?:радиатор|радіатор|radiator)$/iu],
];
const modifiers = [
  ['前','front',/^(?:передн(?:ий|яя|ее|я|є|ього)|front)$/iu],
  ['后','rear',/^(?:задн(?:ий|яя|ее|я|є|ього)|rear)$/iu],
  ['左','left',/^(?:лев(?:ый|ая|ое)|лів(?:ий|а|е)|left)$/iu],
  ['右','right',/^(?:прав(?:ый|ая|ое|ий|а|е)|right)$/iu],
  ['上','upper',/^(?:верхн(?:ий|яя|ее|я|є)|upper)$/iu],
  ['下','lower',/^(?:нижн(?:ий|яя|ее|я|є)|lower)$/iu],
];

export function suggestInvoicePart(value) {
  const input=value.trim().replace(/\s+/g,' ');
  const han=/\p{Script=Han}/u, cyrillic=/\p{Script=Cyrillic}/u;
  const base={partZh:han.test(input) && !cyrillic.test(input) ? input:'',partEn:!han.test(input) && !cyrillic.test(input) ? input:''};
  if (han.test(input)) {
    const compact=input.replace(/\s+/g,'');
    const part=parts.find(([zh])=>compact.endsWith(zh));
    if (!part) return base;
    const before=compact.slice(0,-part[0].length), flags=modifiers.filter(([zh])=>before.includes(zh));
    if ([...before].some(ch=>!flags.some(([zh])=>zh===ch))) return base;
    return {...base,partEn:[...flags.map(m=>m[1]),part[1]].join(' ')};
  }
  const flags=[], remaining=[];
  for (const word of input.split(' ')) {
    const flag=modifiers.find(([, , pattern])=>pattern.test(word));
    if (flag) flags.push(flag);
    else remaining.push(word);
  }
  const part=parts.find(([, , pattern])=>pattern.test(remaining.join(' ')));
  if (!part) return base;
  const chineseOrder=['左','右','前','后','上','下'];
  return {partZh:chineseOrder.filter(zh=>flags.some(flag=>flag[0]===zh)).join('')+part[0],
    partEn:base.partEn || [...modifiers.filter(flag=>flags.includes(flag)).map(m=>m[1]),part[1]].join(' ')};
}
