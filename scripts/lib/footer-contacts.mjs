import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { publicHtmlFiles } from './seller-identity.mjs';

export const footerContactsVersion = '20260922-footer-contacts-2';

export function footerContactsMarkup(language = 'uk') {
  const ru = language.startsWith('ru');
  const label = ru ? 'Менеджер по запчастям' : 'Менеджер із запчастин';
  return `<section class="footer-contacts" data-footer-contacts aria-label="${label}">
  <div class="footer-contacts__heading"><strong>${label}</strong><span>+38 (093) 525-10-24</span></div>
  <div class="footer-contacts__links">
    <a class="footer-contacts__link footer-contacts__link--telegram" href="https://t.me/evline_support" target="_blank" rel="noopener noreferrer" data-contact-intent="parts" data-contact-id="footer-parts-telegram" aria-label="Telegram: ${label.toLowerCase()}"><img src="/assets/icons/telegram.svg" width="22" height="22" alt="" aria-hidden="true">Telegram</a>
    <a class="footer-contacts__link footer-contacts__link--whatsapp" href="https://wa.me/380935251024" target="_blank" rel="noopener noreferrer" data-contact-intent="parts" data-contact-id="footer-parts-whatsapp" aria-label="WhatsApp: ${label.toLowerCase()}"><img src="/assets/icons/whatsapp.svg" width="22" height="22" alt="" aria-hidden="true">WhatsApp</a>
    <a class="footer-contacts__link footer-contacts__link--viber" href="viber://chat?number=%2B380935251024" data-contact-intent="parts" data-contact-id="footer-parts-viber" aria-label="Viber: ${label.toLowerCase()}"><img src="/assets/icons/viber.svg" width="22" height="22" alt="" aria-hidden="true">Viber</a>
  </div>
</section>`;
}

export function withFooterContacts(html) {
  const document = parse(html);
  if (!document.querySelector('footer')) return html;
  const markup = footerContactsMarkup(document.querySelector('html')?.getAttribute('lang') || 'uk');
  const stylesheet = `<link rel="stylesheet" href="/assets/css/footer-contacts.css?v=${footerContactsVersion}" data-footer-contacts-style>`;
  let updated = document.querySelector('[data-footer-contacts]')
    ? html.replace(/<section\b[^>]*\bdata-footer-contacts\b[^>]*>[\s\S]*?<\/section>/, markup)
    : html.replace(/<footer\b[^>]*>/i, opening => `${opening}\n${markup}`);
  updated = document.querySelector('[data-footer-contacts-style]')
    ? updated.replace(/<link\b[^>]*\bdata-footer-contacts-style\b[^>]*>/, stylesheet)
    : updated.replace(/<\/head>/i, `${stylesheet}\n</head>`);
  // All public pages must load the tracker that recognizes the footer's explicit intent.
  return updated.replace(/(assets\/js\/(?:main|contact-tracking)\.js)(?:\?[^"']*)?(?=["'])/g, `$1?v=${footerContactsVersion}`);
}

export async function syncFooterContacts(root, { check = false } = {}) {
  const changed = [];
  for (const file of await publicHtmlFiles(root)) {
    const original = await readFile(file, 'utf8');
    const updated = withFooterContacts(original);
    if (original === updated) continue;
    changed.push(path.relative(root, file));
    if (!check) await writeFile(file, updated);
  }
  return changed;
}
