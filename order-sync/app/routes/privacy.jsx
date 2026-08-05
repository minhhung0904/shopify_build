const SECTION_STYLE = { marginBottom: "1.5rem" };

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: "40rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>Privacy Policy — SellfernSync</h1>
      <p>
        <em>Last updated: August 5, 2026</em>
      </p>

      <section style={SECTION_STYLE}>
        <h2>What this app does</h2>
        <p>
          SellfernSync forwards each new order placed on your Shopify store to
          a platform you connect, so that platform can fulfill or manage the
          order. It does this by subscribing to Shopify&apos;s{" "}
          <code>orders/create</code> webhook.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>What data we access</h2>
        <p>
          For each new order, we read the order details Shopify sends,
          including the customer&apos;s name, email, phone number, and
          shipping address, along with the order&apos;s line items and totals.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Why we access it</h2>
        <p>
          Solely to relay the order to the platform you&apos;ve connected, so
          it can be fulfilled or tracked there. We don&apos;t use this data
          for marketing, analytics, personalization, or any purpose other than
          that relay.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>What we store</h2>
        <p>
          Customer names, emails, phone numbers, and addresses are forwarded
          to your connected platform and are <strong>not stored</strong> by
          this app. The only records we keep are:
        </p>
        <ul>
          <li>
            Your store domain and each order&apos;s ID, so a redelivered
            webhook isn&apos;t processed twice.
          </li>
          <li>
            The integration token you paste in to connect your platform,
            encrypted at rest (AES-256-GCM) and never shown in full again.
          </li>
        </ul>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Security</h2>
        <p>
          Data in transit is protected with HTTPS/TLS, both from Shopify to
          us and from us to your connected platform. Incoming webhooks are
          verified against Shopify&apos;s HMAC signature before we act on
          them. Your platform token is encrypted before it&apos;s written to
          the database and decrypted only when needed to send an order.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Data retention and deletion</h2>
        <p>
          We retain no customer personal data. Your platform token and order
          dedupe records are kept only while the app is installed, and are
          deleted when you disconnect your platform or uninstall the app.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Your rights</h2>
        <p>
          We support Shopify&apos;s mandatory compliance webhooks —{" "}
          <code>customers/data_request</code>, <code>customers/redact</code>,
          and <code>shop/redact</code> — so data subject requests submitted
          through Shopify are honored.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Third parties</h2>
        <p>
          Order data is sent only to the platform URL and with the token you
          configure when you connect the app. We don&apos;t share data with
          any other third party.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Access control and backups</h2>
        <p>
          Only Sellfern staff who operate this app can reach the database or
          hosting account that holds your encrypted platform token, and those
          accounts require two-factor authentication. Database backups are
          encrypted, and our test environment uses a separate database from
          production so test activity never touches real merchant data.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Processing log</h2>
        <p>
          Every order we forward is recorded with the shop domain, order ID,
          and timestamp it was processed — this is our audit trail of when
          customer data was accessed, kept separate from the data itself.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Incident response</h2>
        <p>
          If we discover a security incident affecting your data, we will
          contain it, assess what was affected, and notify you and Shopify
          without undue delay.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Agreement</h2>
        <p>
          By installing and connecting this app, you agree to the data
          handling described on this page.
        </p>
      </section>

      <section style={SECTION_STYLE}>
        <h2>Contact</h2>
        <p>
          Questions about this policy or your data:{" "}
          <a href="mailto:support@sellfern.com">support@sellfern.com</a>
        </p>
      </section>
    </main>
  );
}
