import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { verifyToken, PlatformError } from "../platform.server";
import { deleteToken, getConnection, saveToken } from "../credentials.server";

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

  if (formData.get("intent") === "disconnect") {
    await deleteToken(session.shop);
    return { ok: true, message: "Disconnected." };
  }

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
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

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
    </s-page>
  );
}
