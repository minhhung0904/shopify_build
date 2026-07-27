import { getDb } from "../mongo.server";

/** Reports whether ENCRYPTION_KEY is usable, without revealing it. */
function encryptionKeyStatus() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return "missing";

  const bytes = Buffer.from(raw, "base64").length;
  return bytes === 32 ? "ok" : `wrong size (${bytes} bytes, need 32)`;
}

export const loader = async () => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const collections = await db.listCollections().toArray();

    return Response.json({
      ok: true,
      db: db.databaseName,
      collections: collections.map((c) => c.name),
      storedCredentials: await db.collection("platform_credentials").countDocuments(),
      env: {
        encryptionKey: encryptionKeyStatus(),
        platformApiUrl: process.env.PLATFORM_API_URL ? "set" : "missing",
        platformVerifyPath: process.env.PLATFORM_VERIFY_PATH || "(empty)",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
};
