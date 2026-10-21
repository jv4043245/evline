import { parse } from 'node-html-parser';

export const responsivePartsImages = [
  { source: 'assets/hero-gallery-5.webp', width: 720, height: 960, sizes: '(max-width: 900px) calc((100vw - 64px) * .575), 310px' },
  { source: 'assets/hero-gallery-3.webp', width: 720, height: 540, sizes: '(max-width: 900px) calc((100vw - 64px) * .425), 275px' },
  { source: 'assets/hero-gallery-6.webp', width: 720, height: 960, sizes: '(max-width: 900px) calc((100vw - 64px) * .425), 155px' },
  { source: 'assets/images/china-delivery-visual.webp', width: 1802, height: 900, sizes: '(max-width: 900px) calc(100vw - 40px), 354px' },
  { source: 'assets/images/vin-parts-visual.webp', width: 1400, height: 900, sizes: '(max-width: 900px) calc(100vw - 40px), 354px' },
  { source: 'assets/images/oem-parts-visual.webp', width: 1400, height: 900, sizes: '(max-width: 900px) calc(100vw - 40px), 354px' },
  { source: 'assets/images/seo-photos/byd.jpg', width: 1280, height: 789, sizes: '(max-width: 900px) calc(100vw - 40px), 570px' },
  { source: 'assets/images/seo-photos/zeekr.jpg', width: 1280, height: 762, sizes: '(max-width: 900px) calc(100vw - 40px), 570px' },
];

export const responsiveWidths = [240, 400, 640, 960];
export function widthsForImage(item) {
  // For the already compressed 720px hero originals, a 640px re-encode is larger.
  return responsiveWidths.filter(width => width < item.width && (!item.source.startsWith('assets/hero-') || width <= 400));
}
export function responsiveImagePath(item, width) {
  return `assets/responsive/${item.source.split('/').at(-1).replace(/\.[^.]+$/, '')}-${width}.webp`;
}

export function withResponsivePartsImages(html) {
  const document = parse(html);
  let updated = html;
  for (const image of document.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    const item = responsivePartsImages.find(item => src.split('?')[0].endsWith(item.source) || src.split('?')[0].endsWith(item.source.replace('.webp', '.jpg')));
    if (!item) continue;
    const set = widthsForImage(item)
      .map(width => `/${responsiveImagePath(item, width)} ${width}w`)
      .concat(`/${item.source} ${item.width}w`).join(', ');
    const before = image.outerHTML;
    image.setAttribute('srcset', set);
    image.setAttribute('sizes', item.sizes);
    image.setAttribute('width', String(item.width));
    image.setAttribute('height', String(item.height));
    image.setAttribute('decoding', 'async');
    if (item.source.includes('seo-photos/')) image.setAttribute('loading', 'lazy');
    updated = updated.replace(before, image.outerHTML);
    if (image.parentNode?.tagName === 'PICTURE') {
      for (const source of image.parentNode.querySelectorAll('source[type="image/webp"]')) {
        const original = source.outerHTML;
        source.setAttribute('srcset', set);
        source.setAttribute('sizes', item.sizes);
        updated = updated.replace(original, source.outerHTML);
      }
    }
  }
  return updated;
}
