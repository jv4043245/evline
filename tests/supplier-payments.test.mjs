import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { parsePaymentBreakdown, supplierPaymentQrImage } from "../functions/_lib/supplier-payments.js";

test("Zeekr uses the owner-provided updated QR without image modification", () => {
  const url = "https://evline.com.ua/assets/images/suppliers/zeekr-payment-qr-20261005.jpg";
  for (const name of ["Zeekr", "Ziker", "Зікр", "Зикер", "Постачальник Zeekr"]) {
    assert.equal(supplierPaymentQrImage(name)?.url, url);
  }
  assert.equal(supplierPaymentQrImage("Zeekr")?.caption, "QR для оплати постачальнику Zeekr");
  const image = readFileSync(new URL("../assets/images/suppliers/zeekr-payment-qr-20261005.jpg", import.meta.url));
  assert.equal(createHash("sha256").update(image).digest("hex"), "00878c0153a2ad6cf53d44c57f0c6ff1025ac137e9261dbc9c7d849fd9d6eb1a");
  assert.equal(supplierPaymentQrImage("BYD")?.url, "https://evline.com.ua/assets/images/suppliers/byd-payment-qr.jpg");
  assert.equal(supplierPaymentQrImage("Toyota")?.url, "https://evline.com.ua/assets/images/suppliers/toyota-payment-qr.jpg");
});

test("maps the Toyota supplier to its payment QR", () => {
  const paymentQr = supplierPaymentQrImage("Toyota");
  assert.equal(paymentQr?.url, "https://evline.com.ua/assets/images/suppliers/toyota-payment-qr.jpg");
  assert.equal(paymentQr?.caption, "QR для оплати постачальнику Toyota");
  assert.equal(supplierPaymentQrImage("Тойота")?.url, paymentQr?.url);
});

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

test("repairs swapped supplier and commission labels for a 7085 CNY invoice", () => {
  const parsed = parsePaymentBreakdown(
    "TOTAL: 7297.55 CNY\nSUPPLIER: 212.55 CNY\nCOMMISSION: 7085 CNY",
    { requestedAmount: 7085 }
  );
  assert.equal(parsed.total_amount, 7297.55);
  assert.equal(parsed.supplier_amount, 7085);
  assert.equal(parsed.commission_amount, 212.55);
});

test("repairs swapped supplier and commission labels for a 1860 CNY invoice", () => {
  const parsed = parsePaymentBreakdown(
    "TOTAL: 1915.80 CNY\nSUPPLIER: 55.80 CNY\nCOMMISSION: 1860 CNY",
    { requestedAmount: 1860 }
  );
  assert.equal(parsed.total_amount, 1915.8);
  assert.equal(parsed.supplier_amount, 1860);
  assert.equal(parsed.commission_amount, 55.8);
});

test("keeps a correct partial payment breakdown when the invoice is larger", () => {
  const parsed = parsePaymentBreakdown(
    "TOTAL: 8240 CNY\nSUPPLIER: 8000 CNY\nCOMMISSION: 240 CNY",
    { requestedAmount: 9133 }
  );
  assert.equal(parsed.total_amount, 8240);
  assert.equal(parsed.supplier_amount, 8000);
  assert.equal(parsed.commission_amount, 240);
});

test("uses the requested amount when OCR returns only the charged total", () => {
  const parsed = parsePaymentBreakdown("TOTAL: 7297.55 CNY", { requestedAmount: 7085 });
  assert.equal(parsed.total_amount, 7297.55);
  assert.equal(parsed.supplier_amount, 7085);
  assert.equal(parsed.commission_amount, 212.55);
});
