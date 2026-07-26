import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

// boundary.error() renders Shopify's App Bridge re-auth/bounce response via
// dangerouslySetInnerHTML, which never executes the <script> it injects.
// That's fine on a full document load (the browser parses it as real HTML),
// but when authenticate.admin() bounces during a client-side transition
// (e.g. an expired session token), React Router delivers it as a route
// error instead, and the injected script silently never runs, leaving the
// app stuck on a blank page. Reloading re-issues the request as a full
// document GET, where the same response works correctly.
export function ReauthBoundary() {
  const error = useRouteError();
  const isReauthBounce =
    isRouteErrorResponse(error) &&
    typeof error.data === "string" &&
    error.data.includes("shopifycloud/app-bridge.js");

  useEffect(() => {
    if (isReauthBounce) window.location.reload();
  }, [isReauthBounce]);

  if (isReauthBounce) return null;
  return boundary.error(error);
}
