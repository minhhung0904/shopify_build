import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Sent 48 hours after uninstall. Sessions are already cleared by the
  // app/uninstalled handler, but clear them here too in case that webhook
  // was missed.
  const shopSessions = await sessionStorage.findSessionsByShop(shop);
  await sessionStorage.deleteSessions(shopSessions.map((s) => s.id));

  return new Response();
};
