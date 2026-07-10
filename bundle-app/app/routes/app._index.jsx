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
          create there show up automatically in the &ldquo;Bundle
          picker&rdquo; app block — add it to any theme from the Theme Editor
          under Apps.
        </s-paragraph>
      </s-section>

      <s-section heading="How pricing works" slot="aside">
        <s-paragraph>
          Each bundle&rsquo;s discount is enforced automatically at checkout
          by this app&rsquo;s discount function — no manual Discount setup
          needed in Settings → Discounts.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
