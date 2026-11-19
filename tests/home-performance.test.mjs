import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

for (const page of ['index.html', 'ru/index.html']) {
  const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
  function setup() {
    return new JSDOM(html, { url: 'https://evline.com.ua/', runScripts: 'outside-only' });
  }
  function runStickyScript(window) {
    const script = [...window.document.scripts].find(node => node.textContent.includes('function updateStickyCta'));
    // Exercise the production UI block without submitting forms or loading analytics.
    const start = script.textContent.lastIndexOf('\n(function(){');
    window.eval(script.textContent.slice(start));
  }

  test(`${page}: mobile photo row reserves the existing height before images arrive`, () => {
    assert.match(html, /\.hero \.wrap\{gap:14px;grid-template-rows:auto 156px auto\}/);
    assert.match(html, /\.hero-proof\{height:156px;min-height:0\}/);
  });

  test(`${page}: 3x mobile hero uses sharp, lightweight previews and keeps originals`, async () => {
    const dom = setup();
    try {
      const photos = [...dom.window.document.querySelectorAll('.hero-proof__tile img')];
      assert.equal(photos.length, 3);
      let total = 0;
      for (const [index, [id, minimumPixels]] of [[5, 564], [3, 417], [6, 417]].entries()) {
        const photo = photos[index];
        const original = `/assets/hero-gallery-${id}.webp`;
        const entries = photo.srcset.split(',').map(item => {
          const [url, size] = item.trim().split(/\s+/);
          return { url, width: Number.parseInt(size, 10) };
        });
        assert.ok(photo.src.endsWith(original));
        assert.deepEqual(entries.at(-1), { url: original, width: 720 });
        assert.equal(photo.loading ?? photo.getAttribute('loading'), 'eager');
        const chosen = entries.find(entry => entry.width >= minimumPixels);
        assert.match(chosen.url, /^\/assets\/responsive\/hero-gallery-/);
        assert.ok(chosen.width <= minimumPixels * 1.1);
        total += (await stat(new URL(`..${chosen.url}`, import.meta.url))).size;
      }
      assert.ok(total <= 145_000, `Mobile hero transfer budget exceeded: ${total} B`);
    } finally { dom.window.close(); }
  });

  test(`${page}: proof images fit their cards at every breakpoint`, () => {
    const dom = setup();
    try {
      const { document } = dom.window;
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
      const style = (selector, list = rules) => list.find(rule => rule.selectorText === selector)?.style;
      const stylesAt = width => rules.filter(rule => rule.conditionText === `(max-width:${width}px)`)
        .flatMap(rule => [...rule.cssRules]);
      assert.equal(document.querySelectorAll('.proof-card__media picture img').length, 3);
      assert.equal(style('.proof-cards')?.getPropertyValue('display'), 'grid');
      assert.equal(style('.proof-cards', stylesAt(900))?.getPropertyValue('grid-template-columns'), '1fr');
      for (const [height, list] of [['190px', rules], ['220px', stylesAt(900)], ['180px', stylesAt(560)]]) {
        assert.equal(style('.proof-card__media', list)?.getPropertyValue('height'), height);
      }
      for (const selector of ['.proof-card__media picture', '.proof-card__media img']) {
        assert.equal(style(selector)?.getPropertyValue('width'), '100%');
        assert.equal(style(selector)?.getPropertyValue('height'), '100%');
      }
      assert.equal(style('.proof-card__media img')?.getPropertyValue('object-fit'), 'cover');
    } finally { dom.window.close(); }
  });

  test(`${page}: tracking preload does not change script execution order`, () => {
    const dom = setup();
    try {
      const { document } = dom.window;
      const scripts = document.querySelectorAll('script[src*="contact-tracking.js"]');
      assert.equal(scripts.length, 1);
      const script = scripts[0];
      const hints = document.head.querySelectorAll('link[rel="preload"][as="script"]');
      assert.equal(hints.length, 1);
      assert.equal(hints[0].href, script.src);
      assert.equal(script.parentNode, document.body);
      assert.ok(script.previousElementSibling.textContent.includes('function submitLead'));
      assert.equal(script.hasAttribute('async'), false);
      assert.equal(script.hasAttribute('defer'), true);
    } finally { dom.window.close(); }
  });

  test(`${page}: sticky CTA uses observer geometry without synchronous layout reads`, () => {
    const dom = setup();
    try {
      const { window } = dom;
      const hero = window.document.querySelector('.hero');
      for (const property of ['offsetTop', 'offsetHeight']) {
        Object.defineProperty(hero, property, { get() { throw new Error('Forced layout read'); } });
      }
      let callback;
      let observed;
      window.IntersectionObserver = class {
        constructor(fn, options) {
          callback = fn;
          assert.equal(options.rootMargin, '-80px 0px 0px');
          assert.equal(options.threshold, 0);
        }
        observe(element) { observed = element; }
      };
      runStickyScript(window);
      assert.equal(observed, hero);
      for (const [bottom, visible] of [[900, false], [80, false], [79, true], [-500, true], [200, false]]) {
        callback([{ boundingClientRect: { bottom } }]);
        assert.equal(window.document.body.classList.contains('sticky-cta-visible'), visible);
      }
      window.dispatchEvent(new window.Event('scroll'));
      window.dispatchEvent(new window.Event('resize'));
    } finally { dom.window.close(); }
  });

  test(`${page}: legacy fallback coalesces scroll work and preserves the CTA threshold`, () => {
    const dom = setup();
    try {
      const { window } = dom;
      const hero = window.document.querySelector('.hero');
      Object.defineProperty(hero, 'offsetTop', { value: 100 });
      Object.defineProperty(hero, 'offsetHeight', { value: 500 });
      const frames = [];
      window.requestAnimationFrame = callback => { frames.push(callback); };
      runStickyScript(window);
      window.dispatchEvent(new window.Event('scroll'));
      window.dispatchEvent(new window.Event('resize'));
      assert.equal(frames.length, 1);
      frames.shift()();
      assert.equal(window.document.body.classList.contains('sticky-cta-visible'), false);
      window.scrollY = 521;
      window.dispatchEvent(new window.Event('scroll'));
      frames.shift()();
      assert.equal(window.document.body.classList.contains('sticky-cta-visible'), true);
      window.scrollY = 520;
      window.dispatchEvent(new window.Event('scroll'));
      frames.shift()();
      assert.equal(window.document.body.classList.contains('sticky-cta-visible'), false);
    } finally { dom.window.close(); }
  });
}
