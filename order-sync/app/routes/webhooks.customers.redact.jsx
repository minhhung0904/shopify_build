import { authenticate } from "../shopify.server";

/**
 * GDPR: erase a customer's data.
 *
 * TODO: once the platform exposes a delete endpoint, call it here — the copy
 * that actually holds this customer's PII is the one on the platform, and it is
 * this app that put it there.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(
    `Received ${topic} for ${shop}: customer ${payload?.customer?.id}`,
  );

  return new Response();
};
