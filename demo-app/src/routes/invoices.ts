import { Router } from "express";
import { invoices } from "../data/invoices.js";
import { summarizeInvoice } from "../services/pricing.js";

export const invoiceRouter = Router();

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
