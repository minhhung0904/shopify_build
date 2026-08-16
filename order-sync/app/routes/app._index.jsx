import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { checkStore, verifyToken, PlatformError } from "../platform.server";
import { previewOrderRange, syncOrderRange } from "../backfill.server";
import { ORDER_VIEWS } from "../order-views";
import {
  deleteToken,
  getConnection,
  getStoreName,
  getToken,
  saveStoreName,
  saveToken,
} from "../credentials.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return {
    connection: await getConnection(session.shop),
    shop: session.shop,
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "preview-range" || intent === "sync-range") {
    const dateFrom = String(formData.get("dateFrom") || "").trim();
    const dateTo = String(formData.get("dateTo") || "").trim();

    if (!dateFrom || !dateTo) {
      return { ok: false, intent, message: "Pick both a start and end date." };
    }
    if (dateFrom > dateTo) {
      return { ok: false, intent, message: "Start date must be before end date." };
    }

    const orderView = String(formData.get("orderView") || "all");

    if (intent === "preview-range") {
      const preview = await previewOrderRange(admin, {
        from: dateFrom,
        to: dateTo,
        orderView,
      });
      return { ok: true, intent, dateFrom, dateTo, orderView, preview };
    }

    const { scanned, synced, skipped, failed, truncated } = await syncOrderRange(
      admin,
      session.shop,
      { from: dateFrom, to: dateTo, orderView },
    );
    const summary = `Scanned ${scanned}: synced ${synced}, skipped ${skipped} already-synced, ${failed} failed.`;
    const message = truncated
      ? `${summary} More orders remain in range — click Sync again to continue.`
      : `${summary} Done.`;
    return { ok: failed === 0, intent, message };
  }

  if (intent === "disconnect") {
    await deleteToken(session.shop);
    return { ok: true, message: "Disconnected." };
  }

  // Once a store is saved the section is locked to a read-only view. These
  // intents drive it: Edit unlocks the form, Cancel re-locks it, Remove clears
  // the mapping. Edit/Cancel change no data — they just flip the view.
  if (intent === "edit-store") {
    return { ok: true, intent: "edit-store", storeName: await getStoreName(session.shop) };
  }
  if (intent === "cancel-store-edit") {
    return { ok: true, intent: "cancel-store-edit" };
  }
  if (intent === "remove-store") {
    await saveStoreName(session.shop, "");
    return { ok: true, intent: "remove-store", message: "Store name removed. Orders map by shop domain." };
  }

  // Store name is a two-step flow with a single button:
  //   1. "check-store" verifies the name against Sellfern. On success the UI
  //      swaps the button to Save.
  //   2. "save-store" persists the name — but re-verifies first, so an edited
  //      (still-unverified) name can't slip through; a miss drops back to step 1.
  // Both steps need a token to authenticate the check.
  if (intent === "check-store" || intent === "save-store") {
    const storeName = String(formData.get("storeName") || "").trim();
    const token = await getToken(session.shop);

    if (!token) {
      return { ok: false, intent: "check-store", storeName, message: "Connect a token first." };
    }
    if (!storeName) {
      // Empty name clears the mapping: orders fall back to shop-domain mapping.
      await saveStoreName(session.shop, "");
      return { ok: true, intent: "check-store", storeName: "", storeExists: null, message: "Store name cleared. Orders map by shop domain." };
    }

    let storeExists = null;
    try {
      const result = await checkStore(token, storeName);
      storeExists = result.exists;
    } catch (error) {
      if (error instanceof PlatformError) {
        return { ok: false, intent: "check-store", storeName, message: `Could not check store: ${error.message}` };
      }
      throw error;
    }

    // Save step, and the store verifies (or can't be verified) — persist it.
    if (intent === "save-store" && storeExists !== false) {
      await saveStoreName(session.shop, storeName);
      const message = storeExists === true
        ? `Saved. Orders will sync to store "${storeName}".`
        : `Saved store name "${storeName}". (Could not verify it against Sellfern.)`;
      return { ok: true, intent: "save-store", storeName, storeExists, message };
    }

    // Check step, or a save blocked because the store doesn't exist.
    const message = storeExists === true
      ? `Store "${storeName}" exists in Sellfern. Click Save to use it.`
      : storeExists === false
        ? `"${storeName}" does not exist in Sellfern yet — create it under Settings → Stores first.`
        : `Store "${storeName}" could not be verified against Sellfern. Click Save to use it anyway.`;
    return { ok: true, intent: "check-store", storeName, storeExists, message };
  }

  // Default: connect a token.
  const token = String(formData.get("token") || "").trim();
  if (!token) {
    return { ok: false, message: "Paste a token first." };
  }

  // Fail here rather than silently dropping orders later.
  try {
    await verifyToken(token);
  } catch (error) {
    if (error instanceof PlatformError) {
      return { ok: false, message: `Platform rejected that token: ${error.message}` };
    }
    throw error;
  }

  await saveToken(session.shop, token);
  return { ok: true, message: "Connected." };
};

