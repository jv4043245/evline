import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'node-html-parser';
import { priorityPartsPages } from './lib/parts-priority-content.mjs';

const base = process.argv[2];
if (!base) throw new Error('Pass the verified pre-change commit SHA.');
const root = new URL('../', import.meta.url);
const files = ['index.html', 'ru/index.html', ...priorityPartsPages.flatMap(page => [page.uk, page.ru].map(url => `${url.slice(1)}index.html`))];
for (const file of files) {
  const before = parse(execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' }));
  const after = parse(await readFile(new URL(file, root), 'utf8'));
  for (const selector of ['form', 'script:not([type="application/ld+json"])', 'link[rel="canonical"]', 'link[hreflang]', '[data-contact-intent]']) {
    assert.deepEqual(after.querySelectorAll(selector).map(el => el.outerHTML), before.querySelectorAll(selector).map(el => el.outerHTML), `${file}: changed protected ${selector}`);
  }
}
const protectedPaths = ['functions', 'admin', 'migrations', 'workers', 'assets/js', '_redirects', 'robots.txt', 'byd.html', 'zeekr.html', 'ru/byd.html', 'ru/zeekr.html', 'запчастини-з-китаю', 'ru/zapchasti-iz-kitaya', 'assets/gallery-*.jpg', 'assets/hero-gallery-*.webp', 'assets/images/seo-photos', 'assets/images/*-visual.*'];
const differences = execFileSync('git', ['diff', '--name-only', base, '--', ...protectedPaths], { cwd: root, encoding: 'utf8' });
assert.equal(differences.trim(), '', `Protected files changed:\n${differences}`);
console.log(`PASS: ${files.length} pages preserve forms, tracking scripts, canonical, hreflang and contact intents. Ads, API, CRM and originals unchanged.`);
