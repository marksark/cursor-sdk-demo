import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "./pricing.js";

describe("summarizeInvoice", () => {
  it("computes totals for invoices where every line item has a discount", () => {
    const summary = summarizeInvoice(invoices["INV-1001"]);

    assert.equal(summary.invoiceId, "INV-1001");
    assert.equal(summary.subtotalCents, 3500000);
    assert.equal(summary.discountCents, 325000);
    assert.equal(summary.totalCents, 3175000);
  });

  it("handles line items missing a discount without throwing (INV-1002)", () => {
    const summary = summarizeInvoice(invoices["INV-1002"]);

    assert.equal(summary.invoiceId, "INV-1002");
    assert.equal(summary.subtotalCents, 1450000);
    assert.equal(summary.discountCents, 120000);
    assert.equal(summary.totalCents, 1330000);
  });
});
