// Mirrors the 5 default tabs on Shopify's own Orders admin page, so the
// backfill filter feels familiar. `query` is the fragment appended to the
// date-range search string; null means no extra filter (the "All" tab).
//
// Multi-value filters need explicit ORs, and the parentheses are load-bearing.
// Shopify's search syntax has no comma operator, and it *ignores* a value it
// can't parse instead of rejecting it — so the old
// `fulfillment_status:unfulfilled,partial` silently matched every order, making
// these tabs report the same count as All. Grouping matters because
// buildSearchQuery() joins this fragment to the created_at terms with an
// implicit AND, which binds tighter than a bare OR: without the parentheses
// `dates AND unfulfilled OR partial` reads as `(dates AND unfulfilled) OR
// partial`, dragging in every partial order regardless of date.
export const ORDER_VIEWS = [
  { key: "all", label: "All", query: null },
  {
    key: "unfulfilled",
    label: "Unfulfilled",
    query: "(fulfillment_status:unfulfilled OR fulfillment_status:partial)",
  },
  {
    key: "unpaid",
    label: "Unpaid",
    query:
      "(financial_status:pending OR financial_status:authorized OR financial_status:partially_paid)",
  },
  { key: "open", label: "Open", query: "status:open" },
  { key: "archived", label: "Archived", query: "status:closed" },
];
