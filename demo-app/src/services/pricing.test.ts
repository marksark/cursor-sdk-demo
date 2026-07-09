import assert from "node:assert/strict";
import { test } from "node:test";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "./pricing.js";

test("summarizeInvoice handles line items without a discount", () => {
  const summary = summarizeInvoice(invoices["INV-1002"]);

  assert.equal(summary.invoiceId, "INV-1002");
  assert.equal(summary.subtotalCents, 1_450_000);
  assert.equal(summary.discountCents, 120_000);
  assert.equal(summary.totalCents, 1_330_000);
});

test("summarizeInvoice still applies discounts when present", () => {
  const summary = summarizeInvoice(invoices["INV-1001"]);

  assert.equal(summary.totalCents, 3_175_000);
});
