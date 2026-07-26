import { useEffect, useRef } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

// boundary.error() renders Shopify's App Bridge re-auth/bounce response via
// dangerouslySetInnerHTML, which never executes the <script> it injects —
// browsers never run <script> tags inserted that way. That's invisible on a
// full document load (the browser's own HTML parser executes it), but when
// authenticate.admin() bounces during a client-side transition (e.g. an
// expired session token), React Router delivers it as a route error instead,
// and the script silently never runs, leaving the app stuck on a blank page.
//
// Re-creating the <script> tag(s) via the DOM API (not innerHTML) makes the
// browser actually execute them, so App Bridge runs and performs its own
// (token-aware) redirect. Do NOT reload the page here: window.location still
// carries whatever (possibly already-expired/one-time-use) token was in the
// failed request, so reloading just replays the same failure forever.
export function ReauthBoundary() {
  const error = useRouteError();
  const isReauthBounce =
    isRouteErrorResponse(error) &&
    typeof error.data === "string" &&
    error.data.includes("shopifycloud/app-bridge.js");
  const injected = useRef(false);

  useEffect(() => {
    if (!isReauthBounce || injected.current) return;
    injected.current = true;

    const container = document.createElement("div");
    container.innerHTML = error.data;
    container.querySelectorAll("script").forEach((oldScript) => {
      const script = document.createElement("script");
      for (const attr of oldScript.attributes) {
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = oldScript.textContent;
      document.body.appendChild(script);
    });
  }, [isReauthBounce, error]);

  if (isReauthBounce) return null;
  return boundary.error(error);
}
