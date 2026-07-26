import { MongoClient } from "mongodb";

let clientPromise;

/** Shared connection — session storage, dedupe and credentials all live here. */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.DATABASE_URL).connect();
  }

  return clientPromise.then((client) =>
    client.db(process.env.MONGO_DB_NAME || "order-sync"),
  );
}
