import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { checkStore, verifyToken, PlatformError } from "../platform.server";
import {
  deleteToken,
  getConnection,
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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disconnect") {
    await deleteToken(session.shop);
    return { ok: true, message: "Disconnected." };
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
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const storeIntent =
    actionData?.intent === "check-store" || actionData?.intent === "save-store"
      ? actionData
      : null;

  // Advance to the Save step once a non-empty name has verified (or the platform
  // can't verify it). A failed check keeps the button on "Check".
  const canSave = Boolean(
    storeIntent?.ok && storeIntent.storeName && storeIntent.storeExists !== false,
  );

  // Show the value that was just checked, falling back to the saved one.
  const storeFieldValue = storeIntent?.storeName ?? connection.storeName ?? "";

  return (
    <s-page heading="OrderSync">
      <s-section heading="Platform connection">
        {connection.connected ? (
          <>
            <s-banner tone="success">
              {shop} is connected — token ending in {connection.hint}. New orders
              are forwarded automatically.
            </s-banner>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <s-button type="submit" tone="critical" disabled={busy}>
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
              <s-button type="submit" variant="primary" disabled={busy}>
                {busy ? "Connecting…" : "Connect"}
              </s-button>
            </Form>
          </>
        )}
      </s-section>

      {connection.connected && (
        <s-section heading="Sellfern store">
          <s-paragraph>
            Type the store name exactly as it appears in Sellfern under Settings
            → Stores. Synced orders are filed under this name. Leave it empty to
            let the platform map orders by shop domain instead.
          </s-paragraph>

          {storeIntent && (
            <s-banner
              tone={
                storeIntent.ok
                  ? storeIntent.storeExists === false
                    ? "warning"
                    : storeIntent.storeExists === true
                      ? "success"
                      : "info"
                  : "critical"
              }
            >
              {storeIntent.message}
            </s-banner>
          )}

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
            <s-button type="submit" variant="primary" disabled={busy}>
              {busy
                ? canSave
                  ? "Saving…"
                  : "Checking…"
                : canSave
                  ? "Save store"
                  : "Check store"}
            </s-button>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}
