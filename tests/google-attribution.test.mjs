import assert from 'node:assert/strict';
import test from 'node:test';
import { inferAttribution } from '../functions/_lib/attribution.js';

const request = new Request('https://evline.com.ua/api/leads');
const page = 'https://evline.com.ua/ru/zapchasti-zeekr/';
const infer = payload => inferAttribution({ landing_page: page, page_url: page, ...payload }, request);

test('Google referrer alone is organic rather than a paid click', () => {
  const result = infer({ referrer: 'https://www.google.com/' });
  assert.equal(result.attribution_type, 'organic');
  assert.equal(result.source, 'google');
  assert.equal(result.medium, 'organic');
  assert.equal(result.has_google_click, false);
});

test('paid click IDs and Google Ads URL markers remain paid', () => {
  for (const clickKey of ['gclid', 'gbraid', 'wbraid']) {
    const paid = infer({ [clickKey]: 'synthetic-click', referrer: 'https://www.google.com/' });
    assert.equal(paid.attribution_type, 'google_ads', clickKey);
    assert.equal(paid.medium, 'cpc', clickKey);
  }
  for (const key of ['gad_campaignid', 'gad_source']) {
    assert.equal(infer({ landing_page: page + '?' + key + '=123' }).attribution_type, 'google_ads', key);
  }
});

test('explicit paid or organic UTM and direct/internal/Meta attribution remain intact', () => {
  assert.equal(infer({ utm_source: 'google', utm_medium: 'cpc' }).attribution_type, 'google_ads');
  assert.equal(infer({ utm_source: 'google', utm_medium: 'organic', referrer: 'https://www.google.com/' }).attribution_type, 'organic');
  assert.equal(infer({}).attribution_type, 'direct');
  assert.equal(infer({ referrer: 'https://evline.com.ua/ru/' }).attribution_type, 'direct');
  assert.equal(infer({ fbclid: 'synthetic-meta-click', referrer: 'https://www.google.com/' }).attribution_type, 'social');
});

test('campaign, keyword, ad-group content and click ID reach the normalized record', () => {
  const attributed = infer({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'campaign', utm_term: 'wing zeekr', utm_content: 'group-ad', gclid: 'synthetic-click' });
  assert.equal(attributed.campaign, 'campaign');
  assert.equal(attributed.term, 'wing zeekr');
  assert.equal(attributed.content, 'group-ad');
  assert.equal(attributed.gclid, 'synthetic-click');
});
