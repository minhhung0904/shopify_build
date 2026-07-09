import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="Bundle app">
      <s-section heading="Welcome">
        <s-paragraph>
          Manage your product bundles from the{" "}
          <s-link href="/app/bundles">Bundles</s-link> page. Bundles you
          create there show up automatically in the "Bundle picker" app block
          — add it to any theme from the Theme Editor under Apps.
        </s-paragraph>
      </s-section>

      <s-section heading="How pricing works" slot="aside">
        <s-paragraph>
          The bundle price shown on your storefront is a display label only.
          To make checkout actually charge the discounted total, create a
          matching Discount in Settings → Discounts for the products in each
          bundle.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
