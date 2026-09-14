import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateAirGuide, renderAirGuide } from '../assets/js/shipping-air-guide.js';

const guide = JSON.parse(await readFile(new URL('../admin/shipping-pricelist/air-guide.json', import.meta.url), 'utf8'));
const fixture = { ...guide, rate_usd_per_kg: [10, 15], volume_kg_per_m3: [167, 200], reserve_percent: 0,
  profiles: [{ id: 'sample', name: 'Sample', gross_weight_kg: [10, 20], packed_volume_m3: [0.01, 0.02], packaging_cost_usd: [5, 15] }] };

test('air estimate includes gross packed weight and packaging service exactly once', () => {
  const result = calculateAirGuide(fixture, 'sample');
  assert.deepEqual(result.billed, [10, 20]);
  assert.deepEqual(result.range, [105, 315]);
  assert.equal(result.quote, 160);
  assert.ok(result.billed[0] < 30, 'Do not charge the shipment minimum separately to every consolidated part');
});
test('bulky light parts are priced using packed volume instead of net weight', () => {
  const volumetric = { ...fixture, profiles: [{ ...fixture.profiles[0], packed_volume_m3: [0.2, 0.4] }] };
  const result = calculateAirGuide(volumetric, 'sample');
  assert.deepEqual(result.billed, [33.4, 80]);
  assert.deepEqual(result.range, [340, 1215]);
  assert.equal(result.quote, 515);
  const separate = calculateAirGuide(volumetric, 'sample', 'standard', 'separate');
  assert.ok(separate.quote > result.quote);
  assert.deepEqual(separate.packaging, [6.25, 18.75]);
  assert.ok(calculateAirGuide(volumetric, 'sample', 'large').quote > result.quote);
});
test('every planning profile produces bounded figures for every supported vehicle and packaging option', () => {
  assert.equal(guide.basis, 'planning_assumptions_not_shipment_history');
  for (const profile of guide.profiles) for (const vehicle of Object.keys(guide.vehicle_factors)) for (const packing of Object.keys(guide.packing_factors)) {
    const result = calculateAirGuide(guide, profile.id, vehicle, packing);
    assert.ok(result, `${profile.id} ${vehicle} ${packing}`);
    assert.ok(result.range[0] <= result.quote && result.quote <= result.range[1]);
  }
});
test('missing or invalid assumptions never produce a misleading price', () => {
  assert.equal(calculateAirGuide(null, 'sample'), null);
  assert.equal(calculateAirGuide(fixture, 'unknown'), null);
  for (const changes of [{ reserve_percent: -1 }, { reserve_percent: Infinity }, { rate_usd_per_kg: [15, 10] }, { vehicle_factors: { standard: -1 }, packing_factors: { shared: -1 } }]) assert.equal(calculateAirGuide({ ...fixture, ...changes }, 'sample'), null);
});
test('manager view labels the detail and uncertainty without carrier controls', () => {
  const html = renderAirGuide(guide, 'headlamp', 'standard', 'shared');
  assert.match(html, /Робочий орієнтир/); assert.match(html, /Діапазон/);
  assert.match(html, /Фара · 1 деталь · пакування включено/);
  assert.match(html, /не підтверджена нашими авіавідправками/);
  assert.doesNotMatch(html, /data-air-rate|data-air-weight/);
});
