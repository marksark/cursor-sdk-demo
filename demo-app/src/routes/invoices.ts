import { Router } from "express";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "../services/pricing.js";

export const invoiceRouter = Router();

invoiceRouter.get("/", (_req, res) => {
  const list = Object.values(invoices).map((inv) => {
    let totalCents: number | null = null;
    try {
      totalCents = summarizeInvoice(inv).totalCents;
    } catch {
      // INV-1002 has schema drift — totals can't be computed until generated.
    }
    return {
      id: inv.id,
      customer: inv.customer,
      currency: inv.currency,
      issuedAt: inv.id === "INV-1001" ? "2026-06-01" : "2026-06-28",
      dueDate: inv.id === "INV-1001" ? "2026-07-01" : "2026-07-28",
      totalCents,
      status: totalCents !== null ? "ready" : "pending",
    };
  });
  res.json(list);
});

invoiceRouter.get("/:id/summary", (req, res, next) => {
  const invoice = invoices[req.params.id];
  if (!invoice) {
    return res.status(404).json({ error: "invoice_not_found", id: req.params.id });
  }
  try {
    // Healthy path for INV-1001; throws for INV-1002 (planted bug in pricing.ts).
    const summary = summarizeInvoice(invoice);
    res.json(summary);
  } catch (err) {
    next(err); // hand off to the structured error handler in server.ts
  }
});

invoiceRouter.get("/:id", (req, res) => {
  const invoice = invoices[req.params.id];
  if (!invoice) {
    return res.status(404).json({ error: "invoice_not_found", id: req.params.id });
  }
  res.json({
    id: invoice.id,
    customer: invoice.customer,
    currency: invoice.currency,
    lineItems: invoice.lineItems.map((item) => ({
      sku: item.sku,
      description: item.description,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      discount: item.discount
        ? { rate: item.discount.rate, reason: item.discount.reason }
        : null,
    })),
  });
});
