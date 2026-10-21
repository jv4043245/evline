import { readFile, writeFile } from 'node:fs/promises';
import { priorityPartsPages } from './lib/parts-priority-content.mjs';
import { withResponsivePartsImages } from './lib/responsive-parts-images.mjs';
import { withFooterContacts } from './lib/footer-contacts.mjs';

const root = new URL('../', import.meta.url);
const files = ['index.html', 'ru/index.html', ...priorityPartsPages.flatMap(page => [page.uk, page.ru].map(url => `${url.slice(1)}index.html`))];
for (const file of files) {
  const before = await readFile(new URL(file, root), 'utf8');
  let after = withResponsivePartsImages(before);
  // The standalone home has all its other CSS inline. Avoid a blocking footer-only request.
  if (file === 'index.html' || file === 'ru/index.html') {
    after = after.replace('data-footer-contacts-style>', 'data-footer-contacts-style data-footer-contacts-inline>');
    after = withFooterContacts(after);
  }
  if (after !== before) {
    if (process.argv.includes('--check')) process.exitCode = 1;
    else await writeFile(new URL(file, root), after);
    console.log(file);
  }
}
