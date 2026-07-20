import { authenticate } from "../shopify.server";

/**
 * GDPR: a customer asked what data we hold on them.
 *
 * This app stores no customer PII of its own — orders are forwarded to the
 * platform and only the order id is kept (see dedupe.server.js). Anything the
 * customer is entitled to lives on the platform, so respond there.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(
    `Received ${topic} for ${shop}: customer ${payload?.customer?.id}`,
  );

  return new Response();
};
