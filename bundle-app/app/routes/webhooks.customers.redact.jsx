import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // This app does not store any customer PII (no customer records, orders,
  // or personal data are persisted outside Shopify), so there is no data
  // to redact.

  return new Response();
};
