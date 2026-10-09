import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMonthlyManagerPreview, MANAGER_RATE_BASIS_POINTS, PROFIT_INPUT_KEYS } from '../functions/_lib/accounting-profit.js';

const input = (patch = {}) => ({ revenue_minor: 100000, purchase_minor: 30000, shipping_minor: 10000, other_minor: 5000, advertising_minor: 15000, ...patch });
const onlyRevenue = (value) => input({ revenue_minor: value, purchase_minor: 0, shipping_minor: 0, other_minor: 0, advertising_minor: 0 });

test('fixed 15% applies to net profit, subtracting every expense exactly once', () => {
  assert.equal(MANAGER_RATE_BASIS_POINTS, 1500);
  assert.deepEqual(calculateMonthlyManagerPreview(input()), { status: 'draft', rate_basis_points: 1500,
    profit_before_manager_minor: 40000, manager_minor: 6000, owner_remaining_minor: 34000, missing_keys: [] });
  assert.equal(calculateMonthlyManagerPreview({ ...input(), rate_basis_points: 9999 }).manager_minor, 6000);
});

test('exact integer half-up rounding at small and large amounts', () => {
  for (const [profit, manager] of [[0, 0], [1, 0], [3, 0], [4, 1], [9, 1], [10, 2], [30, 5], [100, 15], [110, 17], [100000000010, 15000000002]]) {
    const result = calculateMonthlyManagerPreview(onlyRevenue(profit));
    assert.equal(result.manager_minor, manager, String(profit));
    assert.equal(result.owner_remaining_minor + manager, profit);
  }
  const max = Number.MAX_SAFE_INTEGER;
  const result = calculateMonthlyManagerPreview(onlyRevenue(max));
  assert.equal(result.manager_minor, Number((BigInt(max) * 15n + 50n) / 100n));
  assert.equal(result.owner_remaining_minor + result.manager_minor, max);
});

test('zero is explicit, a loss produces no commission but preserves owner loss', () => {
  assert.equal(calculateMonthlyManagerPreview(onlyRevenue(0)).status, 'draft');
  const result = calculateMonthlyManagerPreview(input({ revenue_minor: 0 }));
  assert.equal(result.profit_before_manager_minor, -60000);
  assert.equal(result.manager_minor, 0);
  assert.equal(result.owner_remaining_minor, -60000);
});

test('null, missing and undefined stay unknown; invalid known fields still reject', () => {
  for (const key of PROFIT_INPUT_KEYS) {
    for (const value of [null, undefined]) {
      const result = calculateMonthlyManagerPreview(input({ [key]: value }));
      assert.equal(result.status, 'incomplete');
      assert.deepEqual(result.missing_keys, [key]);
      for (const output of ['profit_before_manager_minor', 'manager_minor', 'owner_remaining_minor']) assert.equal(result[output], null);
    }
    const value = input(); delete value[key];
    assert.deepEqual(calculateMonthlyManagerPreview(value).missing_keys, [key]);
  }
  assert.deepEqual(calculateMonthlyManagerPreview({}).missing_keys, [...PROFIT_INPUT_KEYS]);
  assert.throws(() => calculateMonthlyManagerPreview(input({ revenue_minor: null, shipping_minor: -1 })), TypeError);
});

test('reject coercion, negatives, fractional, unsafe or non-finite money', () => {
  for (const key of PROFIT_INPUT_KEYS) for (const value of [-1, 0.1, '100', false, 1n, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateMonthlyManagerPreview(input({ [key]: value })), TypeError);
  }
  for (const value of [null, undefined, [], 10, '']) assert.throws(() => calculateMonthlyManagerPreview(value), TypeError);
});

test('intermediate sums are exact, unsafe final output fails and input remains unchanged', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(calculateMonthlyManagerPreview(input({ revenue_minor: max, purchase_minor: max, shipping_minor: max, other_minor: 0, advertising_minor: 0 })).profit_before_manager_minor, -max);
  assert.throws(() => calculateMonthlyManagerPreview(input({ revenue_minor: 0, purchase_minor: max, shipping_minor: max })), RangeError);
  const frozen = Object.freeze(input());
  assert.equal(calculateMonthlyManagerPreview(frozen).manager_minor, 6000);
});