export default function Index() {
  const { connection, shop } = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  // React 18 stringifies props on custom elements, so disabled={false} renders
  // as disabled="false" — and to a web component any present attribute counts
  // as true, which leaves the button permanently unclickable. Only pass the
  // attribute when it should actually apply. (React 19 handles this itself.)
  const disabledWhenBusy = busy ? { disabled: true } : {};

  // Any store-section action result — kept out of the top-level banner and
  // shown inside the Sellfern store section instead.
  const STORE_INTENTS = [
    "check-store",
    "save-store",
    "edit-store",
    "remove-store",
    "cancel-store-edit",
  ];
  const storeResult = result && STORE_INTENTS.includes(result.intent) ? result : null;
  const backfillResult =
    result?.intent === "preview-range" || result?.intent === "sync-range" ? result : null;
  const previewResult = result?.intent === "preview-range" && result.ok ? result : null;

  // The two-step check/save flow only ever reports via these intents.
  const storeIntent =
    storeResult?.intent === "check-store" || storeResult?.intent === "save-store"
      ? storeResult
      : null;

  // Locked (read-only) once a name is saved, until the merchant clicks Edit.
  // A remove clears the saved name, so we drop straight back to the form.
  const editing =
    !connection.storeName ||
    storeResult?.intent === "edit-store" ||
    storeResult?.intent === "check-store";

  // Advance to the Save step once a non-empty name has verified (or the platform
  // can't verify it). A failed check keeps the button on "Check".
  const canSave = Boolean(
    storeIntent?.ok && storeIntent.storeName && storeIntent.storeExists !== false,
  );

  // Show the value that was just checked, falling back to the saved one.
  const storeFieldValue = storeIntent?.storeName ?? connection.storeName ?? "";

  const storeBannerTone = !storeResult?.ok
    ? "critical"
    : storeResult.storeExists === false
      ? "warning"
      : storeResult.storeExists === true
        ? "success"
        : "info";

  return (
    <s-page heading="OrderSync">
      <s-section heading="Platform connection">
        {/* Without this, a rejected token fails silently and looks like the
            form simply didn't do anything. Store-name results carry an `intent`
            and get their own banner in the Sellfern store section below. */}
        {result?.message && !storeResult && !backfillResult ? (
          <s-banner tone={result.ok ? "success" : "critical"}>
            {result.message}
          </s-banner>
        ) : null}
        {connection.connected ? (
          <>
            <s-banner tone="success">
              {shop} is connected — token ending in {connection.hint}. New orders
              are forwarded automatically.
            </s-banner>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <s-button type="submit" tone="critical" {...disabledWhenBusy}>
                Disconnect
              </s-button>
            </Form>
          </>
        ) : (
          <>
            <s-banner tone="warning">
              Not connected. Orders placed before you connect are not synced.
            </s-banner>
            <Form method="post">
              <s-text-field
                name="token"
                label="Integration token"
                details="Generate one on the platform, then paste it here."
              />
              <s-button type="submit" variant="primary" {...disabledWhenBusy}>
                {busy ? "Connecting…" : "Connect"}
              </s-button>
            </Form>
          </>
        )}
      </s-section>

      {connection.connected && (
        <s-section heading="Sellfern store">
          {editing ? (
            <>
              {storeResult?.message && (
                <s-banner tone={storeBannerTone}>{storeResult.message}</s-banner>
              )}
              <s-paragraph>
                Type the store name exactly as it appears in Sellfern under
                Settings → Stores. Synced orders are filed under this name. Leave
                it empty to let the platform map orders by shop domain instead.
              </s-paragraph>

              <Form method="post" key={storeFieldValue}>
                <input
                  type="hidden"
                  name="intent"
                  value={canSave ? "save-store" : "check-store"}
                />
                <s-text-field
                  name="storeName"
                  label="Store name"
                  defaultValue={storeFieldValue}
                  details={
                    connection.storeName
                      ? `Currently syncing to "${connection.storeName}".`
                      : "No store name set yet."
                  }
                />
                <s-button type="submit" variant="primary" {...disabledWhenBusy}>
                  {busy
                    ? canSave
                      ? "Saving…"
                      : "Checking…"
                    : canSave
                      ? "Save store"
                      : "Check store"}
                </s-button>
              </Form>

              {/* Only offer Cancel when there's a saved name to fall back to. */}
              {connection.storeName && (
                <Form method="post">
                  <input type="hidden" name="intent" value="cancel-store-edit" />
                  <s-button type="submit" variant="tertiary" {...disabledWhenBusy}>
                    Cancel
                  </s-button>
                </Form>
              )}
            </>
          ) : (
            <>
              <s-banner tone="success">
                Orders sync to store "{connection.storeName}". Edit or remove to
                change it.
              </s-banner>
              <s-stack direction="inline" gap="base">
                <Form method="post">
                  <input type="hidden" name="intent" value="edit-store" />
                  <s-button type="submit" {...disabledWhenBusy}>
                    Edit
                  </s-button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-store" />
                  <s-button type="submit" tone="critical" {...disabledWhenBusy}>
                    Remove
                  </s-button>
                </Form>
              </s-stack>
            </>
          )}
        </s-section>
      )}

      {connection.connected && (
        <s-section heading="Backfill orders">
          <s-paragraph>
            Resend orders Shopify already delivered in a date range — useful
            after connecting, or to recover a range that failed earlier.
            Ranges older than 60 days need the read_all_orders scope; without
            it Shopify silently omits those orders.
          </s-paragraph>
          {backfillResult?.message && (
            <s-banner tone={backfillResult.ok ? "success" : "critical"}>
              {backfillResult.message}
            </s-banner>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="preview-range" />
            <s-date-field
              label="From"
              name="dateFrom"
              defaultValue={previewResult?.dateFrom}
              required
            ></s-date-field>
            <s-date-field
              label="To"
              name="dateTo"
              defaultValue={previewResult?.dateTo}
              required
            ></s-date-field>
            <s-choice-list label="View" name="orderView" details="Same tabs as the Orders page.">
              {ORDER_VIEWS.map((view) => (
                <s-choice
                  key={view.key}
                  value={view.key}
                  selected={(previewResult?.orderView ?? "all") === view.key}
                >
                  {view.label}
                </s-choice>
              ))}
            </s-choice-list>
            <s-button type="submit" variant="primary" {...disabledWhenBusy}>
              {busy ? "Loading…" : "Preview"}
            </s-button>
          </Form>

          {previewResult && (
            <>
              <s-paragraph>{previewResult.preview.total} order(s) match this view.</s-paragraph>

              <s-unordered-list>
                {previewResult.preview.breakdown.map((row) => (
                  <s-list-item key={row.key}>
                    {row.label}: {row.count}
                  </s-list-item>
                ))}
              </s-unordered-list>

              {previewResult.preview.orders.length > 0 && (
                <s-table variant="auto">
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Order</s-table-header>
                    <s-table-header listSlot="labeled">Date</s-table-header>
                    <s-table-header listSlot="labeled">Status</s-table-header>
                    <s-table-header listSlot="labeled">Total</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {previewResult.preview.orders.map((order) => (
                      <s-table-row key={order.id}>
                        <s-table-cell>{order.name}</s-table-cell>
                        <s-table-cell>{order.createdAt}</s-table-cell>
                        <s-table-cell>{order.status}</s-table-cell>
                        <s-table-cell>
                          {order.total} {order.currency}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}

              {previewResult.preview.truncated && (
                <s-paragraph color="subdued">
                  Showing the first {previewResult.preview.orders.length} orders only —
                  narrow the date range to see the rest.
                </s-paragraph>
              )}

              {previewResult.preview.total > 0 && (
                <Form method="post">
                  <input type="hidden" name="intent" value="sync-range" />
                  <input type="hidden" name="dateFrom" value={previewResult.dateFrom} />
                  <input type="hidden" name="dateTo" value={previewResult.dateTo} />
                  <input type="hidden" name="orderView" value={previewResult.orderView} />
                  <s-button type="submit" variant="primary" {...disabledWhenBusy}>
                    {busy ? "Syncing…" : `Sync ${previewResult.preview.total} order(s)`}
                  </s-button>
                </Form>
              )}
            </>
          )}
        </s-section>
      )}

      <s-section heading="Privacy">
        <a href="/privacy" target="_blank" rel="noreferrer">
          View our privacy policy
        </a>
      </s-section>
    </s-page>
  );
}
