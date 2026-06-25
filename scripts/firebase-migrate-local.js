#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATE_V2 = process.argv.includes("--v2");
const INCLUDE_IMAGES = !process.argv.includes("--skip-images");
const INCLUDE_LEGACY_SALES = process.argv.includes("--include-legacy-sales");
const BATCH_LIMIT = 20;

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

function productDocIdFromParts(nombre, legacyId) {
  const id = String(legacyId || "").trim();
  return `${slugify(nombre)}${id ? `-${id}` : ""}`;
}

function getRowField(row, candidates) {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined) return row[candidate];
  }
  const normalizedCandidates = new Set(candidates.map((candidate) => (
    String(candidate || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00C2/g, "")
      .toLowerCase()
  )));
  for (const [key, value] of Object.entries(row || {})) {
    const normalizedKey = String(key || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00C2/g, "")
      .toLowerCase();
    if (normalizedCandidates.has(normalizedKey)) return value;
  }
  return "";
}

function saleDocIdFromRow(row, index) {
  const raw = String(getRowField(row, ["ID_VENTA", "id", "legacyId"]) || "").trim();
  return raw ? `venta-${slugify(raw)}` : `venta-${String(index + 1).padStart(6, "0")}`;
}

function customerDocIdFromCustomer(customer) {
  const dni = String(customer?.dni || "").trim();
  const phone = String(customer?.telefono || "").trim();
  const legacy = String(customer?.id || "").trim();
  if (dni) return `customer-${slugify(dni)}`;
  if (phone) return `customer-phone-${slugify(phone)}`;
  return `customer-${legacy || crypto.randomUUID()}`;
}

function comboDocIdFromCombo(combo) {
  return String(combo?.slug || "").trim() || `${slugify(combo?.title || combo?.name || "combo")}-${combo?.id || crypto.randomUUID()}`;
}

function collectionName(base) {
  return MIGRATE_V2 ? `${base}_v2` : base;
}

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requireAdmin() {
  try {
    return require("firebase-admin");
  } catch (error) {
    throw new Error("Falta firebase-admin. Ejecuta: npm install");
  }
}

function readJsonSafe(relativePath, fallback) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function csvRows(raw) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  return csvRows(`${line}\n`)[0] || [];
}

async function forEachCsvObject(relativePath, onRow) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return 0;
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let count = 0;
  for await (const line of reader) {
    if (!headers) {
      headers = parseCsvLine(line).map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
      continue;
    }
    if (!String(line || "").trim()) continue;
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    await onRow(row, count);
    count += 1;
  }
  return count;
}

function parseCsvObjects(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return [];
  const rows = csvRows(fs.readFileSync(filePath, "utf8"));
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseJsonField(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) next[key] = cleanUndefined(entry);
  }
  return next;
}

function dataUrlToBuffer(source) {
  const match = String(source || "").match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[2] || "";
  try {
    return { mime, buffer: Buffer.from(payload, "base64") };
  } catch (_) {
    return null;
  }
}

function imageSourceFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  return record.thumb_webp_url || record.original_webp_url || record.url || record.src || record.source || "";
}

async function uploadImage(bucket, productId, imageRecord, index) {
  const source = imageSourceFromRecord(imageRecord);
  if (!source || !source.startsWith("data:")) {
    return source ? { source, storagePath: "", downloadUrl: source } : null;
  }
  const parsed = dataUrlToBuffer(source);
  if (!parsed || !parsed.buffer.length) return null;
  const extension = parsed.mime.includes("png") ? "png" : parsed.mime.includes("jpeg") ? "jpg" : "webp";
  const hash = crypto.createHash("sha256").update(parsed.buffer).digest("hex");
  const storagePath = `public/products/${productId}/${String(index + 1).padStart(2, "0")}-${hash}.${extension}`;
  const token = crypto.randomUUID();
  if (!DRY_RUN) {
    const file = bucket.file(storagePath);
    await file.save(parsed.buffer, {
      contentType: parsed.mime,
      resumable: false,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: { firebaseStorageDownloadTokens: token }
      }
    });
  }
  const bucketName = bucket.name;
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  return {
    storagePath,
    downloadUrl,
    mime: parsed.mime,
    hash
  };
}

