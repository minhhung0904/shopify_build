import { Outlet, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ReauthBoundary } from "../reauth-boundary";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  if (typeof window !== "undefined") {
    console.log("[order-sync debug] app.jsx rendering", { apiKey, embedded: true });
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <p style={{ background: "yellow", color: "black", padding: 8 }}>
        [order-sync debug] app.jsx rendered
      </p>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export { ReauthBoundary as ErrorBoundary };

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
