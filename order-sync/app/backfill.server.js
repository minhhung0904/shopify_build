/**
 * Re-syncs orders Shopify already delivered, for a merchant-picked date range.
 *
 * Ranges older than 60 days need the read_all_orders scope — without it
 * Shopify silently omits those orders from the query rather than erroring.
 */
import { markSynced, wasSynced } from "./dedupe.server";
import { sendOrderToPlatform } from "./platform.server";
import { ORDER_VIEWS } from "./order-views";

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
function buildSearchQuery({ from, to, orderView }) {
  let searchQuery = `created_at:>=${from} created_at:<=${to}T23:59:59Z`;
  const view = ORDER_VIEWS.find((v) => v.key === orderView);
  if (view?.query) {
    searchQuery += ` ${view.query}`;
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

// Orders per preview page. Small on purpose — this is paged, unlike the
// sync loop, so each click stays fast.
const PREVIEW_PAGE_SIZE = 20;

const PREVIEW_LIST_QUERY = `#graphql
  query PreviewOrders(
    $searchQuery: String!
    $first: Int
    $after: String
    $last: Int
    $before: String
  ) {
    orders(
      query: $searchQuery
      first: $first
      after: $after
      last: $last
      before: $before
      sortKey: CREATED_AT
    ) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      nodes {
        legacyResourceId
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          firstName
          lastName
        }
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 3) {
          pageInfo {
            hasNextPage
          }
          nodes {
            title
            quantity
          }
        }
      }
    }
  }
`;

function summarizeLineItems(lineItems) {
  const summary = (lineItems?.nodes ?? [])
    .map((item) => `${item.title} x${item.quantity}`)
    .join(", ");
  return lineItems?.pageInfo?.hasNextPage ? `${summary}, …` : summary;
}

/**
 * Counts and lists (one page of PREVIEW_PAGE_SIZE) orders matching [from, to]
 * and the chosen order view (see order-views.js — mirrors Shopify's own
 * Orders page tabs), plus a count for every view so a merchant can compare
 * before picking one. `cursor`/`direction` page forward or backward through
 * the same filter.
 */
export async function previewOrderRange(
  admin,
  { from, to, orderView, cursor = null, direction = "next" },
) {
  const searchQuery = buildSearchQuery({ from, to, orderView });
  // Sending both first/after and last/before — even with the unused pair set
  // to null — makes Shopify reject the query with "Specify either first or
  // last, not both". Only include the pair the current direction needs.
  const paginationVariables =
    direction === "prev"
      ? { last: PREVIEW_PAGE_SIZE, before: cursor }
      : { first: PREVIEW_PAGE_SIZE, after: cursor };

  const [breakdown, listResponse] = await Promise.all([
    Promise.all(
      ORDER_VIEWS.map(async (view) => ({
        key: view.key,
        label: view.label,
        count: (
          await countOrders(admin, buildSearchQuery({ from, to, orderView: view.key }))
        ).count,
      })),
    ),
    admin.graphql(PREVIEW_LIST_QUERY, {
      variables: { searchQuery, ...paginationVariables },
    }),
  ]);

  const { data } = await listResponse.json();
  const total = breakdown.find((row) => row.key === orderView)?.count ?? 0;

  return {
    total,
    breakdown,
    orders: data.orders.nodes.map((node) => ({
      id: node.legacyResourceId,
      name: node.name,
      createdAt: node.createdAt,
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      customerName: node.customer
        ? [node.customer.firstName, node.customer.lastName].filter(Boolean).join(" ")
        : null,
      items: summarizeLineItems(node.lineItems),
      total: node.totalPriceSet?.shopMoney?.amount ?? null,
      currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
    })),
    pageInfo: data.orders.pageInfo,
  };
}

/**
 * Resends every order created within [from, to] (inclusive, "YYYY-MM-DD")
 * matching `orderView` (see order-views.js) that isn't already marked
 * synced. Stops after MAX_ORDERS and reports `truncated: true` so the
 * caller knows to offer another click.
 */
export async function syncOrderRange(admin, shop, { from, to, orderView }) {
  const searchQuery = buildSearchQuery({ from, to, orderView });

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