async function uploadDataUrl(bucket, storagePath, source) {
  const parsed = dataUrlToBuffer(source);
  if (!bucket || !parsed || !parsed.buffer.length) return "";
  const token = crypto.randomUUID();
  if (!DRY_RUN) {
    const file = bucket.file(storagePath);
    await file.save(parsed.buffer, {
      contentType: parsed.mime,
      resumable: false,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: { firebaseStorageDownloadTokens: token }
      }
    });
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function sanitizeFirebasePayload(value, bucket, basePath, counter = { value: 0 }) {
  if (typeof value === "string") {
    if (!value.startsWith("data:")) return value;
    const parsed = dataUrlToBuffer(value);
    if (!parsed) return "";
    const hash = crypto.createHash("sha256").update(parsed.buffer).digest("hex");
    const extension = parsed.mime.includes("png") ? "png" : parsed.mime.includes("jpeg") ? "jpg" : "webp";
    const storagePath = `${basePath}/${String(counter.value + 1).padStart(2, "0")}-${hash}.${extension}`;
    counter.value += 1;
    return uploadDataUrl(bucket, storagePath, value);
  }
  if (Array.isArray(value)) {
    const next = [];
    for (const entry of value) {
      next.push(await sanitizeFirebasePayload(entry, bucket, basePath, counter));
    }
    return next;
  }
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = await sanitizeFirebasePayload(entry, bucket, basePath, counter);
  }
  return next;
}

async function buildProduct(row, bucket, productIdMap = null) {
  const id = String(row["N°"] || row.id || "").trim();
  const docId = MIGRATE_V2 ? productDocIdFromParts(row.NOMBRE, id) : id;
  const rawImages = DRY_RUN ? [] : parseJsonField(row.IMAGENES, []);
  const uploadedImages = [];
  if (INCLUDE_IMAGES && bucket && Array.isArray(rawImages)) {
    for (let index = 0; index < rawImages.length; index += 1) {
      const uploaded = await uploadImage(bucket, docId || id || "sin-id", rawImages[index], index);
      if (uploaded) uploadedImages.push(uploaded);
    }
  }
  const fallbackImages = Array.isArray(rawImages)
    ? rawImages.map((item) => {
        const source = imageSourceFromRecord(item);
        return source && !source.startsWith("data:") ? { downloadUrl: source, storagePath: "" } : null;
      }).filter(Boolean)
    : [];
  const variants = await sanitizeFirebasePayload(
    parseJsonField(row.VARIANTES, []),
    bucket,
    `public/products/${docId || id || "sin-id"}/variants`
  );
  if (productIdMap && id) productIdMap.set(id, docId);

  return cleanUndefined({
    id: MIGRATE_V2 ? docId : id,
    legacyId: id,
    numero: toNumber(id, 0),
    slug: docId,
    nombre: String(row.NOMBRE || "").trim(),
    descripcion: String(row.DESCRIPCION || "").trim(),
    categoria: String(row.CATEGORIA || "").trim(),
    precio: toNumber(row.PRECIO),
    precioCompra: toNumber(row.PRECIO_COMPRA),
    variantes: variants,
    stockMaximo: toNumber(row.STOCK_MAXIMO),
    stockMinimo: toNumber(row.STOCK_MINIMO),
    stockActual: toNumber(row.STOCK_ACTUAL),
    estado: String(row.ESTADO || "ACTIVO").trim() || "ACTIVO",
    imagenes: uploadedImages.length ? uploadedImages : fallbackImages,
    migratedAt: new Date().toISOString()
  });
}

