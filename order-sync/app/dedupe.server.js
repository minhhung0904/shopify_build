/**
 * Records which orders we already pushed, so a redelivered webhook doesn't
 * create a second record on the platform.
 */
import { getDb } from "./mongo.server";

const COLLECTION = "synced_orders";

async function getCollection() {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  // Unique on (shop, orderId) so a concurrent redelivery can't double-insert.
  await collection.createIndex({ shop: 1, orderId: 1 }, { unique: true });
  return collection;
}

export async function wasSynced(shop, orderId) {
  const collection = await getCollection();
  const found = await collection.findOne({ shop, orderId: String(orderId) });
  return Boolean(found);
}

/** Call only after the platform confirms the write, never before. */
export async function markSynced(shop, orderId) {
  const collection = await getCollection();
  try {
    await collection.insertOne({
      shop,
      orderId: String(orderId),
      syncedAt: new Date(),
    });
  } catch (error) {
    // 11000 = duplicate key: another delivery of the same webhook won the race.
    if (error?.code !== 11000) throw error;
  }
}

export async function forgetShop(shop) {
  const collection = await getCollection();
  await collection.deleteMany({ shop });
}
