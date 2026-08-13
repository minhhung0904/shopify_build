// Values Shopify's order search accepts for `financial_status:`. Shared
// between the client UI (choice list) and the server (query building), so
// this file must stay free of server-only imports.
export const FINANCIAL_STATUSES = [
  "pending",
  "authorized",
  "partially_paid",
  "paid",
  "partially_refunded",
  "refunded",
  "voided",
  "expired",
];
