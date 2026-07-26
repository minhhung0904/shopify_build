import { getDb } from "../mongo.server";

export const loader = async () => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const collections = await db.listCollections().toArray();
    return Response.json({
      ok: true,
      db: db.databaseName,
      collections: collections.map((c) => c.name),
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
};
