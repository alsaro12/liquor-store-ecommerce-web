const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.join(ROOT, "productos.csv");
const EXECUTE = process.argv.includes("--execute");
const FORCE = process.argv.includes("--force");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(0, Number.parseInt(LIMIT_ARG.split("=")[1], 10) || 0) : 0;

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
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

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  if (!buffer.length) return null;
  return { mime, buffer };
}

function extensionFromMime(mime) {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "bin";
}

function firstImageSource(image) {
  if (typeof image === "string") return image;
  if (!image || typeof image !== "object") return "";
  return image.thumb_webp_url
    || image.original_webp_url
    || image.filtered_image_url
    || image.original_image_url
    || image.downloadUrl
    || image.download_url
    || image.url
    || image.src
    || "";
}

function hasFirestoreImages(product) {
  return Array.isArray(product?.imagenes) && product.imagenes.length > 0;
}

async function uploadDataUrl(bucket, productDocId, productNumber, image, index) {
  const source = firstImageSource(image);
  const parsed = parseDataUrl(source);
  if (!parsed) {
    if (/^https?:\/\//i.test(source)) {
      return {
        storagePath: "",
        downloadUrl: source,
        original_webp_url: source,
        thumb_webp_url: source,
        mime: "",
        size: 0
      };
    }
    return null;
  }
  const hash = crypto.createHash("sha256").update(parsed.buffer).digest("hex");
  const extension = extensionFromMime(parsed.mime);
  const storagePath = `public/products/${productDocId || productNumber}/${String(index + 1).padStart(2, "0")}-${hash}.${extension}`;
  const token = crypto.randomUUID();
  const file = bucket.file(storagePath);
  await file.save(parsed.buffer, {
    resumable: false,
    contentType: parsed.mime,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  return {
    storagePath,
    downloadUrl,
    original_webp_url: downloadUrl,
    thumb_webp_url: downloadUrl,
    filtered_image_url: downloadUrl,
    original_image_url: downloadUrl,
    mime: parsed.mime,
    size: parsed.buffer.length,
    hash
  };
}

async function main() {
  loadEnv();
  const projectId = process.env.FIREBASE_PROJECT_ID || "la-licoreria";
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "lalicoreria";
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  if (!storageBucket) throw new Error("Falta FIREBASE_STORAGE_BUCKET en .env.");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
      storageBucket
    });
  }
  const db = getFirestore(admin.app(), databaseId);
  const bucket = admin.storage().bucket(storageBucket);

  const rows = parseCsv(CSV_PATH);
  const snap = await db.collection("products_v2").get();
  const products = snap.docs.map((doc) => ({ ref: doc.ref, id: doc.id, ...doc.data() }));
  const productsByNumber = new Map(products.map((product) => [String(product.numero || product.legacyId || "").trim(), product]));

  const candidates = [];
  for (const row of rows) {
    const productNumber = String(row["N°"] || "").trim();
    const product = productsByNumber.get(productNumber);
    if (!product) continue;
    if (!FORCE && hasFirestoreImages(product)) continue;
    const csvImages = safeJson(row.IMAGENES || "[]", []);
    if (!Array.isArray(csvImages) || !csvImages.length) continue;
    candidates.push({ row, product, csvImages: csvImages.slice(0, 3) });
  }
  const selected = LIMIT ? candidates.slice(0, LIMIT) : candidates;

  const summary = {
    mode: EXECUTE ? "execute" : "dry-run",
    projectId,
    databaseId,
    storageBucket,
    candidates: candidates.length,
    selected: selected.length,
    updated: 0,
    uploadedImages: 0,
    skipped: 0,
    samples: selected.slice(0, 12).map(({ row, product, csvImages }) => ({
      id: product.id,
      numero: row["N°"],
      nombre: product.nombre || row.NOMBRE,
      csvImages: csvImages.length
    }))
  };

  if (!EXECUTE) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const { row, product, csvImages } of selected) {
    const uploaded = [];
    for (let index = 0; index < csvImages.length; index += 1) {
      const image = await uploadDataUrl(bucket, product.id, row["N°"], csvImages[index], index);
      if (image) uploaded.push(image);
    }
    if (!uploaded.length) {
      summary.skipped += 1;
      continue;
    }
    await product.ref.set({
      imagenes: uploaded,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    summary.updated += 1;
    summary.uploadedImages += uploaded.length;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
