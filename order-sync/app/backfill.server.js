/**
 * Re-syncs orders Shopify already delivered, for a merchant-picked date range.
 *
 * Ranges older than 60 days need the read_all_orders scope — without it
 * Shopify silently omits those orders from the query rather than erroring.
 */
import { markSynced, wasSynced } from "./dedupe.server";
import { sendOrderToPlatform } from "./platform.server";
import { FINANCIAL_STATUSES } from "./financial-statuses";

const PAGE_SIZE = 100;
// Caps one click to a request Render won't time out on. Already-synced orders
// are skipped near-instantly, so re-clicking Sync resumes past whatever this
// run covered.
const MAX_ORDERS = 200;

const ORDERS_QUERY = `#graphql
  query BackfillOrders($searchQuery: String!, $cursor: String) {
    orders(first: ${PAGE_SIZE}, query: $searchQuery, after: $cursor, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        legacyResourceId
        name
        createdAt
        email
        phone
        currencyCode
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          firstName
          lastName
          email
          phone
        }
        shippingAddress {
          address1
          address2
          city
          province
          zip
          country
          phone
        }
        subtotalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        lineItems(first: 100) {
          nodes {
            sku
            title
            variantTitle
            quantity
            originalUnitPriceSet {
              shopMoney {
                amount
              }
            }
            product {
              legacyResourceId
            }
            variant {
              legacyResourceId
            }
          }
        }
      }
    }
  }
`;

/** GraphQL order node -> the REST-shaped object mapOrder()/webhooks expect. */
function toWebhookShapedOrder(node) {
  return {
    id: node.legacyResourceId,
    name: node.name,
    created_at: node.createdAt,
    currency: node.currencyCode,
    subtotal_price: node.subtotalPriceSet?.shopMoney?.amount ?? null,
    total_tax: node.totalTaxSet?.shopMoney?.amount ?? null,
    total_price: node.totalPriceSet?.shopMoney?.amount ?? null,
    financial_status: node.displayFinancialStatus,
    fulfillment_status: node.displayFulfillmentStatus,
    email: node.email,
    phone: node.phone,
    customer: node.customer
      ? {
          email: node.customer.email,
          phone: node.customer.phone,
          first_name: node.customer.firstName,
          last_name: node.customer.lastName,
        }
      : null,
    shipping_address: node.shippingAddress
      ? {
          address1: node.shippingAddress.address1,
          address2: node.shippingAddress.address2,
          city: node.shippingAddress.city,
          province: node.shippingAddress.province,
          zip: node.shippingAddress.zip,
          country: node.shippingAddress.country,
          phone: node.shippingAddress.phone,
        }
      : null,
    line_items: (node.lineItems?.nodes ?? []).map((item) => ({
      product_id: item.product?.legacyResourceId
        ? String(item.product.legacyResourceId)
        : null,
      variant_id: item.variant?.legacyResourceId
        ? String(item.variant.legacyResourceId)
        : null,
      sku: item.sku ?? null,
      title: item.title,
      variant_title: item.variantTitle ?? null,
      quantity: item.quantity,
      price: item.originalUnitPriceSet?.shopMoney?.amount ?? null,
    })),
  };
}

/** Builds the `query:` string shared by the count, list, and sync queries. */
function buildSearchQuery({ from, to, financialStatuses = [] }) {
  let searchQuery = `created_at:>=${from} created_at:<=${to}T23:59:59Z`;
  if (financialStatuses.length > 0) {
    searchQuery += ` financial_status:${financialStatuses.join(",")}`;
  }
  return searchQuery;
}

const COUNT_QUERY = `#graphql
  query CountOrders($searchQuery: String!) {
    ordersCount(query: $searchQuery) {
      count
      precision
    }
  }
`;

async function countOrders(admin, searchQuery) {
  const response = await admin.graphql(COUNT_QUERY, { variables: { searchQuery } });
  const { data } = await response.json();
  return data.ordersCount;
}

// How many orders the preview table shows — kept well under MAX_ORDERS since
// it's just for a merchant to eyeball before confirming.
const PREVIEW_LIMIT = 50;

const PREVIEW_LIST_QUERY = `#graphql
  query PreviewOrders($searchQuery: String!) {
    orders(first: ${PREVIEW_LIMIT}, query: $searchQuery, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
      }
      nodes {
        legacyResourceId
        name
        createdAt
        displayFinancialStatus
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
  }
`;

/**
 * Counts and lists (up to PREVIEW_LIMIT) orders matching the filter, plus a
 * per-status breakdown, so a merchant can see what a sync would do before
 * committing to it. No PII — just what's needed to eyeball the list.
 */
export async function previewOrderRange(admin, { from, to, financialStatuses = [] }) {
  const searchQuery = buildSearchQuery({ from, to, financialStatuses });
  const statusesToBreakdown =
    financialStatuses.length > 0 ? financialStatuses : FINANCIAL_STATUSES;

  const [total, breakdownCounts, listResponse] = await Promise.all([
    countOrders(admin, searchQuery),
    Promise.all(
      statusesToBreakdown.map(async (status) => ({
        status,
        count: await countOrders(
          admin,
          buildSearchQuery({ from, to, financialStatuses: [status] }),
        ),
      })),
    ),
    admin.graphql(PREVIEW_LIST_QUERY, { variables: { searchQuery } }),
  ]);

  const { data } = await listResponse.json();

  return {
    total: total.count,
    totalPrecision: total.precision,
    breakdown: breakdownCounts
      .filter((row) => row.count.count > 0)
      .map((row) => ({ status: row.status, count: row.count.count })),
    orders: data.orders.nodes.map((node) => ({
      id: node.legacyResourceId,
      name: node.name,
      createdAt: node.createdAt,
      status: node.displayFinancialStatus,
      total: node.totalPriceSet?.shopMoney?.amount ?? null,
      currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
    })),
    truncated: data.orders.pageInfo.hasNextPage,
  };
}

/**
 * Resends every order created within [from, to] (inclusive, "YYYY-MM-DD")
 * that isn't already marked synced. An empty/omitted `financialStatuses`
 * matches every payment status. Stops after MAX_ORDERS and reports
 * `truncated: true` so the caller knows to offer another click.
 */
export async function syncOrderRange(admin, shop, { from, to, financialStatuses = [] }) {
  const searchQuery = buildSearchQuery({ from, to, financialStatuses });

  let cursor = null;
  let hasNextPage = true;
  let scanned = 0;
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  while (hasNextPage && scanned < MAX_ORDERS) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { searchQuery, cursor },
    });
    const { data } = await response.json();
    const page = data.orders;

    for (const node of page.nodes) {
      if (scanned >= MAX_ORDERS) break;
      scanned += 1;

      const orderId = node.legacyResourceId;
      if (await wasSynced(shop, orderId)) {
        skipped += 1;
        continue;
      }

      try {
        await sendOrderToPlatform(toWebhookShapedOrder(node), shop);
        await markSynced(shop, orderId);
        synced += 1;
      } catch (error) {
        failed += 1;
        console.error(`backfill ${shop} order ${orderId}: ${error.message}`);
      }
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return { scanned, synced, skipped, failed, truncated: hasNextPage };
}
