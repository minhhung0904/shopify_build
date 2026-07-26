# OrderSync

Shopify app that forwards every new order to an external platform. Built to be
installed by multiple merchants — each connects with their own platform token.

## How it works

1. A new order fires the `orders/create` webhook (declared in `shopify.app.toml`).
2. [`webhooks.orders.create.jsx`](app/routes/webhooks.orders.create.jsx) verifies the HMAC via `authenticate.webhook`.
3. It looks up that shop's platform token ([`credentials.server.js`](app/credentials.server.js)) — merchants paste this on the app's home page.
4. [`platform.server.js`](app/platform.server.js) maps the order and POSTs it with the token in an `X-API-Key` header.
5. The order id is recorded ([`dedupe.server.js`](app/dedupe.server.js)) **after** the platform confirms, so a redelivered webhook is skipped, not duplicated.

### Why the responses are what they are

- **Platform error → HTTP 500.** Deliberate: Shopify then redelivers with backoff for up to 48h, which is a free retry queue.
- **Shop not connected → HTTP 200.** Retrying can't fix a missing token, and enough 500s make Shopify drop the subscription. Orders placed before a merchant connects are not synced.
- **Timeout is 3s** (`PLATFORM_TIMEOUT_MS`), under Shopify's 5s webhook limit.

## Auth model

- The platform is **one deployment** → `PLATFORM_API_URL` in env.
- Each merchant has **their own token** → stored per-shop in MongoDB, **encrypted at rest** ([`crypto.server.js`](app/crypto.server.js), AES-256-GCM). A leaked DB does not leak tokens; the key is `ENCRYPTION_KEY`, only in env.
- No passwords are stored, and tokens never reach the browser — the UI shows only the last 4 chars.

## Plugging in the real API

1. Set `PLATFORM_API_URL` and the paths in `.env.example`.
2. Rewrite `mapOrder` in `app/platform.server.js` to the platform's real schema — the current shape is a neutral guess.
3. Optionally set `PLATFORM_VERIFY_PATH` so a wrong token is caught when a merchant connects rather than via missing orders.

## Setup

```sh
npm install
openssl rand -base64 32          # -> ENCRYPTION_KEY
shopify app config link          # creates/links the app, fills in client_id
shopify app deploy               # registers webhook subscriptions
```

Then set env vars on the host and install on a store.

## Protected customer data

Orders contain customer PII. Request **Protected customer data** approval in the
Partner Dashboard (App setup) or the webhook payload comes back with those
fields stripped. The GDPR webhooks (`customers/data_request`,
`customers/redact`, `shop/redact`) are already wired — `customers/redact` has a
TODO to call the platform's delete endpoint once it exists.
