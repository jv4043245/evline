import test from "node:test";
import assert from "node:assert/strict";

import { parsePaymentBreakdown } from "../functions/_lib/supplier-payments.js";

test("separates supplier principal and commission from labeled OCR output", () => {
  assert.deepEqual(
    parsePaymentBreakdown("TOTAL: 8240 CNY\nSUPPLIER: 8000 CNY\nCOMMISSION: 240 CNY"),
    {
      amount: 8240,
      total_amount: 8240,
      supplier_amount: 8000,
      commission_amount: 240,
      currency: "CNY",
    }
  );
});

test("calculates supplier principal when only total and commission are labeled", () => {
  const parsed = parsePaymentBreakdown("¥1166.99\nВыплачивать комиссию ¥33.99");
  assert.equal(parsed.total_amount, 1166.99);
  assert.equal(parsed.supplier_amount, 1133);
  assert.equal(parsed.commission_amount, 33.99);
});

test("handles the standard Alipay receipt format", () => {
  const parsed = parsePaymentBreakdown("¥453.20\n*宝峰 ¥440.00\nВыплачивать комиссию ¥13.20");
  assert.equal(parsed.total_amount, 453.2);
  assert.equal(parsed.supplier_amount, 440);
  assert.equal(parsed.commission_amount, 13.2);
});

test("treats a single receipt amount as supplier principal when no commission is shown", () => {
  const parsed = parsePaymentBreakdown("支付成功 ¥440.00");
  assert.equal(parsed.total_amount, 440);
  assert.equal(parsed.supplier_amount, 440);
  assert.equal(parsed.commission_amount, 0);
});