async function migrateProducts(db, bucket) {
  const productIdMap = new Map();
  const targetCollection = collectionName("products");
  if (typeof db.ref === "function") {
    const updates = {};
    let written = 0;
    await forEachCsvObject("productos.csv", async (row) => {
      const product = await buildProduct(row, bucket, productIdMap);
      if (!product.id) return;
      updates[`${targetCollection}/${product.id}`] = product;
      written += 1;
      if (written % 25 === 0) {
        process.stdout.write(`Productos preparados: ${written}\r`);
      }
    });
    if (!DRY_RUN && Object.keys(updates).length) {
      await db.ref().update(updates);
    }
    process.stdout.write("\n");
    return { written, productIdMap };
  }

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  await forEachCsvObject("productos.csv", async (row) => {
    const product = await buildProduct(row, bucket, productIdMap);
    if (!product.id) return;
    batch.set(db.collection(targetCollection).doc(product.id), product, { merge: true });
    pending += 1;
    written += 1;
    if (pending >= BATCH_LIMIT) {
      if (!DRY_RUN) await batch.commit();
      batch = db.batch();
      pending = 0;
    }
    if (written % 25 === 0) {
      process.stdout.write(`Productos preparados: ${written}\r`);
    }
  });
  if (pending && !DRY_RUN) await batch.commit();
  process.stdout.write("\n");
  return { written, productIdMap };
}

async function commitCollection(db, collectionName, items, idResolver) {
  if (typeof db.ref === "function") {
    const updates = {};
    let written = 0;
    for (const item of items) {
      const id = String(idResolver(item) || "").trim();
      if (!id) continue;
      updates[`${collectionName}/${id}`] = cleanUndefined(item);
      written += 1;
    }
    if (!DRY_RUN && Object.keys(updates).length) {
      await db.ref().update(updates);
    }
    return written;
  }

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const item of items) {
    const id = String(idResolver(item) || "").trim();
    if (!id) continue;
    const ref = db.collection(collectionName).doc(id);
    batch.set(ref, cleanUndefined(item), { merge: true });
    pending += 1;
    written += 1;
    if (pending >= BATCH_LIMIT) {
      if (!DRY_RUN) await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending && !DRY_RUN) await batch.commit();
  return written;
}

function stripCustomerRuntime(customer) {
  const { sessions, ...rest } = customer;
  return {
    ...rest,
    id: MIGRATE_V2 ? customerDocIdFromCustomer(customer) : customer.id,
    legacyId: customer.id,
    migratedAt: new Date().toISOString()
  };
}

function connectOrder(order, productIdMap, comboIdMap) {
  const id = String(order?.id || "").trim();
  return cleanUndefined({
    ...order,
    id,
    legacyId: id,
    items: Array.isArray(order?.items)
      ? order.items.map((item) => {
          const productLegacyId = String(item?.productId || item?.id || "").trim();
          const comboLegacyId = String(item?.comboId || "").trim();
          return {
            ...item,
            productLegacyId: productLegacyId || "",
            productDocId: productLegacyId ? (productIdMap.get(productLegacyId) || "") : "",
            comboDocId: comboLegacyId ? (comboIdMap.get(comboLegacyId) || "") : ""
          };
        })
      : [],
    migratedAt: new Date().toISOString()
  });
}

function connectCombo(combo, productIdMap) {
  const docId = MIGRATE_V2 ? comboDocIdFromCombo(combo) : String(combo?.id || combo?.slug || "").trim();
  const productEntries = Array.isArray(combo?.items)
    ? combo.items
    : Array.isArray(combo?.products)
      ? combo.products
      : Array.isArray(combo?.productos)
        ? combo.productos
        : [];
  return cleanUndefined({
    ...combo,
    id: docId,
    legacyId: combo?.id || "",
    slug: docId,
    items: productEntries.map((item) => {
      const productLegacyId = String(item?.productId || item?.id || item?.productoId || "").trim();
      return {
        ...item,
        productLegacyId: productLegacyId || "",
        productDocId: productLegacyId ? (productIdMap.get(productLegacyId) || "") : ""
      };
    }),
    migratedAt: new Date().toISOString()
  });
}

function connectSale(row, index, productIdMap) {
  const productLegacyId = String(getRowField(row, ["N\u00B0", "N\u00C2\u00B0", "numero", "productId"]) || "").trim();
  const legacyId = String(getRowField(row, ["ID_VENTA", "id", "legacyId"]) || "").trim();
  return cleanUndefined({
    ...row,
    id: MIGRATE_V2 ? saleDocIdFromRow(row, index) : (row.id || `sale-${String(index + 1).padStart(6, "0")}`),
    legacyId,
    productLegacyId,
    productDocId: productLegacyId ? (productIdMap.get(productLegacyId) || "") : "",
    migratedAt: new Date().toISOString(),
    sourceIndex: index
  });
}

