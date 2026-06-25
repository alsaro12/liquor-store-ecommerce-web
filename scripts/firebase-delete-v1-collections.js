const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const V1_COLLECTIONS = [
  "products",
  "customers",
  "orders",
  "combos",
  "notifications",
  "sales",
  "kardex",
  "settings"
];

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function assertSafeCollectionName(collectionName) {
  if (!V1_COLLECTIONS.includes(collectionName)) {
    throw new Error(`Colección no permitida para borrado v1: ${collectionName}`);
  }
  if (collectionName.endsWith("_v2")) {
    throw new Error(`Protección activa: no se puede borrar una colección v2 (${collectionName}).`);
  }
}

async function deleteCollection(db, collectionName, { execute }) {
  assertSafeCollectionName(collectionName);
  const ref = db.collection(collectionName);
  const countSnap = await ref.count().get();
  const total = countSnap.data().count || 0;
  if (!execute) return { collectionName, total, deleted: 0 };

  let deleted = 0;
  while (true) {
    const snap = await ref.limit(450).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      deleted += 1;
    }
    await batch.commit();
  }
  return { collectionName, total, deleted };
}

async function main() {
  loadEnv();
  const execute = process.argv.includes("--execute");
  const admin = require("firebase-admin");
  const { getFirestore } = require("firebase-admin/firestore");

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "lalicoreria";
  if (!projectId) throw new Error("Falta FIREBASE_PROJECT_ID en .env.");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId
    });
  }

  const db = getFirestore(admin.app(), databaseId);
  const results = [];
  for (const collectionName of V1_COLLECTIONS) {
    results.push(await deleteCollection(db, collectionName, { execute }));
  }

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    projectId,
    databaseId,
    protectedCollections: V1_COLLECTIONS.map((name) => `${name}_v2`),
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
