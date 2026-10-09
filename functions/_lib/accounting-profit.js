export const MANAGER_RATE_BASIS_POINTS = 1500;
export const PROFIT_INPUT_KEYS = Object.freeze([
  'revenue_minor', 'purchase_minor', 'shipping_minor', 'other_minor', 'advertising_minor',
]);

function safeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('profit_result_out_of_range');
  }
  return Number(value);
}

/** Pure preview in UAH kopecks. The caller supplies one consistent monthly
 * revenue/purchase/shipping cohort and the month's advertising exactly once.
 * This function does not select orders, recognise payments, approve or pay a
 * commission. Unknown inputs never become zero. All complete results remain a
 * draft, and the fixed 15% applies to positive profit, never to turnover.
 */
export function calculateMonthlyManagerPreview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('invalid_profit_inputs');
  const missing_keys = [];
  for (const key of PROFIT_INPUT_KEYS) {
    const value = Object.hasOwn(input, key) ? input[key] : null;
    if (value === null || value === undefined) missing_keys.push(key);
    else if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`invalid_${key}`);
  }
  const result = {
    status: missing_keys.length ? 'incomplete' : 'draft',
    rate_basis_points: MANAGER_RATE_BASIS_POINTS,
    profit_before_manager_minor: null, manager_minor: null, owner_remaining_minor: null, missing_keys,
  };
  if (missing_keys.length) return result;
  const profit = BigInt(input.revenue_minor) - BigInt(input.purchase_minor) - BigInt(input.shipping_minor)
    - BigInt(input.other_minor) - BigInt(input.advertising_minor);
  // Exact half-up rounding without unsafe float multiplication or intermediate
  // sums. No loss carry-forward policy is implied by zero on a negative month.
  const manager = profit > 0n ? (profit * BigInt(MANAGER_RATE_BASIS_POINTS) + 5000n) / 10000n : 0n;
  return { ...result, profit_before_manager_minor: safeNumber(profit), manager_minor: safeNumber(manager),
    owner_remaining_minor: safeNumber(profit - manager) };
}
