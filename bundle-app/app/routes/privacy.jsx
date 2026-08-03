const LAST_UPDATED = "August 3, 2026";
const COMPANY_NAME = "Sellfern";
const CONTACT_EMAIL = "support@sellfern.com";

export default function Privacy() {
  return (
    <div
      style={{
        maxWidth: "48rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1a1a1a",
        lineHeight: 1.6,
      }}
    >
      <h1>Privacy Policy</h1>
      <p style={{ color: "#666" }}>Last updated: {LAST_UPDATED}</p>

      <p>
        This Privacy Policy describes how {COMPANY_NAME} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;, &ldquo;our&rdquo;) collects, uses, and protects
        information in connection with our Shopify bundle app (the
        &ldquo;App&rdquo;). The App helps merchants build and sell product
        bundles &mdash; fixed bundles, mix &amp; match, tiered/volume
        discounts, BOGO offers, and combo packages &mdash; on their Shopify
        store.
      </p>

      <h2>Information We Collect</h2>
      <p>To provide the App&apos;s functionality, we access and store:</p>
      <ul>
        <li>
          <strong>Store &amp; account information</strong> &mdash; your shop
          domain and an OAuth access token issued by Shopify when you install
          the App, used to make authorized requests to your store&apos;s
          Admin API.
        </li>
        <li>
          <strong>Product &amp; configuration data</strong> &mdash; product,
          variant, and collection information you choose to include in a
          bundle, and the bundle configurations (titles, pricing rules,
          tiers, add-ons) you create. This is stored as Shopify metaobjects
          and metafields on your own store, and mirrored to our systems only
          as needed to operate the App.
        </li>
        <li>
          <strong>Cart &amp; checkout data</strong> &mdash; when a shopper
          adds a bundle to their cart, the App attaches non-personal
          identifiers (a bundle handle and a per-purchase instance ID) to the
          cart line so the correct discount can be calculated at checkout.
          This data is processed by Shopify&apos;s Cart and Discount
          Function APIs; we do not separately collect or retain it.
        </li>
      </ul>

      <h2>Information We Do Not Collect</h2>
      <p>
        The App does not collect or store shoppers&apos; personal
        information &mdash; such as names, email addresses, physical
        addresses, or payment details. Checkout and customer data remain
        within Shopify&apos;s systems, governed by Shopify&apos;s own privacy
        practices.
      </p>

      <h2>How We Use Information</h2>
      <p>
        Information described above is used solely to operate the App:
        rendering the bundle-building interface in your Shopify admin,
        displaying bundle pickers on your storefront, and applying the
        correct discount to orders that include a bundle. We do not use this
        data for advertising, and we do not sell or rent it to third
        parties.
      </p>

      <h2>Third-Party Sharing</h2>
      <p>
        The App is built entirely on Shopify&apos;s native platform
        (Admin API, Shopify Functions, Theme App Extensions) and does not
        integrate with or transmit data to any third-party service.
      </p>

      <h2>Data Retention &amp; Deletion</h2>
      <p>
        We retain store data for as long as the App remains installed on
        your store. If you uninstall the App, we delete the associated
        access token and stop accessing your store. In compliance with
        Shopify&apos;s mandatory GDPR webhooks, we also respond to{" "}
        <code>customers/data_request</code>, <code>customers/redact</code>,
        and <code>shop/redact</code> webhook events to fulfill data access
        and deletion requests.
      </p>

      <h2>Data Security</h2>
      <p>
        Access tokens and configuration data are stored using
        industry-standard security practices. Access to this data is
        restricted to what&apos;s necessary to operate and support the App.
      </p>

      <h2>Your Rights</h2>
      <p>
        If you are a merchant using the App, or a shopper on a store that
        uses the App, and you have questions about your data or would like
        to request access to or deletion of your data, contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be
        posted on this page with an updated &ldquo;Last updated&rdquo; date.
      </p>

      <h2>Contact Us</h2>
      <p>
        {COMPANY_NAME}
        <br />
        Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </div>
  );
}
