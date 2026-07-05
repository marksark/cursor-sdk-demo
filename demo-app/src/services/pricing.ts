import type { Invoice, LineItem } from "../data/invoices.js";

export interface InvoiceSummary {
  invoiceId: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

// Computes the discounted total for a single line item.
//
// BUG (planted): the type promises `item.discount` is always present, so this
// reads `item.discount.rate` unconditionally and TypeScript is happy. But the
// datastore has rows without a discount (schema drift), so at runtime:
//   TypeError: Cannot read properties of undefined (reading 'rate')
// -> the route returns HTTP 500. This is the incident the agent will remediate.
function lineTotals(item: LineItem): { gross: number; discount: number } {
  const gross = item.unitPriceCents * item.quantity;
  const discount = Math.round(gross * item.discount.rate); // <-- throws at runtime when the row has no discount
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
