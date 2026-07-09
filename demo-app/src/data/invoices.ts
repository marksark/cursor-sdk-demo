// In-memory "database" for the demo billing service.
//
// The TYPE says every line item has a `discount`. But data is loaded from a
// datastore (here: a raw literal cast to the type, as if from a DB/JSON API),
// and one row for INV-1002 is missing it. This is classic schema drift: the
// types promise something the data doesn't deliver. It compiles clean and
// throws only at runtime — which is exactly why it reached production.

export interface Discount {
  rate: number; // 0.10 == 10% off
  reason: string;
}

export interface LineItem {
  sku: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  discount: Discount; // the schema claims this is always present
}

export interface Invoice {
  id: string;
  customer: string;
  currency: string;
  lineItems: LineItem[];
}

// Raw records "from the datastore". Typed as `unknown` because the store does
// not enforce our schema — note INV-1002's onboarding line has no discount.
const RAW_FROM_DATASTORE: unknown = [
  {
    id: "INV-1001",
    customer: "Charles Schwab",
    currency: "USD",
    lineItems: [
      { sku: "SEAT-PRO", description: "Pro seat (annual)", unitPriceCents: 120000, quantity: 25, discount: { rate: 0.1, reason: "Volume 25+" } },
      { sku: "SUPPORT-GOLD", description: "Gold support", unitPriceCents: 500000, quantity: 1, discount: { rate: 0.05, reason: "Renewal" } },
    ],
  },
  {
    id: "INV-1002",
    customer: "Amazon, Inc.",
    currency: "USD",
    lineItems: [
      { sku: "SEAT-PRO", description: "Pro seat (annual)", unitPriceCents: 120000, quantity: 10, discount: { rate: 0.1, reason: "Volume 10+" } },
      { sku: "ONBOARD-1X", description: "One-time onboarding", unitPriceCents: 250000, quantity: 1 /* no discount in the datastore */ },
    ],
  },
];

// The app trusts the schema and treats these as fully-typed Invoices.
export const invoices: Record<string, Invoice> = Object.fromEntries(
  (RAW_FROM_DATASTORE as Invoice[]).map((inv) => [inv.id, inv]),
);
