import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ReauthBoundary } from "./reauth-boundary";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export { ReauthBoundary as ErrorBoundary };

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
