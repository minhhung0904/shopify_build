import { useEffect, useRef } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

// boundary.error() renders Shopify's App Bridge re-auth/bounce response via
// dangerouslySetInnerHTML, which never executes the <script> it injects —
// browsers never run <script> tags inserted that way. That's invisible on a
// full document load (the browser's own HTML parser executes it as the very
// first script, which App Bridge requires), but when authenticate.admin()
// bounces during a client-side transition (e.g. an expired session token),
// React Router delivers it as a route error instead, and the script never
// runs. Re-creating it via the DOM API doesn't work either — App Bridge
// explicitly refuses to run unless it's the first <script> tag in the
// document, which is impossible to satisfy once React has already booted.
//
// So force a real navigation instead, dropping any one-time-use params
// (id_token) from the current URL first. Reloading the exact same URL would
// just replay the same already-consumed token and loop forever; navigating
// to the shop/host/embedded-only URL gets a fresh, real document response
// that the server already handles correctly.
export function ReauthBoundary() {
  const error = useRouteError();
  const isReauthBounce =
    isRouteErrorResponse(error) &&
    typeof error.data === "string" &&
    error.data.includes("shopifycloud/app-bridge.js");
  const navigated = useRef(false);

  useEffect(() => {
    if (!isReauthBounce || navigated.current) return;
    navigated.current = true;

    const current = new URL(window.location.href);
    const clean = new URL(window.location.pathname, window.location.origin);
    for (const key of ["shop", "host", "embedded"]) {
      const value = current.searchParams.get(key);
      if (value) clean.searchParams.set(key, value);
    }
    window.location.replace(clean.toString());
  }, [isReauthBounce]);

  if (isReauthBounce) return null;
  return boundary.error(error);
}
