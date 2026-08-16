// Mirrors the 5 default tabs on Shopify's own Orders admin page, so the
// backfill filter feels familiar. `query` is the fragment appended to the
// date-range search string; null means no extra filter (the "All" tab).
export const ORDER_VIEWS = [
  { key: "all", label: "All", query: null },
  { key: "unfulfilled", label: "Unfulfilled", query: "fulfillment_status:unfulfilled,partial" },
  { key: "unpaid", label: "Unpaid", query: "financial_status:pending,authorized,partially_paid" },
  { key: "open", label: "Open", query: "status:open" },
  { key: "archived", label: "Archived", query: "status:closed" },
];
