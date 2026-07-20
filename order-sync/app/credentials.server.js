/**
 * Per-shop platform tokens.
 *
 * Each merchant pastes their own integration token on the settings page, so a
 * token is scoped to one shop and is stored encrypted.
 */
import { getDb } from "./mongo.server";
import { decrypt, encrypt } from "./crypto.server";

const COLLECTION = "platform_credentials";

async function getCollection() {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ shop: 1 }, { unique: true });
  return collection;
}

/** Returns the decrypted token, or null when the shop hasn't connected yet. */
export async function getToken(shop) {
  const collection = await getCollection();
  const record = await collection.findOne({ shop });
  if (!record?.token) return null;

  try {
    return decrypt(record.token);
  } catch (error) {
    // Wrong/rotated ENCRYPTION_KEY, or a corrupted record. Treat as not
    // connected rather than crashing the webhook.
    console.error(`Could not decrypt token for ${shop}: ${error.message}`);
    return null;
  }
}

/** Safe for the UI: says whether a token exists and shows only its last 4 chars. */
export async function getConnection(shop) {
  const collection = await getCollection();
  const record = await collection.findOne({ shop });
  if (!record) return { connected: false };

  return {
    connected: true,
    hint: record.hint ?? null,
    connectedAt: record.connectedAt ?? null,
  };
}

export async function saveToken(shop, token) {
  const collection = await getCollection();
  await collection.updateOne(
    { shop },
    {
      $set: {
        token: encrypt(token),
        // Enough for a merchant to tell which token this is, useless to a thief.
        hint: token.slice(-4),
        connectedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function deleteToken(shop) {
  const collection = await getCollection();
  await collection.deleteOne({ shop });
}
