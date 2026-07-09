import type { Invoice, LineItem } from "../data/invoices.js";

export interface InvoiceSummary {
  invoiceId: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

function lineTotals(item: LineItem): { gross: number; discount: number } {
  const gross = item.unitPriceCents * item.quantity;
  const discount = Math.round(gross * (item.discount?.rate ?? 0));
  return { gross, discount };
}

export function summarizeInvoice(invoice: Invoice): InvoiceSummary {
  let subtotalCents = 0;
  let discountCents = 0;

  for (const item of invoice.lineItems) {
    const { gross, discount } = lineTotals(item);
    subtotalCents += gross;
    discountCents += discount;
  }

  return {
    invoiceId: invoice.id,
    currency: invoice.currency,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}
