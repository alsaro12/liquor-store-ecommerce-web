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
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function imageCount(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    const parsed = safeJson(value, null);
    return Array.isArray(parsed) ? parsed.length : (value.trim() ? 1 : 0);
  }
  return 0;
}

function hasImage(doc) {
  return imageCount(doc.imagenes || doc.images || doc.IMAGENES) > 0 || Boolean(doc.imageUrl || doc.imagen_url || doc.imageHash);
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
  const snap = await db.collection("products_v2").get();
  const products = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const csvRows = parseCsv("productos.csv");
  const csvByNumber = new Map(csvRows.map((row) => [String(row["N°"] || "").trim(), row]));
  const missingRecoverable = products
    .filter((product) => !hasImage(product))
    .filter((product) => imageCount(csvByNumber.get(String(product.numero || product.legacyId || ""))?.IMAGENES) > 0)
    .map((product) => ({
      id: product.id,
      numero: product.numero || product.legacyId || "",
      nombre: product.nombre || "",
      csvImages: imageCount(csvByNumber.get(String(product.numero || product.legacyId || ""))?.IMAGENES)
    }));

  console.log(JSON.stringify({
    firebaseTotal: products.length,
    firebaseWithImages: products.filter(hasImage).length,
    firebaseWithoutImages: products.filter((product) => !hasImage(product)).length,
    csvTotal: csvRows.length,
    csvWithImages: csvRows.filter((row) => imageCount(row.IMAGENES) > 0).length,
    missingRecoverableCount: missingRecoverable.length,
    missingRecoverable: missingRecoverable.slice(0, 30)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
