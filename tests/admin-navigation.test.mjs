import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'node-html-parser';

const admin = new URL('../admin/', import.meta.url);
const html = async path => parse(await readFile(new URL(path, admin), 'utf8'));

test('invoice register and supplier generator are links in the main menu', async () => {
  const tabs = (await html('index.html')).querySelectorAll('.admin-tabs > .admin-tab');
  assert.deepEqual(tabs.slice(-3).map(tab => [
    tab.textContent.trim(), tab.tagName, tab.getAttribute('href') ?? null
  ]), [
    ['Рахунки', 'A', '/admin/invoices/'],
    ['Надходження', 'BUTTON', null],
    ['Генератор інвойсів', 'A', '/admin/supplier-invoice/'],
  ]);
});

test('every dedicated CRM page has a real return link, even before its script loads', async () => {
  const directories = (await readdir(admin, { withFileTypes: true })).filter(entry => entry.isDirectory());
  const destinations = {
    'documents': '/admin/invoices/',
    'shipping-pricelist': '/admin/?tab=delivery',
  };
  for (const { name } of directories) {
    const page = await html(name + '/index.html');
    const link = page.querySelector('header .crm-subpage-nav a.crm-back');
    assert.ok(link, name);
    assert.equal(link.getAttribute('href'), destinations[name] || '/admin/?tab=orders', name);
    assert.ok(page.querySelector('link[href^="/admin/subpage-nav.css"]'), name);
  }
});
