import { authenticate, sessionStorage } from "../shopify.server";
import { forgetShop } from "../dedupe.server";
import { deleteToken } from "../credentials.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been
  // uninstalled. If this webhook already ran, the session may have been deleted.
  if (session) {
    const shopSessions = await sessionStorage.findSessionsByShop(shop);
    await sessionStorage.deleteSessions(shopSessions.map((s) => s.id));
  }

  // Don't keep a merchant's platform token after they've uninstalled.
  await deleteToken(shop);
  await forgetShop(shop);

  return new Response();
};
