import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "./pricing.js";

describe("summarizeInvoice", () => {
  it("computes summary for invoices with discounts", () => {
    const summary = summarizeInvoice(invoices["INV-1001"]);
    assert.equal(summary.invoiceId, "INV-1001");
    assert.equal(summary.subtotalCents, 3500000);
    assert.equal(summary.discountCents, 325000);
    assert.equal(summary.totalCents, 3175000);
  });

  it("handles line items missing discount (schema drift)", () => {
    const summary = summarizeInvoice(invoices["INV-1002"]);
    assert.equal(summary.invoiceId, "INV-1002");
    // SEAT-PRO: 120000 * 10 = 1_200_000, 10% off = 120_000
    // ONBOARD-1X: 250000 * 1 = 250_000, no discount
    assert.equal(summary.subtotalCents, 1450000);
    assert.equal(summary.discountCents, 120000);
    assert.equal(summary.totalCents, 1330000);
  });
});
