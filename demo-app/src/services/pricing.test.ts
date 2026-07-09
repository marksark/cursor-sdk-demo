import assert from "node:assert/strict";
import { test } from "node:test";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "./pricing.js";

test("summarizeInvoice handles line items without discount (INV-1002)", () => {
  const invoice = invoices["INV-1002"];
  assert.ok(invoice);

  const summary = summarizeInvoice(invoice);

  assert.equal(summary.invoiceId, "INV-1002");
  assert.equal(summary.currency, "USD");
  // SEAT-PRO: 120000 * 10 = 1_200_000 gross, 10% discount = 120_000
  // ONBOARD-1X: 250000 * 1 = 250_000 gross, no discount = 0
  assert.equal(summary.subtotalCents, 1_450_000);
  assert.equal(summary.discountCents, 120_000);
  assert.equal(summary.totalCents, 1_330_000);
});

test("summarizeInvoice still works for invoices with all discounts (INV-1001)", () => {
  const invoice = invoices["INV-1001"];
  assert.ok(invoice);

  const summary = summarizeInvoice(invoice);

  assert.equal(summary.invoiceId, "INV-1001");
  assert.equal(summary.subtotalCents, 3_500_000);
  assert.equal(summary.discountCents, 325_000);
  assert.equal(summary.totalCents, 3_175_000);
});
