const fs = require("fs");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

function loadEnv() {
  if (!fs.existsSync(".env")) return;
  const raw = fs.readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function hasImage(doc) {
  return Array.isArray(doc.imagenes) && doc.imagenes.some((image) => image?.thumb_webp_url || image?.downloadUrl || image?.original_webp_url);
}

async function main() {
  loadEnv();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || "la-licoreria",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
    });
  }
  const db = getFirestore(admin.app(), process.env.FIRESTORE_DATABASE_ID || "lalicoreria");
  const snap = await db.collection("products_v2").select("numero", "nombre", "imagenes").get();
  const docs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const withImages = docs.filter(hasImage);
  console.log(JSON.stringify({
    total: docs.length,
    withImages: withImages.length,
    withoutImages: docs.length - withImages.length,
    samples: withImages.slice(0, 8).map((product) => ({
      id: product.id,
      numero: product.numero,
      nombre: product.nombre,
      imageUrl: product.imagenes?.[0]?.thumb_webp_url || product.imagenes?.[0]?.downloadUrl || ""
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
