import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
      assert.equal(script.hasAttribute('defer'), false);
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