async function main() {
  loadEnvFile();
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  const databaseURL = process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL;
  const databaseEngine = String(process.env.FIREBASE_DATABASE_ENGINE || (databaseURL ? "realtime" : "firestore")).trim().toLowerCase();
  const firestoreDatabaseId = String(process.env.FIRESTORE_DATABASE_ID || "").trim();
  if (!projectId) throw new Error("Falta FIREBASE_PROJECT_ID o VITE_FIREBASE_PROJECT_ID en .env.");
  if (databaseEngine === "realtime" && !databaseURL) {
    throw new Error("Falta FIREBASE_DATABASE_URL o VITE_FIREBASE_DATABASE_URL para migrar a Realtime Database.");
  }

  const admin = requireAdmin();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
      storageBucket,
      databaseURL
    });
  }
  let db = null;
  if (databaseEngine === "realtime") {
    db = admin.database();
  } else if (firestoreDatabaseId) {
    const { getFirestore } = require("firebase-admin/firestore");
    db = getFirestore(admin.app(), firestoreDatabaseId);
  } else {
    db = admin.firestore();
  }
  const bucket = storageBucket ? admin.storage().bucket(storageBucket) : null;

  const customersStore = readJsonSafe("local-db/customers.json", { customers: [] });
  const orders = readJsonSafe("local-db/orders.json", []);
  const combos = readJsonSafe("local-db/combos.json", []);
  const notifications = readJsonSafe("local-db/notificaciones.json", []);
  const deliveryConfig = readJsonSafe("local-db/store-delivery-config.json", null);
  const sales = parseCsvObjects("ventas_diarias.csv");
  const kardex = parseCsvObjects("kardex.csv");
  const productsResult = await migrateProducts(db, bucket);
  const productIdMap = productsResult.productIdMap;
  const connectedCombos = Array.isArray(combos) ? combos.map((combo) => connectCombo(combo, productIdMap)) : [];
  const comboIdMap = new Map(connectedCombos.map((combo, index) => [
    String(Array.isArray(combos) ? (combos[index]?.id || combos[index]?.slug || "") : "").trim(),
    combo.id
  ]));

  const summary = {
    products: productsResult.written,
    customers: await commitCollection(db, collectionName("customers"), customersStore.customers.map(stripCustomerRuntime), (item) => item.id),
    orders: await commitCollection(db, collectionName("orders"), Array.isArray(orders) ? orders.map((order) => connectOrder(order, productIdMap, comboIdMap)) : [], (item) => item.id),
    combos: await commitCollection(db, collectionName("combos"), connectedCombos, (item) => item.id || item.slug),
    notifications: await commitCollection(db, collectionName("notifications"), Array.isArray(notifications) ? notifications : [], (item) => item.id),
    sales: MIGRATE_V2 && !INCLUDE_LEGACY_SALES
      ? 0
      : await commitCollection(db, collectionName("sales"), sales.map((item, index) => connectSale(item, index, productIdMap)), (item) => item.id),
    kardex: await commitCollection(db, collectionName("kardex"), kardex.map((item, index) => ({ ...item, migratedAt: new Date().toISOString(), sourceIndex: index })), (item) => item.id_mov || item.ID || `kardex-${String(item.sourceIndex + 1).padStart(6, "0")}`)
  };

  if (deliveryConfig) {
    if (!DRY_RUN) {
      const configPayload = cleanUndefined({
        ...deliveryConfig,
        migratedAt: new Date().toISOString()
      });
      if (typeof db.ref === "function") {
        await db.ref(`${collectionName("settings")}/storeDeliveryConfig`).set(configPayload);
      } else {
        await db.collection(collectionName("settings")).doc("storeDeliveryConfig").set(configPayload, { merge: true });
      }
    }
    summary.deliveryConfig = 1;
  }

  console.log(JSON.stringify({
    mode: DRY_RUN ? "dry-run" : "write",
    version: MIGRATE_V2 ? "v2" : "legacy",
    images: INCLUDE_IMAGES ? "enabled" : "skipped",
    databaseEngine,
    firestoreDatabaseId,
    projectId,
    storageBucket: storageBucket || "",
    summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
