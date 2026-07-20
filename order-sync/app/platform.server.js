/**
 * Client for the platform that stores our orders.
 *
 * The platform is a single deployment (PLATFORM_API_URL, in env), but each
 * merchant authenticates with their own long-lived integration token, which
 * they paste on the settings page. So: URL from env, token from the database.
 */
import { getToken } from "./credentials.server";

const TIMEOUT_MS = Number(process.env.PLATFORM_TIMEOUT_MS || 3000);

export function platformUrl() {
  return process.env.PLATFORM_API_URL || "";
}

export class PlatformError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "PlatformError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Shopify order payload -> platform payload.
 *
 * TODO: replace with the real schema. The shape below is a neutral flattening,
 * not a contract the platform actually agreed to.
 */
export function mapOrder(order, shop) {
  return {
    source: "shopify",
    shop_domain: shop,
    order_id: String(order.id),
    order_number: order.name ?? String(order.order_number ?? ""),
    created_at: order.created_at,
    currency: order.currency,
    subtotal: order.subtotal_price,
    tax: order.total_tax,
    total: order.total_price,
    financial_status: order.financial_status,
    fulfillment_status: order.fulfillment_status,
    customer: {
      email: order.email ?? order.customer?.email ?? null,
      phone: order.phone ?? order.customer?.phone ?? null,
      first_name: order.customer?.first_name ?? null,
      last_name: order.customer?.last_name ?? null,
    },
    shipping_address: order.shipping_address ?? null,
    line_items: (order.line_items ?? []).map((item) => ({
      product_id: item.product_id ? String(item.product_id) : null,
      variant_id: item.variant_id ? String(item.variant_id) : null,
      sku: item.sku ?? null,
      title: item.title,
      variant_title: item.variant_title ?? null,
      quantity: item.quantity,
      price: item.price,
    })),
  };
}

async function post(path, token, body, { idempotencyKey } = {}) {
  const url = platformUrl();
  if (!url) throw new PlatformError("PLATFORM_API_URL is not set");

  let response;
  try {
    response = await fetch(new URL(path, url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": token,
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      // Must stay under Shopify's 5s webhook timeout.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new PlatformError(`Request to platform failed: ${error.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PlatformError(`Platform returned ${response.status}`, {
      status: response.status,
      body: text.slice(0, 500),
    });
  }

  return response;
}

/**
 * Checks a token before we store it, so a merchant finds out they pasted the
 * wrong thing on the settings page instead of via silently missing orders.
 *
 * TODO: point at the platform's real verify endpoint.
 */
export async function verifyToken(token) {
  const path = process.env.PLATFORM_VERIFY_PATH;
  // Not configured: accept the token and let the first order be the test.
  if (!path) return { verified: false };

  await post(path, token, { source: "shopify" });
  return { verified: true };
}

/** POST one order. Throws PlatformError on timeout or non-2xx. */
export async function sendOrderToPlatform(order, shop) {
  const token = await getToken(shop);
  if (!token) {
    throw new PlatformError(`No platform token stored for ${shop}`, {
      status: 401,
    });
  }

  return post(process.env.PLATFORM_ORDERS_PATH || "/orders", token, mapOrder(order, shop), {
    // Lets the platform drop duplicates on its side too. Shopify can and does
    // deliver the same webhook more than once.
    idempotencyKey: `${shop}:${order.id}`,
  });
}
