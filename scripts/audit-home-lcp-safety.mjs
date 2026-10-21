import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'node-html-parser';

const base = process.argv[2];
if (!base) throw new Error('Pass the pre-optimization commit SHA.');
const root = new URL('../', import.meta.url);
for (const file of ['index.html', 'ru/index.html']) {
  const before = parse(execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' }));
  const after = parse(await readFile(new URL(file, root), 'utf8'));
  const hint = after.querySelector('link[rel="preload"][as="script"]');
  assert.equal(hint.getAttribute('href'), after.querySelector('script[src*="contact-tracking.js"]').getAttribute('src'));
  hint.remove();
  after.querySelector('script[src*="contact-tracking.js"]').removeAttribute('defer');
  const style = after.querySelector('style');
  style.set_content(style.textContent.replace('.hero .wrap{gap:14px;grid-template-rows:auto 156px auto}', '.hero .wrap{gap:14px}'));
  for (const document of [before, after]) {
    const script = document.querySelectorAll('script').find(node => node.textContent.includes('function updateStickyCta'));
    const start = script.textContent.lastIndexOf('\n(function(){');
    assert.ok(start > script.textContent.indexOf('function submitLead'));
    assert.ok(script.textContent.slice(start).includes('function updateStickyCta'));
    script.set_content(script.textContent.slice(0, start));
  }
  // Allow only sticky UI, preload/defer and a fixed row matching the existing mobile photo height.
  assert.equal(after.toString().replace(/\n\s*\n/g, '\n'), before.toString().replace(/\n\s*\n/g, '\n'), `${file}: unexpected markup, CSS, form, SEO or tracking change`);
}
const protectedPaths = ['assets', 'functions', 'admin', 'migrations', 'workers', '_redirects', '_headers', 'robots.txt', 'sitemap.xml', 'byd.html', 'ru/byd.html', 'запчастини-з-китаю', 'ru/zapchasti-iz-kitaya'];
const differences = execFileSync('git', ['diff', '--name-only', base, '--', ...protectedPaths], { cwd: root, encoding: 'utf8' });
assert.equal(differences.trim(), '', `Protected files changed:\n${differences}`);
console.log('PASS: photos, forms, SEO, ad landings, API and tracking unchanged; only preload/defer, sticky UI and reserved mobile photo row changed.');
