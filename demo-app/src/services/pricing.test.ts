import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "./pricing.js";

describe("summarizeInvoice", () => {
  it("computes totals for invoices where every line item has a discount", () => {
    const summary = summarizeInvoice(invoices["INV-1001"]);

    assert.equal(summary.invoiceId, "INV-1001");
    assert.equal(summary.currency, "USD");
    assert.equal(summary.subtotalCents, 3_500_000);
    assert.equal(summary.discountCents, 325_000);
    assert.equal(summary.totalCents, 3_175_000);
  });

  it("handles line items missing a discount without throwing", () => {
    const summary = summarizeInvoice(invoices["INV-1002"]);

    assert.equal(summary.invoiceId, "INV-1002");
    assert.equal(summary.currency, "USD");
    assert.equal(summary.subtotalCents, 1_450_000);
    assert.equal(summary.discountCents, 120_000);
    assert.equal(summary.totalCents, 1_330_000);
  });
});
