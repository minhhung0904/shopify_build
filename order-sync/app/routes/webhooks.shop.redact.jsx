import { authenticate } from "../shopify.server";
import { forgetShop } from "../dedupe.server";
import { deleteToken } from "../credentials.server";

/**
 * GDPR: 48h after uninstall, erase everything we hold for this shop.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} for ${shop}`);

  await deleteToken(shop);
  await forgetShop(shop);

  return new Response();
};
