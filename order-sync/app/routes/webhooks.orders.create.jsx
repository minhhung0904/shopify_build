import { authenticate } from "../shopify.server";
import { sendOrderToPlatform } from "../platform.server";
import { getToken } from "../credentials.server";
import { markSynced, wasSynced } from "../dedupe.server";

export const action = async ({ request }) => {
  // Verifies the HMAC and throws a 401 Response if the request isn't Shopify's.
  const { shop, topic, payload: order } = await authenticate.webhook(request);
  const tag = `[${topic}] ${shop} order ${order.id}`;

  // Merchant installed but hasn't pasted a token yet. Ack rather than fail: a
  // 500 would have Shopify retry for 48h and, after enough failures, drop the
  // subscription entirely. Orders arriving before they connect are not synced.
  if (!(await getToken(shop))) {
    console.warn(`${tag}: shop not connected to platform, skipped`);
    return new Response();
  }

  if (await wasSynced(shop, order.id)) {
    console.log(`${tag}: already synced, skipped`);
    return new Response();
  }

  try {
    await sendOrderToPlatform(order, shop);
    await markSynced(shop, order.id);
    console.log(`${tag}: synced`);
    return new Response();
  } catch (error) {
    console.error(`${tag}: ${error.message}`, error.body ?? "");
    // Non-2xx makes Shopify redeliver with backoff, which is the retry we want.
    return new Response("Failed to forward order to platform", { status: 500 });
  }
};
