# Security & data protection policy

Internal reference backing the answers given in Shopify's Protected Customer
Data access request. See [`app/routes/privacy.jsx`](app/routes/privacy.jsx)
for the merchant-facing version.

## Access control

- Only Sellfern staff operating this app have credentials to the hosting
  account (Render) and database (MongoDB Atlas).
- Those accounts must use two-factor authentication and a unique, strong
  password (enforced via the account provider, not by this app).

## Storage

- Customer personal data (name, email, phone, address) is never written to
  our database — see `app/platform.server.js`. It is forwarded per-order and
  discarded.
- The only persisted records are the merchant's encrypted platform token
  (`app/credentials.server.js`) and a dedupe record of `shop + orderId + syncedAt`
  (`app/dedupe.server.js`), both deleted on uninstall
  (`app/routes/webhooks.app.uninstalled.jsx`).
- Production and local/test development use separate MongoDB databases.
- Backups are encrypted (MongoDB Atlas default).

## Processing log

`app/dedupe.server.js` records every order forwarded — shop, order ID, and
timestamp — as the audit trail of when customer data was accessed, without
logging the personal data itself.

## Incident response

1. **Detect** — error logs and platform delivery failures are monitored.
2. **Contain** — rotate `ENCRYPTION_KEY` and/or affected merchant tokens,
   revoke compromised credentials.
3. **Assess** — determine which shops/orders were affected.
4. **Notify** — inform affected merchants and Shopify without undue delay.
5. **Remediate** — patch the root cause; document what changed.
