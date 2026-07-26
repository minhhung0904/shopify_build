import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Carry the query string over. Shopify identifies the embedded session
  // through these params (shop, host, embedded, id_token) — dropping them
  // leaves /app unable to authenticate, so it serves the bare App Bridge
  // bootstrap instead, and App Bridge then aborts with "missing required
  // configuration fields: shop", leaving the app permanently blank.
  const { search } = new URL(request.url);
  return redirect(`/app${search}`);
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
