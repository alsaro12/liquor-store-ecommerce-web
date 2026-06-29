const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");

const {
  nowIso,
  trimValue,
  toNumber,
  toInt,
  round2,
  safeStringify
} = require("../custom-functions");
const { createAiObjectServer } = require("../objects/ai/server");
const { createAuthObjectServer } = require("../objects/auth/server");
const { createDbObjectServer } = require("../objects/db/server");
const { createCombosObjectServer } = require("../objects/combos/server");
const { createCouponsObjectServer } = require("../objects/coupons/server");
const { createCuentaObjectServer } = require("../objects/cuenta/server");
const { createDireccionesObjectServer } = require("../objects/direcciones/server");
const { createFavoritosObjectServer } = require("../objects/favoritos/server");
const { createMetodosPagoObjectServer } = require("../objects/metodos-pago/server");
const { createNotificacionesObjectServer } = require("../objects/notificaciones/server");
const { createPromosObjectServer } = require("../objects/promos/server");
const { createReferidosObjectServer } = require("../objects/referidos/server");
const { createOrdersObjectServer } = require("../objects/orders/server");
const { createProductosObjectServer } = require("../objects/productos/server");
const { createVentasObjectServer } = require("../objects/ventas/server");
const { createKardexObjectServer } = require("../objects/kardex/server");
const csvDb = require("../../productos_db");

const PROJECT_DIR = path.resolve(__dirname, "../..");
const ENV_FILE_PATH = path.join(PROJECT_DIR, ".env");

function loadDotEnvToProcess() {
  try {
    const raw = fsSync.readFileSync(ENV_FILE_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional in hosted environments.
  }
}

loadDotEnvToProcess();

const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const ROOT_DIR = PROJECT_DIR;
const STATIC_ROOT = PROJECT_DIR;
const DIST_ROOT = path.join(PROJECT_DIR, "dist");
const PRODUCT_IMAGE_UPLOAD_DIR = path.join(PROJECT_DIR, "uploads", "product-images");
const ORDERS_DB_PATH = path.join(PROJECT_DIR, "local-db", "orders.json");
const NOTIFICATIONS_DB_PATH = path.join(PROJECT_DIR, "local-db", "notificaciones.json");
const COMBOS_DB_PATH = path.join(PROJECT_DIR, "local-db", "combos.json");
const CUSTOMERS_DB_PATH = path.join(PROJECT_DIR, "local-db", "customers.json");
const STORE_DELIVERY_CONFIG_PATH = path.join(PROJECT_DIR, "local-db", "store-delivery-config.json");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const LAST_SESSION_LOG_PATH = path.join(LOG_DIR, "last_session.log");
const RUNTIME_VERSION = "licoreria-runtime-2026-05-28-csv-lock-v2";
const STOREFRONT_PRODUCTS_CACHE_TTL_MS = 60 * 1000;
const MYSQL_FALLBACK_COOLDOWN_MS = 20 * 1000;
const MYSQL_FALLBACK_TIMEOUT_MS = Number.parseInt(process.env.DB_FALLBACK_TIMEOUT_MS || "3500", 10) || 3500;
const mysqlPools = new Map();
let storefrontProductsCache = { items: null, savedAt: 0 };
let csvProductImageCache = { map: null, savedAt: 0 };
let mysqlFallbackUntil = 0;
let mysqlFallbackMessage = "";
let localProductsCache = { items: null, mtimeMs: 0, promise: null };
let localProductsLightCache = { items: null, mtimeMs: 0, promise: null };

let firebaseAdminApp = null;
let firebaseDb = null;

function isFirebaseBackendEnabled() {
  const raw = trimValue(process.env.FIREBASE_BACKEND_ENABLED || "true").toLowerCase();
  return !["0", "false", "no", "off"].includes(raw)
    && trimValue(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID)
    && trimValue(process.env.FIRESTORE_DATABASE_ID || "lalicoreria");
}

function cleanForFirestore(value) {
  if (Array.isArray(value)) return value.map(cleanForFirestore);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) next[key] = cleanForFirestore(entry);
  }
  return next;
}

function getFirebaseDb() {
  if (!isFirebaseBackendEnabled()) return null;
  if (firebaseDb) return firebaseDb;
  let admin = null;
  let getFirestore = null;
  try {
    admin = require("firebase-admin");
    ({ getFirestore } = require("firebase-admin/firestore"));
  } catch (_) {
    return null;
  }
  const projectId = trimValue(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID);
  const storageBucket = trimValue(process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET);
  if (!firebaseAdminApp) {
    firebaseAdminApp = admin.apps?.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId,
          storageBucket: storageBucket || undefined
        });
  }
  firebaseDb = getFirestore(firebaseAdminApp, trimValue(process.env.FIRESTORE_DATABASE_ID || "lalicoreria"));
  return firebaseDb;
}

function firebaseCollectionName(base) {
  return `${base}_v2`;
}

async function readFirebaseCollection(base) {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await db.collection(firebaseCollectionName(base)).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function writeFirebaseCollection(base, items) {
  const db = getFirebaseDb();
  if (!db) return false;
  const collection = db.collection(firebaseCollectionName(base));
  let batch = db.batch();
  let pending = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const id = trimValue(item?.id || item?.slug || "");
    if (!id) continue;
    batch.set(collection.doc(id), cleanForFirestore(item), { merge: true });
    pending += 1;
    if (pending >= 100) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return true;
}

async function writeFirebaseDoc(base, id, payload) {
  const db = getFirebaseDb();
  const safeId = trimValue(id || "");
  if (!db || !safeId) return false;
  await db.collection(firebaseCollectionName(base)).doc(safeId).set(cleanForFirestore(payload), { merge: true });
  return true;
}

async function deleteFirebaseDoc(base, id) {
  const db = getFirebaseDb();
  const safeId = trimValue(id || "");
  if (!db || !safeId) return false;
  await db.collection(firebaseCollectionName(base)).doc(safeId).delete();
  return true;
}

async function getFirebaseDoc(base, id) {
  const db = getFirebaseDb();
  const safeId = trimValue(id || "");
  if (!db || !safeId) return null;
  const snap = await db.collection(firebaseCollectionName(base)).doc(safeId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

function getAllowedOrigins() {
  const configured = [
    process.env.ALLOWED_ORIGINS,
    process.env.PUBLIC_SITE_URL,
    process.env.VITE_PUBLIC_SITE_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    ...configured,
    "http://localhost:3005",
    "http://127.0.0.1:3005",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);
}

function getCorsOrigin(req) {
  const origin = String(req?.headers?.origin || "").trim();
  if (!origin) return "";
  return getAllowedOrigins().has(origin) ? origin : "";
}

const DEFAULT_DELIVERY_RANGES = [
  { fromKm: 0, toKm: 1, price: 10 },
  { fromKm: 1, toKm: 3, price: 15 },
  { fromKm: 3, toKm: 6, price: 20 },
  { fromKm: 6, toKm: 10, price: 25 },
  { fromKm: 10, toKm: 15, price: 35 }
];
const AREQUIPA_COVERAGE_BOUNDS = {
  minLat: -16.55,
  maxLat: -16.25,
  minLng: -71.75,
  maxLng: -71.35
};
const ORDER_SERVICE_FEE_RATE = 0;

function roundFeeFavorCustomer(value) {
  const amount = Math.max(0, Number(value) || 0);
  return round2(Math.floor(amount * 2) / 2);
}

function calculateOrderSubtotal(items = []) {
  return round2((Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + round2(item?.price) * Math.max(1, toInt(item?.quantity, 1))
  ), 0));
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
};

const DB_ENV_KEYS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_CHARSET"];
const DB_STATUS_ENV_KEYS = [
  "DB_STATUS_HOST",
  "DB_STATUS_PORT",
  "DB_STATUS_NAME",
  "DB_STATUS_USER",
  "DB_STATUS_PASSWORD",
  "DB_STATUS_CHARSET"
];
const PAYMENT_TYPES = ["Efectivo", "Yape", "Pedido Ya", "Rappi", "IZIPAY"];
const PRODUCT_STATUSES = ["ACTIVO", "INACTIVO"];
const CIGARETTE_BOX_UNITS = 20;
const CIGARETTE_AUTO_OPEN_REFERENCE = "APERTURA_CAJA_AUTOMATICA";
const CIGARETTE_AUTO_OPEN_REVERT_REFERENCE = "REVERSA_APERTURA_CAJA";
const REAL_KARDEX_INGRESS_REFERENCES = new Set(["INGRESO_MANUAL", "INGRESO_RECIBO_UI"]);
const TECHNICAL_KARDEX_INGRESS_REFERENCES = new Set([
  "VENTA_EDITADA",
  "VENTA_ANULADA",
  CIGARETTE_AUTO_OPEN_REFERENCE,
  CIGARETTE_AUTO_OPEN_REVERT_REFERENCE
]);
const CIGARETTE_AUTO_OPEN_RULES = [
  { key: "golden", aliases: ["golden"] },
  { key: "lucky", aliases: ["lucky"] },
  { key: "pallmal", aliases: ["pall mal", "pallmall", "pall mall"] }
];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function truncateText(value, maxLength = 255) {
  const text = trimValue(value ?? "");
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

const PRODUCT_CATEGORY_ALIASES = new Map([
  ["AGUAS", "AGUA"],
  ["BEBIDA", "GASEOSA"],
  ["BEBIDAS", "GASEOSA"],
  ["CERVEZAS", "CERVEZA"],
  ["CHAMPAGNE", "ESPUMANTE"],
  ["CIGARROS", "CIGARRO"],
  ["COCTELES", "COCTEL"],
  ["ENERGIZANTES", "ENERGIZANTE"],
  ["ESPUMANTES", "ESPUMANTE"],
  ["GASEOSAS", "GASEOSA"],
  ["GINS", "GIN"],
  ["HIELOS", "HIELO"],
  ["JUGOS", "JUGO"],
  ["LICORES", "LICOR"],
  ["PISCOS", "PISCO"],
  ["REFRESCO", "GASEOSA"],
  ["REFRESCOS", "GASEOSA"],
  ["RONES", "RON"],
  ["SNACKS", "SNACK"],
  ["TEQUILAS", "TEQUILA"],
  ["VINOS", "VINO"],
  ["VODKAS", "VODKA"],
  ["WHISKEY", "WHISKY"],
  ["WHISKIES", "WHISKY"],
  ["ACCESORIOS", "ACCESORIO"],
  ["OTROS", "OTRO"]
]);
const PRODUCT_CATEGORY_LABELS = [
  "Whisky",
  "Ron",
  "Vodka",
  "Pisco",
  "Tequila",
  "Gin",
  "Vino",
  "Espumante",
  "Cerveza",
  "Cigarros",
  "Anís",
  "Fernet",
  "Licores y Cremas",
  "Aperitivos y Digestivos",
  "Ready To Drink",
  "Energizantes",
  "Gaseosas",
  "Jugos y Néctares",
  "Agua",
  "Hielo",
  "Snacks y Golosinas",
  "Accesorios y Regalos"
];
const PRODUCT_CATEGORY_LABEL_BY_KEY = new Map(
  PRODUCT_CATEGORY_LABELS.map((label) => [
    label
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    label
  ])
);
for (const [alias, label] of [
  ["WHISKEY", "Whisky"],
  ["WHISKIES", "Whisky"],
  ["RONES", "Ron"],
  ["VODKAS", "Vodka"],
  ["GINS", "Gin"],
  ["PISCOS", "Pisco"],
  ["VINOS", "Vino"],
  ["ESPUMANTES", "Espumante"],
  ["CHAMPAGNE", "Espumante"],
  ["ESPUMANTES Y CHAMPAGNE", "Espumante"],
  ["CERVEZAS", "Cerveza"],
  ["CIGARRO", "Cigarros"],
  ["TABACO", "Cigarros"],
  ["TABACOS", "Cigarros"],
  ["ANIS", "Anís"],
  ["LICOR", "Licores y Cremas"],
  ["LICORES", "Licores y Cremas"],
  ["CREMAS", "Licores y Cremas"],
  ["CREMAS Y APERITIVOS", "Licores y Cremas"],
  ["APERITIVO", "Aperitivos y Digestivos"],
  ["APERITIVOS", "Aperitivos y Digestivos"],
  ["DIGESTIVOS", "Aperitivos y Digestivos"],
  ["COCTEL", "Ready To Drink"],
  ["COCTELES", "Ready To Drink"],
  ["RTD", "Ready To Drink"],
  ["BEBIDAS PREPARADAS", "Ready To Drink"],
  ["BEBIDAS PREPARADAS RTD", "Ready To Drink"],
  ["RTD Y BEBIDAS PREPARADAS", "Ready To Drink"],
  ["ENERGIZANTE", "Energizantes"],
  ["GASEOSA", "Gaseosas"],
  ["MIXER", "Gaseosas"],
  ["MIXERS", "Gaseosas"],
  ["GASEOSAS Y MIXERS", "Gaseosas"],
  ["AGUAS", "Agua"],
  ["AGUAS Y COMPLEMENTOS", "Agua"],
  ["COMPLEMENTOS", "Agua"],
  ["JUGO", "Jugos y Néctares"],
  ["JUGOS", "Jugos y Néctares"],
  ["NECTAR", "Jugos y Néctares"],
  ["NECTARES", "Jugos y Néctares"],
  ["NÉCTARES", "Jugos y Néctares"],
  ["JUGOS Y NECTARES", "Jugos y Néctares"],
  ["JUGOS Y NÉCTARES", "Jugos y Néctares"],
  ["HIELOS", "Hielo"],
  ["SNACK", "Snacks y Golosinas"],
  ["SNACKS", "Snacks y Golosinas"],
  ["GOLOSINA", "Snacks y Golosinas"],
  ["GOLOSINAS", "Snacks y Golosinas"],
  ["SNACKS Y PICOTEO", "Snacks y Golosinas"],
  ["PICOTEO", "Snacks y Golosinas"],
  ["ACCESORIO", "Accesorios y Regalos"],
  ["ACCESORIOS", "Accesorios y Regalos"],
  ["REGALO", "Accesorios y Regalos"],
  ["REGALOS", "Accesorios y Regalos"],
  ["OTRO", "Aperitivos y Digestivos"],
  ["OTROS", "Aperitivos y Digestivos"]
]) {
  PRODUCT_CATEGORY_LABEL_BY_KEY.set(alias, label);
}

function normalizeProductCategoryValue(value) {
  const clean = trimValue(value || "OTRO")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = PRODUCT_CATEGORY_LABEL_BY_KEY.get(clean);
  if (label) return label;
  const normalized = PRODUCT_CATEGORY_ALIASES.get(clean) || clean || "OTRO";
  const legacyLabel = PRODUCT_CATEGORY_LABEL_BY_KEY.get(normalized);
  if (legacyLabel) return legacyLabel;
  return "Aperitivos y Digestivos";
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getCigaretteAutoOpenRule(productName) {
  const normalizedName = normalizeText(productName);
  if (!normalizedName) return null;
  const rule = CIGARETTE_AUTO_OPEN_RULES.find((item) =>
    item.aliases.some((alias) => normalizedName.includes(alias))
  );
  if (!rule) return null;
  const isUnit = normalizedName.includes("unidad");
  const isBox = normalizedName.includes("caja");
  if (!isUnit && !isBox) return null;
  return { rule, isUnit, isBox };
}

function findCigaretteBoxProduct(productStateMap, unitProduct) {
  const detected = getCigaretteAutoOpenRule(unitProduct?.nombre);
  if (!detected?.isUnit) return null;
  for (const candidate of productStateMap.values()) {
    if (!candidate || toInt(candidate.id, 0) === toInt(unitProduct.id, 0)) continue;
    const candidateRule = getCigaretteAutoOpenRule(candidate.nombre);
    if (!candidateRule?.isBox) continue;
    if (candidateRule.rule.key !== detected.rule.key) continue;
    return candidate;
  }
  return null;
}

function buildProductStateMap(rows) {
  const stateMap = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    stateMap.set(toInt(row?.id, 0), {
      ...row,
      id: toInt(row?.id, 0),
      stock_actual: round2(row?.stock_actual),
      precio: round2(row?.precio)
    });
  }
  return stateMap;
}

async function loadLockedProductStateMap(connection) {
  const [rows] = await connection.query(
    "SELECT id, nombre, categoria, precio, precio_compra, pedido, stock_actual, estado, variantes_json FROM productos FOR UPDATE"
  );
  return buildProductStateMap(rows);
}

function applyProductSaleToState(productStateMap, productId, quantity, variantId = "", presentationId = "") {
  const product = productStateMap.get(productId);
  if (!product) throw createHttpError(404, `No existe producto con N° ${productId}.`);

  const status = normalizeProductStatus(product.estado) || "ACTIVO";
  if (status !== "ACTIVO") {
    throw createHttpError(409, `No puedes vender N° ${productId} porque está INACTIVO.`);
  }

  const stockBefore = round2(product.stock_actual);
  const cigarettePresentation = resolveCigarettePresentation(product, presentationId);
  const saleQuantity = cigarettePresentation ? round2(quantity * cigaretteAccountingUnits(cigarettePresentation)) : quantity;
  const variantPlan = applyVariantStockSale(product, variantId, saleQuantity);
  const cigaretteRule = getCigaretteAutoOpenRule(product.nombre);
  if (cigarettePresentation || !cigaretteRule?.isUnit) {
    if (stockBefore < saleQuantity) {
      throw createHttpError(
        400,
        `Stock insuficiente para N° ${productId}. Disponible: ${stockBefore}, solicitado: ${saleQuantity}.`
      );
    }
    const stockAfter = round2(stockBefore - saleQuantity);
    const total = cigarettePresentation
      ? round2(round2(cigarettePresentation.price || product.precio) * quantity)
      : round2(round2(product.precio) * quantity);
    product.stock_actual = stockAfter;
    return {
      product,
      variantPlan,
      cigarettePresentation,
      requestedQuantity: quantity,
      saleQuantity,
      stockBefore,
      stockAfter,
      saleStockBefore: stockBefore,
      price: saleQuantity > 0 ? round2(total / saleQuantity) : round2(product.precio),
      total,
      autoOpen: null
    };
  }

  const boxProduct = findCigaretteBoxProduct(productStateMap, product);
  if (!boxProduct) {
    throw createHttpError(409, `No se encontró la caja asociada para ${product.nombre}.`);
  }

  const boxStockBefore = round2(boxProduct.stock_actual);
  let workingUnits = stockBefore;
  let workingBoxes = boxStockBefore;
  let boxesOpened = 0;

  // Las unidades nunca deben terminar en cero; si se agotan, se abre otra caja automáticamente.
  while (round2(workingUnits - saleQuantity) <= 0) {
    if (workingBoxes < 1) {
      throw createHttpError(
        400,
        `No hay cajas disponibles para reponer ${product.nombre}. Caja asociada: ${boxProduct.nombre}.`
      );
    }
    workingUnits = round2(workingUnits + CIGARETTE_BOX_UNITS);
    workingBoxes = round2(workingBoxes - 1);
    boxesOpened += 1;
  }

  const saleStockBefore = round2(workingUnits);
  const stockAfter = round2(saleStockBefore - saleQuantity);
  product.stock_actual = stockAfter;
  boxProduct.stock_actual = workingBoxes;

  return {
    product,
    variantPlan,
    cigarettePresentation: null,
    requestedQuantity: quantity,
    saleQuantity,
    stockBefore,
    stockAfter,
    saleStockBefore,
    price: round2(product.precio),
    total: round2(round2(product.precio) * quantity),
    autoOpen:
      boxesOpened > 0
        ? {
            boxProductId: toInt(boxProduct.id, 0),
            boxName: boxProduct.nombre,
            boxStockBefore,
            boxStockAfter: round2(boxProduct.stock_actual),
            boxesOpened,
            openedUnits: round2(boxesOpened * CIGARETTE_BOX_UNITS)
          }
        : null
  };
}

async function syncChangedProducts(connection, beforeStateMap, afterStateMap) {
  for (const [productId, current] of afterStateMap.entries()) {
    const original = beforeStateMap.get(productId);
    if (!original) continue;
    const stockChanged = round2(original.stock_actual) !== round2(current.stock_actual);
    const variantsChanged = String(original.variantes_json || "") !== String(current.variantes_json || "");
    if (!stockChanged && !variantsChanged) continue;
    await connection.query("UPDATE productos SET stock_actual = ?, variantes_json = ? WHERE id = ?", [
      round2(current.stock_actual),
      current.variantes_json || JSON.stringify(normalizeProductVariants(current.VARIANTES)),
      productId
    ]);
  }
}

async function loadAutoOpenMovementsBySale(connection, saleId) {
  try {
    const [rows] = await connection.query(
      `SELECT id_mov, producto_id, nombre_snapshot, tipo, cantidad, stock_antes, stock_despues, referencia, venta_id, nota
       FROM kardex_movimientos
       WHERE venta_id = ? AND referencia = ?
       ORDER BY id_mov ASC
       FOR UPDATE`,
      [saleId, CIGARETTE_AUTO_OPEN_REFERENCE]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

async function reverseAutoOpenMovements(connection, productStateMap, saleId, fechaHora = null) {
  const movements = await loadAutoOpenMovementsBySale(connection, saleId);
  const reversalMovements = [];

  for (const movement of movements) {
    const productId = toInt(movement?.producto_id, 0);
    const product = productStateMap.get(productId);
    if (!product) continue;

    const stockBefore = round2(product.stock_actual);
    const quantity = round2(movement?.cantidad);
    let stockAfter = stockBefore;
    let reverseType = "INGRESO";

    if (normalizeKardexType(movement?.tipo) === "INGRESO") {
      if (stockBefore < quantity) {
        throw createHttpError(
          409,
          `No se pudo revertir la apertura automática para ${product.nombre} porque el stock actual es menor al ajuste requerido.`
        );
      }
      stockAfter = round2(stockBefore - quantity);
      reverseType = "SALIDA";
    } else {
      stockAfter = round2(stockBefore + quantity);
      reverseType = "INGRESO";
    }

    product.stock_actual = stockAfter;
    reversalMovements.push(
      await insertKardexMovement(connection, {
        productId,
        nombre: product.nombre,
        tipo: reverseType,
        cantidad: quantity,
        stockAntes: stockBefore,
        stockDespues: stockAfter,
        referencia: CIGARETTE_AUTO_OPEN_REVERT_REFERENCE,
        ventaId: saleId,
        fechaHora,
        nota: `Reversa ${CIGARETTE_AUTO_OPEN_REFERENCE} venta #${saleId}`
      })
    );
  }

  return reversalMovements;
}

function normalizeIsoDateOnly(value) {
  const text = trimValue(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function extractIsoDateOnly(value) {
  const text = trimValue(value ?? "");
  if (!text) return null;
  const head = text.replace("T", " ").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function formatDateTimeMinutes(value) {
  const text = trimValue(value ?? "");
  if (!text) return "";
  const normalized = text.replace("T", " ").replace(/\s+/g, " ").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toISOString().slice(0, 16).replace("T", " ");
}

function extractTimeMinutes(value) {
  const text = trimValue(value ?? "");
  if (!text) return "";
  const normalized = text.replace("T", " ").replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b(\d{2}:\d{2})(?::\d{2})?\b/);
  if (match?.[1]) return match[1];
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(11, 16);
}

function buildOperativeDateTimeDisplay(operativeValue, saleValue) {
  const operativeDate = extractIsoDateOnly(operativeValue) || extractIsoDateOnly(saleValue) || todayIsoDate();
  const operativeFormatted = formatDateTimeMinutes(operativeValue);
  const saleTime = extractTimeMinutes(saleValue);
  const operativeTime = extractTimeMinutes(operativeValue);

  if (operativeFormatted && operativeTime && operativeTime !== "00:00") {
    return operativeFormatted;
  }
  if (saleTime) {
    return `${operativeDate} ${saleTime}`;
  }
  return operativeFormatted || operativeDate;
}

function normalizeSaleDateTimeInput(value) {
  const text = trimValue(value ?? "");
  if (!text) return null;
  const normalized = text.replace("T", " ").replace(/\s+/g, " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const nowTime = toMysqlDateTime(new Date()).slice(11, 19);
    return `${normalized} ${nowTime}`;
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  return null;
}

function defaultSaleDateTime() {
  return toLimaMysqlDateTime(new Date());
}

function todayIsoDate() {
  return toLimaMysqlDateTime(new Date()).slice(0, 10);
}

function toLimaMysqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function toMysqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function saleLocalDateTimeToStoredUtc(value) {
  const normalized = normalizeSaleDateTimeInput(value);
  return normalized || toLimaMysqlDateTime(new Date());
}

function assertSaleDateIsNotFuture(fechaVenta) {
  const normalized = normalizeSaleDateTimeInput(fechaVenta);
  if (!normalized) return;
  const currentLocal = toLimaMysqlDateTime(new Date());
  const allowedDriftMs = 5 * 60 * 1000;
  const saleTime = new Date(normalized.replace(" ", "T")).getTime();
  const nowTime = new Date(currentLocal.replace(" ", "T")).getTime();
  if (Number.isFinite(saleTime) && Number.isFinite(nowTime) && saleTime - nowTime > allowedDriftMs) {
    throw createHttpError(400, `La fecha de venta (${normalized}) no puede ser futura respecto a la hora local de Perú (${currentLocal}).`);
  }
}

function parseMysqlUtcDateTime(value) {
  const text = trimValue(value ?? "");
  if (!text) return null;
  const normalized = text.replace("T", " ").replace(/\.\d+$/, "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
      0
    )
  );
}

function formatUtcDateToLima(date, { withSeconds = false } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const limaOffsetMs = 5 * 60 * 60 * 1000;
  const local = new Date(date.getTime() - limaOffsetMs);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  const hour = String(local.getUTCHours()).padStart(2, "0");
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  const second = String(local.getUTCSeconds()).padStart(2, "0");
  return withSeconds
    ? `${year}-${month}-${day} ${hour}:${minute}:${second}`
    : `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatStoredUtcToLima(value, { withSeconds = false } = {}) {
  const parsed = parseMysqlUtcDateTime(value);
  if (!parsed) return "";
  return formatUtcDateToLima(parsed, { withSeconds });
}

function formatReportDateHeader(dateIso) {
  const text = normalizeIsoDateOnly(dateIso);
  if (!text) return trimValue(dateIso || "");
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}

function listIsoDatesInRange(fromIso, toIso) {
  const from = normalizeIsoDateOnly(fromIso);
  const to = normalizeIsoDateOnly(toIso);
  if (!from || !to) return [];

  const dates = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  if (text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return `"${text}"`;
  }
  return text;
}

function csvLine(values) {
  return values.map((value) => csvEscape(value)).join(",");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ZIP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const index = (crc ^ buffer[i]) & 0xff;
    crc = ZIP_CRC32_TABLE[index] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDate(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return ((year - 1980) << 9) | (month << 5) | day;
}

function toDosTime(date = new Date()) {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return (hours << 11) | (minutes << 5) | seconds;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosDate = toDosDate(new Date());
  const dosTime = toDosTime(new Date());

  for (const entry of entries) {
    const nameBuffer = Buffer.from(String(entry.name || ""), "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(dataBuffer);
    const size = dataBuffer.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function columnNumberToLetters(index) {
  let num = toInt(index, 0);
  if (num <= 0) return "A";
  let letters = "";
  while (num > 0) {
    const modulo = (num - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    num = Math.floor((num - modulo - 1) / 26);
  }
  return letters;
}

function xlsxInlineStringCell(cellRef, styleId, value) {
  const text = String(value ?? "");
  const preserve = /^\s|\s$|\n|\r|\t/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${cellRef}" s="${styleId}" t="inlineStr"><is><t${preserve}>${htmlEscape(text)}</t></is></c>`;
}

function xlsxNumericCell(cellRef, styleId, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return `<c r="${cellRef}" s="${styleId}"/>`;
  }
  return `<c r="${cellRef}" s="${styleId}"><v>${num}</v></c>`;
}

function formatQtyCsv(value, options = {}) {
  const blankIfZero = Boolean(options.blankIfZero);
  const number = round2(toNumber(value, 0));
  if (blankIfZero && Math.abs(number) < 0.0000001) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.00$/, "");
}

function buildOperationalShiftDateSql(expression) {
  const localExpr = `DATE_SUB(${expression}, INTERVAL 5 HOUR)`;
  return `DATE(CASE WHEN TIME(${localExpr}) < '05:00:00' THEN DATE_SUB(${localExpr}, INTERVAL 1 DAY) ELSE ${localExpr} END)`;
}

function buildSalesExportProducts(catalogProducts, soldProductsById, queryTerm = "") {
  const productMap = new Map();

  for (const item of Array.isArray(catalogProducts) ? catalogProducts : []) {
    const id = toInt(item?.id, 0);
    if (id <= 0) continue;
    productMap.set(id, {
      id,
      nombre: trimValue(item?.nombre || ""),
      precio: round2(item?.precio),
      stockActual: round2(item?.stockActual)
    });
  }

  if (soldProductsById instanceof Map) {
    for (const [rawId, soldProduct] of soldProductsById.entries()) {
      const id = toInt(rawId, 0);
      if (id <= 0) continue;
      const current = productMap.get(id);
      if (current) {
        if (!current.nombre && trimValue(soldProduct?.nombre || "")) {
          current.nombre = trimValue(soldProduct.nombre);
        }
        if (!Number.isFinite(current.precio) || Math.abs(current.precio) < 0.0000001) {
          current.precio = round2(soldProduct?.precio);
        }
        continue;
      }
      productMap.set(id, {
        id,
        nombre: trimValue(soldProduct?.nombre || ""),
        precio: round2(soldProduct?.precio),
        stockActual: round2(soldProduct?.stockActual)
      });
    }
  }

  let products = [...productMap.values()];
  if (queryTerm) {
    products = products.filter((item) => {
      return (
        normalizeText(item.nombre).includes(queryTerm) ||
        String(item.id).includes(queryTerm) ||
        String(item.precio).includes(queryTerm)
      );
    });
  }

  products.sort((a, b) => a.id - b.id || String(a.nombre || "").localeCompare(String(b.nombre || "")));
  return products;
}

function buildDailySalesExportReportRows(
  products,
  dates,
  salesByProductDay,
  ingressByProductDay,
  netByProductDay,
  netAfterEndByProduct
) {
  const datesDesc = [...dates].reverse();
  return products.map((product) => {
    let closingCursor = round2(product.stockActual - toNumber(netAfterEndByProduct.get(product.id), 0));
    const byDay = new Map();

    for (const dateIso of datesDesc) {
      const key = `${product.id}|${dateIso}`;
      const saleQty = round2(toNumber(salesByProductDay.get(key), 0));
      const ingressQty = round2(toNumber(ingressByProductDay.get(key), 0));
      const hasNet = netByProductDay.has(key);
      const netQty = hasNet ? round2(toNumber(netByProductDay.get(key), 0)) : round2(-saleQty);
      const openingQty = round2(closingCursor - netQty);

      byDay.set(dateIso, {
        ingresoDia: ingressQty,
        inicio: openingQty,
        ventaDia: saleQty,
        cierre: closingCursor
      });
      closingCursor = openingQty;
    }

    return {
      id: product.id,
      nombre: product.nombre,
      precio: product.precio,
      byDay
    };
  });
}

function buildAiConfig(envValues) {
  const values = envValues || {};
  const geminiApiKey = trimValue(values.GEMINI_API_KEY || process.env.GEMINI_API_KEY);
  if (geminiApiKey) {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      baseUrl: trimValue(values.GEMINI_BASE_URL || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"),
      model: trimValue(values.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash"),
      imageModel: trimValue(values.GEMINI_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || "")
    };
  }

  const openRouterApiKey = trimValue(values.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY);
  if (openRouterApiKey) {
    return {
      provider: "openrouter",
      apiKey: openRouterApiKey,
      baseUrl: trimValue(values.OPENROUTER_BASE_URL || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"),
      model: trimValue(values.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free")
    };
  }

  return {
    provider: "deepseek",
    apiKey: trimValue(values.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY),
    baseUrl: trimValue(values.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    model: trimValue(values.DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat")
  };
}

function stripMarkdownCodeFence(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("```")) return text;
  return text.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

function parseJsonFromModelText(value) {
  const cleaned = stripMarkdownCodeFence(value);
  if (!cleaned) throw new Error("Respuesta vacia del modelo.");
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstObject = cleaned.indexOf("{");
    const lastObject = cleaned.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
    }
    throw new Error("Respuesta JSON no valida.");
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)(?:;[^,]*)?,(.*)$/);
  if (!match) return { mimeType: "", data: "" };
  return {
    mimeType: match[1],
    data: match[2]
  };
}

function normalizeReceiptAnalysisPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => {
      const fileName = trimValue(item?.fileName || item?.name || "");
      const ocrText = String(item?.ocrText || item?.text || "").trim();
      const dataUrl = trimValue(item?.dataUrl || "");
      const products = Array.isArray(item?.products)
        ? item.products
            .map((product) => ({
              productId: toInt(product?.productId ?? product?.id ?? product?.["N°"], 0),
              name: trimValue(product?.name ?? product?.nombre ?? product?.NOMBRE),
              purchasePrice: round2(Math.max(0, toNumber(product?.purchasePrice ?? product?.PRECIO_COMPRA, 0)))
            }))
            .filter((product) => product.productId > 0 && product.name)
            .slice(0, 500)
        : [];
      if (!fileName || (!ocrText && !dataUrl.startsWith("data:"))) return null;
      return { fileName, ocrText, dataUrl, products };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeReceiptAnalysisResult(raw, fallbackFileName = "") {
  const text = String(raw?.text || raw?.raw_text || raw?.receipt_text || "").trim();
  const rawRows = Array.isArray(raw?.rows)
    ? raw.rows
    : Array.isArray(raw?.matchedRows)
      ? raw.matchedRows
      : [];
  const extractedLines = Array.isArray(raw?.lines)
    ? raw.lines
    : rawRows.length
      ? rawRows.map((row) =>
          trimValue(
            row?.rawText ||
              row?.line ||
              `${row?.lineNumber || row?.numero_fila || ""} ${row?.quantity ?? row?.cantidad ?? ""} ${row?.productText || row?.product || row?.descripcion || ""} ${row?.purchasePrice ?? row?.price ?? row?.total ?? ""}`
          )
        )
    : Array.isArray(raw?.items)
      ? raw.items.map((item) => item?.text || item?.line || "")
      : [];
  const lines = extractedLines
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 200);

  return {
    text,
    lines: lines.length ? lines : text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean),
    unsupported: false,
    sourceLabel: trimValue(raw?.sourceLabel || raw?.source || fallbackFileName || "DeepSeek"),
    visionSummary: trimValue(raw?.visionSummary || raw?.summary || raw?.description || ""),
    matchedRows: rawRows.length
      ? rawRows
          .map((row) => ({
            productId: toInt(row?.productId ?? row?.id, 0),
            quantity: Math.max(1, round2(toNumber(row?.quantity ?? row?.cantidad, 1))),
            purchasePrice: round2(Math.max(0, toNumber(row?.purchasePrice ?? row?.PRECIO_COMPRA ?? row?.price ?? row?.total, 0))),
            lineNumber: toInt(row?.lineNumber ?? row?.numero_fila ?? row?.rowNumber, 0),
            productText: trimValue(row?.productText || row?.product || row?.descripcion || row?.description || ""),
            sourceLabel: trimValue(row?.sourceLabel || row?.source || fallbackFileName || "IA"),
            rawText: trimValue(row?.rawText || row?.text || row?.line || "")
          }))
          .filter((row) => row.quantity > 0 && (row.purchasePrice > 0 || row.productText || row.rawText))
      : []
  };
}

async function callReceiptAnalysisModel(item, aiConfig) {
  const productCatalogBlock = (item.products || [])
    .map((product) => `${product.productId} | ${product.name} | ${product.purchasePrice}`)
    .join("\n");
  const userText =
    `Esta imagen es una boleta de compra manuscrita con tabla.\n` +
    `Lee solo la tabla de productos.\n\n` +
    `Columnas esperadas:\n` +
    `- N°: numero de fila\n` +
    `- CANT: cantidad\n` +
    `- DESCRIPCION: producto escrito a mano\n` +
    `- TOTAL: precio de compra\n\n` +
    `Reglas obligatorias:\n` +
    `- Devuelve una fila por cada renglon lleno.\n` +
    `- No elimines filas si el producto no se entiende.\n` +
    `- Prioriza cantidad y total.\n` +
    `- Si el producto no se entiende, usa productText vacio.\n` +
    `- No inventes productos.\n` +
    `- No uses los encabezados impresos como datos.\n` +
    `- Devuelve solo JSON valido, sin markdown.\n\n` +
    `Formato exacto:\n` +
    `{"visionSummary":"","text":"","lines":[],"rows":[{"lineNumber":1,"quantity":6,"productText":"Cartavio Black","purchasePrice":50.00}]}\n\n` +
    `Catalogo de inventario solo como referencia para nombres, no para cambiar cantidades ni precios:\n${productCatalogBlock || "Sin catalogo"}\n\n` +
    `Nombre de archivo: ${item.fileName}`;

  if (aiConfig.provider === "gemini") {
    const image = parseDataUrl(item.dataUrl);
    if (!image.data || !image.mimeType) {
      throw createHttpError(400, "Gemini necesita una imagen en dataUrl para analizar el recibo.");
    }

    const models = [
      aiConfig.model,
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-flash-latest"
    ].filter((model, index, list) => model && list.indexOf(model) === index);
    let lastError = "";

    for (const model of models) {
      const response = await fetch(
        `${aiConfig.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(aiConfig.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 2048,
              responseMimeType: "application/json"
            },
            contents: [
              {
                role: "user",
                parts: [
                  { text: userText },
                  {
                    inlineData: {
                      mimeType: image.mimeType,
                      data: image.data
                    }
                  }
                ]
              }
            ]
          })
        }
      );

      const responseText = await response.text();
      if (!response.ok) {
        lastError = `Gemini ${model} devolvio error: ${responseText.slice(0, 400)}`;
        if (![400, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
        continue;
      }
      const parsedResponse = JSON.parse(responseText);
      const contentText = (parsedResponse?.candidates?.[0]?.content?.parts || [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
        .trim();
      try {
        return normalizeReceiptAnalysisResult(parseJsonFromModelText(contentText), item.fileName);
      } catch (error) {
        lastError = `Gemini ${model} no devolvio JSON util: ${error.message}`;
        continue;
      }
    }

    throw createHttpError(502, lastError || "Gemini no devolvio una respuesta util.");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${aiConfig.apiKey}`
  };
  if (aiConfig.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://127.0.0.1:8787";
    headers["X-Title"] = "Licoreria AQP OCR";
  }

  const useImageVision = aiConfig.provider === "openrouter" && String(item.dataUrl || "").startsWith("data:");
  const ocrBlock = !useImageVision && item.ocrText ? `OCR crudo del archivo ${item.fileName}:\n${item.ocrText}\n\n` : "";
  const chatUserText = `${userText}\n\n${ocrBlock}`;
  const requestBody = {
    model: aiConfig.model,
    temperature: 0,
    max_tokens: 700,
    messages: [
        {
          role: "system",
          content:
          "Eres un asistente de vision que transcribe recibos manuscritos con tabla. Solo debes leer la tabla escrita a mano por filas. Ignora texto impreso, bordes y encabezados. Cada fila debe salir como: numero_fila cantidad nombre precio. Si el nombre no se entiende completo, conserva igual la fila. Prioriza cantidades y precios correctos. No devuelvas fragmentos sueltos. Devuelve solo JSON válido con visionSummary, text, lines, sourceLabel y matchedRows. matchedRows puede estar vacío."
        },
      {
        role: "user",
        content: useImageVision
          ? [
              { type: "text", text: chatUserText },
              { type: "image_url", image_url: { url: item.dataUrl } }
            ]
          : chatUserText
      }
    ]
  };
  if (aiConfig.provider !== "openrouter") {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(`${aiConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw createHttpError(
      response.status,
      `${aiConfig.provider === "openrouter" ? "OpenRouter" : "DeepSeek"} devolvio error: ${responseText.slice(0, 400)}`
    );
  }

  let parsedResponse = {};
  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    throw createHttpError(502, `${aiConfig.provider === "openrouter" ? "OpenRouter" : "DeepSeek"} devolvio una respuesta no valida.`);
  }

  const rawContent = parsedResponse?.choices?.[0]?.message?.content;
  const contentText =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
        : "";
  const cleaned = stripMarkdownCodeFence(contentText);

  try {
    return normalizeReceiptAnalysisResult(parseJsonFromModelText(cleaned), item.fileName);
  } catch {
    return normalizeReceiptAnalysisResult({ text: cleaned, lines: cleaned.split(/\r?\n/) }, item.fileName);
  }
}

function sanitizeCsvFileName(fileName) {
  const text = trimValue(fileName || "");
  if (!text) return "reporte.csv";
  return text.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parsePositiveInt(value, label) {
  const parsed = toInt(value, 0);
  if (parsed <= 0) {
    throw createHttpError(400, `${label} debe ser un numero entero positivo.`);
  }
  return parsed;
}

function parseCartProductId(value) {
  const direct = toInt(value, 0);
  if (direct > 0) return direct;
  const match = String(value ?? "").trim().match(/^\d+/);
  return match ? toInt(match[0], 0) : 0;
}

function resolveIncomingProductId(row) {
  if (!row || typeof row !== "object") return 0;
  const directValue =
    row.productId ??
    row.productoId ??
    row.producto_id ??
    row["N°"] ??
    row["N"] ??
    row.id ??
    row.ID ??
    row.n;
  const directParsed = parseCartProductId(directValue);
  if (directParsed > 0) return directParsed;

  for (const [key, value] of Object.entries(row)) {
    const compactKey = normalizeText(key).replace(/[^a-z0-9]/g, "");
    if (["n", "na", "no", "nro", "numero", "productid", "productoid", "productoid", "productoid"].includes(compactKey)) {
      const parsed = parseCartProductId(value);
      if (parsed > 0) return parsed;
    }
  }

  return 0;
}

function parseNonNegativeNumber(value, label) {
  const parsed = Number(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${label} debe ser numerico y no negativo.`);
  }
  return round2(parsed);
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw createHttpError(400, `${label} debe ser un numero entero no negativo.`);
  }
  return parsed;
}

function parseIntegerNumber(value, label) {
  const parsed = Number(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw createHttpError(400, `${label} debe ser un numero entero.`);
  }
  return parsed;
}

function normalizePaymentType(value) {
  const raw = trimValue(value || "Efectivo");
  if (!raw) return "Efectivo";
  const normalized = normalizeText(raw);
  if (["aya per", "a ya per", "ayaper", "yape"].includes(normalized)) return "Yape";
  if (["easy pay", "easypay", "izi pay", "izipay", "izi-pay"].includes(normalized)) return "IZIPAY";
  const found = PAYMENT_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return found || raw;
}

function isSinglePaymentDescriptor(value) {
  const raw = trimValue(value || "");
  if (!raw) return false;
  return !/[+]/.test(raw) && !/s\/\s*\d/i.test(raw);
}

function resolveSalePaymentDisplay(rawType, rawDetail) {
  const detail = trimValue(rawDetail || "");
  if (detail) {
    return isSinglePaymentDescriptor(detail) ? normalizePaymentType(detail) : detail;
  }
  return normalizePaymentType(rawType);
}

function normalizePaymentSplitRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      tipoPago: normalizePaymentType(row?.tipoPago || row?.tipo || "Efectivo"),
      monto: round2(Number(row?.monto || 0))
    }))
    .filter((row) => row.monto > 0);
}

function buildPaymentSummaryText(rows, fallbackType = "Efectivo") {
  const normalizedRows = normalizePaymentSplitRows(rows);
  if (!normalizedRows.length) return normalizePaymentType(fallbackType);
  if (normalizedRows.length === 1) return normalizedRows[0].tipoPago;
  return normalizedRows.map((row) => `${row.tipoPago} S/${row.monto.toFixed(2)}`).join(" + ");
}

function allocatePaymentSplitForAmount(totalInput, paymentCursor, fallbackType = "Efectivo") {
  const total = round2(Number(totalInput || 0));
  if (total <= 0) return [];
  const cursor = Array.isArray(paymentCursor) ? paymentCursor : [];
  const allocated = [];
  let remaining = total;

  for (const row of cursor) {
    if (remaining <= 0) break;
    const available = round2(Number(row?.monto || 0));
    if (available <= 0) continue;
    const taken = round2(Math.min(available, remaining));
    if (taken <= 0) continue;
    allocated.push({ tipoPago: normalizePaymentType(row.tipoPago || fallbackType), monto: taken });
    row.monto = round2(available - taken);
    remaining = round2(remaining - taken);
  }

  if (remaining > 0) {
    allocated.push({ tipoPago: normalizePaymentType(fallbackType), monto: remaining });
  }
  return allocated.filter((row) => row.monto > 0);
}

function normalizeSaleOrigin(value) {
  const raw = trimValue(value || "");
  if (!raw) return "MANUAL";
  const normalized = normalizeText(raw);
  if (["manual", "mostrador", "presencial", "tienda"].includes(normalized)) return "MANUAL";
  if (["delivery", "reparto"].includes(normalized)) return "DELIVERY";
  if (["app", "aplicacion", "aplicación"].includes(normalized)) return "APP";
  return raw.toUpperCase();
}

function normalizeKardexType(value) {
  const normalized = normalizeText(value);
  if (normalized === "ingreso") return "INGRESO";
  if (normalized === "salida") return "SALIDA";
  return null;
}

function normalizeProductStatus(value) {
  const normalized = trimValue(value || "").toUpperCase();
  if (!normalized) return null;
  if (PRODUCT_STATUSES.includes(normalized)) return normalized;
  return null;
}

function resolveProductIdValue(row) {
  return toInt(
    row?.["N°"] ??
      row?.["N"] ??
      row?.productId ??
      row?.id ??
      row?.producto_id,
    0
  );
}

function computeSuggestedOrder(stockActual, stockMinimo, stockMaximo) {
  const stock = round2(Math.max(0, toNumber(stockActual, 0)));
  const min = round2(Math.max(0, toNumber(stockMinimo, 0)));
  const max = round2(Math.max(0, toNumber(stockMaximo, 0)));
  if (max <= stock) return 0;
  if (stock <= 0) return round2(max - stock);
  if (min > 0 && stock <= min) return round2(max - stock);
  return 0;
}

function normalizeProductImages(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string") {
    const trimmed = trimValue(value);
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = trimmed.split("|");
    }
  }

  return list
    .map((item) => {
      if (item && typeof item === "object") {
        const originalWebp = truncateText(
          trimValue(item.original_webp_url ?? item.originalWebpUrl ?? ""),
          2000000
        );
        const thumbWebp = truncateText(
          trimValue(item.thumb_webp_url ?? item.thumbWebpUrl ?? ""),
          2000000
        );
        const original = truncateText(
          trimValue(item.original_image_url ?? item.originalImageUrl ?? item.downloadUrl ?? item.download_url ?? item.original ?? item.url ?? item.src ?? ""),
          2000000
        );
        const filtered = truncateText(
          trimValue(item.filtered_image_url ?? item.filteredImageUrl ?? item.filtered ?? item.url ?? item.src ?? original),
          2000000
        );
        const status = trimValue(item.status || (filtered || originalWebp || thumbWebp ? "completed" : "pending")) || "pending";
        if (!original && !filtered && !originalWebp && !thumbWebp) return null;
        return {
          original_image_url: original || originalWebp || filtered || thumbWebp,
          filtered_image_url: filtered || originalWebp || thumbWebp || original,
          original_webp_url: originalWebp || filtered || original || thumbWebp,
          thumb_webp_url: thumbWebp || originalWebp || filtered || original,
          mime: trimValue(item.mime || item.MIME || "image/webp") || "image/webp",
          width: toInt(item.width ?? item.WIDTH, 0),
          height: toInt(item.height ?? item.HEIGHT, 0),
          status
        };
      }
      const src = truncateText(String(item ?? ""), 2000000).trim();
      if (!src) return null;
      return {
        original_image_url: src,
        filtered_image_url: src,
        original_webp_url: src,
        thumb_webp_url: src,
        mime: "image/webp",
        width: 0,
        height: 0,
        status: "completed"
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeProductVariants(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string") {
    const trimmed = trimValue(value);
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  }

  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const name = truncateText(trimValue(item.NOMBRE ?? item.name ?? item.nombre ?? item.label), 120);
      if (!name) return null;
      const rawId = trimValue(item.ID_VARIANTE ?? item.id ?? item.variantId ?? item.slug);
      const id = rawId || name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `variante-${index + 1}`;
      const priceRaw = item.PRECIO ?? item.price ?? item.precio;
      const purchaseRaw = item.PRECIO_COMPRA ?? item.purchasePrice ?? item.precioCompra ?? item.precio_compra;
      const stockRaw = item.STOCK_ACTUAL ?? item.stock ?? item.stockActual ?? item.stock_actual;
      const status = normalizeProductStatus(item.ESTADO ?? item.status ?? item.estado ?? "ACTIVO") || "ACTIVO";
      return {
        id: truncateText(id, 80),
        name,
        description: truncateText(trimValue(item.DESCRIPCION ?? item.description ?? item.descripcion ?? ""), 255),
        price: priceRaw === "" || priceRaw === null || priceRaw === undefined ? null : round2(Math.max(0, toNumber(priceRaw, 0))),
        purchasePrice: purchaseRaw === "" || purchaseRaw === null || purchaseRaw === undefined ? null : round2(Math.max(0, toNumber(purchaseRaw, 0))),
        stock: round2(Math.max(0, toNumber(stockRaw, 0))),
        stockMin: round2(Math.max(0, toNumber(item.STOCK_MINIMO ?? item.stockMin ?? item.stock_minimo ?? 0))),
        stockMax: round2(Math.max(0, toNumber(item.STOCK_MAXIMO ?? item.stockMax ?? item.stock_maximo ?? 0))),
        status,
        images: normalizeProductImages(item.IMAGENES ?? item.images ?? item.imagenes)
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

function normalizeCigarettePresentationId(value) {
  const text = normalizeText(value);
  if (["unit", "unidad", "unidades"].includes(text)) return "unit";
  if (["box10", "caja10", "caja x10", "cajax10", "caja-10"].includes(text)) return "box10";
  if (["box20", "caja20", "caja x20", "cajax20", "caja-20"].includes(text)) return "box20";
  return "";
}

function defaultCigarettePresentations(basePrice = 0) {
  return [
    { id: "unit", label: "Unidad", units: 1, reportUnits: 1, enabled: true, price: round2(basePrice) },
    { id: "box10", label: "Caja x10", units: 10, reportUnits: 1, enabled: false, price: 0 },
    { id: "box20", label: "Caja x20", units: 20, reportUnits: 20, enabled: false, price: 0 }
  ];
}

function normalizeCigarettePresentations(value, basePrice = 0) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string") {
    const trimmed = trimValue(value);
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
  }
  const normalized = defaultCigarettePresentations(basePrice);
  for (const item of list) {
    const id = normalizeCigarettePresentationId(item?.id ?? item?.tipo);
    const index = normalized.findIndex((preset) => preset.id === id);
    if (index < 0) continue;
    normalized[index] = {
      ...normalized[index],
      enabled: item?.enabled !== false && item?.activo !== false,
      reportUnits: id === "box20" ? 20 : 1,
      price: round2(Math.max(0, toNumber(item?.price ?? item?.precio, normalized[index].price)))
    };
  }
  const activeIndex = normalized.findIndex((item) => item.enabled);
  return normalized.map((item, index) => ({
    ...item,
    enabled: activeIndex < 0 ? item.id === "unit" : index === activeIndex
  }));
}

function cigaretteAccountingUnits(presentation) {
  if (!presentation) return 1;
  return presentation.id === "box20" ? 20 : 1;
}

function resolveCigarettePresentation(product, requestedId) {
  const category = normalizeProductCategoryValue(product?.categoria ?? product?.CATEGORIA ?? "");
  if (category !== "Cigarros") return null;
  const id = normalizeCigarettePresentationId(requestedId) || "unit";
  const presentations = normalizeCigarettePresentations(
    product?.cigarette_presentations_json ??
      product?.CIGARRO_PRESENTACIONES ??
      product?.cigarettePresentations ??
      product?.presentacionesCigarro ??
      product?.presentaciones_cigarro,
    product?.precio ?? product?.PRECIO ?? 0
  );
  const presentation = presentations.find((item) => item.id === id && item.enabled);
  return presentation || presentations.find((item) => item.id === "unit" && item.enabled) || null;
}

function sumVariantStock(value) {
  return round2(
    normalizeProductVariants(value).reduce((acc, variant) => {
      if (variant.status === "INACTIVO") return acc;
      return acc + round2(variant.stock || variant.STOCK_ACTUAL || 0);
    }, 0)
  );
}

function applyVariantStockSale(product, variantId, quantity) {
  const cleanVariantId = trimValue(variantId);
  if (!cleanVariantId) return null;
  const variants = normalizeProductVariants(product.variantes_json ?? product.VARIANTES ?? product.variants ?? product.variantes);
  const index = variants.findIndex((variant) => trimValue(variant.id ?? variant.ID_VARIANTE) === cleanVariantId);
  if (index < 0) {
    throw createHttpError(404, `No existe la variante ${cleanVariantId} para ${product.nombre}.`);
  }
  const variant = variants[index];
  if (variant.status === "INACTIVO") {
    throw createHttpError(409, `La variante ${variant.name || cleanVariantId} está INACTIVA.`);
  }
  const variantStockBefore = round2(variant.stock || variant.STOCK_ACTUAL || 0);
  if (variantStockBefore < quantity) {
    throw createHttpError(
      400,
      `Stock insuficiente para ${product.nombre} - ${variant.name || cleanVariantId}. Disponible: ${variantStockBefore}, solicitado: ${quantity}.`
    );
  }
  const variantStockAfter = round2(variantStockBefore - quantity);
  variants[index] = { ...variant, stock: variantStockAfter };
  product.variantes_json = JSON.stringify(variants);
  product.VARIANTES = variants;
  product.variantes = variants;
  return {
    variantId: cleanVariantId,
    variantName: variant.name || cleanVariantId,
    variantStockBefore,
    variantStockAfter,
    variants
  };
}

function hasSellableStock(item) {
  if ((normalizeProductStatus(item?.ESTADO ?? item?.estado ?? item?.status ?? "ACTIVO") || "ACTIVO") !== "ACTIVO") {
    return false;
  }
  if (Number(item?.stock ?? item?.STOCK_ACTUAL ?? item?.stock_actual ?? 0) >= 1) return true;
  return normalizeProductVariants(item?.variants ?? item?.VARIANTES ?? item?.variantes ?? item?.variantes_json).some(
    (variant) => variant.status !== "INACTIVO" && Number(variant.stock || variant.STOCK_ACTUAL || 0) >= 1
  );
}

function buildProductAlert(stockActual, stockMinimo, stockMaximo) {
  const stock = round2(Math.max(0, toNumber(stockActual, 0)));
  const min = round2(Math.max(0, toNumber(stockMinimo, 0)));
  const suggestedOrder = computeSuggestedOrder(stock, min, stockMaximo);
  if (min > 0 && stock < min) {
    return {
      ALERTA_STOCK: "BAJO",
      ALERTA_SEVERIDAD: "ALERTA",
      PEDIDO_SUGERIDO: suggestedOrder
    };
  }
  return {
    ALERTA_STOCK: "OK",
    ALERTA_SEVERIDAD: "OK",
    PEDIDO_SUGERIDO: 0
  };
}

function buildProductApiShape(base) {
  const productId = resolveProductIdValue(base);
  const stockMinimo = round2(Math.max(0, toNumber(base?.STOCK_MINIMO ?? base?.stock_minimo ?? base?.stockMinimo, 0)));
  const stockMaximo = round2(Math.max(0, toNumber(base?.STOCK_MAXIMO ?? base?.stock_maximo ?? base?.stockMaximo ?? base?.PEDIDO ?? base?.pedido, 0)));
  const stockActual = round2(Math.max(0, toNumber(base?.STOCK_ACTUAL ?? base?.stock_actual ?? base?.stockActual, 0)));
  const images = normalizeProductImages(base?.IMAGENES ?? base?.imagenes ?? base?.imagenes_json);
  const variants = normalizeProductVariants(base?.VARIANTES ?? base?.variants ?? base?.variantes ?? base?.variantes_json);
  const cigarettePresentations = normalizeCigarettePresentations(
    base?.CIGARRO_PRESENTACIONES ??
      base?.cigarettePresentations ??
      base?.presentacionesCigarro ??
      base?.presentaciones_cigarro ??
      base?.cigarette_presentations_json,
    base?.PRECIO ?? base?.precio
  );
  const alert = buildProductAlert(stockActual, stockMinimo, stockMaximo);
  return {
    "N°": productId,
    productId,
    NOMBRE: trimValue(base?.NOMBRE ?? base?.nombre ?? ""),
    DESCRIPCION: trimValue(base?.DESCRIPCION ?? base?.descripcion ?? base?.descripción ?? ""),
    CATEGORIA: normalizeProductCategoryValue(base?.CATEGORIA ?? base?.categoria ?? "OTRO"),
    PRECIO: round2(base?.PRECIO ?? base?.precio),
    PRECIO_COMPRA: round2(Math.max(0, toNumber(base?.PRECIO_COMPRA ?? base?.precio_compra ?? base?.precioCompra, 0))),
    IMAGENES: images,
    CIGARRO_PRESENTACIONES: cigarettePresentations,
    CIGARRO_STOCK_LINK: normalizeCigaretteStockLink(base?.CIGARRO_STOCK_LINK ?? base?.cigaretteStockLink ?? base?.stockLinkCigarro),
    VARIANTES: variants,
    STOCK_MAXIMO: stockMaximo,
    PEDIDO: stockMaximo,
    STOCK_MINIMO: stockMinimo,
    STOCK_ACTUAL: stockActual,
    ESTADO: normalizeProductStatus(base?.ESTADO ?? base?.estado ?? "ACTIVO") || "ACTIVO",
    ...alert
  };
}

function normalizePage(value, defaultValue = 1) {
  const parsed = toInt(value, defaultValue);
  return parsed > 0 ? parsed : defaultValue;
}

function normalizePageSize(value, defaultValue = 20) {
  const parsed = toInt(value, defaultValue);
  if (parsed <= 0) return defaultValue;
  return Math.min(parsed, 5000);
}

function normalizeSortDir(value, defaultValue = "asc") {
  const normalized = normalizeText(value || defaultValue);
  return normalized === "desc" ? "desc" : "asc";
}

function compareSortValues(left, right, direction = "asc") {
  const dir = direction === "desc" ? -1 : 1;
  const a = left ?? "";
  const b = right ?? "";
  const aNum = Number(a);
  const bNum = Number(b);
  const canCompareAsNumber =
    Number.isFinite(aNum) &&
    Number.isFinite(bNum) &&
    String(a).trim() !== "" &&
    String(b).trim() !== "";

  if (canCompareAsNumber) {
    if (aNum === bNum) return 0;
    return aNum > bNum ? dir : -dir;
  }

  const result = String(a).localeCompare(String(b), "es", {
    sensitivity: "base",
    numeric: true
  });
  if (result === 0) return 0;
  return result > 0 ? dir : -dir;
}

function sortItems(items, options = {}) {
  const source = Array.isArray(items) ? items : [];
  const allowed = options.allowed || {};
  const fallbackKey = options.defaultSortBy || Object.keys(allowed)[0] || "";
  const sortBy = allowed[options.sortBy] ? options.sortBy : fallbackKey;
  const sortDir = normalizeSortDir(options.sortDir, options.defaultSortDir || "asc");
  const getValue = allowed[sortBy];

  if (!getValue) return [...source];

  return source
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compareSortValues(getValue(left.item), getValue(right.item), sortDir);
      if (result !== 0) return result;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function matchDateRange(rawDate, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  const value = normalizeIsoDateOnly(rawDate);
  if (!value) return false;
  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;
  return true;
}

const OPERATIONAL_DAY_ORDER = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

function formatOperationalDayLabel(dayKey) {
  const normalized = normalizeText(dayKey).replace(/[^a-z]/g, "");
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseLocalSaleDateTime(rawValue) {
  const text = trimValue(rawValue);
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      0
    );
  }

  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      0
    );
  }

  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }
  return null;
}

function toLocalIsoDate(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
  const local = new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function resolveOperationalShiftDate(rawValue) {
  const text = trimValue(rawValue ?? "");
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?/);
  if (isoMatch) {
    const isoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const hour = isoMatch[4] !== undefined ? Number.parseInt(isoMatch[4], 10) : null;
    const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
    const baseDate = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
    if (Number.isFinite(hour) && hour < 5) {
      baseDate.setDate(baseDate.getDate() - 1);
    }
    return toLocalIsoDate(baseDate);
  }

  const latamMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?/);
  if (latamMatch) {
    const isoDate = `${latamMatch[3]}-${latamMatch[2]}-${latamMatch[1]}`;
    const hour = latamMatch[4] !== undefined ? Number.parseInt(latamMatch[4], 10) : null;
    const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
    const baseDate = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
    if (Number.isFinite(hour) && hour < 5) {
      baseDate.setDate(baseDate.getDate() - 1);
    }
    return toLocalIsoDate(baseDate);
  }

  const parsed = parseLocalSaleDateTime(text);
  if (parsed) {
    const base = getCurrentOperationalBaseDate(parsed);
    return toLocalIsoDate(base);
  }
  return normalizeIsoDateOnly(text);
}

function normalizeOperationalDayKey(value) {
  const text = normalizeText(value).replace(/[^a-z]/g, "");
  return OPERATIONAL_DAY_ORDER.includes(text) ? text : "";
}

function getCurrentOperationalBaseDate(anchor = new Date()) {
  const baseDate = new Date(anchor);
  const hour = baseDate.getHours();
  if (hour < 5) {
    baseDate.setDate(baseDate.getDate() - 1);
  }
  return baseDate;
}

function getOperationalWeekStart(anchor = new Date()) {
  const businessDate = getCurrentOperationalBaseDate(anchor);
  const mondayBasedIndex = (businessDate.getDay() + 6) % 7;
  const weekStart = new Date(businessDate);
  weekStart.setDate(weekStart.getDate() - mondayBasedIndex);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function resolveOperationalDayDate(dayKey, anchor = new Date()) {
  const normalizedDay = normalizeOperationalDayKey(dayKey);
  if (!normalizedDay) return null;
  const businessDate = getCurrentOperationalBaseDate(anchor);
  const currentIndex = (businessDate.getDay() + 6) % 7;
  const calendarIndex = (anchor.getDay() + 6) % 7;
  const targetIndex = OPERATIONAL_DAY_ORDER.indexOf(normalizedDay);
  if (targetIndex < 0) return null;

  if (currentIndex !== calendarIndex && targetIndex === calendarIndex) {
    const calendarDate = new Date(anchor);
    calendarDate.setHours(0, 0, 0, 0);
    return calendarDate;
  }

  let offset = targetIndex - currentIndex;
  if (offset > 0) {
    offset -= 7;
  }

  const resolvedDate = new Date(businessDate);
  resolvedDate.setDate(resolvedDate.getDate() + offset);
  resolvedDate.setHours(0, 0, 0, 0);
  return resolvedDate;
}

function buildOperationalRange(fromDay, toDay, anchor = new Date()) {
  const fromIso = normalizeIsoDateOnly(fromDay);
  const toIso = normalizeIsoDateOnly(toDay);
  if (fromIso || toIso) {
    const startIso = fromIso || toIso;
    const endIso = toIso || fromIso;
    const [sy, sm, sd] = startIso.split("-").map((part) => Number.parseInt(part, 10));
    const [ey, em, ed] = endIso.split("-").map((part) => Number.parseInt(part, 10));
    const start = new Date(sy, Math.max(0, (sm || 1) - 1), sd || 1, 5, 0, 0, 0);
    const end = new Date(ey, Math.max(0, (em || 1) - 1), ed || 1, 5, 0, 0, 0);
    if (end < start) return null;
    end.setDate(end.getDate() + 1);
    end.setHours(4, 59, 59, 999);
    return { start, end };
  }

  const normalizedFrom = normalizeOperationalDayKey(fromDay);
  const normalizedTo = normalizeOperationalDayKey(toDay);
  if (!normalizedFrom && !normalizedTo) return null;

  const safeFrom = normalizedFrom || normalizedTo;
  const safeTo = normalizedTo || normalizedFrom;
  const start = resolveOperationalDayDate(safeFrom, anchor);
  const endBase = resolveOperationalDayDate(safeTo, anchor);
  if (!start || !endBase) return null;
  start.setHours(5, 0, 0, 0);

  const end = new Date(endBase);
  if (end < start) {
    end.setDate(end.getDate() + 7);
  }
  end.setDate(end.getDate() + 1);
  end.setHours(4, 59, 59, 999);

  return { start, end };
}

function getOperationalDayKey(rawValue) {
  const shiftDateIso = resolveOperationalShiftDate(rawValue);
  if (!shiftDateIso) return "";
  const anchor = new Date(`${shiftDateIso}T12:00:00`);
  const jsDay = anchor.getDay();
  return OPERATIONAL_DAY_ORDER[(jsDay + 6) % 7] || "";
}

function matchSalesShiftRange(item, fromDay, toDay) {
  const fromIso = normalizeIsoDateOnly(fromDay);
  const toIso = normalizeIsoDateOnly(toDay);
  if (fromIso || toIso) {
    const shiftIso = resolveOperationalShiftDate(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
    if (!shiftIso) return false;
    const start = fromIso || toIso;
    const end = toIso || fromIso;
    if (end < start) return false;
    return shiftIso >= start && shiftIso <= end;
  }

  const range = buildOperationalRange(fromDay, toDay);
  if (!range) return true;
  const saleDateTime = parseLocalSaleDateTime(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
  if (!saleDateTime) return false;
  return saleDateTime >= range.start && saleDateTime <= range.end;
}

function extractDateOnly(value) {
  return normalizeIsoDateOnly(String(value ?? "").slice(0, 10));
}

function paginate(items, options = {}) {
  const pageSize = normalizePageSize(options.pageSize, 20);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(normalizePage(options.page, 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages
    }
  };
}

function parseEnvText(text) {
  const result = {};
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const separatorIndex = raw.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = raw.slice(0, separatorIndex).trim();
    let value = raw.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function readEnvValuesQuiet() {
  try {
    const raw = await fs.readFile(ENV_FILE_PATH, "utf8");
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

async function analyzeReceiptImage(req) {
  const payload = await parseJsonBody(req);
  const items = normalizeReceiptAnalysisPayload(payload);
  if (!items.length) {
    throw createHttpError(400, "No se recibieron imagenes validas para analizar.");
  }

  const envValues = await readEnvValuesQuiet();
  const aiConfig = buildAiConfig(envValues);
  if (!aiConfig.apiKey) {
    return {
      ok: false,
      provider: aiConfig.provider || "openrouter",
      configured: false,
      items: items.map((item) => ({
        fileName: item.fileName,
        text: "",
        lines: [],
        unsupported: true,
        error: "Falta OPENROUTER_API_KEY en .env. Como respaldo tambien puedes usar DEEPSEEK_API_KEY."
      }))
    };
  }

  const results = [];
  for (const item of items) {
    try {
      const analyzed = await callReceiptAnalysisModel(item, aiConfig);
      results.push({
        fileName: item.fileName,
        ...analyzed,
        error: null
      });
    } catch (error) {
      results.push({
        fileName: item.fileName,
        text: "",
        lines: [],
        unsupported: false,
        error: trimValue(
          error?.message ||
            `No se pudo analizar el OCR con ${aiConfig.provider === "openrouter" ? "OpenRouter" : "DeepSeek"}.`
        )
      });
    }
  }

  return {
    ok: true,
    provider: aiConfig.provider,
    configured: true,
    items: results
  };
}

function buildDbConfig(envValues, type = "main") {
  const values = envValues || {};
  const host =
    type === "status"
      ? trimValue(values.DB_STATUS_HOST || values.DB_HOST || process.env.DB_STATUS_HOST || process.env.DB_HOST)
      : trimValue(values.DB_HOST || process.env.DB_HOST);
  const portRaw =
    type === "status"
      ? values.DB_STATUS_PORT || values.DB_PORT || process.env.DB_STATUS_PORT || process.env.DB_PORT
      : values.DB_PORT || process.env.DB_PORT;
  const database =
    type === "status"
      ? trimValue(values.DB_STATUS_NAME || values.DB_NAME || process.env.DB_STATUS_NAME || process.env.DB_NAME)
      : trimValue(values.DB_NAME || process.env.DB_NAME);
  const user =
    type === "status"
      ? trimValue(values.DB_STATUS_USER || values.DB_USER || process.env.DB_STATUS_USER || process.env.DB_USER)
      : trimValue(values.DB_USER || process.env.DB_USER);
  const password =
    type === "status"
      ? String(values.DB_STATUS_PASSWORD || values.DB_PASSWORD || process.env.DB_STATUS_PASSWORD || process.env.DB_PASSWORD || "")
      : String(values.DB_PASSWORD || process.env.DB_PASSWORD || "");
  const charset =
    trimValue(
      type === "status"
        ? values.DB_STATUS_CHARSET || values.DB_CHARSET || process.env.DB_STATUS_CHARSET || process.env.DB_CHARSET
        : values.DB_CHARSET || process.env.DB_CHARSET
    ) || "utf8mb4";

  return {
    host,
    port: Number.parseInt(String(portRaw || "3306"), 10) || 3306,
    database,
    user,
    password,
    charset
  };
}

function buildDbErrorMessage(error) {
  const code = trimValue(error?.code || "");
  const msg = trimValue(error?.sqlMessage || error?.message || "Error de base de datos");
  if (code) return `${msg} [${code}]`;
  return msg;
}

async function openMysqlConnection(config) {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset,
    connectTimeout: 3000,
    dateStrings: true
  });
}

function getMysqlPool(config) {
  const mysql = require("mysql2/promise");
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    charset: config.charset
  });
  if (!mysqlPools.has(key)) {
    mysqlPools.set(
      key,
      mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        charset: config.charset,
        connectTimeout: 3000,
        dateStrings: true,
        waitForConnections: true,
        connectionLimit: 8,
        queueLimit: 0
      })
    );
  }
  return mysqlPools.get(key);
}

async function withMysqlConnection(executor) {
  const envValues = await readEnvValuesQuiet();
  const config = buildDbConfig(envValues, "main");
  const missingKeys = [];
  if (!config.host) missingKeys.push("DB_HOST");
  if (!config.database) missingKeys.push("DB_NAME");
  if (!config.user) missingKeys.push("DB_USER");
  if (!config.password) missingKeys.push("DB_PASSWORD");
  if (missingKeys.length) {
    throw createHttpError(400, `Faltan variables DB en .env: ${missingKeys.join(", ")}`);
  }

  const connection = await getMysqlPool(config).getConnection();
  try {
    return await executor(connection, config);
  } finally {
    try {
      connection.release();
    } catch {
      // noop
    }
  }
}

function sanitizeHostCandidate(value) {
  let host = trimValue(value || "");
  if (!host) return "";
  host = host.replace(/^https?:\/\//i, "");
  const slashIndex = host.indexOf("/");
  if (slashIndex >= 0) {
    host = host.slice(0, slashIndex);
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const colonIndex = host.lastIndexOf(":");
  if (colonIndex > 0 && host.indexOf(":") === colonIndex) {
    const possiblePort = host.slice(colonIndex + 1);
    if (/^\d+$/.test(possiblePort)) {
      host = host.slice(0, colonIndex);
    }
  }
  return trimValue(host);
}

function isIpv4(value) {
  const text = trimValue(value || "");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return false;
  return text.split(".").every((part) => {
    const octet = Number.parseInt(part, 10);
    return octet >= 0 && octet <= 255;
  });
}

function isPrivateIpv4(ip) {
  if (!isIpv4(ip)) return false;
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isLikelyHostname(value) {
  const text = trimValue(value || "");
  if (!text) return false;
  if (text.length > 253) return false;
  if (!/^[a-zA-Z0-9.-]+$/.test(text)) return false;
  if (text.startsWith(".") || text.endsWith(".")) return false;
  return text.split(".").every((label) => {
    if (!label) return false;
    if (label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return true;
  });
}

function requestTextOverHttps(url, timeoutMs = 2600) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "licoreria-access-host-check/1.0",
          Accept: "application/json, text/plain"
        }
      },
      (response) => {
        const statusCode = Number(response.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${statusCode || "ERR"}`));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("timeout"));
    });
  });
}

async function detectPublicIpv4() {
  const probes = [
    {
      source: "ipify",
      url: "https://api.ipify.org?format=json",
      parse: (text) => {
        try {
          const data = JSON.parse(text);
          return trimValue(data?.ip || "");
        } catch {
          return "";
        }
      }
    },
    {
      source: "checkip-amazon",
      url: "https://checkip.amazonaws.com",
      parse: (text) => trimValue(text)
    },
    {
      source: "icanhazip",
      url: "https://ipv4.icanhazip.com",
      parse: (text) => trimValue(text)
    }
  ];

  const attempts = probes.map(async (probe) => {
    const raw = await requestTextOverHttps(probe.url);
    const ip = sanitizeHostCandidate(probe.parse(raw));
    if (!isIpv4(ip) || isPrivateIpv4(ip)) {
      throw new Error("invalid-public-ip");
    }
    return { ip, source: probe.source };
  });

  const results = await Promise.allSettled(attempts);
  for (const result of results) {
    if (result.status === "fulfilled") {
      return result.value;
    }
  }
  return null;
}

function detectLocalIpv4() {
  const interfaces = os.networkInterfaces() || {};
  for (const addresses of Object.values(interfaces)) {
    for (const item of addresses || []) {
      const family = String(item?.family || "");
      if (!item || item.internal || family !== "IPv4") continue;
      const address = sanitizeHostCandidate(item.address);
      if (isIpv4(address)) return address;
    }
  }
  return "";
}

async function getDbAccessHostStatus() {
  const checkedAt = nowIso();
  const envValues = await readEnvValuesQuiet();
  const overrideHost = sanitizeHostCandidate(
    envValues.ACCESS_HOST || process.env.ACCESS_HOST || envValues.DB_ACCESS_HOST || process.env.DB_ACCESS_HOST
  );

  if (overrideHost) {
    return {
      checkedAt,
      host: overrideHost,
      source: "env_override",
      sourceLabel: "Configurado en .env (ACCESS_HOST)",
      publicHost: isIpv4(overrideHost) && !isPrivateIpv4(overrideHost) ? overrideHost : null,
      dbDeniedHost: null,
      localHost: null,
      canWhitelist: isIpv4(overrideHost) || isLikelyHostname(overrideHost),
      message: "Host manual detectado. Úsalo en cPanel > Remote MySQL."
    };
  }

  const publicProbeResult = await detectPublicIpv4();
  const publicHost = publicProbeResult?.ip || "";
  const publicSource = publicProbeResult?.source || "";
  const localHost = detectLocalIpv4();

  let host = "";
  let source = "none";
  let sourceLabel = "No detectado";
  if (publicHost) {
    host = publicHost;
    source = "public_ipv4";
    sourceLabel = `IP publica detectada (${publicSource || "probe"})`;
  } else if (localHost) {
    host = localHost;
    source = "local_ipv4";
    sourceLabel = "IP local detectada (puede no servir fuera de tu red)";
  }

  const canWhitelist = Boolean(host && (isIpv4(host) || isLikelyHostname(host)));
  const isPrivate = isIpv4(host) && isPrivateIpv4(host);
  const message = host
    ? isPrivate
      ? "Se detectó IP privada. Para cPanel remoto normalmente necesitas tu IP pública."
      : "Host listo para copiar y autorizar en cPanel > Remote MySQL."
    : "No se pudo detectar el Access Host automaticamente.";

  return {
    checkedAt,
    host: host || null,
    source,
    sourceLabel,
    publicHost: publicHost || null,
    dbDeniedHost: null,
    localHost: localHost || null,
    canWhitelist,
    message
  };
}

async function resetSessionLog() {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(
    LAST_SESSION_LOG_PATH,
    `[${nowIso()}] [INFO] Log de sesion iniciado.\n`,
    "utf8"
  );
}

async function appendLog(level, message, meta = null) {
  const details = meta ? ` ${safeStringify(meta)}` : "";
  const line = `[${nowIso()}] [${level}] ${message}${details}\n`;
  await fs.appendFile(LAST_SESSION_LOG_PATH, line, "utf8");
}

function logInfo(message, meta = null) {
  appendLog("INFO", message, meta).catch(() => {});
}

function logWarn(message, meta = null) {
  appendLog("WARN", message, meta).catch(() => {});
}

function logError(message, meta = null) {
  appendLog("ERROR", message, meta).catch(() => {});
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function setApiCorsHeaders(req, res) {
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw createHttpError(400, "JSON invalido.");
  }
}

async function readOrdersStore() {
  try {
    const remote = await readFirebaseCollection("orders");
    if (Array.isArray(remote)) return remote;
  } catch (error) {
    await appendLog("WARN", "Fallback local de pedidos", {
      operation: "readOrdersStore",
      message: buildDbErrorMessage(error)
    });
  }
  try {
    const raw = await fs.readFile(ORDERS_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeOrdersStore(items) {
  const list = Array.isArray(items) ? items : [];
  try {
    if (await writeFirebaseCollection("orders", list)) return;
  } catch (error) {
    await appendLog("WARN", "Fallback local de pedidos", {
      operation: "writeOrdersStore",
      message: buildDbErrorMessage(error)
    });
  }
  await fs.mkdir(path.dirname(ORDERS_DB_PATH), { recursive: true });
  await fs.writeFile(ORDERS_DB_PATH, JSON.stringify(list, null, 2), "utf8");
}

function normalizeDeliveryRange(range, index = 0) {
  const fromKm = Math.max(0, round2(range?.fromKm ?? range?.from ?? 0));
  const toKm = Math.max(fromKm, round2(range?.toKm ?? range?.to ?? fromKm));
  const price = Math.max(0, round2(range?.price ?? range?.amount ?? 0));
  return {
    id: trimValue(range?.id || `range-${index + 1}`),
    fromKm,
    toKm,
    price
  };
}

function normalizeDeliveryConfig(input = {}) {
  const store = input?.store && typeof input.store === "object" ? input.store : {};
  const lat = Number(store?.latitud ?? store?.lat ?? input?.storeLatitud ?? input?.latitud);
  const lng = Number(store?.longitud ?? store?.lng ?? input?.storeLongitud ?? input?.longitud);
  const ranges = Array.isArray(input?.ranges) && input.ranges.length
    ? input.ranges
    : DEFAULT_DELIVERY_RANGES;
  const normalizedRanges = ranges
    .map(normalizeDeliveryRange)
    .filter((range) => range.toKm > range.fromKm && range.price >= 0)
    .sort((left, right) => left.fromKm - right.fromKm || left.toKm - right.toKm);
  return {
    store: {
      name: trimValue(store?.name || input?.storeName || "La Licoreria"),
      address: trimValue(store?.address || input?.storeAddress || ""),
      latitud: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
      longitud: Number.isFinite(lng) ? Number(lng.toFixed(6)) : null
    },
    ranges: normalizedRanges.length ? normalizedRanges : DEFAULT_DELIVERY_RANGES.map(normalizeDeliveryRange),
    updatedAt: trimValue(input?.updatedAt || nowIso())
  };
}

function hasStoreDeliveryLocation(config) {
  return config?.store?.latitud !== null
    && config?.store?.latitud !== undefined
    && config?.store?.longitud !== null
    && config?.store?.longitud !== undefined
    && Number.isFinite(Number(config.store.latitud))
    && Number.isFinite(Number(config.store.longitud));
}

function isInsideArequipaCoverage(point = {}) {
  const lat = Number(point?.latitud ?? point?.lat);
  const lng = Number(point?.longitud ?? point?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= AREQUIPA_COVERAGE_BOUNDS.minLat
    && lat <= AREQUIPA_COVERAGE_BOUNDS.maxLat
    && lng >= AREQUIPA_COVERAGE_BOUNDS.minLng
    && lng <= AREQUIPA_COVERAGE_BOUNDS.maxLng;
}

async function readStoreDeliveryConfig() {
  const remote = await getFirebaseDoc("settings", "storeDeliveryConfig");
  if (remote) return normalizeDeliveryConfig(remote);
  try {
    const raw = await fs.readFile(STORE_DELIVERY_CONFIG_PATH, "utf8");
    return normalizeDeliveryConfig(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return normalizeDeliveryConfig({ ranges: DEFAULT_DELIVERY_RANGES });
    throw error;
  }
}

async function writeStoreDeliveryConfig(input) {
  const config = normalizeDeliveryConfig({ ...input, updatedAt: nowIso() });
  if (await writeFirebaseDoc("settings", "storeDeliveryConfig", config)) return config;
  await fs.mkdir(path.dirname(STORE_DELIVERY_CONFIG_PATH), { recursive: true });
  await fs.writeFile(STORE_DELIVERY_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function haversineKm(from, to) {
  const lat1 = Number(from?.latitud ?? from?.lat);
  const lon1 = Number(from?.longitud ?? from?.lng);
  const lat2 = Number(to?.latitud ?? to?.lat);
  const lon2 = Number(to?.longitud ?? to?.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateDeliveryQuote(config, destination) {
  if (!hasStoreDeliveryLocation(config)) {
    return { available: false, reason: "STORE_LOCATION_REQUIRED", message: "Configura la ubicación de la tienda." };
  }
  const destinationLat = Number(destination?.latitud ?? destination?.lat);
  const destinationLng = Number(destination?.longitud ?? destination?.lng);
  if (![destinationLat, destinationLng].every(Number.isFinite)) {
    return { available: false, reason: "DESTINATION_REQUIRED", message: "Elige tu ubicación en el mapa." };
  }
  if (!isInsideArequipaCoverage({ latitud: destinationLat, longitud: destinationLng })) {
    return {
      available: false,
      reason: "OUT_OF_AREQUIPA",
      message: "Tu dirección está fuera de cobertura en Arequipa."
    };
  }
  const distanceKm = haversineKm(config.store, destination);
  if (!Number.isFinite(distanceKm)) {
    return { available: false, reason: "DESTINATION_REQUIRED", message: "Elige tu ubicación en el mapa." };
  }
  const roundedDistance = Number(distanceKm.toFixed(2));
  const range = config.ranges.find((item) => roundedDistance >= item.fromKm && roundedDistance <= item.toKm);
  if (!range) {
    return {
      available: false,
      reason: "OUT_OF_COVERAGE",
      message: "Tu dirección está fuera de cobertura.",
      distanceKm: roundedDistance
    };
  }
  return {
    available: true,
    distanceKm: roundedDistance,
    price: round2(range.price),
    range
  };
}

async function readCombosStore() {
  try {
    const remote = await readFirebaseCollection("combos");
    if (Array.isArray(remote)) return remote;
  } catch (error) {
    await appendLog("WARN", "Fallback local de combos", {
      operation: "readCombosStore",
      message: buildDbErrorMessage(error)
    });
  }
  try {
    const raw = await fs.readFile(COMBOS_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeCombosStore(items) {
  const list = Array.isArray(items) ? items : [];
  try {
    if (await writeFirebaseCollection("combos", list)) return;
  } catch (error) {
    await appendLog("WARN", "Fallback local de combos", {
      operation: "writeCombosStore",
      message: buildDbErrorMessage(error)
    });
  }
  await fs.mkdir(path.dirname(COMBOS_DB_PATH), { recursive: true });
  await fs.writeFile(COMBOS_DB_PATH, JSON.stringify(list, null, 2), "utf8");
}

async function readCustomersStore() {
  try {
    const remote = await readFirebaseCollection("customers");
    if (Array.isArray(remote)) return { customers: remote };
  } catch (error) {
    await appendLog("WARN", "Fallback local de clientes", {
      operation: "readCustomersStore",
      message: buildDbErrorMessage(error)
    });
  }
  try {
    const raw = await fs.readFile(CUSTOMERS_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { customers: parsed };
    return {
      customers: Array.isArray(parsed?.customers) ? parsed.customers : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { customers: [] };
    throw error;
  }
}

async function writeCustomersStore(store) {
  const customers = Array.isArray(store?.customers) ? store.customers : [];
  try {
    if (await writeFirebaseCollection("customers", customers)) return;
  } catch (error) {
    await appendLog("WARN", "Fallback local de clientes", {
      operation: "writeCustomersStore",
      message: buildDbErrorMessage(error)
    });
  }
  await fs.mkdir(path.dirname(CUSTOMERS_DB_PATH), { recursive: true });
  await fs.writeFile(
    CUSTOMERS_DB_PATH,
    JSON.stringify({ customers }, null, 2),
    "utf8"
  );
}

function emptyCustomerData(userId) {
  return {
    id: String(userId),
    userId: String(userId),
    addresses: [],
    favorites: [],
    paymentMethods: [],
    invitations: []
  };
}

async function readCustomerData(userId) {
  const safeId = trimValue(userId || "");
  if (!safeId) throw createHttpError(401, "Sesión requerida.");
  const remote = await getFirebaseDoc("customer_data", safeId);
  return {
    ...emptyCustomerData(safeId),
    ...(remote || {}),
    id: safeId,
    userId: safeId,
    addresses: Array.isArray(remote?.addresses) ? remote.addresses : [],
    favorites: Array.isArray(remote?.favorites) ? remote.favorites : [],
    paymentMethods: Array.isArray(remote?.paymentMethods) ? remote.paymentMethods : [],
    invitations: Array.isArray(remote?.invitations) ? remote.invitations : []
  };
}

async function writeCustomerData(userId, data) {
  const safeId = trimValue(userId || "");
  if (!safeId) throw createHttpError(401, "Sesión requerida.");
  const saved = await writeFirebaseDoc("customer_data", safeId, {
    ...emptyCustomerData(safeId),
    ...data,
    id: safeId,
    userId: safeId,
    updatedAt: nowIso()
  });
  if (!saved) throw createHttpError(503, "Firebase no está disponible.");
}

function nextEmbeddedId(items) {
  return (Array.isArray(items) ? items : []).reduce((max, item) => Math.max(max, toInt(item?.id, 0)), 0) + 1;
}

function findCustomerRecord(customers, userId) {
  const safeId = trimValue(userId || "");
  return (Array.isArray(customers) ? customers : []).find((entry) => (
    trimValue(entry?.id || "") === safeId ||
    trimValue(entry?.legacyId || "") === safeId ||
    Number(entry?.legacyId ?? entry?.id) === Number(userId)
  )) || null;
}

function normalizeOrderMode(value) {
  return "delivery";
}

function normalizeOrderStatus(value, options = {}) {
  const normalized = normalizeText(value || "pendiente");
  if (normalized === "pendiente") return "PENDIENTE";
  if (["validado", "aprobado", "pago_validado", "pago_aprobado", "pago_verificado"].includes(normalized)) return "VALIDADO";
  if (normalized === "en_preparacion") return "VALIDADO";
  if (normalized === "en_camino") return "EN_CAMINO";
  if (normalized === "entregado") return "ENTREGADO";
  if (normalized === "finalizado") return "ENTREGADO";
  if (normalized === "cancelado") return "CANCELADO";
  if (normalized === "rechazado") return "RECHAZADO";
  if (options.strict) {
    throw createHttpError(400, `Estado de pedido invalido: ${value}`);
  }
  return "PENDIENTE";
}

function nextOrderId(items) {
  const max = (Array.isArray(items) ? items : []).reduce((highest, item) => {
    const match = /^PED-(\d{6})$/.exec(trimValue(item?.id || ""));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `PED-${String(max + 1).padStart(6, "0")}`;
}

const PUBLIC_ORDER_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function normalizeOrderLookupCode(value) {
  return trimValue(value || "").toUpperCase();
}

function randomPublicOrderCode() {
  let suffix = "";
  for (let index = 0; index < 5; index += 1) {
    suffix += PUBLIC_ORDER_CODE_CHARS[Math.floor(Math.random() * PUBLIC_ORDER_CODE_CHARS.length)];
  }
  return `P-${suffix}`;
}

function nextPublicOrderCode(items) {
  const existing = new Set((Array.isArray(items) ? items : [])
    .map((item) => normalizeOrderLookupCode(item?.publicCode || item?.customerCode || item?.id || ""))
    .filter(Boolean));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = randomPublicOrderCode();
    if (!existing.has(normalizeOrderLookupCode(code))) return code;
  }
  return `P-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

function orderMatchesCode(order, code) {
  const target = normalizeOrderLookupCode(code);
  if (!target) return false;
  return [
    order?.publicCode,
    order?.customerCode,
    order?.id
  ].some((value) => normalizeOrderLookupCode(value) === target);
}

function internalOrderCode(order) {
  return trimValue(order?.id || "");
}

function publicOrderCode(order) {
  return trimValue(order?.publicCode || order?.customerCode || "");
}

function buildOrderApiShape(base) {
  const items = Array.isArray(base?.items)
    ? base.items.map((item) => ({
        id: trimValue(item?.id || ""),
        type: trimValue(item?.type || ""),
        comboId: trimValue(item?.comboId || ""),
        productId: parseCartProductId(item?.productId || item?.parentProductId || item?.id),
        parentProductId: trimValue(item?.parentProductId || ""),
        variantId: trimValue(item?.variantId || ""),
        variantName: trimValue(item?.variantName || ""),
        presentacionCigarro: trimValue(item?.presentacionCigarro || item?.cigarettePresentation || item?.PRESENTACION_CIGARRO || ""),
        cigarettePresentation: trimValue(item?.cigarettePresentation || item?.presentacionCigarro || item?.PRESENTACION_CIGARRO || ""),
        cigarettePresentationLabel: trimValue(item?.cigarettePresentationLabel || item?.PRESENTACION_CIGARRO_LABEL || ""),
        cigarettePresentationUnits: Math.max(0, toInt(item?.cigarettePresentationUnits ?? item?.PRESENTACION_UNIDADES, 0)),
        cigarettePresentationReportUnits: Math.max(0, toInt(item?.cigarettePresentationReportUnits ?? item?.PRESENTACION_UNIDADES_REPORTE, 0)),
        name: trimValue(item?.name || ""),
        category: trimValue(item?.category || ""),
        price: round2(item?.price),
        quantity: Math.max(1, toInt(item?.quantity, 1)),
        stock: Math.max(0, toInt(item?.stock, 0)),
        imageHash: trimValue(item?.imageHash || ""),
        items: Array.isArray(item?.items)
          ? item.items.map((line, index) => ({
              productId: trimValue(line?.productId || line?.id || `combo-item-${index + 1}`),
              variantId: trimValue(line?.variantId || ""),
              quantity: Math.max(1, toInt(line?.quantity, 1)),
              name: trimValue(line?.name || ""),
              price: round2(line?.price),
              category: trimValue(line?.category || "")
            })).filter((line) => line.name)
          : []
      }))
    : [];
  const computedSubtotal = calculateOrderSubtotal(items);
  const subtotal = Number.isFinite(Number(base?.subtotal)) && Number(base?.subtotal) > 0
    ? round2(base.subtotal)
    : computedSubtotal;
  const serviceFee = roundFeeFavorCustomer(subtotal * ORDER_SERVICE_FEE_RATE);
  const hasStoredShipping = Number.isFinite(Number(base?.shipping));
  const inferredShipping = Number.isFinite(Number(base?.total))
    ? Math.max(0, round2(Number(base.total) - subtotal - serviceFee))
    : 0;
  const shipping = hasStoredShipping ? round2(base.shipping) : inferredShipping;
  const deliveryDiscount = Math.max(0, round2(base?.deliveryDiscount ?? base?.coupon?.deliveryDiscount ?? 0));
  const shippingBeforeDiscount = Number.isFinite(Number(base?.shippingBeforeDiscount))
    ? Math.max(0, round2(base.shippingBeforeDiscount))
    : round2(shipping + deliveryDiscount);
  const coupon = base?.coupon && typeof base.coupon === "object"
    ? {
        id: trimValue(base.coupon.id || ""),
        code: normalizeCouponCode(base.coupon.code || ""),
        title: trimValue(base.coupon.title || ""),
        appliesTo: "delivery",
        discountType: normalizeCouponDiscountType(base.coupon.discountType),
        discountValue: round2(base.coupon.discountValue || 0),
        deliveryDiscount
      }
    : null;
  const hasDeliveryCost = base?.deliveryCost !== null
    && base?.deliveryCost !== undefined
    && String(base.deliveryCost).trim() !== ""
    && Number.isFinite(Number(base.deliveryCost));
  const deliveryCost = hasDeliveryCost ? round2(base.deliveryCost) : null;
  const deliveryProfit = hasDeliveryCost ? round2(shipping - deliveryCost) : null;
  const total = round2(subtotal + shipping + serviceFee);
  const customer = base?.customer && typeof base.customer === "object" ? base.customer : {};
  const usuarioId = toInt(base?.usuarioId ?? base?.usuario_id, 0);
  const sourceStatusTimestamps = base?.statusTimestamps && typeof base.statusTimestamps === "object" ? base.statusTimestamps : {};
  const statusTimestamps = {
    PENDIENTE: trimValue(sourceStatusTimestamps.PENDIENTE || sourceStatusTimestamps.pendiente || base?.createdAt || ""),
    VALIDADO: trimValue(sourceStatusTimestamps.VALIDADO || sourceStatusTimestamps.validado || sourceStatusTimestamps.APROBADO || ""),
    EN_CAMINO: trimValue(sourceStatusTimestamps.EN_CAMINO || sourceStatusTimestamps.en_camino || sourceStatusTimestamps.ENVIADO || ""),
    ENTREGADO: trimValue(sourceStatusTimestamps.ENTREGADO || sourceStatusTimestamps.entregado || sourceStatusTimestamps.FINALIZADO || sourceStatusTimestamps.CERRADO || ""),
    CANCELADO: trimValue(sourceStatusTimestamps.CANCELADO || sourceStatusTimestamps.cancelado || ""),
    RECHAZADO: trimValue(sourceStatusTimestamps.RECHAZADO || sourceStatusTimestamps.rechazado || "")
  };
  return {
    id: trimValue(base?.id || ""),
    publicCode: trimValue(base?.publicCode || base?.customerCode || ""),
    usuarioId: usuarioId > 0 ? usuarioId : null,
    createdAt: trimValue(base?.createdAt || nowIso()),
    mode: normalizeOrderMode(base?.mode),
    modeLabel: "Delivery",
    pickupDate: "",
    status: normalizeOrderStatus(base?.status),
    customer: {
      name: trimValue(customer?.name || ""),
      phone: trimValue(customer?.phone || ""),
      address: trimValue(customer?.address || ""),
      location: trimValue(customer?.location || ""),
      reference: trimValue(customer?.reference || ""),
      latitud: customer?.latitud ?? null,
      longitud: customer?.longitud ?? null,
      geohash: trimValue(customer?.geohash || ""),
      distrito: trimValue(customer?.distrito || ""),
      ciudad: trimValue(customer?.ciudad || "")
    },
    items,
    subtotal,
    shipping,
    shippingBeforeDiscount,
    deliveryDiscount,
    coupon,
    serviceFee,
    serviceFeeRate: ORDER_SERVICE_FEE_RATE,
    deliveryDistanceKm: base?.deliveryDistanceKm === null || base?.deliveryDistanceKm === undefined
      ? null
      : round2(base?.deliveryDistanceKm),
    deliveryPricingRange: base?.deliveryPricingRange && typeof base.deliveryPricingRange === "object"
      ? normalizeDeliveryRange(base.deliveryPricingRange)
      : null,
    deliveryCost,
    deliveryProfit,
    deliveryFinanceNote: trimValue(base?.deliveryFinanceNote || ""),
    deliveryFinanceAt: trimValue(base?.deliveryFinanceAt || ""),
    storeLatitud: base?.storeLatitud ?? null,
    storeLongitud: base?.storeLongitud ?? null,
    total,
    yapeProof: base?.yapeProof && typeof base.yapeProof === "object"
      ? {
          name: trimValue(base.yapeProof.name || ""),
          dataUrl: trimValue(base.yapeProof.dataUrl || ""),
          label: trimValue(base.yapeProof.label || "Yape")
        }
      : null,
    deliveryProof: base?.deliveryProof && typeof base.deliveryProof === "object"
      ? {
          name: trimValue(base.deliveryProof.name || ""),
          dataUrl: trimValue(base.deliveryProof.dataUrl || ""),
          label: trimValue(base.deliveryProof.label || "InDrive")
        }
      : null,
    reason: trimValue(base?.reason || base?.statusReason || ""),
    statusReason: trimValue(base?.statusReason || base?.reason || ""),
    statusTimestamps,
    notes: trimValue(base?.notes || ""),
    inventoryDispatchedAt: trimValue(base?.inventoryDispatchedAt || ""),
    lastUpdatedAt: trimValue(base?.lastUpdatedAt || base?.createdAt || nowIso())
  };
}

function buildPublicOrderShape(order) {
  const safe = order && typeof order === "object" ? order : {};
  const customer = safe.customer && typeof safe.customer === "object" ? safe.customer : {};
  return {
    id: safe.id,
    publicCode: safe.publicCode,
    createdAt: safe.createdAt,
    lastUpdatedAt: safe.lastUpdatedAt,
    mode: safe.mode,
    modeLabel: safe.modeLabel,
    pickupDate: safe.pickupDate,
    status: safe.status,
    customer: {
      name: trimValue(customer.name || ""),
      distrito: trimValue(customer.distrito || ""),
      ciudad: trimValue(customer.ciudad || "")
    },
    items: Array.isArray(safe.items)
      ? safe.items.map((item) => ({
          id: item.id,
          type: item.type,
          comboId: item.comboId,
          productId: item.productId,
          variantId: item.variantId,
          variantName: item.variantName,
          name: item.name,
          category: item.category,
          price: item.price,
          quantity: item.quantity,
          imageHash: item.imageHash,
          items: Array.isArray(item.items)
            ? item.items.map((line) => ({
                productId: line.productId,
                variantId: line.variantId,
                quantity: line.quantity,
                name: line.name,
                price: line.price,
                category: line.category
              }))
            : []
        }))
      : [],
    subtotal: safe.subtotal,
    shipping: safe.shipping,
    shippingBeforeDiscount: safe.shippingBeforeDiscount,
    deliveryDiscount: safe.deliveryDiscount,
    coupon: safe.coupon,
    serviceFee: safe.serviceFee,
    total: safe.total,
    reason: safe.reason,
    statusReason: safe.statusReason
  };
}

function filterOrders(items, query) {
  const list = Array.isArray(items) ? items : [];
  const term = normalizeText(query?.get("q") || "");
  const statusFilter = normalizeOrderStatus(query?.get("status") || "PENDIENTE");
  const useStatusFilter = query?.get("status") ? true : false;
  const modeFilter = normalizeText(query?.get("mode") || "");
  return list.filter((item) => {
    if (useStatusFilter && item.status !== statusFilter) return false;
    if (modeFilter && modeFilter !== "todos" && item.mode !== normalizeOrderMode(modeFilter)) return false;
    if (!term) return true;
    return (
      normalizeText(item.id).includes(term) ||
      normalizeText(item.publicCode).includes(term) ||
      normalizeText(item.customer?.name).includes(term) ||
      normalizeText(item.customer?.phone).includes(term) ||
      normalizeText(item.customer?.address).includes(term) ||
      normalizeText(item.modeLabel).includes(term) ||
      normalizeText(item.status).includes(term) ||
      item.items.some((product) => normalizeText(product.name).includes(term))
    );
  });
}

async function readOrdersAll(query) {
  const orders = (await readOrdersStore()).map((item) => buildOrderApiShape(item));
  orders.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return filterOrders(orders, query);
}

async function createOrder(payload, options = {}) {
  const customer = payload?.customer && typeof payload.customer === "object" ? payload.customer : {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const mode = normalizeOrderMode(payload?.mode);
  const name = trimValue(customer?.name || "");
  const phone = trimValue(customer?.phone || "");
  const address = trimValue(customer?.address || "");
  const customerLat = Number(customer?.latitud);
  const customerLng = Number(customer?.longitud);
  if (!name) throw createHttpError(400, "El nombre del cliente es obligatorio.");
  if (!phone) throw createHttpError(400, "El celular del cliente es obligatorio.");
  if (!items.length) throw createHttpError(400, "El pedido debe incluir al menos un producto.");
  if (mode === "delivery" && !address) {
    throw createHttpError(400, "La dirección es obligatoria para delivery.");
  }
  if (mode === "delivery" && (!Number.isFinite(customerLat) || !Number.isFinite(customerLng))) {
    throw createHttpError(400, "La ubicación en mapa es obligatoria para delivery.");
  }
  const subtotal = calculateOrderSubtotal(items);
  let shipping = 0;
  let deliveryDistanceKm = null;
  let deliveryPricingRange = null;
  let storeLatitud = null;
  let storeLongitud = null;
  if (mode === "delivery") {
    const deliveryConfig = await readStoreDeliveryConfig();
    const quote = calculateDeliveryQuote(deliveryConfig, { latitud: customerLat, longitud: customerLng });
    if (!quote.available) {
      throw createHttpError(400, quote.message || "No se pudo calcular el delivery.");
    }
    shipping = round2(quote.price);
    deliveryDistanceKm = quote.distanceKm;
    deliveryPricingRange = quote.range;
    storeLatitud = deliveryConfig.store.latitud;
    storeLongitud = deliveryConfig.store.longitud;
  }
  const shippingBeforeDiscount = shipping;
  const couponCode = normalizeCouponCode(payload?.coupon?.code || payload?.couponCode || payload?.codigoCupon || "");
  const coupon = couponCode
    ? await validateCouponForDelivery(couponCode, { shipping: shippingBeforeDiscount })
    : null;
  const deliveryDiscount = coupon ? coupon.deliveryDiscount : 0;
  shipping = round2(Math.max(0, shippingBeforeDiscount - deliveryDiscount));
  const serviceFee = roundFeeFavorCustomer(subtotal * ORDER_SERVICE_FEE_RATE);
  const computedTotal = round2(subtotal + shipping + serviceFee);

  const current = await readOrdersStore();
  const createdAt = trimValue(payload?.createdAt || new Date().toLocaleString("es-PE"));
  const order = buildOrderApiShape({
    id: nextOrderId(current),
    publicCode: nextPublicOrderCode(current),
    usuarioId: toInt(options?.usuarioId ?? payload?.usuarioId ?? payload?.usuario_id, 0) || null,
    createdAt,
    mode,
    modeLabel: "Delivery",
    pickupDate: "",
    status: "PENDIENTE",
    customer: {
      name,
      phone,
      address,
      location: trimValue(customer?.location || ""),
      reference: trimValue(customer?.reference || ""),
      latitud: customer?.latitud ?? null,
      longitud: customer?.longitud ?? null,
      geohash: trimValue(customer?.geohash || ""),
      distrito: trimValue(customer?.distrito || ""),
      ciudad: trimValue(customer?.ciudad || "")
    },
    items,
    subtotal,
    shipping,
    shippingBeforeDiscount,
    deliveryDiscount,
    coupon,
    serviceFee,
    serviceFeeRate: ORDER_SERVICE_FEE_RATE,
    deliveryDistanceKm,
    deliveryPricingRange,
    storeLatitud,
    storeLongitud,
    total: computedTotal,
    yapeProof: payload?.yapeProof || null,
    deliveryProof: payload?.deliveryProof || null,
    reason: trimValue(payload?.reason || payload?.statusReason || ""),
    statusReason: trimValue(payload?.statusReason || payload?.reason || ""),
    statusTimestamps: {
      PENDIENTE: createdAt
    },
    notes: trimValue(payload?.notes || ""),
    lastUpdatedAt: nowIso()
  });

  if (coupon) await consumeCouponUse(coupon.id);
  current.unshift(order);
  await writeOrdersStore(current);

  // Notificación al usuario logueado + chequeo de recompensa de referido
  if (order.usuarioId) {
    try {
      await addNotificacion(order.usuarioId, {
        tipo: "pedido",
        titulo: "Pedido confirmado",
        mensaje: `Tu pedido ${publicOrderCode(order)} fue realizado con éxito. Paga el total indicado y te avisaremos cuando aprobemos tu pago.`,
        icono: "pedido_confirmado",
        link: `/pedidos`
      });
    } catch (_) { /* no bloquea */ }
    try {
      // Si es el primer pedido del usuario y vino por referido, otorga premio al referrer
      const ordersAll = current.filter((o) => Number(o.usuarioId) === Number(order.usuarioId));
      if (ordersAll.length === 1) {
        await promoteInvitacionPrimerPedido(order.usuarioId);
      }
    } catch (_) { /* no bloquea */ }
  }

  return order;
}

function buildOrderStatusNotification(order, previousStatus, nextStatus) {
  if (!order?.usuarioId || previousStatus === nextStatus) return null;
  const orderId = publicOrderCode(order) || "tu pedido";
  const messages = {
    VALIDADO: {
      titulo: "Pago aprobado",
      mensaje: `Importante: verificamos el pago de tu pedido ${orderId}. Te avisaremos cuando tu delivery esté en camino.`,
      icono: "pago_aprobado"
    },
    EN_CAMINO: {
      titulo: "Pedido en camino",
      mensaje: `Tu pedido ${orderId} ya está en camino. Mantente atento al celular para coordinar la entrega.`,
      icono: "pedido_camino"
    },
    ENTREGADO: {
      titulo: "Pedido finalizado",
      mensaje: `Tu pedido ${orderId} fue marcado como entregado. Gracias por comprar con nosotros.`,
      icono: "pedido_entregado"
    },
    CANCELADO: {
      titulo: "Pedido cancelado",
      mensaje: `Tu pedido ${orderId} fue cancelado${order.statusReason ? `: ${order.statusReason}` : "."}`,
      icono: "pedido_cancelado"
    }
  };
  const notification = messages[nextStatus];
  if (!notification) return null;
  return {
    tipo: "pedido",
    ...notification,
    dedupeKey: `order:${order.id}:status:${nextStatus}`,
    link: "/pedidos"
  };
}

function orderInventoryReference(order) {
  return `PEDIDO:${internalOrderCode(order) || publicOrderCode(order) || ""}`.trim();
}

async function hasOrderInventoryMovement(order) {
  const reference = orderInventoryReference(order);
  if (!reference || reference === "PEDIDO:") return false;
  const expectedCount = orderInventoryItems(order).length;
  if (expectedCount <= 0) return false;
  const items = await readKardexAll();
  const movementCount = items.filter((item) => {
    const ref = trimValue(item?.REFERENCIA || item?.referencia || "");
    const note = trimValue(item?.NOTA || item?.nota || "");
    return ref === reference || note.includes(reference);
  }).length;
  return movementCount >= expectedCount;
}

async function updateOrder(orderId, payload) {
  const current = await readOrdersStore();
  const index = current.findIndex((item) => trimValue(item?.id || "") === trimValue(orderId || ""));
  if (index < 0) throw createHttpError(404, "Pedido no encontrado.");

  const existing = buildOrderApiShape(current[index]);
  const previousStatus = existing.status;
  let deliveryCost = existing.deliveryCost;
  let deliveryFinanceNote = existing.deliveryFinanceNote;
  let deliveryFinanceAt = existing.deliveryFinanceAt;
  if (payload?.deliveryCost !== undefined) {
    const nextDeliveryCost = Number(payload.deliveryCost);
    if (!Number.isFinite(nextDeliveryCost) || nextDeliveryCost < 0) {
      throw createHttpError(400, "Costo real de delivery invalido.");
    }
    deliveryCost = round2(nextDeliveryCost);
    deliveryFinanceNote = trimValue(payload?.deliveryFinanceNote || "");
    deliveryFinanceAt = nowIso();
  } else if (payload?.deliveryFinanceNote !== undefined) {
    deliveryFinanceNote = trimValue(payload.deliveryFinanceNote || "");
    deliveryFinanceAt = deliveryCost === null || deliveryCost === undefined ? "" : nowIso();
  }
  const nextStatus = payload?.status !== undefined ? normalizeOrderStatus(payload.status, { strict: true }) : existing.status;
  const statusTimestamps = {
    ...(existing.statusTimestamps || {}),
    ...(payload?.statusTimestamps && typeof payload.statusTimestamps === "object" ? payload.statusTimestamps : {})
  };
  if (previousStatus !== nextStatus && !trimValue(statusTimestamps[nextStatus] || "")) {
    statusTimestamps[nextStatus] = nowIso();
  }
  const next = buildOrderApiShape({
    ...existing,
    status: nextStatus,
    reason: payload?.reason !== undefined ? trimValue(payload.reason || "") : existing.reason,
    statusReason: payload?.reason !== undefined
      ? trimValue(payload.reason || "")
      : payload?.statusReason !== undefined
        ? trimValue(payload.statusReason || "")
        : existing.statusReason,
    notes: payload?.notes !== undefined ? trimValue(payload.notes || "") : existing.notes,
    deliveryProof:
      payload?.deliveryProof !== undefined
        ? payload.deliveryProof
        : existing.deliveryProof,
    yapeProof:
      payload?.yapeProof !== undefined
        ? payload.yapeProof
        : existing.yapeProof,
    deliveryCost,
    deliveryFinanceNote,
    deliveryFinanceAt,
    statusTimestamps,
    inventoryDispatchedAt: existing.inventoryDispatchedAt,
    lastUpdatedAt: nowIso()
  });

  let nextOrder = next;
  const shouldReachInventoryExit = ["EN_CAMINO", "ENTREGADO"].includes(next.status);
  const statusEnteredDispatchStage = previousStatus !== next.status && shouldReachInventoryExit;
  const alreadyHasInventoryMovement = shouldReachInventoryExit ? await hasOrderInventoryMovement(next) : false;
  const shouldDispatchInventory = shouldReachInventoryExit && statusEnteredDispatchStage && !alreadyHasInventoryMovement;
  if (shouldDispatchInventory) {
    await dispatchOrderInventory(next);
    nextOrder = buildOrderApiShape({
      ...next,
      inventoryDispatchedAt: nowIso(),
      lastUpdatedAt: nowIso()
    });
  }

  current[index] = nextOrder;
  await writeOrdersStore(current);
  const notification = buildOrderStatusNotification(nextOrder, previousStatus, nextOrder.status);
  if (notification) {
    try {
      await addNotificacion(nextOrder.usuarioId, notification);
    } catch (_) { /* no bloquea el cambio de estado */ }
  }
  return nextOrder;
}

function orderInventoryItems(order) {
  const rows = [];
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    const itemQuantity = Math.max(1, toInt(item?.quantity, 1));
    if (item?.type === "combo" && Array.isArray(item.items)) {
      for (const line of item.items) {
        const productId = parseCartProductId(line?.productId || line?.parentProductId || line?.id);
        if (productId <= 0) continue;
        rows.push({
          productId,
          variantId: trimValue(line?.variantId || ""),
          cantidad: Math.max(1, toInt(line?.quantity, 1)) * itemQuantity,
          presentacionCigarro: trimValue(line?.presentacionCigarro || line?.cigarettePresentation || "")
        });
      }
      continue;
    }
    const productId = parseCartProductId(item?.productId || item?.parentProductId || item?.id);
    if (productId <= 0) continue;
    rows.push({
      productId,
      variantId: trimValue(item?.variantId || ""),
      cantidad: itemQuantity,
      presentacionCigarro: trimValue(item?.presentacionCigarro || item?.cigarettePresentation || "")
    });
  }
  return rows;
}

async function dispatchOrderInventory(order) {
  const items = orderInventoryItems(order);
  if (!items.length) return null;
  const reference = orderInventoryReference(order);
  const customerReference = publicOrderCode(order);
  try {
    return await registerSaleBatchFirebase({
      items,
      fechaVenta: defaultSaleDateTime(),
      tipoPago: "Pedido web",
      origen: reference,
      referencia: reference,
      nota: `Salida automatica ${reference}${customerReference ? ` | Codigo cliente ${customerReference}` : ""}`.trim()
    });
  } catch (error) {
    if (error?.status) throw error;
    throw createHttpError(
      503,
      `No se pudo descontar inventario en Firebase para ${internalOrderCode(order) || publicOrderCode(order) || "el pedido"}. ${buildDbErrorMessage(error)}`
    );
  }
}

function resolveStaticFilePath(rootDir, requestPath) {
  const pathname = String(requestPath || "/");
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = path.normalize(path.join(rootDir, relativePath));
  if (!safePath.startsWith(rootDir)) return null;
  return safePath;
}

function staticCandidatePaths(requestPath) {
  const normalizedPath = requestPath || "/";
  const aliases =
    normalizedPath === "/" || normalizedPath === "/index.html"
      ? ["/index.html"]
      : normalizedPath === "/admin.html"
        ? ["/admin.html", "/admin.react.html"]
        : [normalizedPath];

  const candidates = [];
  for (const alias of aliases) {
    const distPath = resolveStaticFilePath(DIST_ROOT, alias);
    if (distPath) candidates.push(distPath);
    const projectPath = resolveStaticFilePath(STATIC_ROOT, alias);
    if (projectPath) candidates.push(projectPath);
  }
  if (!path.extname(normalizedPath)) {
    const spaIndexPath = resolveStaticFilePath(DIST_ROOT, "/index.html");
    if (spaIndexPath) candidates.push(spaIndexPath);
  }
  return candidates;
}

async function serveStatic(req, res, requestPath) {
  const candidatePaths = staticCandidatePaths(requestPath);
  if (!candidatePaths.length) {
    sendText(res, 403, "Acceso denegado.");
    return;
  }

  for (const filePath of candidatePaths) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) continue;

      const extension = path.extname(filePath).toLowerCase();
      const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
      const content = await fs.readFile(filePath);
      const noCacheExtensions = new Set([".html", ".css", ".js", ".json"]);
      const cacheControl = noCacheExtensions.has(extension)
        ? "no-store, no-cache, must-revalidate, max-age=0"
        : "public, max-age=86400";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        Pragma: "no-cache",
        Expires: "0"
      });
      res.end(content);
      return;
    } catch {
      // Intenta el siguiente candidato.
    }
  }

  sendText(res, 404, "No encontrado.");
}

function productRowToApi(row) {
  return buildProductApiShape({
    id: row?.id,
    nombre: row?.nombre,
    descripcion: row?.descripcion,
    categoria: row?.categoria,
    precio: row?.precio,
    precio_compra: row?.precio_compra,
    imagenes_json: row?.imagenes_json,
    cigarette_presentations_json: row?.cigarette_presentations_json,
    pedido: row?.pedido,
    stock_minimo: row?.stock_minimo,
    stock_actual: row?.stock_actual,
    estado: row?.estado
  });
}

function saleRowToApi(row) {
  const saleDate = extractIsoDateOnly(row?.fecha_venta) || todayIsoDate();
  const localReferenceDateTime =
    formatDateTimeMinutes(row?.fecha_venta || row?.fecha_operativa || "") ||
    formatStoredUtcToLima(row?.fecha_referencia);
  const operativeDate = buildOperativeDateTimeDisplay(row?.fecha_venta || row?.fecha_operativa, localReferenceDateTime || row?.fecha_venta);
  const dayTurno = formatOperationalDayLabel(
    getOperationalDayKey(localReferenceDateTime || row?.fecha_venta || row?.fecha_operativa)
  );
  const saleStatus = normalizeText(row?.estado || "ACTIVA") === "anulada" ? "ANULADA" : "ACTIVA";
  return {
    ID_VENTA: toInt(row?.id_venta, 0),
    FECHA_VENTA: saleDate,
    FECHA_REFERENCIA: localReferenceDateTime,
    DIA_TURNO: dayTurno,
    FECHA_OPERATIVA: operativeDate,
    "N°": toInt(row?.producto_id, 0),
    NOMBRE: trimValue(row?.nombre_snapshot || ""),
    CANTIDAD: round2(row?.cantidad),
    PRECIO: round2(row?.precio),
    TOTAL: round2(row?.total),
    TIPO_PAGO: resolveSalePaymentDisplay(row?.tipo_pago, row?.tipo_pago_detalle),
    TIPO_PAGO_DETALLE: trimValue(row?.tipo_pago_detalle || row?.tipo_pago || ""),
    ORIGEN: trimValue(row?.origen || "MANUAL") || "MANUAL",
    ESTADO: saleStatus,
    ANULADA_AT: trimValue(row?.anulada_at || ""),
    ANULADA_MOTIVO: trimValue(row?.anulada_motivo || "")
  };
}

function normalizeKardexReferenceValue(value) {
  return trimValue(value || "").toUpperCase();
}

function classifyKardexMovement(row) {
  const type = normalizeKardexType(row?.TIPO || row?.tipo) || "SALIDA";
  const reference = normalizeKardexReferenceValue(row?.REFERENCIA || row?.referencia);
  const saleId = toInt(row?.ID_VENTA ?? row?.venta_id, 0);

  if (type !== "INGRESO") {
    return {
      MOVIMIENTO_CLASE: "TECNICO",
      ES_INGRESO_REAL: false
    };
  }

  if (REAL_KARDEX_INGRESS_REFERENCES.has(reference)) {
    return {
      MOVIMIENTO_CLASE: "REAL",
      ES_INGRESO_REAL: true
    };
  }

  if (reference === "AJUSTE_PRODUCTO" && saleId <= 0) {
    return {
      MOVIMIENTO_CLASE: "REAL",
      ES_INGRESO_REAL: true
    };
  }

  if (saleId > 0 || TECHNICAL_KARDEX_INGRESS_REFERENCES.has(reference)) {
    return {
      MOVIMIENTO_CLASE: "TECNICO",
      ES_INGRESO_REAL: false
    };
  }

  return {
    MOVIMIENTO_CLASE: "TECNICO",
    ES_INGRESO_REAL: false
  };
}

function kardexRowToApi(row) {
  return {
    ID_MOV: toInt(row?.id_mov, 0),
    FECHA_HORA: formatStoredUtcToLima(row?.fecha_hora, { withSeconds: true }) || trimValue(row?.fecha_hora || ""),
    ID_VENTA: toInt(row?.venta_id, 0),
    "N°": toInt(row?.producto_id, 0),
    NOMBRE: trimValue(row?.nombre_snapshot || ""),
    TIPO: normalizeKardexType(row?.tipo) || "SALIDA",
    CANTIDAD: round2(row?.cantidad),
    STOCK_ANTES: round2(row?.stock_antes),
    STOCK_DESPUES: round2(row?.stock_despues),
    REFERENCIA: trimValue(row?.referencia || ""),
    NOTA: trimValue(row?.nota || ""),
    ...classifyKardexMovement(row)
  };
}

function csvProductToApi(row) {
  return buildProductApiShape(row);
}

function firebaseProductToApi(row) {
  return buildProductApiShape({
    ...row,
    "N°": row?.numero ?? row?.legacyId ?? row?.productId ?? row?.id,
    NOMBRE: row?.nombre,
    DESCRIPCION: row?.descripcion,
    CATEGORIA: row?.categoria,
    PRECIO: row?.precio,
    PRECIO_COMPRA: row?.precioCompra,
    IMAGENES: row?.imagenes,
    CIGARRO_PRESENTACIONES: row?.presentacionesCigarro,
    CIGARRO_STOCK_LINK: row?.cigaretteStockLink,
    VARIANTES: row?.variantes,
    STOCK_MAXIMO: row?.stockMaximo,
    STOCK_MINIMO: row?.stockMinimo,
    STOCK_ACTUAL: row?.stockActual,
    ESTADO: row?.estado
  });
}

function normalizeCigaretteStockLink(value) {
  const source = value && typeof value === "object" ? value : {};
  const unitProductId = trimValue(source.unitProductId ?? source.unit_product_id ?? "");
  const box20ProductId = trimValue(source.box20ProductId ?? source.box20_product_id ?? "");
  const enabled = source.enabled === true && unitProductId && box20ProductId && unitProductId !== box20ProductId;
  return cleanForFirestore({
    enabled: Boolean(enabled),
    unitProductId,
    box20ProductId,
    unitsPerBox: 20
  });
}

function slugifyDocumentId(value) {
  return trimValue(value || "item")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

function buildFirebaseProductDoc(payload, existing = {}) {
  const legacyId = trimValue(payload?.["N°"] ?? payload?.id ?? payload?.n ?? existing?.legacyId ?? existing?.numero ?? existing?.id ?? "");
  const name = trimValue(payload?.NOMBRE ?? payload?.nombre ?? existing?.nombre ?? existing?.NOMBRE ?? "");
  if (!name) throw createHttpError(400, "El campo NOMBRE es obligatorio.");
  const variants = normalizeProductVariants(payload?.VARIANTES ?? payload?.variantes ?? payload?.variants ?? existing?.variantes ?? existing?.VARIANTES ?? []);
  const price = parseNonNegativeNumber(payload?.PRECIO ?? payload?.precio ?? existing?.precio ?? 0, "PRECIO");
  const stockInput = payload?.STOCK_ACTUAL ?? payload?.stockActual ?? payload?.stock_actual ?? payload?.stock ?? existing?.stockActual ?? existing?.STOCK_ACTUAL ?? 0;
  const stockActual = Math.max(parseNonNegativeInteger(stockInput, "STOCK_ACTUAL"), sumVariantStock(variants));
  const numero = toInt(legacyId, 0);
  const slug = `${slugifyDocumentId(name)}${numero > 0 ? `-${numero}` : ""}`;
  return cleanForFirestore({
    id: slug,
    legacyId: numero > 0 ? String(numero) : legacyId,
    numero,
    slug,
    nombre: name,
    descripcion: truncateText(payload?.DESCRIPCION ?? payload?.descripcion ?? payload?.descripcion_larga ?? existing?.descripcion ?? "", 255),
    categoria: normalizeProductCategoryValue(payload?.CATEGORIA ?? payload?.categoria ?? existing?.categoria ?? "OTRO"),
    precio: price,
    precioCompra: parseNonNegativeNumber(payload?.PRECIO_COMPRA ?? payload?.precio_compra ?? payload?.precioCompra ?? existing?.precioCompra ?? 0, "PRECIO_COMPRA"),
    imagenes: normalizeProductImages(payload?.IMAGENES ?? payload?.imagenes ?? payload?.imagenes_json ?? existing?.imagenes ?? []),
    presentacionesCigarro: normalizeCigarettePresentations(
      payload?.CIGARRO_PRESENTACIONES ??
        payload?.cigarettePresentations ??
        payload?.presentacionesCigarro ??
        existing?.presentacionesCigarro,
      price
    ),
    cigaretteStockLink: normalizeCigaretteStockLink(
      payload?.CIGARRO_STOCK_LINK ??
        payload?.cigaretteStockLink ??
        payload?.stockLinkCigarro ??
        existing?.cigaretteStockLink
    ),
    variantes: variants,
    stockMaximo: parseNonNegativeInteger(payload?.STOCK_MAXIMO ?? payload?.stock_maximo ?? payload?.stockMaximo ?? payload?.PEDIDO ?? payload?.pedido ?? existing?.stockMaximo ?? 0, "STOCK_MAXIMO"),
    stockMinimo: parseNonNegativeInteger(payload?.STOCK_MINIMO ?? payload?.stockMinimo ?? payload?.stock_minimo ?? existing?.stockMinimo ?? 0, "STOCK_MINIMO"),
    stockActual,
    estado: normalizeProductStatus(payload?.ESTADO ?? payload?.estado ?? payload?.status ?? existing?.estado ?? "ACTIVO") || "ACTIVO",
    updatedAt: nowIso(),
    createdAt: existing?.createdAt || nowIso()
  });
}

async function createProductFirebase(payload) {
  const db = getFirebaseDb();
  if (!db) return null;
  const current = await readFirebaseCollection("products") || [];
  let nextNumero = toInt(payload?.["N°"] ?? payload?.id ?? payload?.n, 0);
  if (nextNumero <= 0) {
    nextNumero = current.reduce((max, item) => Math.max(max, toInt(item.numero ?? item.legacyId, 0)), 0) + 1;
  }
  if (current.some((item) => toInt(item.numero ?? item.legacyId, 0) === nextNumero)) {
    throw createHttpError(409, `Ya existe producto con N° ${nextNumero}.`);
  }
  const imageSafePayload = await replaceImageDataUrisWithStorageUrls(
    { ...payload, "N°": nextNumero },
    `products/${nextNumero}`,
    `product-${nextNumero}`
  );
  const doc = buildFirebaseProductDoc(imageSafePayload);
  await writeFirebaseDoc("products", doc.id, doc);
  return firebaseProductToApi(doc);
}

async function updateProductFirebase(idInput, payload) {
  const db = getFirebaseDb();
  if (!db) return null;
  const id = parsePositiveInt(idInput, "N°");
  const current = await readFirebaseCollection("products") || [];
  const existing = current.find((item) => toInt(item.numero ?? item.legacyId, 0) === id);
  if (!existing) throw createHttpError(404, `No existe producto con N° ${id}.`);
  const imageSafePayload = await replaceImageDataUrisWithStorageUrls(
    { ...payload, "N°": id },
    `products/${id}`,
    `product-${id}`
  );
  const doc = buildFirebaseProductDoc(imageSafePayload, existing);
  const oldId = existing.id;
  await writeFirebaseDoc("products", doc.id, doc);
  if (oldId && oldId !== doc.id) {
    await db.collection(firebaseCollectionName("products")).doc(oldId).delete();
  }
  return firebaseProductToApi(doc);
}

async function deleteProductFirebase(idInput) {
  const db = getFirebaseDb();
  if (!db) return null;
  const id = parsePositiveInt(idInput, "N°");
  const current = await readFirebaseCollection("products") || [];
  const existing = current.find((item) => toInt(item.numero ?? item.legacyId, 0) === id);
  if (!existing) throw createHttpError(404, `No existe producto con N° ${id}.`);
  const doc = { ...existing, estado: "INACTIVO", updatedAt: nowIso() };
  await writeFirebaseDoc("products", existing.id, doc);
  return firebaseProductToApi(doc);
}

function csvSaleToApi(row) {
  const saleDate = extractIsoDateOnly(row?.FECHA_VENTA || row?.FECHA || row?.fecha) || todayIsoDate();
  const saleDateTime = formatDateTimeMinutes(
    row?.FECHA_VENTA || row?.fecha_venta || row?.FECHA_OPERATIVA || row?.FECHA || row?.fecha || ""
  );
  const operativeDate = buildOperativeDateTimeDisplay(
    row?.FECHA_OPERATIVA,
    row?.FECHA_VENTA || row?.FECHA || row?.fecha || saleDate
  );
  const dayTurno = formatOperationalDayLabel(
    getOperationalDayKey(row?.FECHA_VENTA || row?.FECHA_OPERATIVA || row?.FECHA || row?.fecha)
  );
  const saleStatus = normalizeText(row?.ESTADO || row?.estado || "ACTIVA") === "anulada" ? "ANULADA" : "ACTIVA";
  return {
    ID_VENTA: toInt(row?.ID_VENTA ?? row?.id_venta, 0),
    FECHA_VENTA: saleDate,
    FECHA_REFERENCIA: saleDateTime,
    DIA_TURNO: dayTurno,
    FECHA_OPERATIVA: operativeDate,
    "N°": resolveProductIdValue(row),
    NOMBRE: trimValue(row?.NOMBRE || row?.nombre_snapshot || ""),
    CANTIDAD: round2(row?.CANTIDAD ?? row?.cantidad),
    PRECIO: round2(row?.PRECIO ?? row?.precio),
    TOTAL: round2(row?.TOTAL ?? row?.total),
    TIPO_PAGO: resolveSalePaymentDisplay(
      row?.TIPO_PAGO ?? row?.tipo_pago,
      row?.TIPO_PAGO_DETALLE ?? row?.tipo_pago_detalle
    ),
    TIPO_PAGO_DETALLE: trimValue(
      row?.TIPO_PAGO_DETALLE ?? row?.tipo_pago_detalle ?? row?.TIPO_PAGO ?? row?.tipo_pago ?? ""
    ),
    ORIGEN: trimValue(row?.ORIGEN || row?.origen || "MANUAL") || "MANUAL",
    ESTADO: saleStatus,
    ANULADA_AT: trimValue(row?.ANULADA_AT || row?.anulada_at || ""),
    ANULADA_MOTIVO: trimValue(row?.ANULADA_MOTIVO || row?.anulada_motivo || "")
  };
}

function csvKardexToApi(row) {
  return {
    ID_MOV: toInt(row?.ID_MOV ?? row?.id_mov, 0),
    FECHA_HORA: trimValue(row?.FECHA_HORA || row?.fecha_hora || ""),
    ID_VENTA: toInt(row?.ID_VENTA ?? row?.venta_id, 0),
    "N°": resolveProductIdValue(row),
    NOMBRE: trimValue(row?.NOMBRE || row?.nombre_snapshot || ""),
    TIPO: normalizeKardexType(row?.TIPO || row?.tipo) || "SALIDA",
    CANTIDAD: round2(row?.CANTIDAD ?? row?.cantidad),
    STOCK_ANTES: round2(row?.STOCK_ANTES ?? row?.stock_antes),
    STOCK_DESPUES: round2(row?.STOCK_DESPUES ?? row?.stock_despues),
    REFERENCIA: trimValue(row?.REFERENCIA || row?.referencia || ""),
    NOTA: trimValue(row?.NOTA || row?.nota || ""),
    ...classifyKardexMovement(row)
  };
}

function purchasePriceHistoryRowToApi(row) {
  const fechaHora = formatStoredUtcToLima(row?.fecha_hora, { withSeconds: true }) || trimValue(row?.fecha_hora || "");
  return {
    ID_HISTORIAL: toInt(row?.id_historial, 0),
    FECHA_HORA: fechaHora,
    "N°": toInt(row?.producto_id, 0),
    NOMBRE: trimValue(row?.nombre_snapshot || ""),
    PRECIO_COMPRA: round2(row?.precio_compra),
    NOTA: trimValue(row?.nota || ""),
    ORIGEN: trimValue(row?.origen || "")
  };
}

function csvPurchasePriceHistoryToApi(row) {
  return {
    ID_HISTORIAL: toInt(row?.ID_HISTORIAL ?? row?.id_historial, 0),
    FECHA_HORA: trimValue(row?.FECHA_HORA || row?.fecha_hora || ""),
    "N°": resolveProductIdValue(row),
    NOMBRE: trimValue(row?.NOMBRE || row?.nombre_snapshot || ""),
    PRECIO_COMPRA: round2(row?.PRECIO_COMPRA ?? row?.precio_compra),
    NOTA: trimValue(row?.NOTA || row?.nota || ""),
    ORIGEN: trimValue(row?.ORIGEN || row?.origen || "")
  };
}

function shouldUseLocalCsvFallback(error) {
  const code = trimValue(error?.code || "");
  if (
    ["ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "ER_ACCESS_DENIED_ERROR"].includes(code)
  ) {
    return true;
  }

  const message = trimValue(error?.message || "");
  return /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ACCESS DENIED|connect/i.test(message);
}

async function isMysqlOnlyModeEnabled() {
  const envValues = await readEnvValuesQuiet();
  const raw = trimValue(process.env.DB_FORCE_MYSQL_ONLY || envValues.DB_FORCE_MYSQL_ONLY || "");
  return /^(1|true|yes|on)$/i.test(raw);
}

async function ensureLocalCsvReady() {
  await csvDb.ensureInventoryData();
}

async function readLocalProductsCached() {
  const sourceInfo = typeof csvDb.getSourceInfo === "function" ? csvDb.getSourceInfo() : null;
  const csvPath = sourceInfo?.activeCsvPath || sourceInfo?.defaultCsvPath || path.join(PROJECT_DIR, "productos.csv");
  let mtimeMs = Date.now();
  try {
    const stats = await fs.stat(csvPath);
    mtimeMs = Number(stats.mtimeMs || 0);
  } catch {}
  if (Array.isArray(localProductsCache.items) && localProductsCache.mtimeMs === mtimeMs) {
    return localProductsCache.items;
  }
  if (localProductsCache.promise) return localProductsCache.promise;
  localProductsCache.promise = csvDb.readProducts()
    .then((rows) => {
      const items = Array.isArray(rows) ? rows : [];
      localProductsCache = { items, mtimeMs, promise: null };
      return items;
    })
    .catch((error) => {
      localProductsCache.promise = null;
      throw error;
    });
  return localProductsCache.promise;
}

async function readLocalProductsLightCached() {
  const sourceInfo = typeof csvDb.getSourceInfo === "function" ? csvDb.getSourceInfo() : null;
  const csvPath = sourceInfo?.activeCsvPath || sourceInfo?.defaultCsvPath || path.join(PROJECT_DIR, "productos.csv");
  let mtimeMs = Date.now();
  try {
    const stats = await fs.stat(csvPath);
    mtimeMs = Number(stats.mtimeMs || 0);
  } catch {}
  if (Array.isArray(localProductsLightCache.items) && localProductsLightCache.mtimeMs === mtimeMs) {
    return localProductsLightCache.items;
  }
  if (localProductsLightCache.promise) return localProductsLightCache.promise;
  localProductsLightCache.promise = fs.readFile(csvPath, "utf8")
    .then((raw) => {
      const items = parseProductsCsvLight(raw);
      localProductsLightCache = { items, mtimeMs, promise: null };
      return items;
    })
    .catch((error) => {
      localProductsLightCache.promise = null;
      throw error;
    });
  return localProductsLightCache.promise;
}

function parseProductsCsvLight(raw) {
  const headers = [];
  const rows = [];
  let row = [];
  let value = "";
  let fieldIndex = 0;
  let inQuotes = false;
  let headerReady = false;
  let skipValue = false;
  let skippedHasValue = false;

  function currentHeader() {
    return headerReady ? String(headers[fieldIndex] || "").replace(/^\uFEFF/, "") : "";
  }

  function pushField() {
    const text = skipValue ? (skippedHasValue ? "[]" : "") : value;
    row.push(text);
    value = "";
    fieldIndex += 1;
    skipValue = currentHeader() === "IMAGENES";
    skippedHasValue = false;
  }

  function pushRow() {
    pushField();
    if (!headerReady) {
      headers.splice(0, headers.length, ...row.map((entry) => String(entry || "").replace(/^\uFEFF/, "")));
      headerReady = true;
    } else if (row.some((entry) => String(entry || "").trim())) {
      const item = {};
      for (let index = 0; index < headers.length; index += 1) {
        const key = headers[index];
        if (key) item[key] = row[index] ?? "";
      }
      rows.push(item);
    }
    row = [];
    fieldIndex = 0;
    skipValue = currentHeader() === "IMAGENES";
    skippedHasValue = false;
  }

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\"") {
      if (inQuotes && raw[index + 1] === "\"") {
        if (!skipValue) value += "\"";
        skippedHasValue = skippedHasValue || skipValue;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      pushField();
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    if (skipValue) {
      if (!/\s/.test(char)) skippedHasValue = true;
    } else {
      value += char;
    }
  }
  if (value || row.length) pushRow();
  return rows;
}

function invalidateLocalProductsCache() {
  localProductsCache = { items: null, mtimeMs: 0, promise: null };
  localProductsLightCache = { items: null, mtimeMs: 0, promise: null };
  storefrontProductsCache = { items: null, savedAt: 0 };
}

async function withDataSourceFallback(operationName, mysqlExecutor, localExecutor) {
  if (isFirebaseBackendEnabled()) {
    return localExecutor(createHttpError(503, `Firebase no devolvió datos para ${operationName}.`));
  }
  if (mysqlFallbackUntil > Date.now() && !(await isMysqlOnlyModeEnabled())) {
    return localExecutor(createHttpError(503, mysqlFallbackMessage || "MySQL no disponible temporalmente."));
  }
  try {
    return await withMysqlFallbackTimeout(mysqlExecutor(), operationName);
  } catch (error) {
    if (!shouldUseLocalCsvFallback(error)) throw error;
    mysqlFallbackUntil = Date.now() + MYSQL_FALLBACK_COOLDOWN_MS;
    mysqlFallbackMessage = buildDbErrorMessage(error);
    if (await isMysqlOnlyModeEnabled()) {
      throw createHttpError(
        503,
        `MySQL no disponible para ${operationName}. El fallback CSV está deshabilitado (DB_FORCE_MYSQL_ONLY=true).`
      );
    }
    await ensureLocalCsvReady();
    await appendLog("WARN", "Fallback a CSV local", {
      operation: operationName,
      message: buildDbErrorMessage(error)
    });
    return localExecutor(error);
  }
}

function withMysqlFallbackTimeout(promise, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`ETIMEDOUT: MySQL no respondio a tiempo para ${operationName}.`);
        error.code = "ETIMEDOUT";
        reject(error);
      }, MYSQL_FALLBACK_TIMEOUT_MS);
    })
  ]);
}

async function ensureKardexTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS kardex_movimientos (
      id_mov INT NOT NULL AUTO_INCREMENT,
      fecha_hora DATETIME NOT NULL,
      producto_id INT NOT NULL,
      nombre_snapshot VARCHAR(180) NOT NULL,
      tipo ENUM('INGRESO', 'SALIDA') NOT NULL,
      cantidad DECIMAL(12,2) UNSIGNED NOT NULL,
      stock_antes DECIMAL(12,2) UNSIGNED NOT NULL,
      stock_despues DECIMAL(12,2) UNSIGNED NOT NULL,
      referencia VARCHAR(80) NULL,
      venta_id INT NULL,
      nota VARCHAR(255) NULL,
      PRIMARY KEY (id_mov),
      KEY idx_kardex_fecha_hora (fecha_hora),
      KEY idx_kardex_producto (producto_id),
      KEY idx_kardex_tipo (tipo),
      KEY idx_kardex_referencia (referencia),
      KEY idx_kardex_venta_id (venta_id)
    ) ENGINE=InnoDB
  `);
}

async function ensureProductMinimumStockColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN stock_minimo DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0 AFTER stock_actual"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function ensureProductPurchasePriceColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN precio_compra DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0 AFTER precio"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function ensureProductImagesColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN imagenes_json LONGTEXT NULL AFTER precio_compra"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function ensureProductImagesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS producto_imagenes (
      id INT NOT NULL AUTO_INCREMENT,
      producto_id INT NOT NULL,
      orden INT NOT NULL DEFAULT 0,
      es_portada TINYINT(1) NOT NULL DEFAULT 0,
      original_webp_url LONGTEXT NULL,
      thumb_webp_url LONGTEXT NULL,
      mime VARCHAR(80) NULL,
      width INT UNSIGNED NOT NULL DEFAULT 0,
      height INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_producto_imagenes_producto (producto_id),
      KEY idx_producto_imagenes_portada (producto_id, es_portada, orden)
    ) ENGINE=InnoDB
  `);
  await ensureProductImageHashColumn(connection);
}

async function ensureProductImageHashColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE producto_imagenes ADD COLUMN hash_image VARCHAR(64) NULL AFTER thumb_webp_url"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
  try {
    await connection.query(
      "ALTER TABLE producto_imagenes ADD INDEX idx_producto_imagenes_hash (hash_image)"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_KEYNAME") throw error;
  }
}

function computeImageHash(content) {
  const source = typeof content === "string" ? content : "";
  if (!source) return "";
  return crypto.createHash("sha256").update(source).digest("hex");
}

function parseDataUri(value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) return null;
  const match = source.match(/^data:([^;,]+)?(?:;([^,]+))?,(.*)$/s);
  if (!match) {
    return { mime: "", encoding: "", payload: source, isDataUri: false };
  }
  return {
    mime: (match[1] || "").trim(),
    encoding: (match[2] || "").trim().toLowerCase(),
    payload: match[3] || "",
    isDataUri: true
  };
}

async function readProductsStorefront() {
  if (
    Array.isArray(storefrontProductsCache.items) &&
    Date.now() - storefrontProductsCache.savedAt < STOREFRONT_PRODUCTS_CACHE_TTL_MS
  ) {
    return storefrontProductsCache.items.filter(hasSellableStock);
  }

  try {
    const remote = await readFirebaseCollection("products");
    if (Array.isArray(remote)) {
      const items = remote.map(firebaseProductToApi).sort((a, b) => trimValue(a.NOMBRE).localeCompare(trimValue(b.NOMBRE), "es", { numeric: true }));
      storefrontProductsCache = { items, savedAt: Date.now() };
      return items.filter(hasSellableStock);
    }
  } catch (error) {
    await appendLog("WARN", "Fallback local de productos storefront", {
      operation: "readProductsStorefront",
      message: buildDbErrorMessage(error)
    });
  }

  const items = await withDataSourceFallback(
    "readProductsStorefront",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductCategoryColumn(connection);
        await ensureProductDescriptionColumn(connection);
        await ensureProductImagesTable(connection);
        await ensureProductVariantsColumn(connection);

        const [rows] = await connection.query(
          `SELECT id, nombre, descripcion, categoria, precio, stock_actual, estado, imagenes_json, variantes_json
           FROM productos
           WHERE UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
           ORDER BY nombre ASC`
        );
        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) return [];

        const ids = safeRows.map((row) => toInt(row.id, 0)).filter((id) => id > 0);
        const placeholders = ids.map(() => "?").join(",");
        const [imgRows] = await connection.query(
          `SELECT id, producto_id, hash_image, thumb_webp_url, original_webp_url, mime, width, height
           FROM producto_imagenes
           WHERE producto_id IN (${placeholders})
           ORDER BY producto_id ASC, es_portada DESC, orden ASC, id ASC`,
          ids
        );

        const coverByProduct = new Map();
        const imagesByProduct = new Map();
        for (const row of Array.isArray(imgRows) ? imgRows : []) {
          const productId = toInt(row?.producto_id, 0);
          const image = productImageRowToApi(row);
          if (productId && image) {
            const list = imagesByProduct.get(productId) || [];
            list.push(image);
            imagesByProduct.set(productId, list.slice(0, 3));
          }
          if (!productId || coverByProduct.has(productId)) continue;
          let hash = typeof row?.hash_image === "string" ? row.hash_image.trim().toLowerCase() : "";
          if (!hash) {
            const source = row?.thumb_webp_url || row?.original_webp_url || "";
            hash = computeImageHash(source);
            if (hash) {
              try {
                await connection.query(
                  "UPDATE producto_imagenes SET hash_image = ? WHERE id = ?",
                  [hash, row.id]
                );
              } catch (_) {}
            }
          }
          if (hash) coverByProduct.set(productId, hash);
        }

        for (const row of safeRows) {
          const productId = toInt(row?.id, 0);
          if (!productId || coverByProduct.has(productId)) continue;
          const legacyImages = normalizeProductImages(row?.imagenes_json);
          if (!legacyImages.length) continue;
          const cover = legacyImages[0];
          const original = cover.original_webp_url || cover.filtered_image_url || cover.original_image_url || "";
          const thumb = cover.thumb_webp_url || cover.filtered_image_url || original || "";
          const source = thumb || original;
          const hash = computeImageHash(source);
          if (!hash) continue;
          try {
            await connection.query(
              `INSERT INTO producto_imagenes
                (producto_id, orden, es_portada, original_webp_url, thumb_webp_url, hash_image, mime, width, height)
               VALUES (?, 0, 1, ?, ?, ?, ?, ?, ?)`,
              [
                productId,
                original || null,
                thumb || null,
                hash,
                cover.mime || "image/webp",
                toInt(cover.width, 0),
                toInt(cover.height, 0)
              ]
            );
          } catch (_) {}
          coverByProduct.set(productId, hash);
          imagesByProduct.set(productId, [cover]);
        }

        const csvImagesByProduct = new Map();

        return safeRows.map((row) => {
          const productId = toInt(row?.id, 0);
          const description = String(row?.descripcion ?? "");
          const legacyImages = normalizeProductImages(row?.imagenes_json);
          const tableImages = imagesByProduct.get(productId) || [];
          const csvImages = csvImagesByProduct.get(productId) || [];
          const images = tableImages.length ? tableImages : legacyImages.length ? legacyImages : csvImages;
          const cover = images[0] || {};
          const imageUrlCandidates = [
            cover.thumb_webp_url,
            cover.filtered_image_url,
            cover.original_webp_url,
            cover.original_image_url
          ];
          const lightweightImageUrl =
            imageUrlCandidates.find((value) => {
              const source = String(value || "").trim();
              return source && !source.startsWith("data:");
            }) || (images.length ? `/api/productos/imagen-producto/${productId}` : "");
          return {
            id: String(row?.id ?? ""),
            name: String(row?.nombre ?? ""),
            category: normalizeProductCategoryValue(row?.categoria ?? "OTRO"),
            price: round2(row?.precio ?? 0),
            stock: round2(Math.max(0, toNumber(row?.stock_actual, 0))),
            status: normalizeProductStatus(row?.estado ?? "ACTIVO") || "ACTIVO",
            variants: normalizeProductVariants(row?.variantes_json),
            imageHash: coverByProduct.get(productId) || "",
            imageUrl: lightweightImageUrl,
            shortDescription: description.length > 140 ? `${description.slice(0, 140)}…` : description
          };
        });
      }),
    async () => {
      const rows = await readLocalProductsLightCached();
      return rows.map(csvProductToApi).filter(hasSellableStock).map((row) => {
        const images = normalizeProductImages(row?.IMAGENES ?? row?.imagenes ?? row?.imagenes_json);
        const cover = images[0] || {};
        const imageUrlCandidates = [
          cover.thumb_webp_url,
          cover.filtered_image_url,
          cover.original_webp_url,
          cover.original_image_url
        ];
        const lightweightImageUrl =
          imageUrlCandidates.find((value) => {
            const source = String(value || "").trim();
            return source && !source.startsWith("data:");
          }) || (images.length ? `/api/productos/imagen-producto/${row?.productId ?? row?.["N°"] ?? ""}` : "");
        return {
          id: String(row?.productId ?? row?.["N°"] ?? ""),
          name: String(row?.NOMBRE ?? ""),
          category: String(row?.CATEGORIA ?? "OTRO"),
          price: Number(row?.PRECIO ?? 0),
          stock: Number(row?.STOCK_ACTUAL ?? 0),
          status: normalizeProductStatus(row?.ESTADO ?? "ACTIVO") || "ACTIVO",
          variants: normalizeProductVariants(row?.VARIANTES ?? row?.variants ?? row?.variantes),
          imageHash: "",
          imageUrl: lightweightImageUrl,
          shortDescription: String(row?.DESCRIPCION ?? "").slice(0, 140)
        };
      });
    }
  );
  storefrontProductsCache = {
    items: (Array.isArray(items) ? items : []).filter(hasSellableStock),
    savedAt: Date.now()
  };
  return storefrontProductsCache.items;
}

async function readProductImageByHash(hashInput) {
  const hash = typeof hashInput === "string" ? hashInput.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  return withDataSourceFallback(
    "readProductImageByHash",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductImagesTable(connection);
        const [rows] = await connection.query(
          `SELECT original_webp_url, thumb_webp_url, mime
           FROM producto_imagenes WHERE hash_image = ? LIMIT 1`,
          [hash]
        );
        const row = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!row) return null;
        const source = row.thumb_webp_url || row.original_webp_url || "";
        return { source, mime: row.mime || "" };
      }),
    async () => null
  );
}

async function readCsvProductImageMap() {
  if (csvProductImageCache.map && Date.now() - csvProductImageCache.savedAt < STOREFRONT_PRODUCTS_CACHE_TTL_MS) {
    return csvProductImageCache.map;
  }
  const map = new Map();
  try {
    const rows = await readLocalProductsCached();
    for (const csvRow of Array.isArray(rows) ? rows : []) {
      const product = csvProductToApi(csvRow);
      const productId = String(product?.productId ?? product?.["N°"] ?? "").trim();
      if (!productId) continue;
      const images = normalizeProductImages(product?.IMAGENES);
      const cover = images[0] || {};
      const source =
        cover.thumb_webp_url ||
        cover.filtered_image_url ||
        cover.original_webp_url ||
        cover.original_image_url ||
        "";
      if (source) map.set(productId, { source, mime: cover.mime || "image/webp" });
    }
  } catch (_) {}
  csvProductImageCache = { map, savedAt: Date.now() };
  return map;
}

async function readProductImageByProductId(productIdInput) {
  const productId = toInt(productIdInput, 0);
  if (!productId) return null;
  return withDataSourceFallback(
    "readProductImageByProductId",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductImagesTable(connection);
        const [imageRows] = await connection.query(
          `SELECT original_webp_url, thumb_webp_url, mime
           FROM producto_imagenes
           WHERE producto_id = ?
           ORDER BY es_portada DESC, orden ASC, id ASC
           LIMIT 1`,
          [productId]
        );
        const imageRow = Array.isArray(imageRows) && imageRows.length ? imageRows[0] : null;
        if (imageRow) {
          return {
            source: imageRow.thumb_webp_url || imageRow.original_webp_url || "",
            mime: imageRow.mime || "image/webp"
          };
        }

        const [productRows] = await connection.query(
          "SELECT imagenes_json FROM productos WHERE id = ? LIMIT 1",
          [productId]
        );
        const productRow = Array.isArray(productRows) && productRows.length ? productRows[0] : null;
        const images = normalizeProductImages(productRow?.imagenes_json);
        const cover = images[0] || {};
        return {
          source: cover.thumb_webp_url || cover.filtered_image_url || cover.original_webp_url || cover.original_image_url || "",
          mime: cover.mime || "image/webp"
        };
      }),
    async () => {
      const map = await readCsvProductImageMap();
      return map.get(String(productId)) || null;
    }
  );
}

// ============================================================
// AUTH (storefront customers)
// ============================================================

async function ensureUsuariosTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS usuarios_cliente (
      id INT NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      nombre VARCHAR(190) NOT NULL DEFAULT '',
      telefono VARCHAR(40) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_usuarios_cliente_email (email)
    ) ENGINE=InnoDB
  `);
  // Migraciones aditivas para referidos
  for (const ddl of [
    "ALTER TABLE usuarios_cliente ADD COLUMN codigo_referido VARCHAR(40) NULL",
    "ALTER TABLE usuarios_cliente ADD COLUMN referido_por VARCHAR(40) NULL",
    "ALTER TABLE usuarios_cliente ADD COLUMN puntos_club INT NOT NULL DEFAULT 0",
    "ALTER TABLE usuarios_cliente ADD COLUMN dni VARCHAR(12) NULL AFTER telefono",
    "ALTER TABLE usuarios_cliente ADD COLUMN rol VARCHAR(30) NOT NULL DEFAULT 'cliente' AFTER puntos_club",
    "ALTER TABLE usuarios_cliente ADD UNIQUE KEY uk_usuario_codigo (codigo_referido)"
  ]) {
    try { await connection.query(ddl); } catch (error) {
      if (!["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME"].includes(error?.code)) {
        // No abortar si la columna o índice ya existen
      }
    }
  }
}

async function ensureSesionesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS sesiones_cliente (
      token CHAR(64) NOT NULL,
      usuario_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (token),
      KEY idx_sesiones_cliente_usuario (usuario_id),
      KEY idx_sesiones_cliente_expira (expires_at)
    ) ENGINE=InnoDB
  `);
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(plain), salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(plain, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const derived = crypto.scryptSync(String(plain), salt, expected.length);
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").slice(-9);
}

function normalizeDni(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 12);
}

function normalizeUserRole(value) {
  const role = String(value || "cliente").trim().toLowerCase();
  return ["cliente", "staff", "admin"].includes(role) ? role : "cliente";
}

function buildCustomerUser(row) {
  const mayoriaEdadConfirmada = row.mayoriaEdadConfirmada === true;
  const fechaNacimiento = trimValue(row.fechaNacimiento || "");
  return {
    id: row.legacyId ?? row.id,
    docId: row.id,
    email: row.email || "",
    nombre: row.nombre || "",
    telefono: row.telefono || "",
    dni: row.dni || "",
    fechaNacimiento,
    edadDeclarada: Number(row.edadDeclarada || 0) || null,
    mayoriaEdadConfirmada,
    requiereVerificacionEdad: !fechaNacimiento || !mayoriaEdadConfirmada,
    rol: normalizeUserRole(row.rol),
    codigo_referido: row.codigo_referido || "",
    puntos_club: Number(row.puntos_club || 0)
  };
}

function calculateAgeFromBirthDate(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimValue(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day ||
    birthDate.getTime() > now.getTime()
  ) return null;
  let age = now.getUTCFullYear() - year;
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age;
}

function firebaseStorageImageExtension(mime) {
  const safe = trimValue(mime).toLowerCase();
  if (safe.includes("webp")) return "webp";
  if (safe.includes("png")) return "png";
  if (safe.includes("jpeg") || safe.includes("jpg")) return "jpg";
  if (safe.includes("gif")) return "gif";
  return "webp";
}

function getFirebaseStorageBucket() {
  getFirebaseDb();
  try {
    if (!firebaseAdminApp) return null;
    const { getStorage } = require("firebase-admin/storage");
    return getStorage(firebaseAdminApp).bucket();
  } catch (_) {
    return null;
  }
}

async function uploadDataUriToFirebaseStorage(dataUri, folder, nameHint = "image") {
  const parsed = parseDataUri(dataUri);
  if (!parsed?.isDataUri || parsed.encoding !== "base64" || !parsed.payload) return "";
  const mime = parsed.mime || "image/webp";
  if (!/^image\//i.test(mime)) return "";
  const bucket = getFirebaseStorageBucket();
  if (!bucket) throw createHttpError(503, "Firebase Storage no está disponible para guardar la imagen.");
  const buffer = Buffer.from(parsed.payload, "base64");
  if (!buffer.length) throw createHttpError(400, "La imagen enviada está vacía.");
  const hash = computeImageHash(dataUri).slice(0, 24);
  const ext = firebaseStorageImageExtension(mime);
  const safeName = slugifyDocumentId(nameHint || "image").slice(0, 60) || "image";
  const filePath = `${folder.replace(/^\/+|\/+$/g, "")}/${safeName}-${hash}.${ext}`;
  const token = crypto.randomUUID ? crypto.randomUUID() : computeImageHash(`${filePath}-${Date.now()}`);
  const file = bucket.file(filePath);
  await file.save(buffer, {
    resumable: false,
    contentType: mime,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function replaceImageDataUrisWithStorageUrls(value, folder, nameHint = "image", uploaded = new Map()) {
  if (typeof value === "string") {
    if (!value.startsWith("data:image/")) return value;
    if (uploaded.has(value)) return uploaded.get(value);
    const url = await uploadDataUriToFirebaseStorage(value, folder, nameHint);
    if (!url) throw createHttpError(400, "La imagen enviada no es válida.");
    uploaded.set(value, url);
    return url;
  }
  if (Array.isArray(value)) {
    const next = [];
    for (let index = 0; index < value.length; index += 1) {
      next.push(await replaceImageDataUrisWithStorageUrls(value[index], folder, `${nameHint}-${index + 1}`, uploaded));
    }
    return next;
  }
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = await replaceImageDataUrisWithStorageUrls(entry, folder, `${nameHint}-${key}`, uploaded);
  }
  return next;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function generateReferralCode(nombre) {
  const base = String(nombre || "amigo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8) || "AMIGO";
  const suffix = String(100 + Math.floor(Math.random() * 900));
  return `${base}${suffix}`.slice(0, 12);
}

function normalizeCustomerSessions(value) {
  return Array.isArray(value)
    ? value.filter((session) => session?.token && session?.expiresAt)
    : [];
}

async function createCustomerSessionLocal(userId, tokenOverride = "") {
  const store = await readCustomersStore();
  const customer = store.customers.find((entry) => (
    Number(entry.id) === Number(userId) ||
    Number(entry.legacyId) === Number(userId) ||
    trimValue(entry.id || "") === trimValue(userId || "")
  ));
  if (!customer) throw createHttpError(404, "Cuenta no encontrada.");
  const safeToken = typeof tokenOverride === "string" && /^[a-f0-9]{64}$/i.test(tokenOverride.trim())
    ? tokenOverride.trim().toLowerCase()
    : "";
  const token = safeToken || crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  customer.sessions = normalizeCustomerSessions(customer.sessions)
    .filter((session) => new Date(session.expiresAt).getTime() > Date.now())
    .concat({ token, expiresAt });
  await writeCustomersStore(store);
  return { token, expiresAt };
}

async function registerCustomerLocal({ email, passwordHashSource, nombre, telefono, dni, refCode, fechaNacimiento, edadDeclarada, mayoriaEdadConfirmada }) {
  const store = await readCustomersStore();
  const existing = store.customers.find((entry) => (
    normalizeEmail(entry.email) === email ||
    (telefono && normalizePhone(entry.telefono) === telefono) ||
    (dni && normalizeDni(entry.dni) === dni)
  ));
  if (existing) {
    if (telefono && normalizePhone(existing.telefono) === telefono) {
      throw createHttpError(409, "Ya existe una cuenta con ese celular.");
    }
    if (dni && normalizeDni(existing.dni) === dni) {
      throw createHttpError(409, "Ya existe una cuenta con ese DNI.");
    }
    throw createHttpError(409, "Ya existe una cuenta con esos datos.");
  }

  let codigoRef = generateReferralCode(nombre);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const taken = store.customers.some((entry) => trimValue(entry.codigo_referido || "") === codigoRef);
    if (!taken) break;
    codigoRef = generateReferralCode(nombre);
  }

  const now = new Date().toISOString();
  const nextId = store.customers.reduce((max, entry) => Math.max(max, toInt(entry.legacyId ?? entry.id, 0)), 0) + 1;
  const customerDocId = dni ? `customer-${dni}` : telefono ? `customer-phone-${telefono}` : `customer-${nextId}`;
  const customer = {
    id: customerDocId,
    legacyId: nextId,
    email,
    password_hash: hashPassword(passwordHashSource),
    nombre,
    telefono: telefono || "",
    dni: dni || "",
    edadDeclarada,
    fechaNacimiento,
    mayoriaEdadConfirmada: true,
    mayoriaEdadConfirmadaAt: now,
    rol: "cliente",
    codigo_referido: codigoRef,
    referido_por: refCode || "",
    puntos_club: 0,
    created_at: now,
    sessions: []
  };
  store.customers.push(customer);
  await writeCustomersStore(store);
  const session = await createCustomerSessionLocal(nextId);
  return { token: session.token, user: buildCustomerUser(customer) };
}

async function loginCustomerLocal({ email, password, telefono, dni, usePhoneFlow }) {
  const store = await readCustomersStore();
  const customer = usePhoneFlow
    ? store.customers.find((entry) => {
        const entryDni = normalizeDni(entry.dni);
        if (telefono) return normalizePhone(entry.telefono) === telefono && entryDni === dni;
        return entryDni === dni;
      })
    : store.customers.find((entry) => normalizeEmail(entry.email) === email);
  if (!customer) {
    throw createHttpError(401, usePhoneFlow ? "DNI o contraseña incorrectos." : "Email o contraseña incorrectos.");
  }
  if (!verifyPassword(password, customer.password_hash)) {
    throw createHttpError(401, usePhoneFlow ? "DNI o contraseña incorrectos." : "Email o contraseña incorrectos.");
  }
  const session = await createCustomerSessionLocal(customer.id);
  return { token: session.token, user: buildCustomerUser(customer) };
}

async function findCustomerByTokenLocal(token) {
  const store = await readCustomersStore();
  const now = Date.now();
  let needsSave = false;
  let found = null;
  for (const customer of store.customers) {
    const sessions = normalizeCustomerSessions(customer.sessions);
    const active = sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
    if (active.length !== sessions.length) needsSave = true;
    customer.sessions = active;
    if (!found && active.some((session) => session.token === token)) {
      found = buildCustomerUser(customer);
    }
  }
  if (needsSave) await writeCustomersStore(store);
  return found;
}

async function verifyCustomerAdultStatus(token, payload) {
  const safeToken = typeof token === "string" ? token.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/i.test(safeToken)) throw createHttpError(401, "Sesión requerida.");
  const fechaNacimiento = trimValue(payload?.fechaNacimiento || "");
  const edadDeclarada = calculateAgeFromBirthDate(fechaNacimiento);
  const confirmed = payload?.confirmaMayoriaEdad === true || payload?.mayoriaEdadConfirmada === true;
  if (!Number.isInteger(edadDeclarada) || edadDeclarada < 18 || edadDeclarada > 120) {
    throw createHttpError(400, "Debes ingresar una fecha de nacimiento válida y ser mayor de 18 años.");
  }
  if (!confirmed) throw createHttpError(400, "Debes confirmar que eres mayor de edad.");

  const store = await readCustomersStore();
  const now = Date.now();
  const customer = store.customers.find((entry) => normalizeCustomerSessions(entry.sessions).some((session) => (
    session.token === safeToken && new Date(session.expiresAt).getTime() > now
  )));
  if (!customer) throw createHttpError(401, "Sesión requerida.");
  customer.fechaNacimiento = fechaNacimiento;
  customer.edadDeclarada = edadDeclarada;
  customer.mayoriaEdadConfirmada = true;
  customer.mayoriaEdadConfirmadaAt = new Date().toISOString();
  await writeCustomersStore(store);
  return { user: buildCustomerUser(customer) };
}

async function logoutCustomerLocal(token) {
  const store = await readCustomersStore();
  let changed = false;
  for (const customer of store.customers) {
    const sessions = normalizeCustomerSessions(customer.sessions);
    const next = sessions.filter((session) => session.token !== token);
    if (next.length !== sessions.length) changed = true;
    customer.sessions = next;
  }
  if (changed) await writeCustomersStore(store);
}

async function resetCustomerPasswordLocal({ telefono }) {
  const phone = normalizePhone(telefono);
  if (phone.length !== 9) throw createHttpError(400, "Ingresa un celular válido de 9 dígitos.");
  const store = await readCustomersStore();
  const customer = store.customers.find((entry) => normalizePhone(entry.telefono) === phone);
  if (!customer) throw createHttpError(404, "No encontramos una cuenta con ese celular.");
  const temporaryPassword = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  customer.password_hash = hashPassword(temporaryPassword);
  customer.sessions = [];
  customer.password_reset_at = new Date().toISOString();
  await writeCustomersStore(store);
  return { ok: true, telefono: phone, temporaryPassword };
}

const OTP_TTL_MS = 1000 * 60 * 5;
const OTP_RESEND_COOLDOWN_MS = 1000 * 45;
const OTP_RATE_WINDOW_MS = 1000 * 60 * 10;
const OTP_MAX_SENDS_PER_WINDOW = 3;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const customerOtpState = new Map();

function normalizeOtpPurpose(value) {
  return String(value || "login").trim().toLowerCase() === "register" ? "register" : "login";
}

function buildOtpKey(telefono, dni, purpose) {
  return `${purpose}:${telefono}:${dni}`;
}

function shouldExposeDevOtp() {
  const raw = trimValue(process.env.OTP_EXPOSE_DEV_CODE || process.env.NODE_ENV || "");
  return raw !== "production" && !/^(0|false|no|off)$/i.test(trimValue(process.env.OTP_EXPOSE_DEV_CODE || "true"));
}

function hashOtpCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function normalizeOtpCode(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 6);
}

async function findCustomerByPhoneDni(telefono, dni) {
  if (!(await isMysqlOnlyModeEnabled())) {
    const store = await readCustomersStore();
    const customer = store.customers.find(
      (entry) => normalizePhone(entry.telefono) === telefono && normalizeDni(entry.dni) === dni
    );
    return customer ? buildCustomerUser(customer) : null;
  }
  try {
    return await withMysqlConnection(async (connection) => {
      await ensureUsuariosTable(connection);
      const [rows] = await connection.query(
        "SELECT id, email, nombre, telefono, dni, rol, codigo_referido, puntos_club FROM usuarios_cliente WHERE telefono = ? AND dni = ? LIMIT 1",
        [telefono, dni]
      );
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      return row ? buildCustomerUser(row) : null;
    });
  } catch (error) {
    if (await isMysqlOnlyModeEnabled()) throw error;
    const store = await readCustomersStore();
    const customer = store.customers.find(
      (entry) => normalizePhone(entry.telefono) === telefono && normalizeDni(entry.dni) === dni
    );
    return customer ? buildCustomerUser(customer) : null;
  }
}

async function ensureProductVariantsColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN variantes_json LONGTEXT NULL AFTER imagenes_json"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function sendCustomerOtp({ telefono, code, purpose }) {
  await appendLog("INFO", "OTP cliente generado", {
    telefono,
    purpose,
    provider: "local-dev",
    code: shouldExposeDevOtp() ? code : undefined
  });
}

async function requestCustomerOtp(payload) {
  const purpose = normalizeOtpPurpose(payload?.purpose || payload?.modo || payload?.mode);
  const nombre = trimValue(payload?.nombre || "").slice(0, 190);
  const telefono = normalizePhone(payload?.telefono);
  const dni = normalizeDni(payload?.dni);
  const fechaNacimiento = trimValue(payload?.fechaNacimiento || "");
  const edadDeclarada = calculateAgeFromBirthDate(fechaNacimiento);
  const mayoriaEdadConfirmada = payload?.confirmaMayoriaEdad === true || payload?.mayoriaEdadConfirmada === true;
  if (telefono.length !== 9) throw createHttpError(400, "Ingresa un celular válido de 9 dígitos.");
  if (dni.length < 8) throw createHttpError(400, "Ingresa un DNI válido.");
  if (purpose === "register" && !nombre) throw createHttpError(400, "Falta el nombre.");

  const existing = await findCustomerByPhoneDni(telefono, dni);
  if (purpose === "login" && !existing) {
    throw createHttpError(404, "No encontramos una cuenta con ese celular y DNI.");
  }
  if (purpose === "register" && existing) {
    throw createHttpError(409, "Ya existe una cuenta con ese celular y DNI.");
  }

  const key = buildOtpKey(telefono, dni, purpose);
  const now = Date.now();
  const previous = customerOtpState.get(key);
  const sends = previous?.windowStart && now - previous.windowStart < OTP_RATE_WINDOW_MS
    ? Number(previous.sends || 0)
    : 0;
  const windowStart = sends ? previous.windowStart : now;
  if (previous?.lastSentAt && now - previous.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - previous.lastSentAt)) / 1000);
    throw createHttpError(429, `Espera ${retryAfter}s antes de pedir otro código.`);
  }
  if (sends >= OTP_MAX_SENDS_PER_WINDOW) {
    throw createHttpError(429, "Demasiados códigos enviados. Intenta nuevamente en unos minutos.");
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  customerOtpState.set(key, {
    codeHash: hashOtpCode(code),
    purpose,
    nombre,
    telefono,
    dni,
    attempts: 0,
    sends: sends + 1,
    windowStart,
    lastSentAt: now,
    expiresAt: now + OTP_TTL_MS
  });
  await sendCustomerOtp({ telefono, code, purpose });

  return {
    ok: true,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
    devCode: shouldExposeDevOtp() ? code : undefined
  };
}

async function verifyCustomerOtp(payload) {
  const purpose = normalizeOtpPurpose(payload?.purpose || payload?.modo || payload?.mode);
  const nombre = trimValue(payload?.nombre || "").slice(0, 190);
  const telefono = normalizePhone(payload?.telefono);
  const dni = normalizeDni(payload?.dni);
  const code = normalizeOtpCode(payload?.code || payload?.codigo || payload?.otp);
  if (telefono.length !== 9 || dni.length < 8) throw createHttpError(400, "Ingresa celular y DNI válidos.");
  if (code.length !== 6) throw createHttpError(400, "Ingresa el código de 6 dígitos.");

  const key = buildOtpKey(telefono, dni, purpose);
  const state = customerOtpState.get(key);
  if (!state || Date.now() > state.expiresAt) {
    customerOtpState.delete(key);
    throw createHttpError(401, "El código expiró. Solicita uno nuevo.");
  }
  if (state.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    customerOtpState.delete(key);
    throw createHttpError(429, "Demasiados intentos. Solicita un código nuevo.");
  }
  if (hashOtpCode(code) !== state.codeHash) {
    state.attempts += 1;
    customerOtpState.set(key, state);
    throw createHttpError(401, "Código incorrecto.");
  }

  customerOtpState.delete(key);
  if (purpose === "register") {
    return registerCustomer({
      nombre: nombre || state.nombre,
      telefono,
      dni,
      refCode: payload?.refCode || payload?.codigo_referido || ""
    });
  }
  return loginCustomer({ telefono, dni });
}

const REFERIDO_PREMIO_PUNTOS = 300;

function buildInvitacionShape(row) {
  return {
    id: toInt(row.id, 0),
    email: row.email ? trimValue(row.email) : "",
    destinatario_nombre: row.destinatario_nombre ? trimValue(row.destinatario_nombre) : "",
    estado: trimValue(row.estado || "enviada"),
    premio_puntos: toInt(row.premio_puntos, 0),
    referido_usuario_id: row.referido_usuario_id ? toInt(row.referido_usuario_id, 0) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

// ============================================================
// CUENTA — RESUMEN AGREGADO (dashboard "Mi cuenta")
// ============================================================

const CLUB_MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

const CLUB_NIVELES = [
  { nivel: "Vecino", min: 0, max: 299, next: 300, color: "#b86d35" },
  { nivel: "Casero", min: 300, max: 699, next: 700, color: "#a6a6a6" },
  { nivel: "Pata de la Casa", min: 700, max: 1499, next: 1500, color: "#f0b51a" },
  { nivel: "Leyenda de la Previa", min: 1500, max: 9999999, next: null, color: "#9a59d1" }
];

const CLUB_MONTHLY_PRIZE = "Gift Card Delivery S/25";

function resolveClubNivel(puntos) {
  const safe = Number(puntos || 0);
  const idx = CLUB_NIVELES.findIndex((n) => safe >= n.min && safe <= n.max);
  const current = CLUB_NIVELES[idx] || CLUB_NIVELES[0];
  const siguiente = CLUB_NIVELES[idx + 1] || null;
  const objetivo = current.next || safe;
  const progreso = current.next ? Math.max(0, Math.min(1, safe / current.next)) : 1;
  return {
    nivel: current.nivel,
    color: current.color,
    puntos: safe,
    siguiente: siguiente?.nivel || null,
    objetivo,
    faltante: current.next ? Math.max(0, current.next - safe) : 0,
    progreso
  };
}

function parseClubDate(value) {
  const raw = trimValue(value || "");
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:,?\s+(.+))?/);
  if (!match) return null;
  let hour = 0;
  let minute = 0;
  let second = 0;
  const timeMatch = trimValue(match[4] || "")
    .replace(/\s+/g, " ")
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)?$/i);
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] || 0);
    const period = normalizeText(timeMatch[4] || "");
    if (period.startsWith("p") && hour < 12) hour += 12;
    if (period.startsWith("a") && hour === 12) hour = 0;
  }
  const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, minute, second);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function orderDateTimeValue(order) {
  const date = parseClubDate(order?.createdAt || order?.lastUpdatedAt || "");
  return date ? date.getTime() : 0;
}

function isSameClubMonth(date, reference) {
  return date &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth();
}

function buildClubMonthMeta(reference = new Date()) {
  const nextMonthDate = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  const previousMonthDate = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  return {
    currentMonth: CLUB_MONTHS[reference.getMonth()],
    currentYear: reference.getFullYear(),
    nextMonth: CLUB_MONTHS[(reference.getMonth() + 1) % 12],
    previousWinnerMonth: `${CLUB_MONTHS[previousMonthDate.getMonth()]} ${previousMonthDate.getFullYear()}`,
    daysUntilRaffle: Math.max(1, Math.ceil((nextMonthDate.getTime() - reference.getTime()) / 86400000))
  };
}

async function countClubReferralRewards(usuarioId, reference) {
  try {
    const items = await listInvitacionesByUser(usuarioId);
    return items.filter((item) => {
      if (item.estado !== "recompensa_otorgada") return false;
      return isSameClubMonth(parseClubDate(item.updated_at || item.created_at), reference);
    }).length;
  } catch (_) {
    return 0;
  }
}

async function buildClubMonthlySummary(userId, basePoints = 0) {
  const reference = new Date();
  let ordersThisMonth = [];
  try {
    const ordersAll = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
    ordersThisMonth = ordersAll.filter((order) => {
      if (Number(order.usuarioId) !== Number(userId)) return false;
      if (order.status === "CANCELADO") return false;
      return isSameClubMonth(parseClubDate(order.createdAt), reference);
    });
  } catch (_) {
    ordersThisMonth = [];
  }

  const puntosMes = Math.floor(ordersThisMonth.reduce((sum, order) => sum + Number(order.total || 0), 0));
  const puntos = Math.max(0, Number(basePoints || 0)) + puntosMes;
  const orderCount = ordersThisMonth.length;
  const referralRewards = await countClubReferralRewards(userId, reference);
  const missions = [
    {
      name: "Primera Noche",
      description: "Haz tu primer pedido del mes",
      rewardTickets: 1,
      completed: orderCount >= 1,
      icon: "🍺"
    },
    {
      name: "Segunda Ronda",
      description: "Realiza dos pedidos en el mes",
      rewardTickets: 2,
      completed: orderCount >= 2,
      icon: "🥂"
    },
    {
      name: "Cliente Frecuente",
      description: "Realiza tres pedidos en el mes",
      rewardTickets: 3,
      completed: orderCount >= 3,
      icon: "🍻"
    },
    {
      name: "Trae a un Amigo",
      description: "Un amigo hace su primer pedido",
      rewardTickets: 5,
      completed: referralRewards > 0,
      icon: "👥"
    }
  ];
  const boletos = missions.reduce((sum, mission) => sum + (mission.completed ? mission.rewardTickets : 0), 0);
  return {
    ...resolveClubNivel(puntos),
    puntos,
    puntosBase: Math.max(0, Number(basePoints || 0)),
    puntosMes,
    boletos,
    ordersThisMonth: orderCount,
    missions,
    levels: CLUB_NIVELES.map((level) => ({
      name: level.nivel,
      range: level.next ? `${level.min} - ${level.max.toLocaleString("en-US")} pts` : `${level.min.toLocaleString("en-US")}+ pts`,
      min: level.min,
      max: level.max,
      color: level.color
    })),
    monthlyPrize: CLUB_MONTHLY_PRIZE,
    prizeUsage: "Credito aplicable unicamente al delivery. Valido para usar en tus pedidos durante el siguiente mes.",
    previousWinnerName: "Carlos M.",
    ...buildClubMonthMeta(reference)
  };
}

async function buildCuentaResumen(user) {
  const userId = Number(user?.id);
  if (!userId) throw createHttpError(401, "Sesión requerida.");

  let referidoInfo = { codigo: user?.codigo_referido || "" };
  try {
    referidoInfo = await getReferidoInfo(userId);
  } catch (_) { /* no bloquea */ }

  let club = {
    nivel: "Club",
    color: "#ffc84d",
    puntos: 0,
    progreso: 0,
    siguiente: "Bronce",
    faltante: 100,
    boletos: 0
  };
  try {
    club = await buildClubMonthlySummary(userId, user?.puntos_club || 0);
  } catch (_) { /* no bloquea */ }

  // último pedido del usuario
  let ultimoPedido = null;
  try {
    const ordersAll = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
    const mine = ordersAll
      .filter((o) => Number(o.usuarioId) === userId)
      .sort((a, b) => orderDateTimeValue(b) - orderDateTimeValue(a));
    if (mine.length) {
      const o = mine[0];
      ultimoPedido = {
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        modeLabel: o.modeLabel,
        total: o.total,
        items: (o.items || []).slice(0, 3).map((it) => ({
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          imageHash: it.imageHash || ""
        })),
        itemsCount: (o.items || []).length
      };
    }
  } catch (_) { /* no bloquea */ }

  // top favoritos (productos) — los primeros 3 referencias
  let favoritosTop = [];
  try {
    const favIds = await listFavoritoIdsByUser(userId);
    const productIds = (favIds.productoIds || []).slice(0, 3).map(Number).filter((id) => id > 0);
    if (productIds.length) {
      const products = await readProductsStorefront();
      favoritosTop = products
        .filter((product) => productIds.includes(resolveProductIdValue(product)))
        .map((product) => ({
          id: String(resolveProductIdValue(product)),
          name: trimValue(product.NOMBRE || product.nombre || ""),
          category: trimValue(product.CATEGORIA || product.categoria || ""),
          price: round2(product.PRECIO ?? product.precio),
          imageHash: trimValue(product.imageHash || "")
        }));
    }
  } catch (_) { /* no bloquea */ }

  // top direcciones (principal + más reciente)
  let direccionesTop = [];
  try {
    const all = await listDireccionesByUser(userId);
    direccionesTop = all.slice(0, 2);
  } catch (_) { /* no bloquea */ }

  const beneficios = [
    {
      nivel: "Vecino",
      color: "#b86d35",
      bullets: ["Acumulas puntos mensuales", "Participas completando misiones", "Ves tu avance del mes"]
    },
    {
      nivel: "Casero",
      color: "#a6a6a6",
      bullets: ["Mas avance en el ranking mensual", "Misiones visibles", "Mas motivacion para sumar boletos"]
    },
    {
      nivel: "Pata de la Casa",
      color: "#f0b51a",
      bullets: ["Nivel destacado del club", "Mas oportunidades al completar misiones", "Sorteo mensual activo"]
    },
    {
      nivel: "Leyenda de la Previa",
      color: "#9a59d1",
      bullets: ["Nivel maximo del club", "Beneficios completos activos", "Reconocimiento destacado del mes"]
    }
  ];

  return {
    user: {
      id: userId,
      nombre: user.nombre || "",
      email: user.email || "",
      telefono: user.telefono || "",
      codigo_referido: referidoInfo.codigo || user.codigo_referido || ""
    },
    club,
    beneficios,
    ultimoPedido,
    favoritosTop,
    direccionesTop,
    invitacion: {
      premioPuntos: 300,
      beneficioAmigo: "S/ 10 en su primer pedido",
      descuentoAmigo: 10
    }
  };
}

async function getReferidoInfo(usuarioId) {
  const store = await readCustomersStore();
  const customer = findCustomerRecord(store.customers, usuarioId);
  if (!customer) return { codigo: "", puntos: 0 };
  if (!customer.codigo_referido) {
    let code = generateReferralCode(customer.nombre);
    for (let attempt = 0; attempt < 8 && store.customers.some((entry) => entry.codigo_referido === code); attempt += 1) {
      code = generateReferralCode(customer.nombre);
    }
    customer.codigo_referido = code;
    await writeCustomersStore(store);
  }
  return { codigo: customer.codigo_referido || "", puntos: Number(customer.puntos_club || 0) };
}

async function listInvitacionesByUser(usuarioId) {
  const data = await readCustomerData(usuarioId);
  return data.invitations.slice().sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || ""))).slice(0, 200).map(buildInvitacionShape);
}

async function createInvitacionManual(usuarioId, payload) {
  const email = trimValue(payload?.email || "").toLowerCase().slice(0, 190);
  const nombre = trimValue(payload?.nombre || payload?.destinatario_nombre || "").slice(0, 190);
  if (!email && !nombre) {
    throw createHttpError(400, "Indica un email o nombre para la invitación.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError(400, "Email inválido.");
  }
  const data = await readCustomerData(usuarioId);
  const item = {
    id: nextEmbeddedId(data.invitations),
    email,
    destinatario_nombre: nombre,
    estado: "enviada",
    premio_puntos: 0,
    referido_usuario_id: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  data.invitations.push(item);
  await writeCustomerData(usuarioId, data);
  return buildInvitacionShape(item);
}

async function promoteInvitacionPrimerPedido(usuarioReferidoId) {
  const profiles = await readFirebaseCollection("customer_data") || [];
  for (const profile of profiles) {
    const invitations = Array.isArray(profile.invitations) ? profile.invitations : [];
    const index = invitations.findIndex((item) => Number(item.referido_usuario_id) === Number(usuarioReferidoId) && item.estado !== "recompensa_otorgada");
    if (index < 0) continue;
    invitations[index] = { ...invitations[index], estado: "recompensa_otorgada", premio_puntos: REFERIDO_PREMIO_PUNTOS, updated_at: nowIso() };
    await writeCustomerData(profile.userId || profile.id, { ...profile, invitations });
    const customers = await readCustomersStore();
    const referrer = findCustomerRecord(customers.customers, profile.userId || profile.id);
    if (referrer) {
      referrer.puntos_club = Number(referrer.puntos_club || 0) + REFERIDO_PREMIO_PUNTOS;
      await writeCustomersStore(customers);
    }
    await addNotificacion(profile.userId || profile.id, {
      tipo: "club",
      titulo: `+${REFERIDO_PREMIO_PUNTOS} puntos por tu invitación`,
      mensaje: "Tu amigo hizo su primer pedido. Sigue invitando para sumar más beneficios.",
      icono: "recompensa_referido",
      link: "/invitar"
    });
    return { invitacionId: invitations[index].id, referrerId: profile.userId || profile.id, premio: REFERIDO_PREMIO_PUNTOS };
  }
  return null;
}

async function ensureClienteInvitacionesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente_invitaciones (
      id INT NOT NULL AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      referido_usuario_id INT NULL,
      email VARCHAR(190) NULL,
      destinatario_nombre VARCHAR(190) NULL,
      estado VARCHAR(40) NOT NULL DEFAULT 'enviada',
      premio_puntos INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_inv_user (usuario_id),
      KEY idx_inv_referido (referido_usuario_id)
    ) ENGINE=InnoDB
  `);
}

async function registerCustomer(payload) {
  const emailInput = normalizeEmail(payload?.email);
  const password = String(payload?.password || "");
  const nombre = trimValue(payload?.nombre || "").slice(0, 190);
  const telefono = normalizePhone(payload?.telefono);
  const dni = normalizeDni(payload?.dni);
  const refCode = trimValue(payload?.refCode || payload?.codigo_referido || "").toUpperCase().slice(0, 40);
  const usePhoneFlow = !!telefono || !!dni || !emailInput;
  const fechaNacimiento = trimValue(payload?.fechaNacimiento || "");
  const edadDeclarada = calculateAgeFromBirthDate(fechaNacimiento);
  const mayoriaEdadConfirmada = payload?.confirmaMayoriaEdad === true || payload?.mayoriaEdadConfirmada === true;

  if (!nombre) {
    throw createHttpError(400, "Falta el nombre.");
  }
  if (!Number.isInteger(edadDeclarada) || edadDeclarada < 18 || edadDeclarada > 120) {
    throw createHttpError(400, "Debes ingresar una fecha de nacimiento válida y ser mayor de 18 años.");
  }
  if (!mayoriaEdadConfirmada) {
    throw createHttpError(400, "Debes confirmar que eres mayor de edad para crear una cuenta.");
  }
  if (usePhoneFlow && telefono.length !== 9) {
    throw createHttpError(400, "Ingresa un celular válido de 9 dígitos.");
  }
  if (usePhoneFlow && dni.length < 8) {
    throw createHttpError(400, "Ingresa un DNI válido.");
  }
  if (usePhoneFlow && password.length < 6) {
    throw createHttpError(400, "La contraseña debe tener al menos 6 caracteres.");
  }
  if (!usePhoneFlow && (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput))) {
    throw createHttpError(400, "Email inválido.");
  }
  if (!usePhoneFlow && password.length < 6) {
    throw createHttpError(400, "La contraseña debe tener al menos 6 caracteres.");
  }
  const email = usePhoneFlow ? (emailInput || `cliente-${telefono}@local.lalicoreria.aqp`) : emailInput;
  const passwordHashSource = password;

  const mysqlOnly = await isMysqlOnlyModeEnabled();
  if (!mysqlOnly) {
    return registerCustomerLocal({ email, passwordHashSource, nombre, telefono, dni, refCode, fechaNacimiento, edadDeclarada, mayoriaEdadConfirmada });
  }
  try {
    return await withMysqlFallbackTimeout(withMysqlConnection(async (connection) => {
      await ensureUsuariosTable(connection);
      await ensureSesionesTable(connection);
      await ensureClienteInvitacionesTable(connection);

    const [existing] = await connection.query(
      "SELECT id, email, telefono, dni FROM usuarios_cliente WHERE email = ? OR telefono = ? OR dni = ? LIMIT 1",
      [email, telefono || "__sin_telefono__", dni || "__sin_dni__"]
    );
    if (Array.isArray(existing) && existing.length) {
      const found = existing[0];
      if (telefono && String(found.telefono || "") === telefono) {
        throw createHttpError(409, "Ya existe una cuenta con ese celular.");
      }
      if (dni && String(found.dni || "") === dni) {
        throw createHttpError(409, "Ya existe una cuenta con ese DNI.");
      }
      throw createHttpError(409, "Ya existe una cuenta con esos datos.");
    }

    // Generar código único de referido
    let codigoRef = generateReferralCode(nombre);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [taken] = await connection.query(
        "SELECT id FROM usuarios_cliente WHERE codigo_referido = ? LIMIT 1",
        [codigoRef]
      );
      if (!Array.isArray(taken) || !taken.length) break;
      codigoRef = generateReferralCode(nombre);
    }

    const passwordHash = hashPassword(passwordHashSource);
    const [result] = await connection.query(
      `INSERT INTO usuarios_cliente
        (email, password_hash, nombre, telefono, dni, rol, codigo_referido, referido_por)
       VALUES (?, ?, ?, ?, ?, 'cliente', ?, ?)`,
      [email, passwordHash, nombre, telefono || null, dni || null, codigoRef, refCode || null]
    );
    const userId = result?.insertId;

    // Si vino con código de referido válido, registra invitación
    if (refCode) {
      const [refRows] = await connection.query(
        "SELECT id FROM usuarios_cliente WHERE codigo_referido = ? LIMIT 1",
        [refCode]
      );
      const referrerId = Array.isArray(refRows) && refRows.length ? refRows[0].id : null;
      if (referrerId && referrerId !== userId) {
        try {
          await connection.query(
            `INSERT INTO cliente_invitaciones
              (usuario_id, referido_usuario_id, email, destinatario_nombre, estado, premio_puntos)
             VALUES (?, ?, ?, ?, 'registrado', 0)`,
            [referrerId, userId, email, nombre]
          );
          // Notificación para el referrer
          try {
            await addNotificacion(referrerId, {
              tipo: "club",
              titulo: "¡Tu invitado se registró!",
              mensaje: `${nombre} acaba de crear su cuenta usando tu código. Tu recompensa llega con su primer pedido.`,
              icono: "referido_registrado",
              link: "/invitar"
            });
          } catch (_) {}
        } catch (_) {}
      }
    }

      const session = await createCustomerSession(connection, userId);
      return {
        token: session.token,
        user: buildCustomerUser({ id: userId, email, nombre, telefono, dni, rol: "cliente", codigo_referido: codigoRef, puntos_club: 0 })
      };
    }), "registerCustomer");
  } catch (error) {
    if (error?.status) throw error;
    if (mysqlOnly) throw error;
    await appendLog("WARN", "Fallback local de clientes", {
      operation: "registerCustomer",
      message: buildDbErrorMessage(error)
    });
    return registerCustomerLocal({ email, passwordHashSource, nombre, telefono, dni, refCode, fechaNacimiento, edadDeclarada, mayoriaEdadConfirmada });
  }
}

async function loginCustomer(payload) {
  const email = normalizeEmail(payload?.email);
  const password = String(payload?.password || "");
  const telefono = normalizePhone(payload?.telefono);
  const dni = normalizeDni(payload?.dni);
  const usePhoneFlow = !!telefono || !!dni;
  if (usePhoneFlow && dni.length < 8) {
    throw createHttpError(400, "Ingresa un DNI válido.");
  }
  if (usePhoneFlow && password.length < 6) {
    throw createHttpError(400, "Ingresa tu contraseña.");
  }
  if (!usePhoneFlow && (!email || !password)) throw createHttpError(400, "Faltan credenciales.");

  const mysqlOnly = await isMysqlOnlyModeEnabled();
  if (!mysqlOnly) {
    return loginCustomerLocal({ email, password, telefono, dni, usePhoneFlow });
  }
  try {
    return await withMysqlFallbackTimeout(withMysqlConnection(async (connection) => {
      await ensureUsuariosTable(connection);
      await ensureSesionesTable(connection);

    const [rows] = usePhoneFlow
      ? telefono
        ? await connection.query(
            "SELECT id, email, password_hash, nombre, telefono, dni, rol, codigo_referido, puntos_club FROM usuarios_cliente WHERE telefono = ? AND dni = ? LIMIT 1",
            [telefono, dni]
          )
        : await connection.query(
            "SELECT id, email, password_hash, nombre, telefono, dni, rol, codigo_referido, puntos_club FROM usuarios_cliente WHERE dni = ? LIMIT 1",
            [dni]
          )
      : await connection.query(
          "SELECT id, email, password_hash, nombre, telefono, dni, rol, codigo_referido, puntos_club FROM usuarios_cliente WHERE email = ? LIMIT 1",
          [email]
        );
    const user = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw createHttpError(401, usePhoneFlow ? "DNI o contraseña incorrectos." : "Email o contraseña incorrectos.");
    }

      const session = await createCustomerSession(connection, user.id);
      if (!mysqlOnly) {
        try {
          await createCustomerSessionLocal(user.id, session.token);
        } catch (_) {}
      }
      return {
        token: session.token,
        user: buildCustomerUser(user)
      };
    }), "loginCustomer");
  } catch (error) {
    if (error?.status) throw error;
    if (mysqlOnly) throw error;
    await appendLog("WARN", "Fallback local de clientes", {
      operation: "loginCustomer",
      message: buildDbErrorMessage(error)
    });
    return loginCustomerLocal({ email, password, telefono, dni, usePhoneFlow });
  }
}

async function resetCustomerPassword(payload) {
  const telefono = normalizePhone(payload?.telefono);
  if (telefono.length !== 9) throw createHttpError(400, "Ingresa un celular válido de 9 dígitos.");
  const temporaryPassword = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const mysqlOnly = await isMysqlOnlyModeEnabled();

  if (!mysqlOnly) {
    return resetCustomerPasswordLocal({ telefono });
  }

  try {
    return await withMysqlConnection(async (connection) => {
      await ensureUsuariosTable(connection);
      const passwordHash = hashPassword(temporaryPassword);
      const [result] = await connection.query(
        "UPDATE usuarios_cliente SET password_hash = ? WHERE telefono = ? LIMIT 1",
        [passwordHash, telefono]
      );
      if (!result?.affectedRows) throw createHttpError(404, "No encontramos una cuenta con ese celular.");
      await connection.query("DELETE FROM sesiones_cliente WHERE usuario_id IN (SELECT id FROM usuarios_cliente WHERE telefono = ?)", [telefono]);
      return { ok: true, telefono, temporaryPassword };
    });
  } catch (error) {
    if (error?.status) throw error;
    if (mysqlOnly) throw error;
    await appendLog("WARN", "Fallback local de recuperacion de contraseña", {
      operation: "resetCustomerPassword",
      message: buildDbErrorMessage(error)
    });
    return resetCustomerPasswordLocal({ telefono });
  }
}

async function createCustomerSession(connection, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await connection.query(
    "INSERT INTO sesiones_cliente (token, usuario_id, expires_at) VALUES (?, ?, ?)",
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

async function findCustomerByToken(token) {
  const safe = typeof token === "string" ? token.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(safe)) return null;
  const mysqlOnly = await isMysqlOnlyModeEnabled();
  if (!mysqlOnly) {
    return findCustomerByTokenLocal(safe.toLowerCase());
  }
  if (mysqlFallbackUntil > Date.now() && !mysqlOnly) {
    return null;
  }
  try {
    return await withMysqlFallbackTimeout(withMysqlConnection(async (connection) => {
      await ensureUsuariosTable(connection);
      await ensureSesionesTable(connection);
      const [rows] = await connection.query(
        `SELECT u.id, u.email, u.nombre, u.telefono, u.dni, u.rol, u.codigo_referido, u.puntos_club, s.expires_at
         FROM sesiones_cliente s
         JOIN usuarios_cliente u ON u.id = s.usuario_id
         WHERE s.token = ? AND s.expires_at > NOW()
         LIMIT 1`,
        [safe.toLowerCase()]
      );
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!row) return null;
      return buildCustomerUser(row);
    }), "findCustomerByToken");
  } catch (error) {
    if (mysqlOnly) throw error;
    mysqlFallbackUntil = Date.now() + MYSQL_FALLBACK_COOLDOWN_MS;
    mysqlFallbackMessage = buildDbErrorMessage(error);
    return null;
  }
}

async function logoutCustomer(token) {
  const safe = typeof token === "string" ? token.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(safe)) return;
  if (!(await isMysqlOnlyModeEnabled())) {
    await logoutCustomerLocal(safe.toLowerCase());
    return;
  }
  try {
    await withMysqlConnection(async (connection) => {
      await ensureSesionesTable(connection);
      await connection.query("DELETE FROM sesiones_cliente WHERE token = ?", [safe.toLowerCase()]);
    });
  } catch (error) {
    if (await isMysqlOnlyModeEnabled()) throw error;
    await logoutCustomerLocal(safe.toLowerCase());
  }
}

function extractBearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+([a-f0-9]+)\s*$/i);
  return match ? match[1] : "";
}

async function requireCustomer(req) {
  const token = extractBearerToken(req);
  const user = token ? await findCustomerByToken(token) : null;
  if (!user) throw createHttpError(401, "Sesión requerida.");
  if (user.requiereVerificacionEdad && normalizeUserRole(user.rol) === "cliente") {
    throw createHttpError(403, "Debes confirmar que eres mayor de 18 años antes de continuar.");
  }
  return user;
}

async function requireStaff(req) {
  const user = await requireCustomer(req);
  const role = normalizeUserRole(user?.rol);
  if (!["admin", "staff"].includes(role)) {
    throw createHttpError(403, "Acceso reservado para administradores.");
  }
  return user;
}

// ============================================================
// DIRECCIONES (storefront customers)
// ============================================================

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

function geohashEncode(latitude, longitude, precision = 10) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        lngMin = mid;
      } else {
        bits = bits << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += GEOHASH_ALPHABET[bits];
      bit = 0;
      bits = 0;
    }
  }
  return hash;
}

const DIRECCION_ICON_VALUES = new Set(["casa", "trabajo", "playa", "amigo", "otro"]);

async function ensureClienteDireccionesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente_direcciones (
      id INT NOT NULL AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      etiqueta VARCHAR(80) NOT NULL DEFAULT '',
      icono VARCHAR(20) NOT NULL DEFAULT 'casa',
      direccion VARCHAR(255) NOT NULL,
      referencia VARCHAR(255) NULL,
      distrito VARCHAR(120) NULL,
      ciudad VARCHAR(120) NULL,
      telefono VARCHAR(40) NULL,
      latitud DECIMAL(9,6) NOT NULL,
      longitud DECIMAL(9,6) NOT NULL,
      geohash VARCHAR(12) NOT NULL,
      es_principal TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_dir_user (usuario_id),
      KEY idx_dir_principal (usuario_id, es_principal),
      KEY idx_dir_geohash (geohash)
    ) ENGINE=InnoDB
  `);
}

function buildDireccionApiShape(row) {
  if (!row) return null;
  return {
    id: toInt(row.id, 0),
    etiqueta: trimValue(row.etiqueta || ""),
    icono: DIRECCION_ICON_VALUES.has(String(row.icono).toLowerCase()) ? String(row.icono).toLowerCase() : "casa",
    direccion: trimValue(row.direccion || ""),
    direccion_escrita: trimValue(row.direccion || ""),
    direccion_mapa: trimValue(row.direccion_mapa || ""),
    referencia: row.referencia ? trimValue(row.referencia) : null,
    distrito: row.distrito ? trimValue(row.distrito) : null,
    ciudad: row.ciudad ? trimValue(row.ciudad) : null,
    telefono: row.telefono ? trimValue(row.telefono) : null,
    latitud: Number(row.latitud),
    longitud: Number(row.longitud),
    geohash: trimValue(row.geohash || ""),
    es_principal: Number(row.es_principal) === 1,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function validateDireccionInput(input) {
  const direccionEscrita = trimValue(input?.direccion_escrita || input?.direccion || "").slice(0, 255);
  const direccionMapa = trimValue(input?.direccion_mapa || input?.direccion || "").slice(0, 255);
  const direccion = direccionEscrita;
  const lat = Number(input?.latitud);
  const lng = Number(input?.longitud);
  if (!direccion) throw createHttpError(400, "La dirección es obligatoria.");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw createHttpError(400, "Latitud inválida.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw createHttpError(400, "Longitud inválida.");
  }
  const iconoRaw = String(input?.icono || "casa").toLowerCase();
  const icono = DIRECCION_ICON_VALUES.has(iconoRaw) ? iconoRaw : "casa";
  return {
    etiqueta: (trimValue(input?.etiqueta || "") || "Otra").slice(0, 80),
    icono,
    direccion,
    direccion_escrita: direccionEscrita,
    direccion_mapa: direccionMapa,
    referencia: input?.referencia ? trimValue(input.referencia).slice(0, 255) : null,
    distrito: input?.distrito ? trimValue(input.distrito).slice(0, 120) : null,
    ciudad: input?.ciudad ? trimValue(input.ciudad).slice(0, 120) : null,
    telefono: input?.telefono ? trimValue(input.telefono).slice(0, 40) : null,
    latitud: Number(lat.toFixed(6)),
    longitud: Number(lng.toFixed(6)),
    geohash: geohashEncode(lat, lng, 10),
    es_principal: input?.es_principal === true || input?.es_principal === 1 || input?.es_principal === "1"
  };
}

async function listDireccionesByUser(usuarioId) {
  const data = await readCustomerData(usuarioId);
  return data.addresses
    .map(buildDireccionApiShape)
    .sort((left, right) => Number(right.es_principal) - Number(left.es_principal) || String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

async function getDireccionById(usuarioId, id) {
  const data = await readCustomerData(usuarioId);
  return buildDireccionApiShape(data.addresses.find((item) => Number(item.id) === Number(id)) || null);
}

async function createDireccion(usuarioId, input) {
  const inputData = validateDireccionInput(input);
  const store = await readCustomerData(usuarioId);
  const setPrincipal = inputData.es_principal || store.addresses.length === 0;
  if (setPrincipal) store.addresses = store.addresses.map((item) => ({ ...item, es_principal: 0 }));
  const item = {
    ...inputData,
    id: nextEmbeddedId(store.addresses),
    es_principal: setPrincipal ? 1 : 0,
    created_at: nowIso()
  };
  store.addresses.push(item);
  await writeCustomerData(usuarioId, store);
  return buildDireccionApiShape(item);
}

async function updateDireccion(usuarioId, id, input) {
  const inputData = validateDireccionInput(input);
  const store = await readCustomerData(usuarioId);
  const index = store.addresses.findIndex((item) => Number(item.id) === Number(id));
  if (index < 0) throw createHttpError(404, "Dirección no encontrada.");
  if (inputData.es_principal) store.addresses = store.addresses.map((item) => ({ ...item, es_principal: 0 }));
  store.addresses[index] = {
    ...store.addresses[index],
    ...inputData,
    id: Number(id),
    es_principal: inputData.es_principal ? 1 : 0,
    updated_at: nowIso()
  };
  await writeCustomerData(usuarioId, store);
  return buildDireccionApiShape(store.addresses[index]);
}

async function deleteDireccion(usuarioId, id) {
  const store = await readCustomerData(usuarioId);
  const previousLength = store.addresses.length;
  store.addresses = store.addresses.filter((item) => Number(item.id) !== Number(id));
  if (store.addresses.length === previousLength) throw createHttpError(404, "Dirección no encontrada.");
  if (store.addresses.length && !store.addresses.some((item) => Number(item.es_principal) === 1)) {
    store.addresses[0] = { ...store.addresses[0], es_principal: 1 };
  }
  await writeCustomerData(usuarioId, store);
}

async function setDireccionPrincipal(usuarioId, id) {
  const store = await readCustomerData(usuarioId);
  if (!store.addresses.some((item) => Number(item.id) === Number(id))) throw createHttpError(404, "Dirección no encontrada.");
  store.addresses = store.addresses.map((item) => ({ ...item, es_principal: Number(item.id) === Number(id) ? 1 : 0 }));
  await writeCustomerData(usuarioId, store);
  return buildDireccionApiShape(store.addresses.find((item) => Number(item.id) === Number(id)));
}

// ============================================================
// FAVORITOS (storefront customers)
// ============================================================

const FAVORITO_TIPOS = new Set(["producto", "combo"]);

async function ensureClienteFavoritosTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente_favoritos (
      id INT NOT NULL AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'producto',
      referencia_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_cliente_fav (usuario_id, tipo, referencia_id),
      KEY idx_cliente_fav_user (usuario_id)
    ) ENGINE=InnoDB
  `);
}

function normalizeFavoritoInput(input) {
  const tipo = String(input?.tipo || "producto").toLowerCase();
  if (!FAVORITO_TIPOS.has(tipo)) {
    throw createHttpError(400, "Tipo inválido (producto|combo).");
  }
  const referencia_id = trimValue(input?.referencia_id || input?.referenciaId || "").slice(0, 64);
  if (!referencia_id) throw createHttpError(400, "Falta referencia_id.");
  return { tipo, referencia_id };
}

async function listFavoritosByUser(usuarioId) {
  const data = await readCustomerData(usuarioId);
  return data.favorites.slice().sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

async function listFavoritoIdsByUser(usuarioId) {
  const items = await listFavoritosByUser(usuarioId);
  return {
    productoIds: items.filter((it) => it.tipo === "producto").map((it) => it.referencia_id),
    comboIds: items.filter((it) => it.tipo === "combo").map((it) => it.referencia_id)
  };
}

async function addFavorito(usuarioId, payload) {
  const inputData = normalizeFavoritoInput(payload);
  const store = await readCustomerData(usuarioId);
  const existing = store.favorites.find((item) => item.tipo === inputData.tipo && item.referencia_id === inputData.referencia_id);
  if (existing) return existing;
  const item = { id: nextEmbeddedId(store.favorites), ...inputData, created_at: nowIso() };
  store.favorites.push(item);
  await writeCustomerData(usuarioId, store);
  return item;
}

async function removeFavoritoById(usuarioId, id) {
  const store = await readCustomerData(usuarioId);
  const previousLength = store.favorites.length;
  store.favorites = store.favorites.filter((item) => Number(item.id) !== Number(id));
  if (store.favorites.length === previousLength) throw createHttpError(404, "Favorito no encontrado.");
  await writeCustomerData(usuarioId, store);
}

async function removeFavoritoByRef(usuarioId, tipo, referenciaId) {
  const store = await readCustomerData(usuarioId);
  store.favorites = store.favorites.filter((item) => !(item.tipo === tipo && item.referencia_id === referenciaId));
  await writeCustomerData(usuarioId, store);
}

// ============================================================
// COMBOS (catalog)
// ============================================================

const COMBO_TIPOS = new Set([
  "previa", "reunion-en-casa", "noche-de-salida", "playa-y-verano",
  "brindis-y-celebracion", "chill-y-relax", "parrilla-y-amigos",
  "frutal-y-refrescante", "premium", "express",
  "pre", "playa", "chill", "fiesta", "romantico", "mixers", "after", "general"
]);

async function ensureCombosTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS combos (
      id INT NOT NULL AUTO_INCREMENT,
      slug VARCHAR(120) NOT NULL,
      nombre VARCHAR(190) NOT NULL,
      descripcion TEXT NULL,
      precio DECIMAL(10,2) NOT NULL DEFAULT 0,
      precio_antes DECIMAL(10,2) NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'general',
      badge VARCHAR(80) NULL,
      tema VARCHAR(40) NOT NULL DEFAULT 'gold',
      imagen_hash VARCHAR(64) NULL,
      imagen_url VARCHAR(255) NULL,
      orden INT NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_combos_slug (slug),
      KEY idx_combos_estado_orden (estado, orden)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS combo_items (
      id INT NOT NULL AUTO_INCREMENT,
      combo_id INT NOT NULL,
      producto_id INT NOT NULL,
      variant_id VARCHAR(80) NULL,
      cantidad INT NOT NULL DEFAULT 1,
      orden INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_combo_items_combo (combo_id),
      KEY idx_combo_items_producto (producto_id)
    ) ENGINE=InnoDB
  `);
  for (const ddl of [
    "ALTER TABLE combos ADD COLUMN portada_estilo VARCHAR(40) NULL AFTER imagen_url",
    "ALTER TABLE combos ADD COLUMN portada_texto VARCHAR(160) NULL AFTER portada_estilo",
    "ALTER TABLE combo_items ADD COLUMN variant_id VARCHAR(80) NULL AFTER producto_id"
  ]) {
    try {
      await connection.query(ddl);
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

const DEFAULT_COMBOS_SEED = [
  { slug: "combo-pre", nombre: "Combo Pre", descripcion: "12 chelas + hielo + snacks", precio: 69, badge: "Más pedido", tema: "gold", tipo: "pre", orden: 1 },
  { slug: "combo-playa", nombre: "Combo Playa", descripcion: "18 chelas + ron + hielo + snacks", precio: 129, badge: "Para 6 personas", tema: "cyan", tipo: "playa", orden: 2 },
  { slug: "combo-chill", nombre: "Combo Chill", descripcion: "Gin + mixers + snacks", precio: 89, badge: "Tarde tranqui", tema: "coral", tipo: "chill", orden: 3 },
  { slug: "combo-full", nombre: "Combo Full", descripcion: "Ron + vodka + whisky + energizantes + hielo", precio: 159, badge: "Fiesta improvisada", tema: "green", tipo: "fiesta", orden: 4 },
  { slug: "combo-romantico", nombre: "Combo Romántico", descripcion: "Vino + chocolates + queso", precio: 79, badge: "Para dos", tema: "pink", tipo: "romantico", orden: 5 },
  { slug: "combo-premium", nombre: "Combo Top", descripcion: "Whisky + vodka + energizantes", precio: 189, badge: "Premium", tema: "purple", tipo: "premium", orden: 6 },
  { slug: "combo-after", nombre: "Combo After", descripcion: "Ron + chelas + snacks + hielo", precio: 119, badge: "After office", tema: "cyan", tipo: "after", orden: 7 },
  { slug: "combo-gin-tonic", nombre: "Combo Gin", descripcion: "Gin + mixers + botanas", precio: 109, badge: "Gin night", tema: "coral", tipo: "mixers", orden: 8 }
];

async function ensureDefaultCombosSeed(connection) {
  const [rows] = await connection.query("SELECT COUNT(*) AS total FROM combos");
  if (Number(rows?.[0]?.total || 0) > 0) return;
  for (const c of DEFAULT_COMBOS_SEED) {
    try {
      await connection.query(
        `INSERT INTO combos (slug, nombre, descripcion, precio, tipo, badge, tema, orden, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO')`,
        [c.slug, c.nombre, c.descripcion, c.precio, c.tipo, c.badge, c.tema, c.orden]
      );
    } catch (_) {}
  }
}

// Recetas: cada combo se rellena con productos del catálogo eligiendo el primero
// disponible de cada categoría. Si la categoría no existe en BD, se ignora.
const COMBO_ITEM_RECIPES = {
  "combo-pre": [
    { categorias: ["Cervezas"], cantidad: 12 },
    { categorias: ["Hielo"], cantidad: 1 },
    { categorias: ["Snacks"], cantidad: 2 }
  ],
  "combo-playa": [
    { categorias: ["Cervezas"], cantidad: 18 },
    { categorias: ["Ron"], cantidad: 1 },
    { categorias: ["Hielo"], cantidad: 1 },
    { categorias: ["Snacks"], cantidad: 2 }
  ],
  "combo-chill": [
    { categorias: ["Gin"], cantidad: 1 },
    { categorias: ["Gaseosas y Mixers"], cantidad: 2 },
    { categorias: ["Snacks"], cantidad: 2 }
  ],
  "combo-full": [
    { categorias: ["Ron"], cantidad: 1 },
    { categorias: ["Vodka"], cantidad: 1 },
    { categorias: ["Whisky"], cantidad: 1 },
    { categorias: ["Energizantes"], cantidad: 4 },
    { categorias: ["Hielo"], cantidad: 1 }
  ],
  "combo-romantico": [
    { categorias: ["Vinos", "Espumantes"], cantidad: 1 },
    { categorias: ["Snacks"], cantidad: 2 }
  ],
  "combo-premium": [
    { categorias: ["Whisky"], cantidad: 1 },
    { categorias: ["Vodka"], cantidad: 1 },
    { categorias: ["Energizantes"], cantidad: 4 }
  ],
  "combo-after": [
    { categorias: ["Ron"], cantidad: 1 },
    { categorias: ["Cervezas"], cantidad: 6 },
    { categorias: ["Snacks"], cantidad: 2 },
    { categorias: ["Hielo"], cantidad: 1 }
  ],
  "combo-gin-tonic": [
    { categorias: ["Gin"], cantidad: 1 },
    { categorias: ["Gaseosas y Mixers", "Aguas"], cantidad: 4 },
    { categorias: ["Snacks"], cantidad: 2 }
  ]
};

async function ensureDefaultComboItemsSeed(connection) {
  const [comboRows] = await connection.query(
    "SELECT id, slug FROM combos WHERE UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'"
  );
  if (!Array.isArray(comboRows) || !comboRows.length) return;

  // cache de productos por categoría (id más bajo activo)
  const cacheByCategoria = new Map();
  async function pickProductForCategorias(categorias, productosUsados) {
    for (const cat of categorias) {
      if (!cacheByCategoria.has(cat)) {
        try {
          // Para OTRO: matchea también categorías vacías o NULL
          const isOtro = String(cat).toUpperCase() === "OTRO";
          const sql = isOtro
            ? `SELECT id FROM productos
               WHERE (categoria IS NULL OR TRIM(categoria) = '' OR UPPER(categoria) = 'OTRO')
                 AND UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
               ORDER BY id ASC LIMIT 12`
            : `SELECT id FROM productos
               WHERE UPPER(COALESCE(categoria, '')) = ?
                 AND UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
               ORDER BY id ASC LIMIT 5`;
          const params = isOtro ? [] : [cat];
          const [prodRows] = await connection.query(sql, params);
          cacheByCategoria.set(cat, (Array.isArray(prodRows) ? prodRows : []).map((r) => toInt(r.id, 0)).filter((id) => id > 0));
        } catch (_) {
          cacheByCategoria.set(cat, []);
        }
      }
      const ids = cacheByCategoria.get(cat) || [];
      for (const id of ids) {
        if (!productosUsados.has(id)) return id;
      }
    }
    return null;
  }

  for (const combo of comboRows) {
    // Solo seedear combos sin items
    const [existing] = await connection.query(
      "SELECT COUNT(*) AS total FROM combo_items WHERE combo_id = ?",
      [combo.id]
    );
    if (Number(existing?.[0]?.total || 0) > 0) continue;

    const recipe = COMBO_ITEM_RECIPES[String(combo.slug)];
    if (!recipe || !recipe.length) continue;

    const productosUsados = new Set();
    let orden = 0;
    for (const ingr of recipe) {
      // Intenta primero con las categorías ideales, luego con Cremas y Aperitivos como último recurso
      let productId = await pickProductForCategorias(ingr.categorias, productosUsados);
      if (!productId) {
        productId = await pickProductForCategorias(["Cremas y Aperitivos"], productosUsados);
      }
      if (!productId) continue;
      productosUsados.add(productId);
      try {
        await connection.query(
          "INSERT INTO combo_items (combo_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)",
          [combo.id, productId, Math.max(1, toInt(ingr.cantidad, 1)), orden]
        );
        orden += 1;
      } catch (_) {}
    }
  }
}

function buildComboApiShape(row, items = []) {
  return {
    id: toInt(row.id, 0),
    slug: trimValue(row.slug || ""),
    title: trimValue(row.nombre || ""),
    summary: row.descripcion ? trimValue(row.descripcion) : "",
    price: round2(row.precio),
    priceBefore: row.precio_antes !== null && row.precio_antes !== undefined ? round2(row.precio_antes) : null,
    tipo: trimValue(row.tipo || "general"),
    badge: row.badge ? trimValue(row.badge) : "",
    theme: trimValue(row.tema || "gold"),
    imageHash: row.imagen_hash ? trimValue(row.imagen_hash) : "",
    imageUrl: row.imagen_url ? trimValue(row.imagen_url) : "",
    coverStyle: row.portada_estilo ? trimValue(row.portada_estilo) : "gold-bar",
    coverText: row.portada_texto ? trimValue(row.portada_texto) : "Listo para armar la fiesta",
    orden: toInt(row.orden, 0),
    estado: trimValue(row.estado || "ACTIVO"),
    items: items.map((it) => ({
      productId: String(it.producto_id),
      variantId: trimValue(it.variant_id || ""),
      quantity: Math.max(1, toInt(it.cantidad, 1))
    }))
  };
}

function slugifyComboTitle(value) {
  const base = trimValue(value || "combo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return base || "combo";
}

function normalizeComboInput(payload) {
  const title = truncateText(payload?.title || payload?.nombre || "", 190);
  if (!title) throw createHttpError(400, "El nombre del combo es obligatorio.");
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item, index) => {
      const rawProductId = trimValue(item?.productId ?? item?.producto_id ?? "");
      const [parentId, compoundVariantId] = rawProductId.split("::");
      const productIdInput = item?.parentProductId ?? item?.parent_product_id ?? (parentId || rawProductId);
      return {
        productId: toInt(productIdInput, 0),
        variantId: truncateText(trimValue(item?.variantId ?? item?.variant_id ?? compoundVariantId ?? ""), 80),
        quantity: Math.max(1, toInt(item?.quantity ?? item?.cantidad, 1)),
        orden: index
      };
    })
    .filter((item) => item.productId > 0);
  if (!items.length) throw createHttpError(400, "El combo debe incluir al menos un producto.");
  const tipo = trimValue(payload?.tipo || "general").toLowerCase();
  return {
    slug: slugifyComboTitle(payload?.slug || title),
    title,
    summary: truncateText(payload?.summary || payload?.descripcion || "", 255),
    price: round2(payload?.price),
    priceBefore: payload?.priceBefore !== null && payload?.priceBefore !== undefined ? round2(payload.priceBefore) : null,
    tipo: COMBO_TIPOS.has(tipo) ? tipo : "general",
    badge: truncateText(payload?.badge || "", 80),
    theme: truncateText(payload?.theme || "gold", 40),
    imageHash: truncateText(payload?.imageHash || "", 64),
    imageUrl: truncateText(payload?.imageUrl || "", 255),
    imageData: typeof payload?.imageData === "string" ? payload.imageData.trim() : "",
    coverStyle: truncateText(payload?.coverStyle || "gold-bar", 40),
    coverText: truncateText(payload?.coverText || "Listo para armar la fiesta", 160),
    items
  };
}

async function persistComboImageData(connection, imageData) {
  const parsed = parseDataUri(imageData);
  if (!parsed?.isDataUri || parsed.encoding !== "base64" || !parsed.payload) return "";
  const mime = parsed.mime || "image/webp";
  if (!/^image\//i.test(mime)) return "";
  const hash = computeImageHash(imageData);
  if (!hash) return "";
  await ensureProductImagesTable(connection);
  const [existing] = await connection.query(
    "SELECT id FROM producto_imagenes WHERE hash_image = ? LIMIT 1",
    [hash]
  );
  if (!Array.isArray(existing) || !existing.length) {
    await connection.query(
      `INSERT INTO producto_imagenes
        (producto_id, orden, es_portada, original_webp_url, thumb_webp_url, hash_image, mime, width, height)
       VALUES (0, 0, 1, ?, ?, ?, ?, 0, 0)`,
      [imageData, imageData, hash, mime]
    );
  }
  return hash;
}

async function buildUniqueComboSlug(connection, desiredSlug) {
  let slug = desiredSlug;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
    const [rows] = await connection.query("SELECT id FROM combos WHERE slug = ? LIMIT 1", [candidate]);
    if (!Array.isArray(rows) || !rows.length) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

async function createComboLocal(payload) {
  const data = normalizeComboInput(payload);
  const current = await readCombosStore();
  const existingSlugs = new Set(current.map((item) => trimValue(item?.slug || "")));
  let slug = data.slug;
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${data.slug}-${suffix}`;
    suffix += 1;
  }
  const item = buildComboApiShape(
    {
      id: Date.now(),
      slug,
      nombre: data.title,
      descripcion: data.summary,
      precio: data.price,
      precio_antes: data.priceBefore,
      tipo: data.tipo,
      badge: data.badge,
      tema: data.theme,
      imagen_hash: data.imageHash,
      imagen_url: data.imageData || data.imageUrl,
      portada_estilo: data.coverStyle,
      portada_texto: data.coverText,
      orden: current.length + 1,
      estado: "ACTIVO"
    },
    data.items.map((entry) => ({
      producto_id: entry.productId,
      variant_id: entry.variantId || "",
      cantidad: entry.quantity,
      orden: entry.orden
    }))
  );
  current.unshift(item);
  await writeCombosStore(current);
  return item;
}

async function readLocalComboApiShapes() {
  return (await readCombosStore()).map((item) =>
    item?.title ? item : buildComboApiShape(item, item?.items || [])
  );
}

async function listCombosActivos() {
  const localItems = await readLocalComboApiShapes();
  if (getFirebaseDb()) {
    return localItems.filter((item) => normalizeText(item?.estado || "ACTIVO") === "activo");
  }
  try {
    const mysqlItems = await withMysqlConnection(async (connection) => {
      await ensureCombosTables(connection);
      await ensureDefaultCombosSeed(connection);
      await ensureDefaultComboItemsSeed(connection);
      const [combosRows] = await connection.query(
        `SELECT * FROM combos
         WHERE UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
         ORDER BY orden ASC, id ASC`
      );
      const safe = Array.isArray(combosRows) ? combosRows : [];
      if (!safe.length) return [];
      const ids = safe.map((c) => toInt(c.id, 0)).filter((id) => id > 0);
      const placeholders = ids.map(() => "?").join(",");
      const [itemRows] = await connection.query(
        `SELECT combo_id, producto_id, variant_id, cantidad, orden
         FROM combo_items
         WHERE combo_id IN (${placeholders})
         ORDER BY combo_id ASC, orden ASC, id ASC`,
        ids
      );
      const byCombo = new Map();
      for (const row of Array.isArray(itemRows) ? itemRows : []) {
        const cid = toInt(row.combo_id, 0);
        if (!byCombo.has(cid)) byCombo.set(cid, []);
        byCombo.get(cid).push(row);
      }
      return safe.map((row) => buildComboApiShape(row, byCombo.get(toInt(row.id, 0)) || []));
    });
    const mysqlSlugs = new Set(mysqlItems.map((item) => trimValue(item?.slug || "")));
    return [...mysqlItems, ...localItems.filter((item) => !mysqlSlugs.has(trimValue(item?.slug || "")))];
  } catch (error) {
    if (await isMysqlOnlyModeEnabled()) throw error;
    await appendLog("WARN", "Fallback local de combos", {
      operation: "listCombosActivos",
      message: buildDbErrorMessage(error)
    });
    return localItems;
  }
}

async function createCombo(payload) {
  const data = normalizeComboInput(payload);
  if (getFirebaseDb()) {
    if (data.imageData) {
      const uploadedUrl = await uploadDataUriToFirebaseStorage(data.imageData, "combos", data.slug || data.title);
      if (!uploadedUrl) throw createHttpError(400, "La imagen del combo no es válida.");
      data.imageUrl = uploadedUrl;
      data.imageData = "";
    }
    return createComboLocal(data);
  }
  try {
    return await withMysqlConnection(async (connection) => {
      await ensureCombosTables(connection);
      const uploadedImageHash = data.imageData ? await persistComboImageData(connection, data.imageData) : "";
      if (uploadedImageHash) data.imageHash = uploadedImageHash;
      const slug = await buildUniqueComboSlug(connection, data.slug);
      const [orderRows] = await connection.query("SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM combos");
      const orden = toInt(orderRows?.[0]?.maxOrden, 0) + 1;
      const [result] = await connection.query(
        `INSERT INTO combos
          (slug, nombre, descripcion, precio, precio_antes, tipo, badge, tema, imagen_hash, imagen_url, portada_estilo, portada_texto, orden, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO')`,
        [
          slug,
          data.title,
          data.summary || null,
          data.price,
          data.priceBefore,
          data.tipo,
          data.badge || null,
          data.theme,
          data.imageHash || null,
          data.imageUrl || null,
          data.coverStyle,
          data.coverText,
          orden
        ]
      );
      const comboId = result.insertId;
      for (const item of data.items) {
        await connection.query(
          "INSERT INTO combo_items (combo_id, producto_id, variant_id, cantidad, orden) VALUES (?, ?, ?, ?, ?)",
          [comboId, item.productId, item.variantId || null, item.quantity, item.orden]
        );
      }
      return buildComboApiShape(
        {
          id: comboId,
          slug,
          nombre: data.title,
          descripcion: data.summary,
          precio: data.price,
          precio_antes: data.priceBefore,
          tipo: data.tipo,
          badge: data.badge,
          tema: data.theme,
          imagen_hash: data.imageHash,
          imagen_url: data.imageUrl,
          portada_estilo: data.coverStyle,
          portada_texto: data.coverText,
          orden,
          estado: "ACTIVO"
        },
        data.items.map((item) => ({
          producto_id: item.productId,
          variant_id: item.variantId || "",
          cantidad: item.quantity,
          orden: item.orden
        }))
      );
    });
  } catch (error) {
    if (await isMysqlOnlyModeEnabled()) throw error;
    await appendLog("WARN", "Fallback local de combos", {
      operation: "createCombo",
      message: buildDbErrorMessage(error)
    });
    return createComboLocal(data);
  }
}

async function updateCombo(slugInput, payload) {
  const data = normalizeComboInput(payload);
  const safeSlug = trimValue(slugInput || payload?.slug || payload?.id || "").toLowerCase();
  if (!safeSlug) throw createHttpError(400, "Combo inválido.");
  if (data.imageData) {
    const uploadedUrl = await uploadDataUriToFirebaseStorage(data.imageData, "combos", data.slug || data.title);
    if (!uploadedUrl) throw createHttpError(400, "La imagen del combo no es válida.");
    data.imageUrl = uploadedUrl;
    data.imageData = "";
  }
  const current = await readCombosStore();
  const index = current.findIndex((item) => trimValue(item?.slug || item?.id || "").toLowerCase() === safeSlug);
  if (index < 0) throw createHttpError(404, "Combo no encontrado.");
  const existing = current[index] || {};
  const updated = buildComboApiShape(
    {
      id: existing.id || Date.now(),
      slug: data.slug || existing.slug || safeSlug,
      nombre: data.title,
      descripcion: data.summary,
      precio: data.price,
      precio_antes: data.priceBefore,
      tipo: data.tipo,
      badge: data.badge,
      tema: data.theme,
      imagen_hash: data.imageHash || existing.imageHash || "",
      imagen_url: data.imageUrl || existing.imageUrl || "",
      portada_estilo: data.coverStyle,
      portada_texto: data.coverText,
      orden: existing.orden || index + 1,
      estado: existing.estado || "ACTIVO"
    },
    data.items.map((entry) => ({
      producto_id: entry.productId,
      variant_id: entry.variantId || "",
      cantidad: entry.quantity,
      orden: entry.orden
    }))
  );
  current[index] = updated;
  await writeCombosStore(current);
  return updated;
}

async function deleteCombo(slugInput) {
  const safeSlug = trimValue(slugInput || "").toLowerCase();
  if (!safeSlug) throw createHttpError(400, "Combo inválido.");
  const current = await readCombosStore();
  const index = current.findIndex((item) => trimValue(item?.slug || item?.id || "").toLowerCase() === safeSlug);
  if (index < 0) throw createHttpError(404, "Combo no encontrado.");
  const existing = current[index] || {};
  if (getFirebaseDb()) {
    await deleteFirebaseDoc("combos", existing.id || existing.slug || safeSlug);
  }
  const next = current.filter((_, itemIndex) => itemIndex !== index);
  await writeCombosStore(next);
  return { ok: true };
}

async function getComboBySlug(slug) {
  const safeSlug = trimValue(slug || "").toLowerCase();
  if (!safeSlug) return null;
  if (getFirebaseDb()) {
    const items = await readCombosStore();
    return items.find((item) => trimValue(item?.slug || item?.id || "").toLowerCase() === safeSlug) || null;
  }
  return withDataSourceFallback(
    "getComboBySlug",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureCombosTables(connection);
        const [rows] = await connection.query("SELECT * FROM combos WHERE slug = ? LIMIT 1", [safeSlug]);
        const row = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!row) return null;
        const [itemRows] = await connection.query(
          "SELECT producto_id, variant_id, cantidad, orden FROM combo_items WHERE combo_id = ? ORDER BY orden ASC, id ASC",
          [row.id]
        );
        return buildComboApiShape(row, Array.isArray(itemRows) ? itemRows : []);
      }),
    async () => {
      const items = await readCombosStore();
      return items.find((item) => trimValue(item?.slug || "").toLowerCase() === safeSlug) || null;
    }
  );
}

// ============================================================
// PROMOS (catalog)
// ============================================================

const PROMO_TIPOS = new Set(["descuento", "2x1", "bundle", "tiempo_limitado"]);

async function ensurePromocionesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS promociones (
      id INT NOT NULL AUTO_INCREMENT,
      slug VARCHAR(120) NOT NULL,
      titulo VARCHAR(190) NOT NULL,
      subtitulo VARCHAR(255) NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'descuento',
      descuento_pct INT NULL,
      precio DECIMAL(10,2) NULL,
      precio_antes DECIMAL(10,2) NULL,
      categoria VARCHAR(40) NULL,
      producto_id INT NULL,
      combo_id INT NULL,
      badge VARCHAR(80) NULL,
      hero_image_hash VARCHAR(64) NULL,
      hero_image_url VARCHAR(255) NULL,
      destacada TINYINT(1) NOT NULL DEFAULT 0,
      vence_at DATETIME NULL,
      orden INT NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_promociones_slug (slug),
      KEY idx_promociones_destacada (destacada, estado),
      KEY idx_promociones_categoria (categoria)
    ) ENGINE=InnoDB
  `);
}

const DEFAULT_PROMOS_SEED = [
  {
    slug: "corona-2x1",
    titulo: "2x1 EN CORONA 355ML",
    subtitulo: "Llévate dos cajas al precio de una",
    tipo: "2x1",
    categoria: "Cervezas",
    badge: "OFERTA DEL DIA",
    destacada: 1,
    descuento_pct: 50,
    venceEnHoras: 24,
    orden: 1
  },
  {
    slug: "whisky-20",
    titulo: "20% OFF WHISKY",
    subtitulo: "Aplica a toda la categoría",
    tipo: "descuento",
    categoria: "Whisky",
    descuento_pct: 20,
    badge: "Limitado",
    venceEnHoras: 72,
    orden: 2
  },
  {
    slug: "ron-15",
    titulo: "15% OFF RON",
    subtitulo: "El sabor de la fiesta",
    tipo: "descuento",
    categoria: "Ron",
    descuento_pct: 15,
    venceEnHoras: 72,
    orden: 3
  },
  {
    slug: "vodka-25",
    titulo: "25% OFF VODKA",
    subtitulo: "Mezcla y disfruta",
    tipo: "descuento",
    categoria: "Vodka",
    descuento_pct: 25,
    venceEnHoras: 72,
    orden: 4
  },
  {
    slug: "gin-30",
    titulo: "30% OFF GIN",
    subtitulo: "Para la noche perfecta",
    tipo: "descuento",
    categoria: "Gin",
    descuento_pct: 30,
    venceEnHoras: 48,
    orden: 5
  },
  {
    slug: "vino-25",
    titulo: "25% OFF VINOS",
    subtitulo: "Selección premium",
    tipo: "descuento",
    categoria: "Vinos",
    descuento_pct: 25,
    venceEnHoras: 96,
    orden: 6
  },
  {
    slug: "tequila-20",
    titulo: "20% OFF TEQUILA",
    subtitulo: "Sabor mexicano",
    tipo: "descuento",
    categoria: "Tequila",
    descuento_pct: 20,
    venceEnHoras: 96,
    orden: 7
  }
];

async function ensureDefaultPromosSeed(connection) {
  const [rows] = await connection.query("SELECT COUNT(*) AS total FROM promociones");
  if (Number(rows?.[0]?.total || 0) > 0) return;
  for (const p of DEFAULT_PROMOS_SEED) {
    try {
      const vence = new Date(Date.now() + (p.venceEnHoras || 24) * 3600 * 1000);
      await connection.query(
        `INSERT INTO promociones
          (slug, titulo, subtitulo, tipo, descuento_pct, categoria, badge, destacada, vence_at, orden, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO')`,
        [
          p.slug,
          p.titulo,
          p.subtitulo,
          p.tipo,
          p.descuento_pct || null,
          p.categoria || null,
          p.badge || null,
          p.destacada || 0,
          vence.toISOString().slice(0, 19).replace("T", " "),
          p.orden || 0
        ]
      );
    } catch (_) {}
  }
}

function buildPromoApiShape(row) {
  return {
    id: toInt(row.id, 0),
    slug: trimValue(row.slug || ""),
    titulo: trimValue(row.titulo || ""),
    subtitulo: row.subtitulo ? trimValue(row.subtitulo) : "",
    tipo: trimValue(row.tipo || "descuento"),
    descuentoPct: row.descuento_pct !== null && row.descuento_pct !== undefined ? toInt(row.descuento_pct, 0) : null,
    precio: row.precio !== null && row.precio !== undefined ? round2(row.precio) : null,
    precioAntes: row.precio_antes !== null && row.precio_antes !== undefined ? round2(row.precio_antes) : null,
    categoria: row.categoria ? trimValue(row.categoria) : "",
    productoId: row.producto_id ? toInt(row.producto_id, 0) : null,
    comboId: row.combo_id ? toInt(row.combo_id, 0) : null,
    badge: row.badge ? trimValue(row.badge) : "",
    heroImageHash: row.hero_image_hash ? trimValue(row.hero_image_hash) : "",
    heroImageUrl: row.hero_image_url ? trimValue(row.hero_image_url) : "",
    destacada: Number(row.destacada) === 1,
    venceAt: row.vence_at ? new Date(row.vence_at).toISOString() : null,
    orden: toInt(row.orden, 0),
    estado: trimValue(row.estado || "ACTIVO")
  };
}

async function listPromosActivas() {
  if (isFirebaseBackendEnabled()) {
    const rows = await readFirebaseCollection("promos") || [];
    const now = Date.now();
    return rows
      .map(buildPromoApiShape)
      .filter((promo) => promo.estado === "ACTIVO")
      .filter((promo) => !promo.venceAt || new Date(promo.venceAt).getTime() > now)
      .sort((left, right) => Number(right.destacada) - Number(left.destacada) || Number(left.orden) - Number(right.orden));
  }
  return withDataSourceFallback(
    "listPromosActivas",
    () =>
      withMysqlConnection(async (connection) => {
        await ensurePromocionesTable(connection);
        await ensureDefaultPromosSeed(connection);
        const [rows] = await connection.query(
          `SELECT * FROM promociones
           WHERE UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
             AND (vence_at IS NULL OR vence_at > NOW())
           ORDER BY destacada DESC, orden ASC, id ASC`
        );
        return (Array.isArray(rows) ? rows : []).map(buildPromoApiShape);
      }),
    async () => []
  );
}

async function getPromoDestacada() {
  const all = await listPromosActivas();
  return all.find((p) => p.destacada) || all[0] || null;
}

async function validarPromoCodigo(codigo) {
  const slug = trimValue(codigo || "").toLowerCase();
  if (!slug) return null;
  if (isFirebaseBackendEnabled()) {
    const promos = await listPromosActivas();
    return promos.find((promo) => promo.slug.toLowerCase() === slug) || null;
  }
  return withMysqlConnection(async (connection) => {
    await ensurePromocionesTable(connection);
    const [rows] = await connection.query(
      `SELECT * FROM promociones
       WHERE slug = ?
         AND UPPER(COALESCE(estado, 'ACTIVO')) = 'ACTIVO'
         AND (vence_at IS NULL OR vence_at > NOW())
       LIMIT 1`,
      [slug]
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return row ? buildPromoApiShape(row) : null;
  });
}

function normalizeCouponCode(value) {
  return trimValue(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeCouponStatus(value) {
  const raw = trimValue(value || "ACTIVO").toUpperCase();
  return raw === "INACTIVO" ? "INACTIVO" : "ACTIVO";
}

function normalizeCouponDiscountType(value) {
  const raw = trimValue(value || "amount").toLowerCase();
  return raw === "percent" || raw === "percentage" || raw === "porcentaje" ? "percent" : "amount";
}

function normalizeCouponDate(value) {
  const text = trimValue(value || "");
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function buildCouponApiShape(row = {}) {
  const code = normalizeCouponCode(row.code || row.codigo || row.id || "");
  const discountType = normalizeCouponDiscountType(row.discountType || row.tipoDescuento || row.discount_type);
  const rawValue = round2(row.discountValue ?? row.valorDescuento ?? row.discount_value ?? 0);
  const discountValue = discountType === "percent" ? Math.min(100, Math.max(0, rawValue)) : Math.max(0, rawValue);
  const unlimitedDates = row.unlimitedDates === true || row.vigenciaIlimitada === true || row.unlimited_dates === true;
  const unlimitedUses = row.unlimitedUses === true || row.usosIlimitados === true || row.unlimited_uses === true;
  const maxUses = unlimitedUses ? null : Math.max(0, toInt(row.maxUses ?? row.max_uses ?? row.unidades ?? 0, 0));
  const usedCount = Math.max(0, toInt(row.usedCount ?? row.used_count ?? 0, 0));
  return {
    id: trimValue(row.id || code || `coupon-${Date.now()}`),
    title: trimValue(row.title || row.titulo || "").slice(0, 120),
    code,
    description: trimValue(row.description || row.descripcion || "").slice(0, 240),
    appliesTo: "delivery",
    discountType,
    discountValue,
    unlimitedDates,
    startsAt: unlimitedDates ? "" : normalizeCouponDate(row.startsAt || row.desde || row.starts_at),
    endsAt: unlimitedDates ? "" : normalizeCouponDate(row.endsAt || row.hasta || row.ends_at),
    unlimitedUses,
    maxUses,
    usedCount,
    status: normalizeCouponStatus(row.status || row.estado),
    createdAt: trimValue(row.createdAt || row.created_at || nowIso()),
    updatedAt: trimValue(row.updatedAt || row.updated_at || nowIso())
  };
}

function assertCouponInput(coupon) {
  if (!coupon.title) throw createHttpError(400, "El cupón necesita un título.");
  if (!coupon.code) throw createHttpError(400, "El cupón necesita un código.");
  if (coupon.discountValue <= 0) throw createHttpError(400, "El descuento de delivery debe ser mayor a 0.");
  if (!coupon.unlimitedDates && coupon.startsAt && coupon.endsAt && new Date(coupon.startsAt).getTime() > new Date(coupon.endsAt).getTime()) {
    throw createHttpError(400, "La fecha inicial no puede ser mayor que la fecha final.");
  }
  if (!coupon.unlimitedUses && (!Number.isFinite(Number(coupon.maxUses)) || Number(coupon.maxUses) <= 0)) {
    throw createHttpError(400, "Define unidades disponibles o marca usos ilimitados.");
  }
}

function isCouponCurrentlyValid(coupon, now = new Date()) {
  if (!coupon || coupon.status !== "ACTIVO") return false;
  const nowMs = now.getTime();
  if (!coupon.unlimitedDates) {
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > nowMs) return false;
    if (coupon.endsAt && new Date(coupon.endsAt).getTime() < nowMs) return false;
  }
  if (!coupon.unlimitedUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses || 0)) return false;
  return true;
}

function calculateDeliveryCouponDiscount(coupon, shippingInput) {
  const shipping = Math.max(0, round2(shippingInput));
  if (!shipping) return 0;
  const rawDiscount = coupon.discountType === "percent"
    ? round2(shipping * Number(coupon.discountValue || 0) / 100)
    : round2(coupon.discountValue);
  return Math.min(shipping, Math.max(0, round2(rawDiscount)));
}

async function validateCouponForDelivery(codeInput, { shipping = 0 } = {}) {
  const code = normalizeCouponCode(codeInput || "");
  if (!code) throw createHttpError(400, "Ingresa un código de cupón.");
  const coupons = await listCouponsAll();
  const coupon = coupons.find((item) => item.code === code);
  if (!coupon || !isCouponCurrentlyValid(coupon)) {
    throw createHttpError(404, "Cupón no disponible.");
  }
  const shippingBeforeDiscount = Math.max(0, round2(shipping));
  const deliveryDiscount = calculateDeliveryCouponDiscount(coupon, shippingBeforeDiscount);
  return {
    id: coupon.id,
    code: coupon.code,
    title: coupon.title,
    description: coupon.description,
    appliesTo: "delivery",
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    deliveryDiscount,
    shippingBeforeDiscount,
    shippingAfterDiscount: round2(Math.max(0, shippingBeforeDiscount - deliveryDiscount))
  };
}

async function consumeCouponUse(couponId) {
  const safeId = trimValue(couponId || "");
  if (!safeId) return;
  const existing = await getFirebaseDoc("coupons", safeId);
  if (!existing) return;
  const coupon = buildCouponApiShape(existing);
  if (coupon.unlimitedUses) return;
  if (!isCouponCurrentlyValid(coupon)) {
    throw createHttpError(409, "Cupón sin unidades disponibles.");
  }
  await writeFirebaseDoc("coupons", safeId, {
    ...existing,
    usedCount: Number(coupon.usedCount || 0) + 1,
    updatedAt: nowIso()
  });
}

async function listCouponsAll() {
  const rows = await readFirebaseCollection("coupons");
  return (Array.isArray(rows) ? rows : [])
    .map(buildCouponApiShape)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function saveCoupon(id, payload = {}) {
  const existing = id ? await getFirebaseDoc("coupons", id) : null;
  const baseCode = normalizeCouponCode(payload.code || payload.codigo || existing?.code || id || "");
  const couponId = trimValue(id || baseCode);
  const next = buildCouponApiShape({
    ...(existing || {}),
    ...payload,
    id: couponId,
    code: baseCode,
    createdAt: existing?.createdAt || nowIso(),
    usedCount: existing?.usedCount ?? payload.usedCount ?? 0,
    updatedAt: nowIso()
  });
  assertCouponInput(next);
  await writeFirebaseDoc("coupons", next.id, next);
  return next;
}

async function deleteCoupon(id) {
  const safeId = trimValue(id || "");
  if (!safeId) throw createHttpError(400, "Falta el cupón.");
  await deleteFirebaseDoc("coupons", safeId);
  return { ok: true, id: safeId };
}

// ============================================================
// MÉTODOS DE PAGO (storefront customers)
// ============================================================

const METODO_PAGO_TIPOS = new Set(["yape", "plin", "tarjeta"]);

async function ensureClienteMetodosPagoTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente_metodos_pago (
      id INT NOT NULL AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      tipo VARCHAR(40) NOT NULL,
      proveedor VARCHAR(40) NULL,
      alias VARCHAR(120) NULL,
      numero VARCHAR(20) NULL,
      ultimos4 VARCHAR(8) NULL,
      identificador_encriptado TEXT NULL,
      verificado TINYINT(1) NOT NULL DEFAULT 0,
      es_principal TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pago_user (usuario_id),
      KEY idx_pago_principal (usuario_id, es_principal)
    ) ENGINE=InnoDB
  `);
}

function buildMetodoPagoShape(row) {
  if (!row) return null;
  return {
    id: toInt(row.id, 0),
    tipo: trimValue(row.tipo || "yape"),
    proveedor: row.proveedor ? trimValue(row.proveedor) : "",
    alias: row.alias ? trimValue(row.alias) : "",
    numero: row.numero ? trimValue(row.numero) : "",
    ultimos4: row.ultimos4 ? trimValue(row.ultimos4) : "",
    verificado: Number(row.verificado) === 1,
    es_principal: Number(row.es_principal) === 1,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function validateMetodoPagoInput(input) {
  const tipo = String(input?.tipo || "").toLowerCase();
  if (!METODO_PAGO_TIPOS.has(tipo)) {
    throw createHttpError(400, "Tipo de método inválido (yape | plin | tarjeta).");
  }
  if (tipo === "tarjeta") {
    throw createHttpError(400, "Las tarjetas estarán disponibles próximamente.");
  }

  // yape / plin: pedimos número (9 dígitos) + alias opcional
  const numeroRaw = String(input?.numero || "").replace(/\s+/g, "");
  if (!/^\d{9}$/.test(numeroRaw)) {
    throw createHttpError(400, "El número debe tener 9 dígitos.");
  }
  const alias = trimValue(input?.alias || "").slice(0, 120);
  return {
    tipo,
    proveedor: tipo === "yape" ? "Yape" : "Plin",
    alias: alias || null,
    numero: numeroRaw,
    ultimos4: numeroRaw.slice(-4),
    identificador_encriptado: null,
    verificado: 0,
    es_principal: input?.es_principal === true || input?.es_principal === 1 || input?.es_principal === "1"
  };
}

async function listMetodosPagoByUser(usuarioId) {
  const data = await readCustomerData(usuarioId);
  return data.paymentMethods.map(buildMetodoPagoShape)
    .sort((left, right) => Number(right.es_principal) - Number(left.es_principal) || String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

async function getMetodoPagoById(usuarioId, id) {
  const data = await readCustomerData(usuarioId);
  return buildMetodoPagoShape(data.paymentMethods.find((item) => Number(item.id) === Number(id)) || null);
}

async function createMetodoPago(usuarioId, input) {
  const inputData = validateMetodoPagoInput(input);
  const store = await readCustomerData(usuarioId);
  if (store.paymentMethods.some((item) => item.tipo === inputData.tipo && item.numero === inputData.numero)) {
    throw createHttpError(409, "Ya tienes ese número registrado.");
  }
  const setPrincipal = inputData.es_principal || store.paymentMethods.length === 0;
  if (setPrincipal) store.paymentMethods = store.paymentMethods.map((item) => ({ ...item, es_principal: 0 }));
  const item = {
    ...inputData,
    id: nextEmbeddedId(store.paymentMethods),
    es_principal: setPrincipal ? 1 : 0,
    created_at: nowIso()
  };
  store.paymentMethods.push(item);
  await writeCustomerData(usuarioId, store);
  return buildMetodoPagoShape(item);
}

async function deleteMetodoPago(usuarioId, id) {
  const store = await readCustomerData(usuarioId);
  const previousLength = store.paymentMethods.length;
  store.paymentMethods = store.paymentMethods.filter((item) => Number(item.id) !== Number(id));
  if (store.paymentMethods.length === previousLength) throw createHttpError(404, "Método no encontrado.");
  if (store.paymentMethods.length && !store.paymentMethods.some((item) => Number(item.es_principal) === 1)) {
    store.paymentMethods[0] = { ...store.paymentMethods[0], es_principal: 1 };
  }
  await writeCustomerData(usuarioId, store);
}

async function setMetodoPagoPrincipal(usuarioId, id) {
  const store = await readCustomerData(usuarioId);
  if (!store.paymentMethods.some((item) => Number(item.id) === Number(id))) throw createHttpError(404, "Método no encontrado.");
  store.paymentMethods = store.paymentMethods.map((item) => ({ ...item, es_principal: Number(item.id) === Number(id) ? 1 : 0 }));
  await writeCustomerData(usuarioId, store);
  return buildMetodoPagoShape(store.paymentMethods.find((item) => Number(item.id) === Number(id)));
}

// ============================================================
// NOTIFICACIONES (storefront customers)
// ============================================================

const NOTIF_TIPOS = new Set(["pedido", "club", "promo", "sistema"]);

async function ensureClienteNotificacionesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente_notificaciones (
      id INT NOT NULL AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'sistema',
      titulo VARCHAR(190) NOT NULL,
      mensaje TEXT NULL,
      icono VARCHAR(40) NULL,
      link VARCHAR(255) NULL,
      leida TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notif_user (usuario_id, leida),
      KEY idx_notif_user_created (usuario_id, created_at)
    ) ENGINE=InnoDB
  `);
}

function buildNotificacionShape(row) {
  return {
    id: toInt(row.id, 0),
    usuario_id: toInt(row.usuario_id ?? row.usuarioId, 0),
    tipo: trimValue(row.tipo || "sistema"),
    titulo: trimValue(row.titulo || ""),
    mensaje: row.mensaje ? trimValue(row.mensaje) : "",
    icono: row.icono ? trimValue(row.icono) : "",
    link: row.link ? trimValue(row.link) : "",
    leida: Number(row.leida) === 1,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

async function readNotificationsStore() {
  const remote = await readFirebaseCollection("notifications");
  if (remote) return remote;
  try {
    const raw = await fs.readFile(NOTIFICATIONS_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeNotificationsStore(items) {
  const list = Array.isArray(items) ? items : [];
  if (await writeFirebaseCollection("notifications", list)) return;
  await fs.mkdir(path.dirname(NOTIFICATIONS_DB_PATH), { recursive: true });
  await fs.writeFile(NOTIFICATIONS_DB_PATH, JSON.stringify(list, null, 2), "utf8");
}

async function addLocalNotificacion(usuarioId, payload) {
  const tipoRaw = String(payload?.tipo || "sistema").toLowerCase();
  const tipo = NOTIF_TIPOS.has(tipoRaw) ? tipoRaw : "sistema";
  const titulo = trimValue(payload?.titulo || "").slice(0, 190);
  if (!titulo) return null;
  const mensaje = payload?.mensaje ? trimValue(payload.mensaje) : "";
  const icono = payload?.icono ? trimValue(payload.icono).slice(0, 40) : "";
  const link = payload?.link ? trimValue(payload.link).slice(0, 255) : "";
  const dedupeKey = trimValue(payload?.dedupeKey || "");
  const current = await readNotificationsStore();
  if (dedupeKey) {
    const existing = current.find((item) => Number(item.usuario_id) === Number(usuarioId) && item.dedupeKey === dedupeKey);
    if (existing) return buildNotificacionShape(existing);
  }
  const nextId = current.reduce((max, item) => Math.max(max, toInt(item.id, 0)), 0) + 1;
  const item = {
    id: nextId,
    usuario_id: toInt(usuarioId, 0),
    tipo,
    titulo,
    mensaje,
    icono,
    link,
    leida: 0,
    dedupeKey,
    created_at: nowIso()
  };
  current.unshift(item);
  await writeNotificationsStore(current);
  return buildNotificacionShape(item);
}

async function ensureLocalOrderStatusNotifications(usuarioId) {
  const orders = (await readOrdersStore()).map((item) => buildOrderApiShape(item));
  for (const order of orders) {
    if (Number(order.usuarioId) !== Number(usuarioId)) continue;
    const notification = buildOrderStatusNotification(order, "", order.status);
    if (notification) await addLocalNotificacion(usuarioId, notification);
  }
}

async function listLocalNotificacionesByUser(usuarioId, { soloNoLeidas = false, tipo = "" } = {}) {
  await ensureLocalOrderStatusNotifications(usuarioId);
  const tipoFilter = String(tipo || "").toLowerCase();
  const items = await readNotificationsStore();
  return items
    .filter((item) => Number(item.usuario_id) === Number(usuarioId))
    .filter((item) => !soloNoLeidas || Number(item.leida) !== 1)
    .filter((item) => !tipoFilter || item.tipo === tipoFilter)
    .sort((left, right) => {
      if (Number(left.leida) !== Number(right.leida)) return Number(left.leida) - Number(right.leida);
      return String(right.created_at || "").localeCompare(String(left.created_at || ""));
    })
    .slice(0, 200)
    .map(buildNotificacionShape);
}

async function countLocalUnreadNotificaciones(usuarioId) {
  await ensureLocalOrderStatusNotifications(usuarioId);
  const items = await readNotificationsStore();
  return items.filter((item) => Number(item.usuario_id) === Number(usuarioId) && Number(item.leida) !== 1).length;
}

async function markLocalNotificacionLeida(usuarioId, id) {
  const current = await readNotificationsStore();
  let found = false;
  const next = current.map((item) => {
    if (Number(item.id) === Number(id) && Number(item.usuario_id) === Number(usuarioId)) {
      found = true;
      return { ...item, leida: 1 };
    }
    return item;
  });
  if (!found) throw createHttpError(404, "Notificación no encontrada.");
  await writeNotificationsStore(next);
}

async function markAllLocalNotificacionesLeidas(usuarioId) {
  const current = await readNotificationsStore();
  let updated = 0;
  const next = current.map((item) => {
    if (Number(item.usuario_id) === Number(usuarioId) && Number(item.leida) !== 1) {
      updated += 1;
      return { ...item, leida: 1 };
    }
    return item;
  });
  await writeNotificationsStore(next);
  return updated;
}

async function addNotificacion(usuarioId, payload) {
  const tipoRaw = String(payload?.tipo || "sistema").toLowerCase();
  const tipo = NOTIF_TIPOS.has(tipoRaw) ? tipoRaw : "sistema";
  const titulo = trimValue(payload?.titulo || "").slice(0, 190);
  if (!titulo) return null;
  const mensaje = payload?.mensaje ? trimValue(payload.mensaje) : null;
  const icono = payload?.icono ? trimValue(payload.icono).slice(0, 40) : null;
  const link = payload?.link ? trimValue(payload.link).slice(0, 255) : null;
  return addLocalNotificacion(usuarioId, { ...payload, tipo, titulo, mensaje, icono, link });
}

async function listNotificacionesByUser(usuarioId, { soloNoLeidas = false, tipo = "" } = {}) {
  return listLocalNotificacionesByUser(usuarioId, { soloNoLeidas, tipo });
}

async function countUnreadNotificaciones(usuarioId) {
  return countLocalUnreadNotificaciones(usuarioId);
}

async function markNotificacionLeida(usuarioId, id) {
  await markLocalNotificacionLeida(usuarioId, id);
}

async function markAllNotificacionesLeidas(usuarioId) {
  return markAllLocalNotificacionesLeidas(usuarioId);
}

function productImageRowToApi(row) {
  return normalizeProductImages([
    {
      original_webp_url: row?.original_webp_url,
      thumb_webp_url: row?.thumb_webp_url,
      original_image_url: row?.original_webp_url,
      filtered_image_url: row?.thumb_webp_url || row?.original_webp_url,
      mime: row?.mime,
      width: row?.width,
      height: row?.height,
      status: "completed"
    }
  ])[0] || null;
}

async function readProductImagesMap(connection, productIds) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map((id) => toInt(id, 0)).filter((id) => id > 0))];
  const map = new Map();
  if (!ids.length) return map;
  await ensureProductImagesTable(connection);
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT producto_id, orden, es_portada, original_webp_url, thumb_webp_url, mime, width, height
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, es_portada DESC, orden ASC, id ASC`,
    ids
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = toInt(row?.producto_id, 0);
    const image = productImageRowToApi(row);
    if (!productId || !image) continue;
    const list = map.get(productId) || [];
    list.push(image);
    map.set(productId, list.slice(0, 3));
  }
  return map;
}

async function readProductCoverImagesMap(connection, productIds) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map((id) => toInt(id, 0)).filter((id) => id > 0))];
  const map = new Map();
  if (!ids.length) return map;
  await ensureProductImagesTable(connection);
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT producto_id, orden, es_portada, thumb_webp_url, mime, width, height
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, es_portada DESC, orden ASC, id ASC`,
    ids
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = toInt(row?.producto_id, 0);
    if (!productId || map.has(productId)) continue;
    const thumb = trimValue(row?.thumb_webp_url || "");
    if (!thumb) continue;
    map.set(productId, [
      {
        original_image_url: "",
        filtered_image_url: thumb,
        original_webp_url: "",
        thumb_webp_url: thumb,
        mime: row?.mime || "image/webp",
        width: toInt(row?.width, 0),
        height: toInt(row?.height, 0),
        status: "completed",
        error: ""
      }
    ]);
  }
  return map;
}

async function replaceProductImages(connection, productIdInput, imagesInput) {
  const productId = parsePositiveInt(productIdInput, "producto");
  const images = normalizeProductImages(imagesInput).slice(0, 4);
  await ensureProductImagesTable(connection);
  await connection.query("DELETE FROM producto_imagenes WHERE producto_id = ?", [productId]);
  for (const [index, image] of images.entries()) {
    const original = image.original_webp_url || image.filtered_image_url || image.original_image_url || null;
    const thumb = image.thumb_webp_url || image.filtered_image_url || image.original_webp_url || image.original_image_url || null;
    const hash = computeImageHash(thumb || original || "");
    await connection.query(
      `INSERT INTO producto_imagenes
        (producto_id, orden, es_portada, original_webp_url, thumb_webp_url, hash_image, mime, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        index,
        index === 0 ? 1 : 0,
        original,
        thumb,
        hash || null,
        image.mime || "image/webp",
        toInt(image.width, 0),
        toInt(image.height, 0)
      ]
    );
  }
  return images;
}

async function ensureProductDescriptionColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN descripcion VARCHAR(255) NULL AFTER nombre"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function ensureProductCategoryColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE productos ADD COLUMN categoria VARCHAR(80) NOT NULL DEFAULT 'OTRO' AFTER descripcion"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function ensureProductPurchasePriceHistoryTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS productos_precio_historial (
      id_historial INT NOT NULL AUTO_INCREMENT,
      fecha_hora DATETIME NOT NULL,
      producto_id INT NOT NULL,
      nombre_snapshot VARCHAR(180) NOT NULL,
      precio_compra DECIMAL(12,2) UNSIGNED NOT NULL,
      nota VARCHAR(255) NULL,
      origen VARCHAR(40) NULL,
      PRIMARY KEY (id_historial),
      KEY idx_precio_historial_producto (producto_id),
      KEY idx_precio_historial_fecha (fecha_hora)
    ) ENGINE=InnoDB
  `);
}

async function appendPurchasePriceHistory(connection, payload) {
  const productId = parsePositiveInt(payload.productId ?? payload["N°"], "producto");
  const productName = truncateText(payload.productName ?? payload.NOMBRE ?? payload.nombre, 180);
  const purchasePrice = parseNonNegativeNumber(payload.purchasePrice ?? payload.PRECIO_COMPRA, "PRECIO_COMPRA");
  if (!productName) throw createHttpError(400, "Nombre inválido para historial de precio de compra.");

  const createdAt = payload.fechaHora || nowIso();
  const note = truncateText(payload.note ?? payload.nota ?? "", 255);
  const source = truncateText(payload.source ?? payload.origen ?? "PRODUCTO_EDICION", 40);

  try {
    const [result] = await connection.query(
      `INSERT INTO productos_precio_historial
         (fecha_hora, producto_id, nombre_snapshot, precio_compra, nota, origen)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [createdAt, productId, productName, purchasePrice, note || null, source || null]
    );
    return {
      ID_HISTORIAL: toInt(result?.insertId, 0),
      FECHA_HORA: createdAt,
      "N°": productId,
      NOMBRE: productName,
      PRECIO_COMPRA: purchasePrice,
      NOTA: note,
      ORIGEN: source
    };
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
    await ensureProductPurchasePriceHistoryTable(connection);
    return appendPurchasePriceHistory(connection, payload);
  }
}

async function ensureSalesPaymentDetailColumn(connection) {
  try {
    await connection.query(
      "ALTER TABLE ventas_diarias ADD COLUMN tipo_pago_detalle VARCHAR(255) NULL AFTER tipo_pago"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function insertKardexMovement(connection, payload) {
  const productId = parsePositiveInt(payload.productId ?? payload["N°"], "producto");
  const name = truncateText(payload.nombre ?? payload.nombre_snapshot ?? payload.NOMBRE, 180);
  if (!name) {
    throw createHttpError(400, "El nombre del producto es obligatorio para el kardex.");
  }

  const type = normalizeKardexType(payload.tipo);
  if (!type) throw createHttpError(400, "TIPO kardex invalido. Usa INGRESO o SALIDA.");

  const quantity = parseNonNegativeNumber(payload.cantidad, "cantidad");
  if (quantity <= 0) throw createHttpError(400, "La cantidad del kardex debe ser mayor a 0.");

  const stockBefore = parseNonNegativeNumber(payload.stockAntes, "STOCK_ANTES");
  const stockAfter = parseNonNegativeNumber(payload.stockDespues, "STOCK_DESPUES");
  const reference = truncateText(payload.referencia || "", 80);
  const note = truncateText(payload.nota || "", 255);
  const fechaHora = normalizeSaleDateTimeInput(payload.fechaHora) || toLimaMysqlDateTime(payload.fechaHora || new Date());
  const saleIdRaw = payload.ventaId ?? payload.venta_id ?? payload.ID_VENTA;
  const saleId =
    saleIdRaw === undefined || saleIdRaw === null || trimValue(saleIdRaw) === ""
      ? null
      : parsePositiveInt(saleIdRaw, "venta_id");

  try {
    const [result] = await connection.query(
      `INSERT INTO kardex_movimientos
       (fecha_hora, producto_id, nombre_snapshot, tipo, cantidad, stock_antes, stock_despues, referencia, venta_id, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fechaHora, productId, name, type, quantity, stockBefore, stockAfter, reference || null, saleId, note || null]
    );

    return {
      ID_MOV: toInt(result?.insertId, 0),
      FECHA_HORA: fechaHora,
      ID_VENTA: saleId || 0,
      "N°": productId,
      NOMBRE: name,
      TIPO: type,
      CANTIDAD: quantity,
      STOCK_ANTES: stockBefore,
      STOCK_DESPUES: stockAfter,
      REFERENCIA: reference,
      NOTA: note
    };
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
    await ensureKardexTable(connection);
    return insertKardexMovement(connection, payload);
  }
}

async function readProductsAll(options = {}) {
  const includeImages = options.includeImages !== false;
  try {
    const remote = await readFirebaseCollection("products");
    if (Array.isArray(remote)) return remote.map(firebaseProductToApi);
  } catch (error) {
    await appendLog("WARN", "Fallback local de productos", {
      operation: "readProductsAll",
      message: buildDbErrorMessage(error)
    });
  }
  if (!includeImages && !(await isMysqlOnlyModeEnabled())) {
    const rows = await readLocalProductsLightCached();
    return rows.map(csvProductToApi);
  }
  return withDataSourceFallback(
    "readProductsAll",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductMinimumStockColumn(connection);
        await ensureProductPurchasePriceColumn(connection);
        await ensureProductImagesColumn(connection);
        await ensureProductImagesTable(connection);
        await ensureProductDescriptionColumn(connection);
        await ensureProductCategoryColumn(connection);
        await ensureProductVariantsColumn(connection);
        const [rows] = await connection.query(
          includeImages
            ? "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, variantes_json, pedido, stock_minimo, stock_actual, estado FROM productos ORDER BY id ASC"
            : "SELECT id, nombre, descripcion, categoria, precio, precio_compra, variantes_json, pedido, stock_minimo, stock_actual, estado FROM productos ORDER BY id ASC"
        );
        const safeRows = Array.isArray(rows) ? rows : [];
        const imagesMap = includeImages ? await readProductImagesMap(connection, safeRows.map((row) => row.id)) : new Map();
        return safeRows.map((row) => {
          const tableImages = imagesMap.get(toInt(row.id, 0)) || [];
          return buildProductApiShape({
            ...row,
            IMAGENES: tableImages.length ? tableImages : undefined,
            VARIANTES: normalizeProductVariants(row.variantes_json),
            imagenes_json: includeImages ? (tableImages.length ? JSON.stringify(tableImages) : row.imagenes_json) : undefined
          });
        });
      }),
    async () => {
      const rows = includeImages ? await readLocalProductsCached() : await readLocalProductsLightCached();
      return rows.map(csvProductToApi);
    }
  );
}

async function readProductsPage(query) {
  try {
    const remote = await readFirebaseCollection("products");
    if (Array.isArray(remote)) {
      const items = remote.map(firebaseProductToApi);
      const term = normalizeText(query.get("q"));
      const pedidoFilter = normalizeText(query.get("pedido") || "todos");
      const statusFilter = normalizeText(query.get("estado") || "todos");
      const filtered = items.filter((item) => {
        const matchesTerm =
          !term ||
          normalizeText(item.NOMBRE).includes(term) ||
          normalizeText(item.DESCRIPCION).includes(term) ||
          normalizeText(item.CATEGORIA).includes(term) ||
          String(item["N°"]).includes(term) ||
          String(item.PRECIO).includes(term) ||
          String(item.PRECIO_COMPRA ?? 0).includes(term) ||
          String(item.STOCK_MAXIMO ?? item.PEDIDO).includes(term) ||
          String(item.STOCK_MINIMO).includes(term) ||
          String(item.STOCK_ACTUAL).includes(term) ||
          normalizeText(item.ALERTA_STOCK).includes(term) ||
          normalizeText(item.ESTADO).includes(term);
        const pedido = toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0);
        const matchesPedido =
          pedidoFilter === "todos" ||
          (pedidoFilter === "con-pedido" && pedido > 0) ||
          (pedidoFilter === "sin-pedido" && pedido <= 0);
        const status = normalizeText(item.ESTADO || "ACTIVO");
        const matchesStatus =
          statusFilter === "todos" ||
          (statusFilter === "activo" && status === "activo") ||
          (statusFilter === "inactivo" && status === "inactivo");
        return matchesTerm && matchesPedido && matchesStatus;
      });
      const sorted = sortItems(filtered, {
        sortBy: trimValue(query.get("sortBy") || ""),
        sortDir: query.get("sortDir"),
        defaultSortBy: "N°",
        defaultSortDir: "asc",
        allowed: {
          "N°": (item) => item["N°"],
          NOMBRE: (item) => trimValue(item.NOMBRE || ""),
          DESCRIPCION: (item) => trimValue(item.DESCRIPCION || ""),
          IMAGENES: (item) => (Array.isArray(item.IMAGENES) && item.IMAGENES.length ? 1 : 0),
          CATEGORIA: (item) => trimValue(item.CATEGORIA || ""),
          PRECIO: (item) => toNumber(item.PRECIO, 0),
          PRECIO_COMPRA: (item) => toNumber(item.PRECIO_COMPRA, 0),
          STOCK_MAXIMO: (item) => toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0),
          PEDIDO: (item) => toNumber(item.PEDIDO, 0),
          STOCK_MINIMO: (item) => toNumber(item.STOCK_MINIMO, 0),
          STOCK_ACTUAL: (item) => toNumber(item.STOCK_ACTUAL, 0),
          ALERTA_STOCK: (item) => trimValue(item.ALERTA_STOCK || ""),
          ESTADO: (item) => trimValue(item.ESTADO || "ACTIVO")
        }
      });
      return paginate(sorted, {
        page: query.get("page"),
        pageSize: query.get("pageSize")
      });
    }
  } catch (error) {
    await appendLog("WARN", "Fallback local de productos paginados", {
      operation: "readProductsPage",
      message: buildDbErrorMessage(error)
    });
  }
  if (!(await isMysqlOnlyModeEnabled())) {
    const rows = await readLocalProductsLightCached();
    const term = normalizeText(query.get("q"));
    const pedidoFilter = normalizeText(query.get("pedido") || "todos");
    const statusFilter = normalizeText(query.get("estado") || "todos");
    const filtered = rows.filter((item) => {
      const matchesTerm =
        !term ||
        normalizeText(item.NOMBRE).includes(term) ||
        normalizeText(item.DESCRIPCION).includes(term) ||
        normalizeText(item.CATEGORIA).includes(term) ||
        String(resolveProductIdValue(item)).includes(term) ||
        String(item.PRECIO).includes(term) ||
        String(item.PRECIO_COMPRA ?? 0).includes(term) ||
        String(item.STOCK_MAXIMO ?? item.PEDIDO).includes(term) ||
        String(item.PEDIDO_SUGERIDO ?? 0).includes(term) ||
        String(item.STOCK_MINIMO).includes(term) ||
        String(item.STOCK_ACTUAL).includes(term) ||
        normalizeText(item.ALERTA_STOCK).includes(term) ||
        normalizeText(item.ESTADO).includes(term);
      const pedido = toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0);
      const matchesPedido =
        pedidoFilter === "todos" ||
        (pedidoFilter === "con-pedido" && pedido > 0) ||
        (pedidoFilter === "sin-pedido" && pedido <= 0);
      const status = normalizeText(item.ESTADO || "ACTIVO");
      const matchesStatus =
        statusFilter === "todos" ||
        (statusFilter === "activo" && status === "activo") ||
        (statusFilter === "inactivo" && status === "inactivo");
      return matchesTerm && matchesPedido && matchesStatus;
    });
    const sorted = sortItems(filtered, {
      sortBy: trimValue(query.get("sortBy") || ""),
      sortDir: query.get("sortDir"),
      defaultSortBy: "N°",
      defaultSortDir: "asc",
      allowed: {
        "N°": (item) => resolveProductIdValue(item),
        NOMBRE: (item) => trimValue(item.NOMBRE || ""),
        DESCRIPCION: (item) => trimValue(item.DESCRIPCION || ""),
        IMAGENES: (item) => (String(item.IMAGENES || "").trim() ? 1 : 0),
        CATEGORIA: (item) => trimValue(item.CATEGORIA || ""),
        PRECIO: (item) => toNumber(item.PRECIO, 0),
        PRECIO_COMPRA: (item) => toNumber(item.PRECIO_COMPRA, 0),
        STOCK_MAXIMO: (item) => toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0),
        PEDIDO: (item) => toNumber(item.PEDIDO, 0),
        PEDIDO_SUGERIDO: (item) => toNumber(item.PEDIDO_SUGERIDO, 0),
        STOCK_MINIMO: (item) => toNumber(item.STOCK_MINIMO, 0),
        STOCK_ACTUAL: (item) => toNumber(item.STOCK_ACTUAL, 0),
        ALERTA_STOCK: (item) => trimValue(item.ALERTA_STOCK || ""),
        ESTADO: (item) => trimValue(item.ESTADO || "ACTIVO")
      }
    });
    const pageData = paginate(sorted, {
      page: query.get("page"),
      pageSize: query.get("pageSize")
    });
    return {
      ...pageData,
      items: pageData.items.map(csvProductToApi)
    };
  }

  return withDataSourceFallback(
    "readProductsPage",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductMinimumStockColumn(connection);
        await ensureProductPurchasePriceColumn(connection);
        await ensureProductImagesColumn(connection);
        await ensureProductImagesTable(connection);
        await ensureProductDescriptionColumn(connection);
        await ensureProductCategoryColumn(connection);
        await ensureProductVariantsColumn(connection);

        const term = normalizeText(query.get("q"));
        const pedidoFilter = normalizeText(query.get("pedido") || "todos");
        const statusFilter = normalizeText(query.get("estado") || "todos");
        const whereParts = [];
        const params = [];

        if (term) {
          const like = `%${term}%`;
          whereParts.push(`(
            CAST(id AS CHAR) LIKE ?
            OR LOWER(nombre) LIKE ?
            OR LOWER(COALESCE(descripcion, '')) LIKE ?
            OR LOWER(COALESCE(categoria, '')) LIKE ?
            OR CAST(precio AS CHAR) LIKE ?
            OR CAST(COALESCE(precio_compra, 0) AS CHAR) LIKE ?
            OR CAST(COALESCE(pedido, 0) AS CHAR) LIKE ?
            OR CAST(COALESCE(stock_minimo, 0) AS CHAR) LIKE ?
            OR CAST(COALESCE(stock_actual, 0) AS CHAR) LIKE ?
            OR LOWER(COALESCE(estado, 'ACTIVO')) LIKE ?
            OR CASE
              WHEN COALESCE(stock_minimo, 0) > 0 AND COALESCE(stock_actual, 0) < COALESCE(stock_minimo, 0) THEN 'bajo'
              ELSE 'ok'
            END LIKE ?
          )`);
          params.push(like, like, like, like, like, like, like, like, like, like, like);
        }

        if (pedidoFilter === "con-pedido") {
          whereParts.push("COALESCE(pedido, 0) > 0");
        } else if (pedidoFilter === "sin-pedido") {
          whereParts.push("COALESCE(pedido, 0) <= 0");
        }

        if (statusFilter === "activo") {
          whereParts.push("LOWER(COALESCE(estado, 'ACTIVO')) = 'activo'");
        } else if (statusFilter === "inactivo") {
          whereParts.push("LOWER(COALESCE(estado, 'ACTIVO')) = 'inactivo'");
        }

        const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
        const sortColumns = {
          "N°": "id",
          NOMBRE: "nombre",
          DESCRIPCION: "descripcion",
          CATEGORIA: "categoria",
          PRECIO: "precio",
          PRECIO_COMPRA: "precio_compra",
          STOCK_MAXIMO: "pedido",
          PEDIDO: "pedido",
          STOCK_MINIMO: "stock_minimo",
          STOCK_ACTUAL: "stock_actual",
          ALERTA_STOCK: `CASE
            WHEN COALESCE(stock_minimo, 0) > 0 AND COALESCE(stock_actual, 0) < COALESCE(stock_minimo, 0) THEN 0
            ELSE 1
          END`,
          ESTADO: "estado",
          IMAGENES: "(SELECT COUNT(*) FROM producto_imagenes pi WHERE pi.producto_id = productos.id)"
        };
        const sortKey = trimValue(query.get("sortBy") || "N°");
        const sortColumn = sortColumns[sortKey] || sortColumns["N°"];
        const sortDir = normalizeSortDir(query.get("sortDir"), "asc").toUpperCase();
        const pageSize = normalizePageSize(query.get("pageSize"), 20);
        const requestedPage = normalizePage(query.get("page"), 1);

        const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM productos ${whereSql}`, params);
        const totalItems = toInt(countRows?.[0]?.total, 0);
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const page = Math.min(requestedPage, totalPages);
        const offset = (page - 1) * pageSize;

        const [rows] = await connection.query(
          `SELECT id, nombre, descripcion, categoria, precio, precio_compra, variantes_json, pedido, stock_minimo, stock_actual, estado
           FROM productos
           ${whereSql}
           ORDER BY ${sortColumn} ${sortDir}, id ASC
           LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
        const safeRows = Array.isArray(rows) ? rows : [];
        const imagesMap = await readProductCoverImagesMap(connection, safeRows.map((row) => row.id));
        const items = safeRows.map((row) => {
          const tableImages = imagesMap.get(toInt(row.id, 0)) || [];
          return buildProductApiShape({
            ...row,
            IMAGENES: tableImages.length ? tableImages : undefined,
            VARIANTES: normalizeProductVariants(row.variantes_json),
            imagenes_json: tableImages.length ? JSON.stringify(tableImages) : undefined
          });
        });

        return {
          items,
          pagination: {
            page,
            pageSize,
            totalItems,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages
          }
        };
      }),
    async () => {
      const rows = await readLocalProductsLightCached();
      const term = normalizeText(query.get("q"));
      const pedidoFilter = normalizeText(query.get("pedido") || "todos");
      const statusFilter = normalizeText(query.get("estado") || "todos");
      const filtered = rows.filter((item) => {
        const matchesTerm =
          !term ||
          normalizeText(item.NOMBRE).includes(term) ||
          normalizeText(item.DESCRIPCION).includes(term) ||
          normalizeText(item.CATEGORIA).includes(term) ||
          String(resolveProductIdValue(item)).includes(term) ||
          String(item.PRECIO).includes(term) ||
          String(item.PRECIO_COMPRA ?? 0).includes(term) ||
          String(item.STOCK_MAXIMO ?? item.PEDIDO).includes(term) ||
          String(item.PEDIDO_SUGERIDO ?? 0).includes(term) ||
          String(item.STOCK_MINIMO).includes(term) ||
          String(item.STOCK_ACTUAL).includes(term) ||
          normalizeText(item.ALERTA_STOCK).includes(term) ||
          normalizeText(item.ESTADO).includes(term);
        const pedido = toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0);
        const matchesPedido =
          pedidoFilter === "todos" ||
          (pedidoFilter === "con-pedido" && pedido > 0) ||
          (pedidoFilter === "sin-pedido" && pedido <= 0);
        const status = normalizeText(item.ESTADO || "ACTIVO");
        const matchesStatus =
          statusFilter === "todos" ||
          (statusFilter === "activo" && status === "activo") ||
          (statusFilter === "inactivo" && status === "inactivo");
        return matchesTerm && matchesPedido && matchesStatus;
      });
      const sorted = sortItems(filtered, {
        sortBy: trimValue(query.get("sortBy") || ""),
        sortDir: query.get("sortDir"),
        defaultSortBy: "N°",
        defaultSortDir: "asc",
        allowed: {
          "N°": (item) => resolveProductIdValue(item),
          NOMBRE: (item) => trimValue(item.NOMBRE || ""),
          DESCRIPCION: (item) => trimValue(item.DESCRIPCION || ""),
          IMAGENES: (item) => (Array.isArray(item.IMAGENES) && item.IMAGENES.length ? 1 : 0),
          CATEGORIA: (item) => trimValue(item.CATEGORIA || ""),
          PRECIO: (item) => toNumber(item.PRECIO, 0),
          PRECIO_COMPRA: (item) => toNumber(item.PRECIO_COMPRA, 0),
          STOCK_MAXIMO: (item) => toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0),
          PEDIDO: (item) => toNumber(item.PEDIDO, 0),
          PEDIDO_SUGERIDO: (item) => toNumber(item.PEDIDO_SUGERIDO, 0),
          STOCK_MINIMO: (item) => toNumber(item.STOCK_MINIMO, 0),
          STOCK_ACTUAL: (item) => toNumber(item.STOCK_ACTUAL, 0),
          ALERTA_STOCK: (item) => trimValue(item.ALERTA_STOCK || ""),
          ESTADO: (item) => trimValue(item.ESTADO || "ACTIVO")
        }
      });
      const pageData = paginate(sorted, {
        page: query.get("page"),
        pageSize: query.get("pageSize")
      });
      return {
        ...pageData,
        items: pageData.items.map(csvProductToApi)
      };
    }
  );
}

async function readProductById(idInput) {
  const id = parsePositiveInt(idInput, "N°");
  try {
    const remote = await readFirebaseCollection("products");
    if (Array.isArray(remote)) {
      const item = remote.map(firebaseProductToApi).find((row) => resolveProductIdValue(row) === id);
      if (item) return item;
    }
  } catch (error) {
    await appendLog("WARN", "Fallback local de producto por id", {
      operation: "readProductById",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "readProductById",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductMinimumStockColumn(connection);
        await ensureProductPurchasePriceColumn(connection);
        await ensureProductImagesColumn(connection);
        await ensureProductImagesTable(connection);
        await ensureProductDescriptionColumn(connection);
        await ensureProductCategoryColumn(connection);
        await ensureProductVariantsColumn(connection);
        const [rows] = await connection.query(
          "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, variantes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? LIMIT 1",
          [id]
        );
        const row = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!row) throw createHttpError(404, `No existe producto con N° ${id}.`);
        const imagesMap = await readProductImagesMap(connection, [id]);
        const tableImages = imagesMap.get(id) || [];
        return buildProductApiShape({
          ...row,
          IMAGENES: tableImages.length ? tableImages : undefined,
          VARIANTES: normalizeProductVariants(row.variantes_json),
          imagenes_json: tableImages.length ? JSON.stringify(tableImages) : row.imagenes_json
        });
      }),
    async () => {
      const items = await readProductsAll({ includeImages: false });
      const item = items.find((row) => resolveProductIdValue(row) === id);
      if (!item) throw createHttpError(404, `No existe producto con N° ${id}.`);
      return item;
    }
  );
}

async function readSalesAll() {
  try {
    const remote = await readFirebaseCollection("sales");
    if (Array.isArray(remote)) return remote.map(csvSaleToApi);
  } catch (error) {
    await appendLog("WARN", "Fallback local de ventas", {
      operation: "readSalesAll",
      message: buildDbErrorMessage(error)
    });
  }
  if (!(await isMysqlOnlyModeEnabled())) {
    const rows = await csvDb.readSales();
    return rows.map(csvSaleToApi);
  }
  return withDataSourceFallback(
    "readSalesAll",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureSalesPaymentDetailColumn(connection);
        const [rows] = await connection.query(
          `SELECT
             v.id_venta,
             v.fecha_venta,
             v.fecha_operativa,
             km.fecha_referencia,
             v.producto_id,
             v.nombre_snapshot,
             v.cantidad,
             v.precio,
             v.total,
             v.tipo_pago,
             v.tipo_pago_detalle,
             v.origen,
             v.estado,
             v.anulada_at,
             v.anulada_motivo
           FROM ventas_diarias v
           LEFT JOIN (
             SELECT venta_id, MIN(fecha_hora) AS fecha_referencia
             FROM kardex_movimientos
             WHERE venta_id IS NOT NULL
             GROUP BY venta_id
           ) km ON km.venta_id = v.id_venta
           ORDER BY v.fecha_venta DESC, v.id_venta DESC`
        );
        return (Array.isArray(rows) ? rows : []).map(saleRowToApi);
      }),
    async () => {
      const rows = await csvDb.readSales();
      return rows.map(csvSaleToApi);
    }
  );
}

async function findFirebaseProductByLegacyId(productId) {
  const db = getFirebaseDb();
  if (!db) return null;
  const legacy = String(productId);
  const snap = await db.collection(firebaseCollectionName("products"))
    .where("legacyId", "==", legacy)
    .limit(1)
    .get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    return { ref: doc.ref, data: { id: doc.id, ...doc.data() } };
  }
  const numericSnap = await db.collection(firebaseCollectionName("products"))
    .where("numero", "==", toInt(productId, 0))
    .limit(1)
    .get();
  if (!numericSnap.empty) {
    const doc = numericSnap.docs[0];
    return { ref: doc.ref, data: { id: doc.id, ...doc.data() } };
  }
  return null;
}

async function nextFirebaseSaleId(transaction, db) {
  const ref = db.collection(firebaseCollectionName("settings")).doc("counters");
  const snap = await transaction.get(ref);
  const current = snap.exists ? toInt(snap.data()?.salesNext, 0) : 0;
  const next = current + 1;
  transaction.set(ref, { salesNext: next, updatedAt: nowIso() }, { merge: true });
  return next;
}

async function nextFirebaseKardexId(transaction, db) {
  const ref = db.collection(firebaseCollectionName("settings")).doc("counters");
  const snap = await transaction.get(ref);
  const current = snap.exists ? toInt(snap.data()?.kardexNext, 0) : 0;
  const next = current + 1;
  transaction.set(ref, { kardexNext: next, updatedAt: nowIso() }, { merge: true });
  return next;
}

async function nextFirebaseSaleAndKardexIds(transaction, db) {
  const ref = db.collection(firebaseCollectionName("settings")).doc("counters");
  const snap = await transaction.get(ref);
  const data = snap.exists ? snap.data() : {};
  const saleNumber = toInt(data?.salesNext, 0) + 1;
  const movementNumber = toInt(data?.kardexNext, 0) + 1;
  transaction.set(ref, { salesNext: saleNumber, kardexNext: movementNumber, updatedAt: nowIso() }, { merge: true });
  return { saleNumber, movementNumber };
}

async function nextFirebaseSaleAndKardexIdsBlock(transaction, db, movementCount = 1) {
  const ref = db.collection(firebaseCollectionName("settings")).doc("counters");
  const snap = await transaction.get(ref);
  const data = snap.exists ? snap.data() : {};
  const saleNumber = toInt(data?.salesNext, 0) + 1;
  const firstMovementNumber = toInt(data?.kardexNext, 0) + 1;
  transaction.set(ref, {
    salesNext: saleNumber,
    kardexNext: firstMovementNumber + Math.max(1, toInt(movementCount, 1)) - 1,
    updatedAt: nowIso()
  }, { merge: true });
  return { saleNumber, firstMovementNumber };
}

async function registerSaleFirebase(payload) {
  const db = getFirebaseDb();
  if (!db) return null;
  const productId = parsePositiveInt(resolveIncomingProductId(payload), "producto");
  const variantId = trimValue(payload.variantId ?? payload.variant_id ?? "");
  const quantity = parseNonNegativeNumber(payload.cantidad ?? payload.CANTIDAD, "cantidad");
  if (quantity <= 0) throw createHttpError(400, "La cantidad de venta debe ser mayor a 0.");
  const requestedPresentationId = payload.presentacionCigarro ?? payload.cigarettePresentation ?? payload.PRESENTACION_CIGARRO ?? "";
  const fechaVenta =
    normalizeSaleDateTimeInput(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA) ||
    defaultSaleDateTime();
  assertSaleDateIsNotFuture(fechaVenta);
  const paymentSplit = normalizePaymentSplitRows(payload.paymentSplit);
  const tipoPago = paymentSplit[0]?.tipoPago || normalizePaymentType(payload.tipoPago || payload.TIPO_PAGO || "Efectivo");
  const tipoPagoDetalle = trimValue(
    payload.tipoPagoDetalle || payload.TIPO_PAGO_DETALLE || buildPaymentSummaryText(paymentSplit, tipoPago)
  );
  const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN);
  const movementReference = trimValue(payload.referencia ?? payload.REFERENCIA ?? origin) || "VENTA";
  const movementNote = trimValue(payload.nota ?? payload.NOTA ?? "");

  return db.runTransaction(async (transaction) => {
    const productEntry = await findFirebaseProductByLegacyId(productId);
    if (!productEntry) throw createHttpError(404, `No existe producto N° ${productId}.`);
    const productSnap = await transaction.get(productEntry.ref);
    const product = productSnap.data() || productEntry.data;
    const cigarettePresentation = resolveCigarettePresentation(product, requestedPresentationId);
    const reportQuantity = cigarettePresentation ? round2(quantity * cigaretteAccountingUnits(cigarettePresentation)) : quantity;
    const originalStockBefore = round2(product.stockActual ?? product.STOCK_ACTUAL ?? 0);
    let stockBefore = originalStockBefore;
    let autoOpenPlan = null;
    if (cigarettePresentation?.id === "unit" && stockBefore < reportQuantity) {
      const stockLink = normalizeCigaretteStockLink(product.cigaretteStockLink);
      if (stockLink.enabled && parseCartProductId(stockLink.unitProductId) === productId) {
        const boxProductId = parseCartProductId(stockLink.box20ProductId);
        const boxEntry = await findFirebaseProductByLegacyId(boxProductId);
        if (!boxEntry) throw createHttpError(404, `No existe la caja x20 enlazada N° ${boxProductId}.`);
        const boxSnap = await transaction.get(boxEntry.ref);
        const boxProduct = boxSnap.data() || boxEntry.data;
        const unitsPerBox = 20;
        const unitsNeeded = round2(reportQuantity - stockBefore);
        const boxesToOpen = Math.ceil(unitsNeeded / unitsPerBox);
        const boxStockBefore = round2(boxProduct.stockActual ?? boxProduct.STOCK_ACTUAL ?? 0);
        if (boxStockBefore < boxesToOpen) {
          throw createHttpError(
            409,
            `Stock insuficiente para ${product.nombre || product.NOMBRE || productId}. Caja x20 enlazada disponible: ${boxStockBefore}, requerida: ${boxesToOpen}.`
          );
        }
        const openedUnits = boxesToOpen * unitsPerBox;
        autoOpenPlan = {
          boxEntry,
          boxProduct,
          boxProductId,
          boxName: boxProduct.nombre || boxProduct.NOMBRE || `Producto ${boxProductId}`,
          boxesToOpen,
          boxStockBefore,
          boxStockAfter: round2(boxStockBefore - boxesToOpen),
          unitsPerBox,
          openedUnits,
          unitStockBefore: stockBefore,
          unitStockAfterOpen: round2(stockBefore + openedUnits)
        };
        stockBefore = autoOpenPlan.unitStockAfterOpen;
      }
    }
    if (stockBefore < reportQuantity) throw createHttpError(409, `Stock insuficiente para ${product.nombre || product.NOMBRE || productId}.`);
    const variantPlan = applyVariantStockSale(product, variantId, reportQuantity);
    const basePrice = round2(product.precio ?? product.PRECIO ?? 0);
    const total = cigarettePresentation
      ? round2(round2(cigarettePresentation.price || basePrice) * quantity)
      : round2(basePrice * quantity);
    const price = reportQuantity > 0 ? round2(total / reportQuantity) : basePrice;
    const movementCount = autoOpenPlan ? 3 : 1;
    const { saleNumber, firstMovementNumber } = await nextFirebaseSaleAndKardexIdsBlock(transaction, db, movementCount);
    let movementNumber = firstMovementNumber;
    const saleApi = csvSaleToApi({
      ID_VENTA: saleNumber,
      FECHA_VENTA: fechaVenta,
      FECHA_OPERATIVA: fechaVenta,
      "N°": productId,
      NOMBRE: product.nombre || product.NOMBRE || "",
      CANTIDAD: reportQuantity,
      PRECIO: price,
      TOTAL: total,
      TIPO_PAGO: tipoPago,
      TIPO_PAGO_DETALLE: tipoPagoDetalle,
      ORIGEN: origin,
      ESTADO: "ACTIVA"
    });
    if (variantPlan) {
      saleApi.ID_VARIANTE = variantPlan.variantId;
      saleApi.VARIANTE = variantPlan.variantName;
    }
    const saleDoc = {
      ...saleApi,
      id: `venta-${saleNumber}`,
      legacyId: String(saleNumber),
      productLegacyId: String(productId),
      productDocId: productEntry.ref.id,
      variantId: variantPlan?.variantId || "",
      variantName: variantPlan?.variantName || "",
      createdAt: nowIso(),
      migratedAt: ""
    };
    if (cigarettePresentation) {
      saleDoc.PRESENTACION_CIGARRO = cigarettePresentation.label;
      saleDoc.PRESENTACION_UNIDADES = cigarettePresentation.units;
      saleDoc.PRESENTACION_UNIDADES_REPORTE = cigaretteAccountingUnits(cigarettePresentation);
      saleDoc.CANTIDAD_PRESENTACION = quantity;
    }
    const movementDocs = [];
    const movementApis = [];
    if (autoOpenPlan) {
      const boxMovementApi = csvKardexToApi({
        ID_MOV: movementNumber,
        FECHA_HORA: saleLocalDateTimeToStoredUtc(fechaVenta),
        ID_VENTA: saleNumber,
        "N°": autoOpenPlan.boxProductId,
        NOMBRE: autoOpenPlan.boxName,
        TIPO: "SALIDA",
        CANTIDAD: autoOpenPlan.boxesToOpen,
        STOCK_ANTES: autoOpenPlan.boxStockBefore,
        STOCK_DESPUES: autoOpenPlan.boxStockAfter,
        REFERENCIA: "APERTURA_CAJA_X20",
        NOTA: `Apertura automatica para ${product.nombre || product.NOMBRE || productId} | ${movementReference}`
      });
      movementDocs.push({
        ...boxMovementApi,
        id: `kardex-${movementNumber}`,
        legacyId: String(movementNumber),
        productLegacyId: String(autoOpenPlan.boxProductId),
        productDocId: autoOpenPlan.boxEntry.ref.id,
        saleLegacyId: String(saleNumber),
        saleDocId: `venta-${saleNumber}`,
        createdAt: nowIso(),
        migratedAt: ""
      });
      movementApis.push(boxMovementApi);
      movementNumber += 1;

      const unitIngressApi = csvKardexToApi({
        ID_MOV: movementNumber,
        FECHA_HORA: saleLocalDateTimeToStoredUtc(fechaVenta),
        ID_VENTA: saleNumber,
        "N°": productId,
        NOMBRE: product.nombre || product.NOMBRE || "",
        TIPO: "INGRESO",
        CANTIDAD: autoOpenPlan.openedUnits,
        STOCK_ANTES: autoOpenPlan.unitStockBefore,
        STOCK_DESPUES: autoOpenPlan.unitStockAfterOpen,
        REFERENCIA: "APERTURA_CAJA_X20",
        NOTA: `Ingreso automatico desde ${autoOpenPlan.boxName} | ${movementReference}`
      });
      movementDocs.push({
        ...unitIngressApi,
        id: `kardex-${movementNumber}`,
        legacyId: String(movementNumber),
        productLegacyId: String(productId),
        productDocId: productEntry.ref.id,
        saleLegacyId: String(saleNumber),
        saleDocId: `venta-${saleNumber}`,
        createdAt: nowIso(),
        migratedAt: ""
      });
      movementApis.push(unitIngressApi);
      movementNumber += 1;
    }

    const movementApi = csvKardexToApi({
      ID_MOV: movementNumber,
      FECHA_HORA: saleLocalDateTimeToStoredUtc(fechaVenta),
      ID_VENTA: saleNumber,
      "N°": productId,
      NOMBRE: product.nombre || product.NOMBRE || "",
      TIPO: "SALIDA",
      CANTIDAD: reportQuantity,
      STOCK_ANTES: stockBefore,
      STOCK_DESPUES: round2(stockBefore - reportQuantity),
      REFERENCIA: movementReference,
      NOTA: [
        variantPlan ? `Venta #${saleNumber} - ${variantPlan.variantName}` : `Venta #${saleNumber}`,
        movementNote
      ].filter(Boolean).join(" | ")
    });
    const movementDoc = {
      ...movementApi,
      id: `kardex-${movementNumber}`,
      legacyId: String(movementNumber),
      productLegacyId: String(productId),
      productDocId: productEntry.ref.id,
      saleLegacyId: String(saleNumber),
      saleDocId: saleDoc.id,
      variantId: variantPlan?.variantId || "",
      variantName: variantPlan?.variantName || "",
      createdAt: nowIso(),
      migratedAt: ""
    };
    movementDocs.push(movementDoc);
    movementApis.push(movementApi);
    const productPatch = {
      stockActual: round2(stockBefore - reportQuantity),
      updatedAt: nowIso()
    };
    if (variantPlan) productPatch.variantes = variantPlan.variants;
    if (autoOpenPlan) {
      transaction.update(autoOpenPlan.boxEntry.ref, {
        stockActual: autoOpenPlan.boxStockAfter,
        updatedAt: nowIso()
      });
    }
    transaction.update(productEntry.ref, productPatch);
    transaction.set(db.collection(firebaseCollectionName("sales")).doc(saleDoc.id), cleanForFirestore(saleDoc), { merge: true });
    for (const doc of movementDocs) {
      transaction.set(db.collection(firebaseCollectionName("kardex")).doc(doc.id), cleanForFirestore(doc), { merge: true });
    }
    return {
      sale: saleApi,
      product: firebaseProductToApi({ ...product, stockActual: round2(stockBefore - reportQuantity) }),
      movement: movementApi,
      movements: movementApis
    };
  });
}

async function registerSaleBatchFirebase(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  if (!rawItems.length) throw createHttpError(400, "Debes enviar al menos un producto en items.");
  const sales = [];
  const movements = [];
  const productsUpdated = [];
  let total = 0;
  for (const item of rawItems) {
    const result = await registerSaleFirebase({
      ...item,
      fechaVenta: payload.fechaVenta ?? payload.fecha_venta ?? payload.FECHA_VENTA,
      tipoPago: payload.tipoPago,
      tipoPagoDetalle: payload.tipoPagoDetalle,
      paymentSplit: payload.paymentSplit,
      tipoVenta: payload.tipoVenta ?? payload.origen,
      referencia: payload.referencia,
      nota: payload.nota
    });
    sales.push(result.sale);
    if (Array.isArray(result.movements) && result.movements.length) {
      movements.push(...result.movements);
    } else {
      movements.push(result.movement);
    }
    productsUpdated.push(result.product);
    total = round2(total + result.sale.TOTAL);
  }
  return { sales, productsUpdated, movements, total };
}

async function readKardexAll() {
  const remote = await readFirebaseCollection("kardex");
  if (remote) {
    return remote.map((row) => csvKardexToApi({
      ...row,
      ID_MOV: row?.ID_MOV ?? row?.legacyId ?? row?.id_mov ?? row?.id,
      FECHA_HORA: row?.FECHA_HORA ?? row?.fecha_hora,
      ID_VENTA: row?.ID_VENTA ?? row?.venta_id ?? row?.saleLegacyId,
      "N°": row?.["N°"] ?? row?.productLegacyId ?? row?.producto_id,
      NOMBRE: row?.NOMBRE ?? row?.nombre_snapshot,
      TIPO: row?.TIPO ?? row?.tipo,
      CANTIDAD: row?.CANTIDAD ?? row?.cantidad,
      STOCK_ANTES: row?.STOCK_ANTES ?? row?.stock_antes,
      STOCK_DESPUES: row?.STOCK_DESPUES ?? row?.stock_despues,
      REFERENCIA: row?.REFERENCIA ?? row?.referencia,
      NOTA: row?.NOTA ?? row?.nota
    }));
  }
  if (!(await isMysqlOnlyModeEnabled())) {
    const rows = await csvDb.readKardex();
    return rows.map(csvKardexToApi);
  }
  return withDataSourceFallback(
    "readKardexAll",
    () =>
      withMysqlConnection(async (connection) => {
        try {
          const [rows] = await connection.query(
            `SELECT id_mov, fecha_hora, producto_id, nombre_snapshot, tipo, cantidad, stock_antes, stock_despues, referencia, venta_id, nota
             FROM kardex_movimientos
             ORDER BY fecha_hora DESC, id_mov DESC`
          );
          return (Array.isArray(rows) ? rows : []).map(kardexRowToApi);
        } catch (error) {
          if (error?.code === "ER_NO_SUCH_TABLE") return [];
          throw error;
        }
      }),
    async () => {
      const rows = await csvDb.readKardex();
      return rows.map(csvKardexToApi);
    }
  );
}

async function readProductMovementsHistory(productIdInput) {
  const productId = parsePositiveInt(productIdInput, "N°");
  const items = await readKardexAll();
  return items
    .filter((item) => toInt(item["N°"], 0) === productId)
    .sort((a, b) => trimValue(b.FECHA_HORA || "").localeCompare(trimValue(a.FECHA_HORA || "")));
}

async function readProductPurchasePriceHistory(productIdInput) {
  const productId = parsePositiveInt(productIdInput, "N°");
  return withDataSourceFallback(
    "readProductPurchasePriceHistory",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductPurchasePriceHistoryTable(connection);
        const [rows] = await connection.query(
          `SELECT id_historial, fecha_hora, producto_id, nombre_snapshot, precio_compra, nota, origen
           FROM productos_precio_historial
           WHERE producto_id = ?
           ORDER BY fecha_hora DESC, id_historial DESC`,
          [productId]
        );
        return (Array.isArray(rows) ? rows : []).map(purchasePriceHistoryRowToApi);
      }),
    async () => {
      const rows = await csvDb.readProductPurchasePriceHistory(productId);
      return rows.map(csvPurchasePriceHistoryToApi);
    }
  );
}

async function deleteKardexMovement(idInput) {
  const movementId = parsePositiveInt(idInput, "ID_MOV");
  const db = getFirebaseDb();
  if (db) {
    const collection = db.collection(firebaseCollectionName("kardex"));
    const direct = await collection.doc(`kardex-${movementId}`).get();
    let target = direct.exists ? direct : null;
    if (!target) {
      const snap = await collection
        .where("legacyId", "==", String(movementId))
        .limit(1)
        .get();
      target = snap.empty ? null : snap.docs[0];
    }
    if (!target) throw createHttpError(404, `No existe movimiento kardex #${movementId}.`);
    const data = { id: target.id, ...target.data() };
    await target.ref.delete();
    return csvKardexToApi({
      ...data,
      ID_MOV: data.ID_MOV ?? data.legacyId ?? data.id,
      FECHA_HORA: data.FECHA_HORA ?? data.fecha_hora,
      ID_VENTA: data.ID_VENTA ?? data.venta_id ?? data.saleLegacyId,
      "N°": data["N°"] ?? data.productLegacyId ?? data.producto_id,
      NOMBRE: data.NOMBRE ?? data.nombre_snapshot,
      TIPO: data.TIPO ?? data.tipo,
      CANTIDAD: data.CANTIDAD ?? data.cantidad,
      STOCK_ANTES: data.STOCK_ANTES ?? data.stock_antes,
      STOCK_DESPUES: data.STOCK_DESPUES ?? data.stock_despues,
      REFERENCIA: data.REFERENCIA ?? data.referencia,
      NOTA: data.NOTA ?? data.nota
    });
  }
  return withDataSourceFallback(
    "deleteKardexMovement",
    () =>
      withMysqlConnection(async (connection) => {
        try {
          const [rows] = await connection.query(
            `SELECT id_mov, fecha_hora, producto_id, nombre_snapshot, tipo, cantidad, stock_antes, stock_despues, referencia, venta_id, nota
             FROM kardex_movimientos
             WHERE id_mov = ?
             LIMIT 1`,
            [movementId]
          );
          const current = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (!current) throw createHttpError(404, `No existe movimiento kardex #${movementId}.`);

          await connection.query("DELETE FROM kardex_movimientos WHERE id_mov = ?", [movementId]);
          return kardexRowToApi(current);
        } catch (error) {
          if (error?.code === "ER_NO_SUCH_TABLE") {
            throw createHttpError(404, `No existe movimiento kardex #${movementId}.`);
          }
          throw error;
        }
      }),
    async () => csvKardexToApi(await csvDb.deleteKardexMovement(movementId))
  );
}

async function deleteAllKardexMovements() {
  const db = getFirebaseDb();
  if (db) {
    const collection = db.collection(firebaseCollectionName("kardex"));
    let deletedCount = 0;
    while (true) {
      const snap = await collection.limit(450).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref);
        deletedCount += 1;
      });
      await batch.commit();
    }
    return { deletedCount };
  }
  return withDataSourceFallback(
    "deleteAllKardexMovements",
    () =>
      withMysqlConnection(async (connection) => {
        try {
          const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM kardex_movimientos");
          const total = toInt(countRows?.[0]?.total, 0);
          await connection.query("DELETE FROM kardex_movimientos");

          try {
            await connection.query("ALTER TABLE kardex_movimientos AUTO_INCREMENT = 1");
          } catch {
            // Ignora error de reinicio de autoincrement en motores no compatibles.
          }

          return { deletedCount: total };
        } catch (error) {
          if (error?.code === "ER_NO_SUCH_TABLE") {
            return { deletedCount: 0 };
          }
          throw error;
        }
      }),
    async () => csvDb.deleteAllKardexMovements()
  );
}

async function getProductStats() {
  const products = await readProductsAll({ includeImages: false });
  const activeProducts = products.filter((item) => String(item?.ESTADO || "ACTIVO").toUpperCase() === "ACTIVO");
  return {
    total: products.length,
    conPedido: activeProducts.filter((item) => toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0) > 0).length,
    stockTotal: round2(activeProducts.reduce((acc, item) => acc + toNumber(item.STOCK_ACTUAL, 0), 0)),
    lowStockCount: activeProducts.filter((item) => String(item.ALERTA_STOCK || "").toUpperCase() !== "OK").length,
    outOfStockCount: activeProducts.filter((item) => toNumber(item.STOCK_ACTUAL, 0) <= 0).length
  };
}

async function getProductCategories() {
  return PRODUCT_CATEGORY_LABELS;
}

async function createProduct(payload) {
  try {
    const remote = await createProductFirebase(payload);
    if (remote) return remote;
  } catch (error) {
    if (error?.status) throw error;
    await appendLog("WARN", "Fallback local de crear producto", {
      operation: "createProduct",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "createProduct",
    () => withMysqlConnection(async (connection) => {
    await ensureProductMinimumStockColumn(connection);
    await ensureProductPurchasePriceColumn(connection);
    await ensureProductImagesColumn(connection);
    await ensureProductVariantsColumn(connection);
    await ensureProductImagesTable(connection);
    await ensureProductDescriptionColumn(connection);
    await ensureProductCategoryColumn(connection);
    await ensureProductPurchasePriceHistoryTable(connection);
    const hasCustomId = payload["N°"] !== undefined || payload.id !== undefined || payload.n !== undefined;
    const name = trimValue(payload.NOMBRE ?? payload.nombre);
    if (!name) throw createHttpError(400, "El campo NOMBRE es obligatorio.");
    const description = truncateText(payload.DESCRIPCION ?? payload.descripcion ?? payload.descripcion_larga ?? "", 255);
    const category = normalizeProductCategoryValue(payload.CATEGORIA ?? payload.categoria ?? "OTRO");

    const price = parseNonNegativeNumber(payload.PRECIO ?? payload.precio, "PRECIO");
    const purchasePrice = parseNonNegativeNumber(
      payload.PRECIO_COMPRA ?? payload.precio_compra ?? payload.precioCompra ?? 0,
      "PRECIO_COMPRA"
    );
    const stockMaximo = parseNonNegativeInteger(
      payload.STOCK_MAXIMO ?? payload.stock_maximo ?? payload.stockMaximo ?? payload.PEDIDO ?? payload.pedido ?? 0,
      "STOCK_MÁXIMO"
    );
    const productImages = normalizeProductImages(payload.IMAGENES ?? payload.imagenes ?? payload.imagenes_json);
    const productVariants = normalizeProductVariants(payload.VARIANTES ?? payload.variantes ?? payload.variants ?? payload.variantes_json);
    const stock = parseNonNegativeInteger(
      payload.STOCK_ACTUAL ?? payload.stockActual ?? payload.stock_actual ?? payload.stock ?? 0,
      "STOCK_ACTUAL"
    );
    const variantStockTotal = sumVariantStock(productVariants);
    const normalizedStock = Math.max(stock, variantStockTotal);
    const stockMinimo = parseNonNegativeInteger(
      payload.STOCK_MINIMO ?? payload.stockMinimo ?? payload.stock_minimo ?? 0,
      "STOCK_MÍNIMO"
    );
    const statusInput = payload.ESTADO ?? payload.estado ?? payload.status;
    const status = statusInput === undefined ? "ACTIVO" : normalizeProductStatus(statusInput);
    if (!status) {
      throw createHttpError(400, "ESTADO invalido. Usa ACTIVO o INACTIVO.");
    }

    let id;
    if (hasCustomId) {
      id = parsePositiveInt(payload["N°"] ?? payload.id ?? payload.n, "N°");
    } else {
      const [maxRows] = await connection.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM productos");
      id = parsePositiveInt(maxRows?.[0]?.next_id ?? 1, "N°");
    }

    const [existing] = await connection.query("SELECT id FROM productos WHERE id = ? LIMIT 1", [id]);
    if (Array.isArray(existing) && existing.length) {
      throw createHttpError(409, `Ya existe producto con N° ${id}.`);
    }

    await connection.beginTransaction();
    try {
      await connection.query(
        "INSERT INTO productos (id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, variantes_json, pedido, stock_actual, stock_minimo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, name, description || null, category, price, purchasePrice, JSON.stringify(productImages), JSON.stringify(productVariants), stockMaximo, normalizedStock, stockMinimo, status]
      );
      await replaceProductImages(connection, id, productImages);

      let purchasePriceHistory = null;
      if (purchasePrice > 0) {
        purchasePriceHistory = await appendPurchasePriceHistory(connection, {
          productId: id,
          productName: name,
          purchasePrice,
          note: "Precio de compra inicial",
          source: "CREACION_PRODUCTO"
        });
      }

      let movement = null;
      if (normalizedStock > 0) {
        movement = await insertKardexMovement(connection, {
          productId: id,
          nombre: name,
          tipo: "INGRESO",
          cantidad: normalizedStock,
          stockAntes: 0,
          stockDespues: normalizedStock,
          referencia: "CREACION_PRODUCTO",
          nota: "Stock inicial"
        });
      }

      await connection.commit();

      return {
        ...buildProductApiShape({
          id,
          nombre: name,
          descripcion: description,
          categoria: category,
          precio: price,
          precio_compra: purchasePrice,
          IMAGENES: productImages,
          VARIANTES: productVariants,
          imagenes_json: JSON.stringify(productImages),
          variantes_json: JSON.stringify(productVariants),
          pedido: stockMaximo,
          stock_minimo: stockMinimo,
          stock_actual: normalizedStock,
          estado: status
        }),
        MOVIMIENTO: movement,
        PRECIO_HISTORIAL: purchasePriceHistory
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.createProduct(payload);
      invalidateLocalProductsCache();
      return csvProductToApi(result);
    }
  );
}

async function updateProduct(idInput, payload) {
  const id = parsePositiveInt(idInput, "N°");
  try {
    const remote = await updateProductFirebase(id, payload);
    if (remote) return remote;
  } catch (error) {
    if (error?.status) throw error;
    await appendLog("WARN", "Fallback local de editar producto", {
      operation: "updateProduct",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "updateProduct",
    () => withMysqlConnection(async (connection) => {
    await ensureProductMinimumStockColumn(connection);
    await ensureProductPurchasePriceColumn(connection);
    await ensureProductImagesColumn(connection);
    await ensureProductVariantsColumn(connection);
    await ensureProductImagesTable(connection);
    await ensureProductDescriptionColumn(connection);
    await ensureProductCategoryColumn(connection);
    await ensureProductPurchasePriceHistoryTable(connection);
    await connection.beginTransaction();
    let foreignKeyChecksDisabled = false;
    try {
      const [rows] = await connection.query(
        "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, variantes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? FOR UPDATE",
        [id]
      );
      const current = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!current) throw createHttpError(404, `No existe producto con N° ${id}.`);

      const hasNextId =
        payload["N°"] !== undefined ||
        payload.id !== undefined ||
        payload.n !== undefined;
      const nextId = hasNextId
        ? parsePositiveInt(payload["N°"] ?? payload.id ?? payload.n, "N°")
        : id;
      const shouldSwapProductCode =
        payload.swapProductCode === true ||
        payload.intercambiarCodigo === true ||
        payload.intercambiar_orden === true;
      let targetProduct = null;
      if (nextId !== id) {
        const [targetRows] = await connection.query("SELECT id FROM productos WHERE id = ? LIMIT 1 FOR UPDATE", [nextId]);
        targetProduct = Array.isArray(targetRows) && targetRows.length ? targetRows[0] : null;
        if (targetProduct && !shouldSwapProductCode) {
          throw createHttpError(409, `Ya existe producto con N° ${nextId}.`);
        }
      }

      const name = trimValue(payload.NOMBRE ?? current.nombre);
      if (!name) throw createHttpError(400, "El campo NOMBRE es obligatorio.");
      const description =
        payload.DESCRIPCION !== undefined || payload.descripcion !== undefined || payload.descripcion_larga !== undefined
          ? truncateText(payload.DESCRIPCION ?? payload.descripcion ?? payload.descripcion_larga ?? "", 255)
          : trimValue(current.descripcion || "");
      const category =
        payload.CATEGORIA !== undefined || payload.categoria !== undefined
          ? normalizeProductCategoryValue(payload.CATEGORIA ?? payload.categoria ?? "OTRO")
          : normalizeProductCategoryValue(current.categoria || "OTRO");

      const price =
        payload.PRECIO !== undefined || payload.precio !== undefined
          ? parseNonNegativeNumber(payload.PRECIO ?? payload.precio, "PRECIO")
          : round2(current.precio);
      const purchasePrice =
        payload.PRECIO_COMPRA !== undefined ||
        payload.precio_compra !== undefined ||
        payload.precioCompra !== undefined
          ? parseNonNegativeNumber(
              payload.PRECIO_COMPRA ?? payload.precio_compra ?? payload.precioCompra,
              "PRECIO_COMPRA"
            )
          : round2(current.precio_compra);

      const stockMaximo = parseNonNegativeInteger(
        payload.STOCK_MAXIMO ?? payload.stock_maximo ?? payload.stockMaximo ?? payload.PEDIDO ?? payload.pedido ?? current.pedido,
        "STOCK_MÁXIMO"
      );
      const tableImagesMap = await readProductImagesMap(connection, [id]);
      const currentImages = tableImagesMap.get(id)?.length
        ? tableImagesMap.get(id)
        : normalizeProductImages(current.imagenes_json);
      const productImages =
        payload.IMAGENES !== undefined || payload.imagenes !== undefined || payload.imagenes_json !== undefined
          ? normalizeProductImages(payload.IMAGENES ?? payload.imagenes ?? payload.imagenes_json)
          : currentImages;
      const productVariants =
        payload.VARIANTES !== undefined || payload.variantes !== undefined || payload.variants !== undefined || payload.variantes_json !== undefined
          ? normalizeProductVariants(payload.VARIANTES ?? payload.variantes ?? payload.variants ?? payload.variantes_json)
          : normalizeProductVariants(current.variantes_json);
      const currentVariants = normalizeProductVariants(current.variantes_json);
      const variantsChanged =
        payload.VARIANTES !== undefined ||
        payload.variantes !== undefined ||
        payload.variants !== undefined ||
        payload.variantes_json !== undefined;
      const stockMinimo =
        payload.STOCK_MINIMO !== undefined || payload.stock_minimo !== undefined || payload.stockMinimo !== undefined
          ? parseNonNegativeInteger(
              payload.STOCK_MINIMO ?? payload.stock_minimo ?? payload.stockMinimo,
              "STOCK_MÍNIMO"
            )
          : round2(current.stock_minimo);
      let status = normalizeProductStatus(current.estado) || "ACTIVO";
      const statusInput = payload.ESTADO ?? payload.estado ?? payload.status;
      if (statusInput !== undefined) {
        const nextStatus = normalizeProductStatus(statusInput);
        if (!nextStatus) {
          throw createHttpError(400, "ESTADO invalido. Usa ACTIVO o INACTIVO.");
        }
        status = nextStatus;
      }

      const stockManagedSeparately =
        payload.STOCK_BASE_ACTUAL !== undefined || payload.stockBaseActual !== undefined || payload.stock_base_actual !== undefined;
      let stockBase =
        payload.STOCK_ACTUAL !== undefined || payload.stock_actual !== undefined
          ? parseNonNegativeInteger(payload.STOCK_ACTUAL ?? payload.stock_actual, "STOCK_ACTUAL")
          : round2(current.stock_actual);

      let stockDelta = 0;
      const stockAjusteRaw = payload.stockAjuste;
      if (stockAjusteRaw !== undefined && stockAjusteRaw !== null && trimValue(stockAjusteRaw) !== "") {
        stockDelta = parseIntegerNumber(stockAjusteRaw, "AJUSTE STOCK");
        stockBase = round2(stockBase + stockDelta);
      } else {
        stockDelta = round2(stockBase - round2(current.stock_actual));
      }

      if (stockBase < 0) throw createHttpError(400, "STOCK_ACTUAL no puede ser negativo.");
      if (stockManagedSeparately) {
        stockBase = Math.max(stockBase, sumVariantStock(productVariants));
      }
      if (variantsChanged && !stockManagedSeparately) {
        const variantStockDelta = round2(sumVariantStock(productVariants) - sumVariantStock(currentVariants));
        stockBase = round2(stockBase + variantStockDelta);
        if (stockBase < 0) throw createHttpError(400, "El stock de variantes no puede dejar el producto con stock negativo.");
      }

      if (nextId !== id) {
        const updateProductReferences = async (fromId, toId) => {
          await connection.query("UPDATE productos SET id = ? WHERE id = ?", [toId, fromId]);
          await connection.query("UPDATE ventas_diarias SET producto_id = ? WHERE producto_id = ?", [toId, fromId]);
          await connection.query("UPDATE kardex_movimientos SET producto_id = ? WHERE producto_id = ?", [toId, fromId]);
          await connection.query("UPDATE producto_imagenes SET producto_id = ? WHERE producto_id = ?", [toId, fromId]);
          await connection.query("UPDATE productos_precio_historial SET producto_id = ? WHERE producto_id = ?", [toId, fromId]);
        };
        const [maxRows] = await connection.query("SELECT COALESCE(MAX(id), 0) + 1 AS temp_id FROM productos");
        const tempCurrentId = parsePositiveInt(maxRows?.[0]?.temp_id ?? 1, "N° temporal");

        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        foreignKeyChecksDisabled = true;

        if (targetProduct) {
          await updateProductReferences(id, tempCurrentId);
          await updateProductReferences(nextId, id);
          await updateProductReferences(tempCurrentId, nextId);
        } else {
          await updateProductReferences(id, tempCurrentId);
          await updateProductReferences(tempCurrentId, nextId);
        }

        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        foreignKeyChecksDisabled = false;
      }

      await connection.query(
        "UPDATE productos SET nombre = ?, descripcion = ?, categoria = ?, precio = ?, precio_compra = ?, imagenes_json = ?, variantes_json = ?, pedido = ?, stock_actual = ?, stock_minimo = ?, estado = ? WHERE id = ?",
        [name, description || null, category, price, purchasePrice, JSON.stringify(productImages), JSON.stringify(productVariants), stockMaximo, stockBase, stockMinimo, status, nextId]
      );
      await replaceProductImages(connection, nextId, productImages);

      let purchasePriceHistory = null;
      if (round2(current.precio_compra) !== round2(purchasePrice)) {
        purchasePriceHistory = await appendPurchasePriceHistory(connection, {
          productId: nextId,
          productName: name,
          purchasePrice,
          note: trimValue(payload.nota || payload.NOTA || "Cambio de precio de compra"),
          source: "EDICION_PRODUCTO"
        });
      }

      let movement = null;
      if (stockDelta !== 0) {
        const type = stockDelta > 0 ? "INGRESO" : "SALIDA";
        movement = await insertKardexMovement(connection, {
          productId: nextId,
          nombre: name,
          tipo: type,
          cantidad: Math.abs(stockDelta),
          stockAntes: round2(current.stock_actual),
          stockDespues: stockBase,
          referencia: "AJUSTE_PRODUCTO",
          nota: trimValue(payload.nota || payload.NOTA || "Ajuste manual de stock")
        });
      }

      await connection.commit();

      return {
        ...buildProductApiShape({
          id: nextId,
          nombre: name,
          descripcion: description,
          categoria: category,
          precio: price,
          precio_compra: purchasePrice,
          IMAGENES: productImages,
          VARIANTES: productVariants,
          imagenes_json: JSON.stringify(productImages),
          variantes_json: JSON.stringify(productVariants),
          pedido: stockMaximo,
          stock_minimo: stockMinimo,
          stock_actual: round2(stockBase),
          estado: status
        }),
        MOVIMIENTO: movement,
        PRECIO_HISTORIAL: purchasePriceHistory
      };
    } catch (error) {
      try {
        if (foreignKeyChecksDisabled) {
          await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        }
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.updateProduct(id, payload);
      invalidateLocalProductsCache();
      return csvProductToApi(result);
    }
  );
}

async function deleteProduct(idInput) {
  const id = parsePositiveInt(idInput, "N°");
  try {
    const remote = await deleteProductFirebase(id);
    if (remote) return remote;
  } catch (error) {
    if (error?.status) throw error;
    await appendLog("WARN", "Fallback local de desactivar producto", {
      operation: "deleteProduct",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "deleteProduct",
    () => withMysqlConnection(async (connection) => {
    await ensureProductMinimumStockColumn(connection);
    await ensureProductDescriptionColumn(connection);
    await ensureProductCategoryColumn(connection);
    const [rows] = await connection.query(
      "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? LIMIT 1",
      [id]
    );
    const current = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!current) throw createHttpError(404, `No existe producto con N° ${id}.`);

    const currentStatus = normalizeProductStatus(current.estado) || "ACTIVO";
    if (currentStatus !== "INACTIVO") {
      await connection.query("UPDATE productos SET estado = ? WHERE id = ?", ["INACTIVO", id]);
    }

    return productRowToApi({
      ...current,
      estado: "INACTIVO"
    });
  }),
    async () => {
      const result = await csvDb.deleteProduct(id);
      invalidateLocalProductsCache();
      return { ...csvProductToApi(result), ESTADO: "INACTIVO" };
    }
  );
}

async function hardDeleteProduct(idInput) {
  const id = parsePositiveInt(idInput, "N°");
  return withDataSourceFallback(
    "hardDeleteProduct",
    () =>
      withMysqlConnection(async (connection) => {
        await ensureProductImagesTable(connection);
        await ensureProductPurchasePriceHistoryTable(connection);
        await ensureKardexTable(connection);

        await connection.beginTransaction();
        let foreignKeyChecksDisabled = false;
        try {
          const [rows] = await connection.query(
            "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? FOR UPDATE",
            [id]
          );
          const current = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (!current) throw createHttpError(404, `No existe producto con N° ${id}.`);

          await connection.query("SET FOREIGN_KEY_CHECKS = 0");
          foreignKeyChecksDisabled = true;

          await connection.query("DELETE FROM producto_imagenes WHERE producto_id = ?", [id]);
          await connection.query("DELETE FROM productos_precio_historial WHERE producto_id = ?", [id]);
          await connection.query("DELETE FROM kardex_movimientos WHERE producto_id = ?", [id]);
          await connection.query("DELETE FROM ventas_diarias WHERE producto_id = ?", [id]);
          await connection.query("DELETE FROM productos WHERE id = ?", [id]);

          await connection.query("SET FOREIGN_KEY_CHECKS = 1");
          foreignKeyChecksDisabled = false;
          await connection.commit();

          return buildProductApiShape(current);
        } catch (error) {
          try {
            if (foreignKeyChecksDisabled) {
              await connection.query("SET FOREIGN_KEY_CHECKS = 1");
            }
            await connection.rollback();
          } catch {
            // noop
          }
          throw error;
        }
      }),
    async () => {
      const result = await csvDb.deleteProduct(id);
      invalidateLocalProductsCache();
      return csvProductToApi(result);
    }
  );
}

async function registerStockIngress(idInput, payload) {
  const id = parsePositiveInt(idInput, "N°");
  return withDataSourceFallback(
    "registerStockIngress",
    () => withMysqlConnection(async (connection) => {
    if (Array.isArray(payload?.items) || payload?.paymentSplit || payload?.tipoPago || payload?.TIPO_PAGO || payload?.total || payload?.TOTAL) {
      throw createHttpError(400, "Ingreso de inventario solo acepta datos de reposición; no acepta campos de venta.");
    }
    const quantity = parseNonNegativeNumber(payload.cantidad ?? payload.CANTIDAD, "cantidad");
    if (quantity <= 0) throw createHttpError(400, "La cantidad de ingreso debe ser mayor a 0.");
    const purchasePriceProvided =
      payload.purchasePrice !== undefined ||
      payload.PRECIO_COMPRA !== undefined ||
      payload.precio_compra !== undefined ||
      payload.precioCompra !== undefined;
    const purchasePrice = purchasePriceProvided
      ? parseNonNegativeNumber(
          payload.purchasePrice ?? payload.PRECIO_COMPRA ?? payload.precio_compra ?? payload.precioCompra,
          "PRECIO_COMPRA"
        )
      : null;

    const note = trimValue(payload.nota || payload.NOTA || "Ingreso manual");
    const reference = trimValue(payload.referencia || payload.REFERENCIA || "INGRESO_MANUAL");

    await connection.beginTransaction();
    try {
      const [rows] = await connection.query(
        "SELECT id, nombre, categoria, precio, precio_compra, imagenes_json, pedido, stock_actual, estado FROM productos WHERE id = ? FOR UPDATE",
        [id]
      );
      const current = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!current) throw createHttpError(404, `No existe producto con N° ${id}.`);

      const stockBefore = round2(current.stock_actual);
      const stockAfter = round2(stockBefore + quantity);
      const nextPurchasePrice = purchasePrice === null ? round2(current.precio_compra) : round2(purchasePrice);
      await connection.query("UPDATE productos SET stock_actual = ?, precio_compra = ? WHERE id = ?", [stockAfter, nextPurchasePrice, id]);

      const movement = await insertKardexMovement(connection, {
        productId: id,
        nombre: current.nombre,
        tipo: "INGRESO",
        cantidad: quantity,
        stockAntes: stockBefore,
        stockDespues: stockAfter,
        referencia: reference,
        nota: note
      });

      let purchasePriceHistory = null;
      if (purchasePrice !== null && round2(current.precio_compra) !== round2(nextPurchasePrice)) {
        purchasePriceHistory = await appendPurchasePriceHistory(connection, {
          productId: id,
          productName: current.nombre,
          purchasePrice: nextPurchasePrice,
          note,
          source: reference
        });
      }

      await connection.commit();

      return {
        product: {
          ...productRowToApi({ ...current, stock_actual: stockAfter, precio_compra: nextPurchasePrice }),
          CATEGORIA: normalizeProductCategoryValue(current.categoria || "OTRO")
        },
        movement,
        purchasePriceHistory
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.registerStockIngress(id, payload);
      invalidateLocalProductsCache();
      return {
        product: csvProductToApi(result.product),
        movement: csvKardexToApi(result.movement)
      };
    }
  );
}

async function registerSale(payload) {
  try {
    const remote = await registerSaleFirebase(payload);
    if (remote) return remote;
  } catch (error) {
    if (error?.status) throw error;
    await appendLog("WARN", "Fallback local de registro de venta", {
      operation: "registerSale",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "registerSale",
    () => withMysqlConnection(async (connection) => {
    const productId = parsePositiveInt(resolveIncomingProductId(payload), "producto");
    const variantId = trimValue(payload.variantId ?? payload.variant_id ?? "");
    const quantity = parseNonNegativeNumber(payload.cantidad ?? payload.CANTIDAD, "cantidad");
    if (quantity <= 0) throw createHttpError(400, "La cantidad de venta debe ser mayor a 0.");

    const fechaVenta =
      normalizeSaleDateTimeInput(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA) ||
      defaultSaleDateTime();
    assertSaleDateIsNotFuture(fechaVenta);
    const fechaKardex = saleLocalDateTimeToStoredUtc(fechaVenta);
    const paymentSplit = normalizePaymentSplitRows(payload.paymentSplit);
    const tipoPago = paymentSplit[0]?.tipoPago || normalizePaymentType(payload.tipoPago || payload.TIPO_PAGO || "Efectivo");
    const tipoPagoDetalle = trimValue(
      payload.tipoPagoDetalle || payload.TIPO_PAGO_DETALLE || buildPaymentSummaryText(paymentSplit, tipoPago)
    );
    const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN);
    const note = trimValue(payload.nota || payload.NOTA || "");
    const requestedPresentationId = payload.presentacionCigarro ?? payload.cigarettePresentation ?? payload.PRESENTACION_CIGARRO ?? "";

    await ensureSalesPaymentDetailColumn(connection);
    await connection.beginTransaction();
    try {
      const beforeStateMap = await loadLockedProductStateMap(connection);
      const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
      const salePlan = applyProductSaleToState(stateMap, productId, quantity, variantId, requestedPresentationId);
      const product = salePlan.product;
      const saleProductName = salePlan.variantPlan
        ? `${product.nombre} - ${salePlan.variantPlan.variantName}`
        : salePlan.cigarettePresentation
          ? `${product.nombre} - ${salePlan.cigarettePresentation.label}`
        : product.nombre;
      const stockBefore = salePlan.stockBefore;
      const stockAfter = salePlan.stockAfter;
      const price = salePlan.price;
      const total = salePlan.total;

      await syncChangedProducts(connection, beforeStateMap, stateMap);

      const [saleResult] = await connection.query(
        `INSERT INTO ventas_diarias
         (fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fechaVenta,
          fechaVenta,
          productId,
          truncateText(saleProductName, 180),
          salePlan.saleQuantity,
          price,
          total,
          tipoPago,
          truncateText(tipoPagoDetalle, 255),
          origin
        ]
      );

      const [savedSaleRows] = await connection.query(
        `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen, estado, anulada_at, anulada_motivo
         FROM ventas_diarias
         WHERE id_venta = ?
         LIMIT 1`,
        [toInt(saleResult?.insertId, 0)]
      );
      const savedSale =
        Array.isArray(savedSaleRows) && savedSaleRows.length
          ? savedSaleRows[0]
          : {
              id_venta: toInt(saleResult?.insertId, 0),
              fecha_venta: fechaVenta,
              fecha_operativa: fechaVenta,
              producto_id: productId,
              nombre_snapshot: product.nombre,
              cantidad: salePlan.saleQuantity,
              precio: price,
              total,
              tipo_pago: tipoPago,
              tipo_pago_detalle: tipoPagoDetalle,
              origen: origin,
              estado: "ACTIVA",
              anulada_at: null,
              anulada_motivo: null
            };

      const movements = [];
      if (salePlan.autoOpen) {
        movements.push(
          await insertKardexMovement(connection, {
            productId,
            nombre: product.nombre,
            tipo: "INGRESO",
            cantidad: salePlan.autoOpen.openedUnits,
            stockAntes: stockBefore,
            stockDespues: salePlan.saleStockBefore,
            referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
            ventaId: toInt(saleResult?.insertId, 0),
            fechaHora: fechaKardex,
            nota: `Apertura automática de ${salePlan.autoOpen.boxesOpened} caja(s) para ${product.nombre}`
          })
        );
        movements.push(
          await insertKardexMovement(connection, {
            productId: salePlan.autoOpen.boxProductId,
            nombre: salePlan.autoOpen.boxName,
            tipo: "SALIDA",
            cantidad: salePlan.autoOpen.boxesOpened,
            stockAntes: salePlan.autoOpen.boxStockBefore,
            stockDespues: salePlan.autoOpen.boxStockAfter,
            referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
            ventaId: toInt(saleResult?.insertId, 0),
            fechaHora: fechaKardex,
            nota: `Caja abierta para reponer ${product.nombre}`
          })
        );
      }

      const movement = await insertKardexMovement(connection, {
        productId,
        nombre: saleProductName,
        tipo: "SALIDA",
        cantidad: salePlan.saleQuantity,
        stockAntes: salePlan.saleStockBefore,
        stockDespues: stockAfter,
        referencia: "VENTA_RAPIDA",
        ventaId: toInt(saleResult?.insertId, 0),
        fechaHora: fechaKardex,
        nota: note || `Venta #${saleResult.insertId}`
      });
      movements.push(movement);

      await connection.commit();

      return {
        sale: saleRowToApi(savedSale),
        product: {
          ...productRowToApi({ ...product, stock_actual: stockAfter }),
          CATEGORIA: normalizeProductCategoryValue(product.categoria || "OTRO")
        },
        movement,
        movements
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.registerSale(payload);
      invalidateLocalProductsCache();
      return {
        sale: csvSaleToApi(result.sale),
        product: csvProductToApi(result.product),
        movement: csvKardexToApi(result.movement)
      };
    }
  );
}

async function registerSaleBatch(payload) {
  try {
    const remote = await registerSaleBatchFirebase(payload);
    if (remote) return remote;
  } catch (error) {
    if (error?.status) throw error;
    await appendLog("WARN", "Fallback local de registro de venta compuesta", {
      operation: "registerSaleBatch",
      message: buildDbErrorMessage(error)
    });
  }
  return withDataSourceFallback(
    "registerSaleBatch",
    () => withMysqlConnection(async (connection) => {
      const rawItems = Array.isArray(payload?.items) ? payload.items : [];
      if (!rawItems.length) {
        throw createHttpError(400, "Debes enviar al menos un producto en items.");
      }

      const fechaVenta =
        normalizeSaleDateTimeInput(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA) ||
        defaultSaleDateTime();
      assertSaleDateIsNotFuture(fechaVenta);
      const fechaKardex = saleLocalDateTimeToStoredUtc(fechaVenta);
      const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN);
      const note = trimValue(payload.nota || payload.NOTA || "");
      await ensureSalesPaymentDetailColumn(connection);

      const aggregated = new Map();
      for (const row of rawItems) {
        const productId = parsePositiveInt(resolveIncomingProductId(row), "producto");
        const variantId = trimValue(row?.variantId ?? row?.variant_id ?? "");
        const presentationId = trimValue(row?.presentacionCigarro ?? row?.cigarettePresentation ?? row?.PRESENTACION_CIGARRO ?? "");
        const quantity = parseNonNegativeNumber(row?.cantidad ?? row?.CANTIDAD, "cantidad");
        if (quantity <= 0) throw createHttpError(400, "La cantidad de venta debe ser mayor a 0.");
        const key = `${productId}::${variantId}::${presentationId}`;
        const prev = aggregated.get(key) || { productId, variantId, presentationId, cantidad: 0 };
        aggregated.set(key, { productId, variantId, presentationId, cantidad: round2(prev.cantidad + quantity) });
      }
      const items = Array.from(aggregated.values());

      await connection.beginTransaction();
      try {
        const beforeStateMap = await loadLockedProductStateMap(connection);
        const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
        const products = [];
        for (const item of items) {
          products.push({
            item,
            ...applyProductSaleToState(stateMap, item.productId, item.cantidad, item.variantId, item.presentationId)
          });
        }

        const grandTotal = round2(products.reduce((acc, row) => acc + row.total, 0));
        let paymentSplit = Array.isArray(payload?.paymentSplit)
          ? payload.paymentSplit
              .map((row) => ({
                tipoPago: normalizePaymentType(row?.tipoPago || row?.tipo || "Efectivo"),
                monto: round2(Number(row?.monto || 0))
              }))
              .filter((row) => row.monto > 0)
          : [];

        if (!paymentSplit.length) {
          paymentSplit = [{ tipoPago: normalizePaymentType(payload?.tipoPago || "Efectivo"), monto: grandTotal }];
        }

        const paidTotal = round2(paymentSplit.reduce((acc, row) => acc + row.monto, 0));
        if (round2(paidTotal) !== round2(grandTotal)) {
          throw createHttpError(
            400,
            `La suma de pagos (${paidTotal.toFixed(2)}) debe coincidir con el total (${grandTotal.toFixed(2)}).`
          );
        }
        const tipoPago = paymentSplit[0]?.tipoPago || normalizePaymentType(payload?.tipoPago || "Efectivo");
        const tipoPagoDetalle = buildPaymentSummaryText(paymentSplit, tipoPago);

        const sales = [];
        const movements = [];
        const productsUpdated = [];
        const paymentCursor = paymentSplit.map((row) => ({ ...row }));
        await syncChangedProducts(connection, beforeStateMap, stateMap);

        for (const row of products) {
          const rowPaymentSplit = allocatePaymentSplitForAmount(row.total, paymentCursor, tipoPago);
          const rowTipoPago = rowPaymentSplit[0]?.tipoPago || tipoPago;
          const rowTipoPagoDetalle = buildPaymentSummaryText(rowPaymentSplit, rowTipoPago);
          const [saleResult] = await connection.query(
            `INSERT INTO ventas_diarias
             (fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fechaVenta,
              fechaVenta,
              row.item.productId,
              truncateText(row.variantPlan ? `${row.product.nombre} - ${row.variantPlan.variantName}` : row.product.nombre, 180),
              row.item.cantidad,
              row.price,
              row.total,
              rowTipoPago,
              truncateText(rowTipoPagoDetalle, 255),
              origin
            ]
          );

          const saleId = toInt(saleResult?.insertId, 0);
          if (row.autoOpen) {
            movements.push(
              await insertKardexMovement(connection, {
            productId: row.item.productId,
            nombre: row.variantPlan ? `${row.product.nombre} - ${row.variantPlan.variantName}` : row.product.nombre,
                tipo: "INGRESO",
                cantidad: row.autoOpen.openedUnits,
                stockAntes: row.stockBefore,
                stockDespues: row.saleStockBefore,
                referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
                ventaId: saleId,
                fechaHora: fechaKardex,
                nota: `Apertura automática de ${row.autoOpen.boxesOpened} caja(s) para ${row.product.nombre}`
              })
            );
            movements.push(
              await insertKardexMovement(connection, {
                productId: row.autoOpen.boxProductId,
                nombre: row.autoOpen.boxName,
                tipo: "SALIDA",
                cantidad: row.autoOpen.boxesOpened,
                stockAntes: row.autoOpen.boxStockBefore,
                stockDespues: row.autoOpen.boxStockAfter,
                referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
                ventaId: saleId,
                fechaHora: fechaKardex,
                nota: `Caja abierta para reponer ${row.product.nombre}`
              })
            );
          }
          const [savedRows] = await connection.query(
            `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen, estado, anulada_at, anulada_motivo
             FROM ventas_diarias WHERE id_venta = ? LIMIT 1`,
            [saleId]
          );
          const saved = Array.isArray(savedRows) && savedRows.length ? savedRows[0] : null;
          sales.push(
            saleRowToApi(
              saved || {
                id_venta: saleId,
                fecha_venta: fechaVenta,
                fecha_operativa: fechaVenta,
                producto_id: row.item.productId,
                nombre_snapshot: row.product.nombre,
                cantidad: row.item.cantidad,
                precio: row.price,
                total: row.total,
                tipo_pago: rowTipoPago,
                tipo_pago_detalle: rowTipoPagoDetalle,
                origen: origin,
                estado: "ACTIVA",
                anulada_at: null,
                anulada_motivo: null
              }
            )
          );
          movements.push(
            await insertKardexMovement(connection, {
              productId: row.item.productId,
              nombre: row.product.nombre,
              tipo: "SALIDA",
              cantidad: row.item.cantidad,
              stockAntes: row.saleStockBefore,
              stockDespues: row.stockAfter,
              referencia: "VENTA_RAPIDA",
              ventaId: saleId,
              fechaHora: fechaKardex,
              nota: note || `Venta compuesta #${saleId}`
            })
          );
          productsUpdated.push({
            ...productRowToApi({ ...row.product, stock_actual: row.stockAfter }),
            CATEGORIA: normalizeProductCategoryValue(row.product.categoria || "OTRO")
          });
        }

        await connection.commit();
        return { sales, movements, products: productsUpdated, total: grandTotal, tipoPago, paymentSplit, origen: origin };
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // noop
        }
        throw error;
      }
    }),
    async () => {
      if (typeof csvDb.registerSaleBatch === "function") {
        const result = await csvDb.registerSaleBatch(payload);
        invalidateLocalProductsCache();
        return {
          sales: Array.isArray(result.sales) ? result.sales.map(csvSaleToApi) : [],
          movements: Array.isArray(result.movements) ? result.movements.map(csvKardexToApi) : [],
          products: Array.isArray(result.products) ? result.products.map(csvProductToApi) : [],
          total: round2(result.total),
          tipoPago: normalizePaymentType(result.tipoPago || payload.tipoPago || "Efectivo"),
          paymentSplit: Array.isArray(result.paymentSplit) ? result.paymentSplit : [],
          origen: normalizeSaleOrigin(result.origen || payload.tipoVenta || payload.origen)
        };
      }
      throw createHttpError(500, "No se pudo procesar venta compuesta en modo local.");
    }
  );
}

async function updateSale(idInput, payload) {
  const saleId = parsePositiveInt(idInput, "ID_VENTA");

  return withDataSourceFallback(
    "updateSale",
    () => withMysqlConnection(async (connection) => {
    const productId = parsePositiveInt(resolveIncomingProductId(payload), "producto");
    const quantity = parseNonNegativeNumber(payload.cantidad ?? payload.CANTIDAD, "cantidad");
    if (quantity <= 0) throw createHttpError(400, "La cantidad de venta debe ser mayor a 0.");
    const fechaVenta =
      normalizeSaleDateTimeInput(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA) ||
      defaultSaleDateTime();
    assertSaleDateIsNotFuture(fechaVenta);
    const fechaKardex = saleLocalDateTimeToStoredUtc(fechaVenta);
    const paymentSplit = normalizePaymentSplitRows(payload.paymentSplit);
    const tipoPago = paymentSplit[0]?.tipoPago || normalizePaymentType(payload.tipoPago || payload.TIPO_PAGO || "Efectivo");
    const tipoPagoDetalle = trimValue(
      payload.tipoPagoDetalle || payload.TIPO_PAGO_DETALLE || buildPaymentSummaryText(paymentSplit, tipoPago)
    );

    await ensureSalesPaymentDetailColumn(connection);
    await connection.beginTransaction();
    try {
      const beforeStateMap = await loadLockedProductStateMap(connection);
      const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
      const [saleRows] = await connection.query(
        `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen, estado, anulada_at, anulada_motivo
         FROM ventas_diarias
         WHERE id_venta = ? FOR UPDATE`,
        [saleId]
      );
      const currentSale = Array.isArray(saleRows) && saleRows.length ? saleRows[0] : null;
      if (!currentSale) throw createHttpError(404, `No existe venta #${saleId}.`);
      if (normalizeText(currentSale.estado || "ACTIVA") === "anulada") {
        throw createHttpError(409, `No puedes editar la venta #${saleId} porque está ANULADA.`);
      }

      const currentProductId = toInt(currentSale.producto_id, 0);
      const currentQuantity = round2(currentSale.cantidad);
      const currentProduct = stateMap.get(currentProductId);
      if (!currentProduct) throw createHttpError(404, `No existe producto original N° ${currentProductId}.`);

      const movements = [];

      // Revertir impacto de venta original en producto actual.
      const currentBeforeRevert = round2(currentProduct.stock_actual);
      const currentAfterRevert = round2(currentBeforeRevert + currentQuantity);
      currentProduct.stock_actual = currentAfterRevert;

      movements.push(
        await insertKardexMovement(connection, {
          productId: currentProductId,
          nombre: currentProduct.nombre,
          tipo: "INGRESO",
          cantidad: currentQuantity,
          stockAntes: currentBeforeRevert,
          stockDespues: currentAfterRevert,
          referencia: "VENTA_EDITADA",
          ventaId: saleId,
          fechaHora: fechaKardex,
          nota: `Reversion venta #${saleId}`
        })
      );
      movements.push(...(await reverseAutoOpenMovements(connection, stateMap, saleId, fechaKardex)));

      const salePlan = applyProductSaleToState(stateMap, productId, quantity);
      const targetProduct = salePlan.product;
      const targetStockBefore = salePlan.stockBefore;
      const targetStockAfter = salePlan.stockAfter;

      if (salePlan.autoOpen) {
        movements.push(
          await insertKardexMovement(connection, {
            productId,
            nombre: targetProduct.nombre,
            tipo: "INGRESO",
            cantidad: salePlan.autoOpen.openedUnits,
            stockAntes: targetStockBefore,
            stockDespues: salePlan.saleStockBefore,
            referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
            ventaId: saleId,
            fechaHora: fechaKardex,
            nota: `Apertura automática de ${salePlan.autoOpen.boxesOpened} caja(s) para ${targetProduct.nombre}`
          })
        );
        movements.push(
          await insertKardexMovement(connection, {
            productId: salePlan.autoOpen.boxProductId,
            nombre: salePlan.autoOpen.boxName,
            tipo: "SALIDA",
            cantidad: salePlan.autoOpen.boxesOpened,
            stockAntes: salePlan.autoOpen.boxStockBefore,
            stockDespues: salePlan.autoOpen.boxStockAfter,
            referencia: CIGARETTE_AUTO_OPEN_REFERENCE,
            ventaId: saleId,
            fechaHora: fechaKardex,
            nota: `Caja abierta para reponer ${targetProduct.nombre}`
          })
        );
      }

      movements.push(
        await insertKardexMovement(connection, {
          productId,
          nombre: targetProduct.nombre,
          tipo: "SALIDA",
          cantidad: quantity,
          stockAntes: salePlan.saleStockBefore,
          stockDespues: targetStockAfter,
          referencia: "VENTA_EDITADA",
          ventaId: saleId,
          fechaHora: fechaKardex,
          nota: `Aplicacion venta editada #${saleId}`
        })
      );

      await syncChangedProducts(connection, beforeStateMap, stateMap);

      const finalPrice = round2(salePlan.price);
      const finalTotal = round2(salePlan.total);

      await connection.query(
        `UPDATE ventas_diarias
         SET fecha_venta = ?, fecha_operativa = ?, producto_id = ?, nombre_snapshot = ?, cantidad = ?, precio = ?, total = ?, tipo_pago = ?, tipo_pago_detalle = ?, origen = ?
         WHERE id_venta = ?`,
        [
          fechaVenta,
          fechaVenta,
          productId,
          truncateText(targetProduct.nombre, 180),
          quantity,
          finalPrice,
          finalTotal,
          tipoPago,
          truncateText(tipoPagoDetalle, 255),
          trimValue(currentSale.origen || "MANUAL") || "MANUAL",
          saleId
        ]
      );

      const [updatedSaleRows] = await connection.query(
        `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, tipo_pago_detalle, origen, estado, anulada_at, anulada_motivo
         FROM ventas_diarias
         WHERE id_venta = ?
         LIMIT 1`,
        [saleId]
      );
      const updatedSale =
        Array.isArray(updatedSaleRows) && updatedSaleRows.length
          ? updatedSaleRows[0]
          : {
              id_venta: saleId,
              fecha_venta: fechaVenta,
              fecha_operativa: fechaVenta,
              producto_id: productId,
              nombre_snapshot: targetProduct.nombre,
              cantidad: quantity,
              precio: finalPrice,
              total: finalTotal,
              tipo_pago: tipoPago,
              tipo_pago_detalle: tipoPagoDetalle,
              origen: trimValue(currentSale.origen || "MANUAL") || "MANUAL",
              estado: "ACTIVA",
              anulada_at: null,
              anulada_motivo: null
            };

      await connection.commit();

      return {
        sale: saleRowToApi(updatedSale),
        product: {
          ...productRowToApi({ ...targetProduct, stock_actual: targetStockAfter }),
          CATEGORIA: normalizeProductCategoryValue(targetProduct.categoria || "OTRO")
        },
        movements
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.updateSale(saleId, payload);
      return {
        sale: csvSaleToApi(result.sale),
        product: csvProductToApi(result.product),
        movements: Array.isArray(result.movements) ? result.movements.map(csvKardexToApi) : []
      };
    }
  );
}

async function deleteSale(idInput, payload = {}) {
  const saleId = parsePositiveInt(idInput, "ID_VENTA");

  return withDataSourceFallback(
    "deleteSale",
    () => withMysqlConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const beforeStateMap = await loadLockedProductStateMap(connection);
      const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
      const [saleRows] = await connection.query(
        `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, origen, estado, anulada_at, anulada_motivo
         FROM ventas_diarias
         WHERE id_venta = ? FOR UPDATE`,
        [saleId]
      );
      const currentSale = Array.isArray(saleRows) && saleRows.length ? saleRows[0] : null;
      if (!currentSale) throw createHttpError(404, `No existe venta #${saleId}.`);
      if (normalizeText(currentSale.estado || "ACTIVA") === "anulada") {
        throw createHttpError(409, `La venta #${saleId} ya está ANULADA.`);
      }
      const cancelReason = truncateText(
        payload.motivo || payload.anulada_motivo || payload.reason || `Anulación manual venta #${saleId}`,
        255
      );

      const productId = toInt(currentSale.producto_id, 0);
      const quantity = round2(currentSale.cantidad);
      const product = stateMap.get(productId);
      if (!product) throw createHttpError(404, `No existe producto N° ${productId} asociado a la venta #${saleId}.`);

      const stockBefore = round2(product.stock_actual);
      const stockAfter = round2(stockBefore + quantity);
      product.stock_actual = stockAfter;

      await connection.query(
        `UPDATE ventas_diarias
         SET estado = 'ANULADA', anulada_at = NOW(), anulada_motivo = ?
         WHERE id_venta = ?`,
        [cancelReason, saleId]
      );
      const reversalMovements = await reverseAutoOpenMovements(connection, stateMap, saleId);
      await syncChangedProducts(connection, beforeStateMap, stateMap);

      const [updatedSaleRows] = await connection.query(
        `SELECT id_venta, fecha_venta, fecha_operativa, producto_id, nombre_snapshot, cantidad, precio, total, tipo_pago, origen, estado, anulada_at, anulada_motivo
         FROM ventas_diarias
         WHERE id_venta = ?
         LIMIT 1`,
        [saleId]
      );
      const updatedSale =
        Array.isArray(updatedSaleRows) && updatedSaleRows.length
          ? updatedSaleRows[0]
          : {
              ...currentSale,
              estado: "ANULADA",
              anulada_at: nowIso(),
              anulada_motivo: cancelReason
            };

      const movement = await insertKardexMovement(connection, {
        productId,
        nombre: product.nombre,
        tipo: "INGRESO",
        cantidad: quantity,
        stockAntes: stockBefore,
        stockDespues: stockAfter,
        referencia: "VENTA_ANULADA",
        ventaId: saleId,
        nota: cancelReason
      });

      await connection.commit();

      return {
        ok: true,
        sale: saleRowToApi(updatedSale),
        product: {
          ...productRowToApi({ ...product, stock_actual: product.stock_actual }),
          CATEGORIA: normalizeProductCategoryValue(product.categoria || "OTRO")
        },
        movement,
        movements: [movement, ...reversalMovements]
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  }),
    async () => {
      const result = await csvDb.deleteSale(saleId, payload);
      invalidateLocalProductsCache();
      return {
        ok: true,
        sale: csvSaleToApi(result.sale),
        product: csvProductToApi(result.product),
        movement: csvKardexToApi(result.movement)
      };
    }
  );
}

async function getDbStatus() {
  const checkedAt = nowIso();
  if (isFirebaseBackendEnabled()) {
    const started = Date.now();
    try {
      const db = getFirebaseDb();
      await db.collection(firebaseCollectionName("products")).limit(1).get();
      return {
        checked: true,
        checkedAt,
        configured: true,
        connected: true,
        method: "firebase_firestore",
        projectId: trimValue(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
        database: trimValue(process.env.FIRESTORE_DATABASE_ID || "lalicoreria"),
        missingKeys: [],
        probeMs: Date.now() - started,
        message: "Firestore conectado. Backend operando exclusivamente con Firebase.",
        error: null
      };
    } catch (error) {
      return {
        checked: true,
        checkedAt,
        configured: true,
        connected: false,
        method: "firebase_firestore",
        projectId: trimValue(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
        database: trimValue(process.env.FIRESTORE_DATABASE_ID || "lalicoreria"),
        missingKeys: [],
        probeMs: Date.now() - started,
        message: "No se pudo conectar con Firestore.",
        error: buildDbErrorMessage(error)
      };
    }
  }
  const envValues = await readEnvValuesQuiet();
  const config = buildDbConfig(envValues, "status");
  if (!(await isMysqlOnlyModeEnabled())) {
    return {
      checked: true,
      checkedAt,
      configured: Boolean(config.host && config.database && config.user && config.password),
      connected: true,
      method: "local_csv",
      host: config.host || null,
      port: config.port || null,
      database: config.database || null,
      user: config.user || null,
      charset: config.charset,
      missingKeys: [],
      probeMs: 0,
      message: "Operando con respaldo CSV local. MySQL no se prueba en modo local.",
      error: null
    };
  }

  const missing = DB_STATUS_ENV_KEYS.filter((key) => {
    const suffix = key.replace("DB_STATUS_", "").toLowerCase();
    if (suffix === "port" || suffix === "charset") return false;
    if (suffix === "host") return !config.host;
    if (suffix === "name") return !config.database;
    if (suffix === "user") return !config.user;
    if (suffix === "password") return !config.password;
    return false;
  });

  if (!config.host || !config.database || !config.user || !config.password) {
    return {
      checked: true,
      checkedAt,
      configured: false,
      connected: false,
      method: "none",
      host: config.host || null,
      port: config.port || null,
      database: config.database || null,
      user: config.user || null,
      charset: config.charset,
      missingKeys: missing,
      probeMs: 0,
      message: "Faltan variables de conexión DB_* en .env.",
      error: null
    };
  }

  const started = Date.now();
  let connection;
  try {
    connection = await openMysqlConnection(config);
    await connection.query("SELECT 1");
    return {
      checked: true,
      checkedAt,
      configured: true,
      connected: true,
      method: "mysql2",
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      charset: config.charset,
      missingKeys: [],
      probeMs: Date.now() - started,
      message: "Conexión exitosa con base de datos.",
      error: null
    };
  } catch (error) {
    if (shouldUseLocalCsvFallback(error)) {
      if (await isMysqlOnlyModeEnabled()) {
        return {
          checked: true,
          checkedAt,
          configured: true,
          connected: false,
          method: "mysql2",
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          charset: config.charset,
          missingKeys: [],
          probeMs: Date.now() - started,
          message: "MySQL remoto no disponible y el fallback CSV está deshabilitado.",
          error: buildDbErrorMessage(error)
        };
      }
      try {
        await ensureLocalCsvReady();
        return {
          checked: true,
          checkedAt,
          configured: true,
          connected: true,
          method: "local_csv",
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          charset: config.charset,
          missingKeys: [],
          probeMs: Date.now() - started,
          message: "MySQL remoto no disponible. Operando con respaldo CSV local.",
          error: buildDbErrorMessage(error)
        };
      } catch (fallbackError) {
        return {
          checked: true,
          checkedAt,
          configured: true,
          connected: false,
          method: "mysql2",
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          charset: config.charset,
          missingKeys: [],
          probeMs: Date.now() - started,
          message: "No se pudo validar conexión de base de datos ni activar respaldo local.",
          error: `${buildDbErrorMessage(error)} | fallback: ${trimValue(fallbackError?.message || "")}`
        };
      }
    }

    return {
      checked: true,
      checkedAt,
      configured: true,
      connected: false,
      method: "mysql2",
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      charset: config.charset,
      missingKeys: [],
      probeMs: Date.now() - started,
      message: "No se pudo validar conexión de base de datos.",
      error: buildDbErrorMessage(error)
    };
  } finally {
    try {
      if (connection) await connection.end();
    } catch {
      // noop
    }
  }
}

async function getRuntimeStatus() {
  const sourceInfo = await csvDb.getSourceInfo();
  return {
    ok: true,
    runtimeVersion: RUNTIME_VERSION,
    expectedRuntimeVersion: RUNTIME_VERSION,
    host: HOST,
    port: PORT,
    projectDir: PROJECT_DIR,
    rootDir: ROOT_DIR,
    productsCsvPath: sourceInfo.activeCsvPath,
    defaultProductsCsvPath: sourceInfo.defaultCsvPath,
    productsSourceType: sourceInfo.sourceType,
    productsLockedToProject: sourceInfo.lockedToProject === true,
    checkedAt: nowIso()
  };
}

async function buildDailySalesExportCsv(connection, options = {}) {
  const traceId = trimValue(options.traceId || "") || `sales-export-${Date.now()}`;
  const requestedFrom = normalizeIsoDateOnly(options.from);
  const requestedTo = normalizeIsoDateOnly(options.to);
  const queryTerm = normalizeText(options.q || "");

  const from = requestedFrom || requestedTo || todayIsoDate();
  const to = requestedTo || requestedFrom || from;
  if (from > to) {
    throw createHttpError(400, "Rango inválido: la fecha Desde no puede ser mayor que Hasta.");
  }

  await appendLog("INFO", "Export ventas CSV iniciado", {
    traceId,
    from,
    to,
    q: trimValue(options.q || "")
  });

  const [productRows] = await connection.query(
    "SELECT id, nombre, categoria, precio, stock_actual FROM productos ORDER BY id ASC"
  );
  const catalogProducts = (Array.isArray(productRows) ? productRows : []).map((row) => ({
    id: toInt(row.id, 0),
    nombre: trimValue(row.nombre || ""),
    precio: round2(row.precio),
    stockActual: round2(row.stock_actual)
  }));

  const dates = listIsoDatesInRange(from, to);
  const salesByProductDay = new Map();
  const ingressByProductDay = new Map();
  const netByProductDay = new Map();
  const netAfterEndByProduct = new Map();
  const soldProductsById = new Map();

  if (dates.length > 0) {
    const salesShiftDateSql = buildOperationalShiftDateSql("fecha_venta");

    const [salesRows] = await connection.query(
      `
        SELECT ${salesShiftDateSql} AS fecha_turno,
               producto_id,
               MAX(nombre_snapshot) AS nombre_snapshot,
               MAX(precio) AS precio_snapshot,
               SUM(cantidad) AS venta_dia
        FROM ventas_diarias
        WHERE ${salesShiftDateSql} BETWEEN ? AND ?
          AND COALESCE(estado, 'ACTIVA') = 'ACTIVA'
        GROUP BY ${salesShiftDateSql}, producto_id
      `,
      [from, to]
    );
    for (const row of Array.isArray(salesRows) ? salesRows : []) {
      const fecha = normalizeIsoDateOnly(row.fecha_turno);
      const productId = toInt(row.producto_id, 0);
      if (!fecha || productId <= 0) continue;
      const key = `${productId}|${fecha}`;
      salesByProductDay.set(key, round2(row.venta_dia));
      if (!soldProductsById.has(productId)) {
        soldProductsById.set(productId, {
          id: productId,
          nombre: trimValue(row.nombre_snapshot || ""),
          precio: round2(row.precio_snapshot),
          stockActual: 0
        });
      }
    }
  }

  const products = buildSalesExportProducts(catalogProducts, soldProductsById, queryTerm);
  const productIds = products.map((item) => item.id).filter((id) => id > 0);

  if (productIds.length > 0 && dates.length > 0) {
    const placeholders = productIds.map(() => "?").join(",");
    const kardexShiftDateSql = buildOperationalShiftDateSql("fecha_hora");
    const realIngressRefs = [...REAL_KARDEX_INGRESS_REFERENCES];

    try {
      const [kardexIngressRows] = await connection.query(
        `
          SELECT ${kardexShiftDateSql} AS fecha_turno,
                 producto_id,
                 SUM(cantidad) AS ingreso_real_dia
          FROM kardex_movimientos
          WHERE ${kardexShiftDateSql} BETWEEN ? AND ?
            AND producto_id IN (${placeholders})
            AND tipo = 'INGRESO'
            AND (
              UPPER(COALESCE(referencia, '')) IN (${realIngressRefs.map(() => "?").join(",")})
              OR (UPPER(COALESCE(referencia, '')) = 'AJUSTE_PRODUCTO' AND COALESCE(venta_id, 0) <= 0)
            )
          GROUP BY ${kardexShiftDateSql}, producto_id
        `,
        [from, to, ...productIds, ...realIngressRefs]
      );

      for (const row of Array.isArray(kardexIngressRows) ? kardexIngressRows : []) {
        const fecha = normalizeIsoDateOnly(row.fecha_turno);
        const productId = toInt(row.producto_id, 0);
        if (!fecha || productId <= 0) continue;
        const key = `${productId}|${fecha}`;
        ingressByProductDay.set(key, round2(row.ingreso_real_dia));
      }

      const [kardexRows] = await connection.query(
        `
          SELECT ${kardexShiftDateSql} AS fecha_turno, producto_id,
                 SUM(CASE WHEN tipo = 'INGRESO' THEN cantidad ELSE -cantidad END) AS neto_dia
          FROM kardex_movimientos
          WHERE ${kardexShiftDateSql} BETWEEN ? AND ?
            AND producto_id IN (${placeholders})
          GROUP BY ${kardexShiftDateSql}, producto_id
        `,
        [from, to, ...productIds]
      );

      for (const row of Array.isArray(kardexRows) ? kardexRows : []) {
        const fecha = normalizeIsoDateOnly(row.fecha_turno);
        const productId = toInt(row.producto_id, 0);
        if (!fecha || productId <= 0) continue;
        const key = `${productId}|${fecha}`;
        netByProductDay.set(key, round2(row.neto_dia));
      }

      const [kardexAfterRows] = await connection.query(
        `
          SELECT producto_id,
                 SUM(CASE WHEN tipo = 'INGRESO' THEN cantidad ELSE -cantidad END) AS neto_post
          FROM kardex_movimientos
          WHERE ${kardexShiftDateSql} > ?
            AND producto_id IN (${placeholders})
          GROUP BY producto_id
        `,
        [to, ...productIds]
      );

      for (const row of Array.isArray(kardexAfterRows) ? kardexAfterRows : []) {
        const productId = toInt(row.producto_id, 0);
        if (productId <= 0) continue;
        netAfterEndByProduct.set(productId, round2(row.neto_post));
      }
    } catch (error) {
      if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
      await appendLog("WARN", "Export ventas CSV sin kardex_movimientos, usando fallback ventas", {
        traceId
      });
    }
  }

  const reportRows = buildDailySalesExportReportRows(
    products,
    dates,
    salesByProductDay,
    ingressByProductDay,
    netByProductDay,
    netAfterEndByProduct
  );

  const csvRows = [];
  const headerDates = ["N°", "NOMBRE", "PRECIO"];
  for (const dateIso of dates) {
    headerDates.push(formatReportDateHeader(dateIso), "", "", "");
  }
  csvRows.push(csvLine(headerDates));

  const headerTypes = ["", "", ""];
  for (const _dateIso of dates) {
    headerTypes.push("INGRESO", "INICIO", "VENTA DEL DIA", "CIERRE");
  }
  csvRows.push(csvLine(headerTypes));

  for (const row of reportRows) {
    const line = [row.id, row.nombre, Number.isFinite(row.precio) ? row.precio.toFixed(2) : "0.00"];
    for (const dateIso of dates) {
      const day = row.byDay.get(dateIso) || { ingresoDia: 0, inicio: 0, ventaDia: 0, cierre: 0 };
      line.push(
        formatQtyCsv(day.ingresoDia, { blankIfZero: true }),
        formatQtyCsv(day.inicio),
        formatQtyCsv(day.ventaDia, { blankIfZero: true }),
        formatQtyCsv(day.cierre)
      );
    }
    csvRows.push(csvLine(line));
  }

  const csv = `\uFEFF${csvRows.join("\n")}\n`;
  const fileName = sanitizeCsvFileName(`ventas_diarias_resumen_${from}_a_${to}.csv`);

  return {
    csv,
    fileName,
    traceId,
    from,
    to,
    rows: reportRows.length,
    days: dates.length,
    dates,
    reportRows
  };
}

async function buildDailySalesExportCsvLocal(options = {}) {
  const traceId = trimValue(options.traceId || "") || `sales-export-${Date.now()}`;
  const requestedFrom = normalizeIsoDateOnly(options.from);
  const requestedTo = normalizeIsoDateOnly(options.to);
  const queryTerm = normalizeText(options.q || "");

  const from = requestedFrom || requestedTo || todayIsoDate();
  const to = requestedTo || requestedFrom || from;
  if (from > to) {
    throw createHttpError(400, "Rango inválido: la fecha Desde no puede ser mayor que Hasta.");
  }

  await ensureLocalCsvReady();

  const catalogProducts = (await readLocalProductsLightCached()).map((row) => ({
    id: resolveProductIdValue(row),
    nombre: trimValue(row?.NOMBRE || ""),
    precio: round2(row?.PRECIO),
    stockActual: round2(row?.STOCK_ACTUAL)
  }));

  const dates = listIsoDatesInRange(from, to);
  const salesByProductDay = new Map();
  const ingressByProductDay = new Map();
  const netByProductDay = new Map();
  const netAfterEndByProduct = new Map();
  const soldProductsById = new Map();

  const sales = await csvDb.readSales();
  for (const row of sales) {
    const productId = resolveProductIdValue(row);
    const fecha = resolveOperationalShiftDate(
      row?.FECHA_REFERENCIA || row?.FECHA_OPERATIVA || row?.FECHA_VENTA || row?.FECHA || row?.fecha
    );
    const saleStatus = normalizeText(row?.ESTADO || row?.estado || "ACTIVA");
    if (!fecha || productId <= 0 || saleStatus === "anulada") continue;
    if (fecha < from || fecha > to) continue;
    const key = `${productId}|${fecha}`;
    salesByProductDay.set(key, round2(toNumber(salesByProductDay.get(key), 0) + toNumber(row?.CANTIDAD, 0)));
    if (!soldProductsById.has(productId)) {
      soldProductsById.set(productId, {
        id: productId,
        nombre: trimValue(row?.NOMBRE || row?.nombre_snapshot || ""),
        precio: round2(row?.PRECIO ?? row?.precio),
        stockActual: 0
      });
    }
  }

  const products = buildSalesExportProducts(catalogProducts, soldProductsById, queryTerm);
  const productIds = new Set(products.map((item) => item.id).filter((id) => id > 0));

  const kardex = await csvDb.readKardex();
  for (const row of kardex) {
    const productId = resolveProductIdValue(row);
    const fecha = resolveOperationalShiftDate(row?.FECHA_HORA || row?.fecha_hora);
    if (!fecha || productId <= 0 || !productIds.has(productId)) continue;
    const classification = classifyKardexMovement(row);

    const signedQty =
      normalizeKardexType(row?.TIPO) === "INGRESO" ? round2(row?.CANTIDAD) : round2(-toNumber(row?.CANTIDAD, 0));
    if (fecha >= from && fecha <= to) {
      const key = `${productId}|${fecha}`;
      if (classification?.ES_INGRESO_REAL) {
        ingressByProductDay.set(key, round2(toNumber(ingressByProductDay.get(key), 0) + toNumber(row?.CANTIDAD, 0)));
      }
      netByProductDay.set(key, round2(toNumber(netByProductDay.get(key), 0) + signedQty));
    } else if (fecha > to) {
      netAfterEndByProduct.set(
        productId,
        round2(toNumber(netAfterEndByProduct.get(productId), 0) + signedQty)
      );
    }
  }

  const reportRows = buildDailySalesExportReportRows(
    products,
    dates,
    salesByProductDay,
    ingressByProductDay,
    netByProductDay,
    netAfterEndByProduct
  );

  const csvRows = [];
  const headerDates = ["N°", "NOMBRE", "PRECIO"];
  for (const dateIso of dates) {
    headerDates.push(formatReportDateHeader(dateIso), "", "", "");
  }
  csvRows.push(csvLine(headerDates));

  const headerTypes = ["", "", ""];
  for (const _dateIso of dates) {
    headerTypes.push("INGRESO", "INICIO", "VENTA DEL DIA", "CIERRE");
  }
  csvRows.push(csvLine(headerTypes));

  for (const row of reportRows) {
    const line = [row.id, row.nombre, Number.isFinite(row.precio) ? row.precio.toFixed(2) : "0.00"];
    for (const dateIso of dates) {
      const day = row.byDay.get(dateIso) || { ingresoDia: 0, inicio: 0, ventaDia: 0, cierre: 0 };
      line.push(
        formatQtyCsv(day.ingresoDia, { blankIfZero: true }),
        formatQtyCsv(day.inicio),
        formatQtyCsv(day.ventaDia, { blankIfZero: true }),
        formatQtyCsv(day.cierre)
      );
    }
    csvRows.push(csvLine(line));
  }

  return {
    csv: `\uFEFF${csvRows.join("\n")}\n`,
    fileName: sanitizeCsvFileName(`ventas_diarias_resumen_${from}_a_${to}.csv`),
    traceId,
    from,
    to,
    rows: reportRows.length,
    days: dates.length,
    dates,
    reportRows
  };
}

async function buildDailySalesExportCsvWithFallback(options = {}) {
  if (isFirebaseBackendEnabled()) {
    return buildDailySalesExportCsvLocal(options);
  }
  try {
    return await withMysqlConnection(async (connection) => buildDailySalesExportCsv(connection, options));
  } catch (error) {
    if (!shouldUseLocalCsvFallback(error)) throw error;
    await appendLog("WARN", "Export ventas CSV con fallback local", {
      traceId: trimValue(options.traceId || ""),
      message: buildDbErrorMessage(error)
    });
    return buildDailySalesExportCsvLocal(options);
  }
}

function buildDailySalesExportStyledSpreadsheet(exportData) {
  const from = normalizeIsoDateOnly(exportData?.from) || todayIsoDate();
  const to = normalizeIsoDateOnly(exportData?.to) || from;
  const dates = Array.isArray(exportData?.dates) ? exportData.dates : [];
  const reportRows = Array.isArray(exportData?.reportRows) ? exportData.reportRows : [];

  const buildCell = (value, options = {}) => {
    const styleId = options.styleId || "sNormal";
    const type = options.type || "String";
    const mergeAcross = Number(options.mergeAcross || 0);
    const mergeDown = Number(options.mergeDown || 0);
    const attrs = [` ss:StyleID="${styleId}"`];
    if (mergeAcross > 0) attrs.push(` ss:MergeAcross="${mergeAcross}"`);
    if (mergeDown > 0) attrs.push(` ss:MergeDown="${mergeDown}"`);
    const safeValue =
      type === "Number" ? String(toNumber(value, 0)) : htmlEscape(value === null ? "" : value);
    return `<Cell${attrs.join("")}><Data ss:Type="${type}">${safeValue}</Data></Cell>`;
  };

  const rows = [];
  const headerTop = [];
  headerTop.push(buildCell("N°", { styleId: "sHeaderMain", mergeDown: 1 }));
  headerTop.push(buildCell("NOMBRE", { styleId: "sHeaderMain", mergeDown: 1 }));
  headerTop.push(buildCell("PRECIO", { styleId: "sHeaderPrice", mergeDown: 1 }));
  for (const dateIso of dates) {
    headerTop.push(
      buildCell(formatReportDateHeader(dateIso), {
        styleId: "sHeaderDate",
        mergeAcross: 3
      })
    );
  }
  rows.push(`<Row>${headerTop.join("")}</Row>`);

  const headerBottom = [];
  for (const _dateIso of dates) {
    headerBottom.push(buildCell("INGRESO", { styleId: "sSubIngreso" }));
    headerBottom.push(buildCell("INICIO", { styleId: "sSubNormal" }));
    headerBottom.push(buildCell("VENTA DEL DIA", { styleId: "sSubVenta" }));
    headerBottom.push(buildCell("CIERRE", { styleId: "sSubNormal" }));
  }
  rows.push(`<Row>${headerBottom.join("")}</Row>`);

  for (const row of reportRows) {
    const cells = [];
    cells.push(buildCell(toInt(row.id, 0), { styleId: "sNormal", type: "Number" }));
    cells.push(buildCell(row.nombre || "", { styleId: "sName" }));
    cells.push(
      buildCell(round2(toNumber(row.precio, 0)), {
        styleId: "sPrice",
        type: "Number"
      })
    );

    for (const dateIso of dates) {
      const day = row.byDay?.get(dateIso) || { ingresoDia: 0, inicio: 0, ventaDia: 0, cierre: 0 };
      const ingreso = round2(toNumber(day.ingresoDia, 0));
      const inicio = round2(toNumber(day.inicio, 0));
      const venta = round2(toNumber(day.ventaDia, 0));
      const cierre = round2(toNumber(day.cierre, 0));

      if (Math.abs(ingreso) < 0.0000001) {
        cells.push(buildCell("", { styleId: "sIngreso", type: "String" }));
      } else {
        cells.push(buildCell(ingreso, { styleId: "sIngreso", type: "Number" }));
      }
      cells.push(buildCell(inicio, { styleId: "sNormal", type: "Number" }));
      if (Math.abs(venta) < 0.0000001) {
        cells.push(buildCell("", { styleId: "sVenta", type: "String" }));
      } else {
        cells.push(buildCell(venta, { styleId: "sVenta", type: "Number" }));
      }
      cells.push(buildCell(cierre, { styleId: "sNormal", type: "Number" }));
    }
    rows.push(`<Row>${cells.join("")}</Row>`);
  }

  const xml = `\uFEFF<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:FontName="Arial" ss:Size="10" ss:Color="#111111"/>
  </Style>
  <Style ss:ID="sNormal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="sName"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/></Style>
  <Style ss:ID="sHeaderMain"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#111111"/><Interior ss:Color="#9AD14B" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sHeaderPrice"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#0A2B1C"/><Interior ss:Color="#36B37E" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sHeaderDate"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#111111"/><Interior ss:Color="#D4AF37" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sSubIngreso"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#0F5132"/><Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sSubNormal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#111111"/><Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sSubVenta"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#C1121F"/><Interior ss:Color="#F4B183" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sPrice"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#166534"/><Interior ss:Color="#D8F3DC" ss:Pattern="Solid"/><NumberFormat ss:Format="0.00"/></Style>
  <Style ss:ID="sIngreso"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#0F5132"/><Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sVenta"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#C1121F"/><Interior ss:Color="#F6C49F" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Ventas Diarias">
  <Table>
${rows.map((line) => `   ${line}`).join("\n")}
  </Table>
 </Worksheet>
</Workbook>`;

  const fileName = sanitizeCsvFileName(`ventas_diarias_resumen_${from}_a_${to}_color.xml`);
  return {
    content: xml,
    contentType: "application/xml; charset=utf-8",
    fileName
  };
}

function buildDailySalesExportXlsx(exportData) {
  const from = normalizeIsoDateOnly(exportData?.from) || todayIsoDate();
  const to = normalizeIsoDateOnly(exportData?.to) || from;
  const dates = Array.isArray(exportData?.dates) ? exportData.dates : [];
  const reportRows = Array.isArray(exportData?.reportRows) ? exportData.reportRows : [];
  const totalColumns = Math.max(3, 3 + dates.length * 4);
  const totalRows = 2 + reportRows.length;

  const rows = [];
  const topRow = [];
  topRow.push({ col: 1, kind: "s", style: 1, value: "N°" });
  topRow.push({ col: 2, kind: "s", style: 1, value: "NOMBRE" });
  topRow.push({ col: 3, kind: "s", style: 2, value: "PRECIO" });
  for (let i = 0; i < dates.length; i += 1) {
    const startCol = 4 + i * 4;
    topRow.push({ col: startCol, kind: "s", style: 3, value: formatReportDateHeader(dates[i]) });
  }
  rows.push(topRow);

  const secondRow = [];
  for (let i = 0; i < dates.length; i += 1) {
    const startCol = 4 + i * 4;
    secondRow.push({ col: startCol, kind: "s", style: 10, value: "INGRESO" });
    secondRow.push({ col: startCol + 1, kind: "s", style: 4, value: "INICIO" });
    secondRow.push({ col: startCol + 2, kind: "s", style: 5, value: "VENTA DEL DIA" });
    secondRow.push({ col: startCol + 3, kind: "s", style: 4, value: "CIERRE" });
  }
  rows.push(secondRow);

  for (const reportRow of reportRows) {
    const line = [];
    line.push({ col: 1, kind: "n", style: 7, value: toInt(reportRow.id, 0) });
    line.push({ col: 2, kind: "s", style: 6, value: reportRow.nombre || "" });
    line.push({ col: 3, kind: "n", style: 8, value: round2(toNumber(reportRow.precio, 0)) });

    for (let i = 0; i < dates.length; i += 1) {
      const startCol = 4 + i * 4;
      const day = reportRow.byDay?.get(dates[i]) || { ingresoDia: 0, inicio: 0, ventaDia: 0, cierre: 0 };
      const ingreso = round2(toNumber(day.ingresoDia, 0));
      const inicio = round2(toNumber(day.inicio, 0));
      const venta = round2(toNumber(day.ventaDia, 0));
      const cierre = round2(toNumber(day.cierre, 0));
      if (Math.abs(ingreso) < 0.0000001) {
        line.push({ col: startCol, kind: "s", style: 11, value: "" });
      } else {
        line.push({ col: startCol, kind: "n", style: 11, value: ingreso });
      }
      line.push({ col: startCol + 1, kind: "n", style: 7, value: inicio });
      if (Math.abs(venta) < 0.0000001) {
        line.push({ col: startCol + 2, kind: "s", style: 9, value: "" });
      } else {
        line.push({ col: startCol + 2, kind: "n", style: 9, value: venta });
      }
      line.push({ col: startCol + 3, kind: "n", style: 7, value: cierre });
    }
    rows.push(line);
  }

  const mergeRanges = ["A1:A2", "B1:B2", "C1:C2"];
  for (let i = 0; i < dates.length; i += 1) {
    const startCol = 4 + i * 4;
    const endCol = startCol + 3;
    mergeRanges.push(`${columnNumberToLetters(startCol)}1:${columnNumberToLetters(endCol)}1`);
  }

  const rowXml = rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const sortedCells = [...cells].sort((a, b) => a.col - b.col);
      const cellXml = sortedCells
        .map((cell) => {
          const cellRef = `${columnNumberToLetters(cell.col)}${rowNumber}`;
          return cell.kind === "n"
            ? xlsxNumericCell(cellRef, cell.style, cell.value)
            : xlsxInlineStringCell(cellRef, cell.style, cell.value);
        })
        .join("");
      return `<row r="${rowNumber}">${cellXml}</row>`;
    })
    .join("");

  const dimensionRef = `A1:${columnNumberToLetters(totalColumns)}${Math.max(totalRows, 1)}`;

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimensionRef}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${rowXml}</sheetData>
  <mergeCells count="${mergeRanges.length}">
    ${mergeRanges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}
  </mergeCells>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF111111"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FFC1121F"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF9AD14B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF36B37E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD4AF37"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD8F3DC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF6C49F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color auto="1"/></left>
      <right style="thin"><color auto="1"/></right>
      <top style="thin"><color auto="1"/></top>
      <bottom style="thin"><color auto="1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="2" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="2" fontId="1" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Ventas Diarias" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const now = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Licoreria</dc:creator>
  <cp:lastModifiedBy>Licoreria</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Licoreria App</Application>
</Properties>`;

  const content = buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(relsXml, "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(coreXml, "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(appXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(worksheetXml, "utf8") }
  ]);

  return {
    content,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: sanitizeCsvFileName(`ventas_diarias_resumen_${from}_a_${to}.xlsx`)
  };
}

async function handleProductsCollection(req, res, query) {
  if (req.method === "GET") {
    sendJson(res, 200, await readProductsPage(query));
    return;
  }

  if (req.method === "POST") {
    const payload = await parseJsonBody(req);
    const item = await createProduct(payload);
    sendJson(res, 201, item);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleProductsById(req, res, id, query) {
  if (req.method === "GET") {
    const item = await readProductById(id);
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "PUT") {
    const payload = await parseJsonBody(req);
    const item = await updateProduct(id, payload);
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "DELETE") {
    const hardDelete = query?.get("hard") === "1" || query?.get("hard") === "true";
    const item = hardDelete ? await hardDeleteProduct(id) : await deleteProduct(id);
    sendJson(res, 200, item);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleProductStockIngress(req, res, id) {
  if (req.method !== "POST") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }

  const payload = await parseJsonBody(req);
  const result = await registerStockIngress(id, payload);
  sendJson(res, 200, result);
}

async function handleProductMovementsHistory(req, res, id, query) {
  if (req.method !== "GET") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }

  const items = await readProductMovementsHistory(id);
  sendJson(
    res,
    200,
    paginate(items, {
      page: query?.get("page"),
      pageSize: query?.get("pageSize") || "100"
    })
  );
}

async function handleProductPurchasePriceHistory(req, res, id, query) {
  if (req.method !== "GET") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }

  const items = await readProductPurchasePriceHistory(id);
  sendJson(
    res,
    200,
    paginate(items, {
      page: query?.get("page"),
      pageSize: query?.get("pageSize") || "100"
    })
  );
}

async function handleVentasCollection(req, res, query) {
  if (req.method === "GET") {
    const items = await readSalesAll();
    const term = normalizeText(query.get("q"));
    const from = trimValue(query.get("from"));
    const to = trimValue(query.get("to"));
    const statusFilter = normalizeText(query.get("estado") || "todos");
    const filtered = items.filter((item) => {
      if (!matchSalesShiftRange(item, from, to)) return false;
      const itemStatus = normalizeText(item.ESTADO || "ACTIVA");
      const matchesStatus = !statusFilter || statusFilter === "todos" || itemStatus === statusFilter;
      if (!matchesStatus) return false;
      if (!term) return true;
      return (
        normalizeText(item.DIA_TURNO || "").includes(term) ||
        normalizeText(item.NOMBRE).includes(term) ||
        String(item["N°"]).includes(term) ||
        String(item.FECHA_VENTA || "").includes(term) ||
        String(item.FECHA_OPERATIVA || "").includes(term) ||
        normalizeText(item.ESTADO || "ACTIVA").includes(term) ||
        String(item.CANTIDAD).includes(term) ||
        normalizeText(item.TIPO_PAGO).includes(term)
      );
    });
    const sorted = sortItems(filtered, {
      sortBy: trimValue(query.get("sortBy") || ""),
      sortDir: query.get("sortDir"),
      defaultSortBy: "FECHA_OPERATIVA",
      defaultSortDir: "desc",
      allowed: {
        FECHA_VENTA: (item) =>
          parseLocalSaleDateTime(item.FECHA_REFERENCIA || item.FECHA_VENTA || item.FECHA_OPERATIVA)?.getTime() || 0,
        DIA_TURNO: (item) => trimValue(item.DIA_TURNO || ""),
        FECHA_OPERATIVA: (item) =>
          parseLocalSaleDateTime(item.FECHA_REFERENCIA || item.FECHA_OPERATIVA || item.FECHA_VENTA)?.getTime() || 0,
        "N°": (item) => toInt(item["N°"], 0),
        NOMBRE: (item) => trimValue(item.NOMBRE || ""),
        CANTIDAD: (item) => toNumber(item.CANTIDAD, 0),
        PRECIO: (item) => toNumber(item.PRECIO, 0),
        TOTAL: (item) => toNumber(item.TOTAL, 0),
        TIPO_PAGO: (item) => trimValue(item.TIPO_PAGO || ""),
        ORIGEN: (item) => trimValue(item.ORIGEN || ""),
        ESTADO: (item) => trimValue(item.ESTADO || "ACTIVA"),
        ID_VENTA: (item) => toInt(item.ID_VENTA, 0)
      }
    });
    sendJson(
      res,
      200,
      paginate(sorted, {
        page: query.get("page"),
        pageSize: query.get("pageSize")
      })
    );
    return;
  }

  if (req.method === "POST") {
    const payload = await parseJsonBody(req);
    const isBatch = Array.isArray(payload?.items) && payload.items.length > 0;
    const result = isBatch ? await registerSaleBatch(payload) : await registerSale(payload);
    if (isBatch) {
      logInfo("Venta compuesta registrada", {
        salesCount: Array.isArray(result?.sales) ? result.sales.length : 0,
        total: result?.total ?? null,
        tipoPago: result?.tipoPago || null,
        origen: result?.origen || null
      });
    } else {
      logInfo("Venta registrada", {
        productId: result.sale["N°"],
        cantidad: result.sale.CANTIDAD,
        fecha: result.sale.FECHA_VENTA,
        saleId: result.sale.ID_VENTA,
        kardexId: result?.movement?.ID_MOV || null
      });
    }
    sendJson(res, 201, result);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleVentasById(req, res, id) {
  if (req.method === "PUT") {
    const payload = await parseJsonBody(req);
    const result = await updateSale(id, payload);
    logInfo("Venta actualizada", {
      saleId: result.sale.ID_VENTA,
      productId: result.sale["N°"],
      cantidad: result.sale.CANTIDAD,
      fecha: result.sale.FECHA_VENTA
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE") {
    const result = await deleteSale(id);
    logInfo("Venta anulada", {
      saleId: result?.sale?.ID_VENTA || toInt(id, 0),
      productId: result?.product?.["N°"] || null,
      restoredStock: result?.product?.STOCK_ACTUAL ?? null,
      kardexId: result?.movement?.ID_MOV || null
    });
    sendJson(res, 200, result);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleKardexCollection(req, res, query) {
  if (req.method === "DELETE") {
    const result = await deleteAllKardexMovements();
    logInfo("Kardex reiniciado (eliminacion masiva)", {
      deletedCount: result.deletedCount
    });
    sendJson(res, 200, {
      ok: true,
      deletedCount: result.deletedCount
    });
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }

  const items = await readKardexAll();
  const term = normalizeText(query.get("q"));
  const typeFilter = normalizeKardexType(query.get("tipo")) || normalizeText(query.get("tipo"));
  const from = normalizeIsoDateOnly(query.get("from"));
  const to = normalizeIsoDateOnly(query.get("to"));
  const filtered = items.filter((item) => {
    if (!matchDateRange(extractDateOnly(item.FECHA_HORA), from, to)) return false;
    const matchesType =
      !typeFilter ||
      typeFilter === "todos" ||
      normalizeText(item.TIPO) === normalizeText(typeFilter);
    if (!matchesType) return false;
    if (!term) return true;
    return (
      String(item["N°"]).includes(term) ||
      normalizeText(item.NOMBRE).includes(term) ||
      String(item.FECHA_HORA).includes(term) ||
      normalizeText(item.REFERENCIA).includes(term) ||
      normalizeText(item.NOTA).includes(term)
    );
  });
  const sorted = sortItems(filtered, {
    sortBy: trimValue(query.get("sortBy") || ""),
    sortDir: query.get("sortDir"),
    defaultSortBy: "FECHA_HORA",
    defaultSortDir: "desc",
    allowed: {
      FECHA_HORA: (item) => trimValue(item.FECHA_HORA || ""),
      "N°": (item) => toInt(item["N°"], 0),
      NOMBRE: (item) => trimValue(item.NOMBRE || ""),
      TIPO: (item) => trimValue(item.TIPO || ""),
      CANTIDAD: (item) => toNumber(item.CANTIDAD, 0),
      STOCK_ANTES: (item) => toNumber(item.STOCK_ANTES, 0),
      STOCK_DESPUES: (item) => toNumber(item.STOCK_DESPUES, 0),
      REFERENCIA: (item) => trimValue(item.REFERENCIA || "")
    }
  });
  sendJson(
    res,
    200,
    paginate(sorted, {
      page: query.get("page"),
      pageSize: query.get("pageSize")
    })
  );
}

async function handleKardexById(req, res, id) {
  if (req.method === "DELETE") {
    const item = await deleteKardexMovement(id);
    sendJson(res, 200, item);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleOrdersCollection(req, res, query) {
  if (req.method === "GET") {
    const items = await readOrdersAll(query);
    sendJson(res, 200, items);
    return;
  }

  if (req.method === "POST") {
    const payload = await parseJsonBody(req);
    const token = extractBearerToken(req);
    const user = token ? await findCustomerByToken(token) : null;
    const item = await createOrder(payload, { usuarioId: user?.id || null });
    sendJson(res, 201, item);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleStoreDeliveryConfig(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, await readStoreDeliveryConfig());
    return;
  }

  if (req.method === "PUT") {
    await requireStaff(req);
    const payload = await parseJsonBody(req);
    const nextConfig = normalizeDeliveryConfig(payload);
    if (hasStoreDeliveryLocation(nextConfig) && !isInsideArequipaCoverage(nextConfig.store)) {
      sendJson(res, 400, { error: "La tienda debe ubicarse dentro de Arequipa." });
      return;
    }
    sendJson(res, 200, await writeStoreDeliveryConfig(nextConfig));
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

async function handleDeliveryQuote(req, res) {
  if (req.method !== "POST") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }
  const payload = await parseJsonBody(req);
  const config = await readStoreDeliveryConfig();
  const quote = calculateDeliveryQuote(config, {
    latitud: payload?.latitud ?? payload?.lat,
    longitud: payload?.longitud ?? payload?.lng
  });
  sendJson(res, quote.available ? 200 : 400, quote);
}

const STOREFRONT_STATUS_MAP = {
  todos: null,
  pendientes: ["PENDIENTE"],
  en_camino: ["EN_CAMINO", "ENVIADO", "EN CAMINO"],
  entregados: ["ENTREGADO", "COMPLETADO"],
  cancelados: ["CANCELADO"]
};

async function handleStorefrontMyOrders(req, res, query) {
  if (req.method !== "GET") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }
  const token = extractBearerToken(req);
  const user = token ? await findCustomerByToken(token) : null;
  if (!user) {
    sendText(res, 401, "Sesión requerida.");
    return;
  }
  const statusKey = String(query?.get("estado") || "todos").toLowerCase();
  const statusList = STOREFRONT_STATUS_MAP[statusKey] || null;
  const all = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
  const mine = all
    .filter((order) => Number(order.usuarioId) === Number(user.id))
    .filter((order) => (statusList ? statusList.includes(String(order.status || "").toUpperCase()) : true))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  sendJson(res, 200, mine);
}

async function handleStorefrontMyOrderById(req, res, codigo) {
  const token = extractBearerToken(req);
  const user = token ? await findCustomerByToken(token) : null;
  if (!user) {
    sendText(res, 401, "Sesión requerida.");
    return;
  }
  const target = trimValue(codigo || "");
  if (!target) {
    sendText(res, 400, "Falta el código del pedido.");
    return;
  }
  const all = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
  const order = all.find(
    (entry) => orderMatchesCode(entry, target) && Number(entry.usuarioId) === Number(user.id)
  );
  if (!order) {
    sendText(res, 404, "Pedido no encontrado.");
    return;
  }
  if (req.method === "GET") {
    sendJson(res, 200, order);
    return;
  }
  sendText(res, 405, "Metodo no permitido.");
}

async function handlePublicOrderById(req, res, codigo) {
  if (req.method !== "GET") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }
  const target = trimValue(codigo || "");
  if (!target) {
    sendText(res, 400, "Falta el código del pedido.");
    return;
  }
  const all = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
  const order = all.find((entry) => orderMatchesCode(entry, target));
  if (!order) {
    sendText(res, 404, "Pedido no encontrado.");
    return;
  }
  sendJson(res, 200, buildPublicOrderShape(order));
}

async function handleStorefrontRepeatOrder(req, res, codigo) {
  if (req.method !== "POST") {
    sendText(res, 405, "Metodo no permitido.");
    return;
  }
  const token = extractBearerToken(req);
  const user = token ? await findCustomerByToken(token) : null;
  if (!user) {
    sendText(res, 401, "Sesión requerida.");
    return;
  }
  const target = trimValue(codigo || "");
  const all = (await readOrdersStore()).map((entry) => buildOrderApiShape(entry));
  const order = all.find(
    (entry) => orderMatchesCode(entry, target) && Number(entry.usuarioId) === Number(user.id)
  );
  if (!order) {
    sendText(res, 404, "Pedido no encontrado.");
    return;
  }
  sendJson(res, 200, { items: order.items });
}

async function handleOrdersById(req, res, id) {
  if (req.method === "GET") {
    const items = await readOrdersStore();
    const item = items
      .map((entry) => buildOrderApiShape(entry))
      .find((entry) => trimValue(entry.id || "") === trimValue(id || ""));
    if (!item) throw createHttpError(404, "Pedido no encontrado.");
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "PATCH") {
    const payload = await parseJsonBody(req);
    const item = await updateOrder(id, payload);
    sendJson(res, 200, item);
    return;
  }

  sendText(res, 405, "Metodo no permitido.");
}

const API_OBJECT_ROUTE_HANDLERS = [
  createOrdersObjectServer({
    sendText,
    sendJson,
    handleOrdersCollection,
    handleOrdersById,
    handleStorefrontMyOrders,
    handleStorefrontMyOrderById,
    handlePublicOrderById,
    handleStorefrontRepeatOrder,
    requireStaff
  }),
  createAiObjectServer({
    sendText,
    sendJson,
    analyzeReceiptImage,
    requireStaff
  }),
  createVentasObjectServer({
    sendText,
    sendJson,
    readSalesAll,
    handleVentasCollection,
    handleVentasById,
    buildDailySalesExportCsvWithFallback,
    buildDailySalesExportStyledSpreadsheet,
    buildDailySalesExportXlsx,
    appendLog,
    normalizeText,
    requireStaff
  }),
  createDbObjectServer({
    sendText,
    sendJson,
    getDbStatus,
    getDbAccessHostStatus,
    getRuntimeStatus,
    logInfo,
    requireStaff
  }),
  createAuthObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    requestCustomerOtp,
    verifyCustomerOtp,
    registerCustomer,
    loginCustomer,
    resetCustomerPassword,
    logoutCustomer,
    findCustomerByToken,
    verifyCustomerAdultStatus,
    extractBearerToken
  }),
  createDireccionesObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listDireccionesByUser,
    createDireccion,
    updateDireccion,
    deleteDireccion,
    setDireccionPrincipal,
    getDireccionById
  }),
  createFavoritosObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listFavoritosByUser,
    listFavoritoIdsByUser,
    addFavorito,
    removeFavoritoById,
    removeFavoritoByRef
  }),
  createCombosObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    listCombosActivos,
    createCombo,
    updateCombo,
    deleteCombo,
    getComboBySlug,
    requireStaff
  }),
  createPromosObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    listPromosActivas,
    getPromoDestacada,
    validarPromoCodigo
  }),
  createCouponsObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    listCouponsAll,
    saveCoupon,
    deleteCoupon,
    validateCouponForDelivery,
    requireStaff
  }),
  createMetodosPagoObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listMetodosPagoByUser,
    createMetodoPago,
    deleteMetodoPago,
    setMetodoPagoPrincipal
  }),
  createNotificacionesObjectServer({
    sendText,
    sendJson,
    requireCustomer,
    listNotificacionesByUser,
    countUnreadNotificaciones,
    markNotificacionLeida,
    markAllNotificacionesLeidas
  }),
  createReferidosObjectServer({
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    getReferidoInfo,
    listInvitacionesByUser,
    createInvitacionManual
  }),
  createCuentaObjectServer({
    sendText,
    sendJson,
    requireCustomer,
    buildCuentaResumen
  }),
  createProductosObjectServer({
    sendText,
    sendJson,
    readProductsAll,
    readProductsStorefront,
    readProductImageByHash,
    readProductImageByProductId,
    readProductById,
    getProductCategories,
    getProductStats,
    handleProductsCollection,
    handleProductsById,
    handleProductStockIngress,
    handleProductMovementsHistory,
    handleProductPurchasePriceHistory,
    requireStaff
  }),
  createKardexObjectServer({
    sendText,
    sendJson,
    readKardexAll,
    handleKardexCollection,
    handleKardexById,
    requireStaff
  })
];

const GEO_ACCESS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const geoAccessCache = new Map();

function getAllowedCountryCodes() {
  return new Set(
    String(process.env.GEO_ALLOWED_COUNTRIES || "PE,FR")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^[A-Z]{2}$/.test(value))
  );
}

function normalizeClientIp(value) {
  let ip = String(value || "").split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  return ip;
}

function getClientIp(req) {
  return normalizeClientIp(
    req?.headers?.["x-forwarded-for"] ||
    req?.headers?.["x-real-ip"] ||
    req?.socket?.remoteAddress ||
    ""
  );
}

function isPrivateClientIp(ip) {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const match = ip.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^(fc|fd|fe80):/i.test(ip);
}

function requestCountryByIp(ip) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: "api.country.is",
      path: `/${encodeURIComponent(ip)}`,
      headers: { Accept: "application/json", "User-Agent": "LaLicoreria/1.0" },
      timeout: 4500
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 4096) body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GeoIP respondió ${response.statusCode}.`));
          return;
        }
        try {
          const payload = JSON.parse(body);
          const country = trimValue(payload?.country || "").toUpperCase();
          if (!/^[A-Z]{2}$/.test(country)) throw new Error("País no válido.");
          resolve(country);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("GeoIP agotó el tiempo de espera.")));
    request.on("error", reject);
  });
}

async function resolveCountryAccess(req) {
  const ip = getClientIp(req);
  const allowedCountries = [...getAllowedCountryCodes()];
  if (isPrivateClientIp(ip)) {
    return { allowed: true, country: "LOCAL", allowedCountries, source: "local" };
  }
  const cached = geoAccessCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const country = await requestCountryByIp(ip);
    const value = {
      allowed: getAllowedCountryCodes().has(country),
      country,
      allowedCountries,
      source: "ip"
    };
    geoAccessCache.set(ip, { value, expiresAt: Date.now() + GEO_ACCESS_CACHE_TTL_MS });
    return value;
  } catch (error) {
    return {
      allowed: false,
      country: "",
      allowedCountries,
      source: "unverified",
      message: "No pudimos verificar tu país en este momento."
    };
  }
}

async function handleApi(req, res, pathname, query) {
  if (pathname === "/api/geo/access" || pathname === "/api/geo/access/") {
    if (req.method !== "GET") {
      sendText(res, 405, "Método no permitido.");
      return true;
    }
    sendJson(res, 200, await resolveCountryAccess(req));
    return true;
  }
  if (pathname === "/api/store-delivery-config" || pathname === "/api/store-delivery-config/") {
    await handleStoreDeliveryConfig(req, res);
    return true;
  }
  if (pathname === "/api/delivery/quote" || pathname === "/api/delivery/quote/") {
    await handleDeliveryQuote(req, res);
    return true;
  }
  for (const handler of API_OBJECT_ROUTE_HANDLERS) {
    if (await handler(req, res, pathname, query)) {
      return true;
    }
  }
  return false;
}

async function createServer() {
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const elapsedMs = Date.now() - startedAt;
      const level = res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
      appendLog(level, "HTTP request", {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        elapsedMs
      }).catch(() => {});
    });

    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname.startsWith("/api/")) {
        setApiCorsHeaders(req, res);
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (pathname !== "/api/geo/access" && pathname !== "/api/geo/access/") {
          const geoAccess = await resolveCountryAccess(req);
          if (!geoAccess.allowed) {
            sendJson(res, 451, {
              error: "Lo sentimos, no te encuentras en un país con cobertura.",
              code: "COUNTRY_NOT_SUPPORTED",
              country: geoAccess.country,
              allowedCountries: geoAccess.allowedCountries
            });
            return;
          }
        }

        const handled = await handleApi(req, res, pathname, requestUrl.searchParams);
        if (!handled) {
          sendJson(res, 404, { error: "No encontrado." });
        }
        return;
      }

      await serveStatic(req, res, pathname);
    } catch (error) {
      const statusCode = Number.isInteger(error?.status) ? error.status : 500;
      const message = trimValue(error?.message || "Error interno del servidor.");
      if (statusCode >= 500) {
        logError("Request fallo", {
          method: req.method,
          url: req.url,
          message
        });
      } else {
        logWarn("Request validacion", {
          method: req.method,
          url: req.url,
          message
        });
      }

      if (req.url && String(req.url).startsWith("/api/")) {
        setApiCorsHeaders(req, res);
        sendJson(res, statusCode, { error: message });
      } else {
        sendText(res, statusCode, message);
      }
    }
  });

  return server;
}

async function start() {
  try {
    await resetSessionLog();
    await appendLog("INFO", "Inicializando servidor", { host: HOST, port: PORT });

    const server = await createServer();
    server.listen(PORT, HOST, async () => {
      await appendLog("INFO", "Servidor listo", {
        url: `http://${HOST}:${PORT}`,
        defaultCsvPath: path.join(ROOT_DIR, "productos.csv"),
        activeCsvPath: path.join(ROOT_DIR, "productos.csv"),
        ventasCsvPath: path.join(ROOT_DIR, "ventas_diarias.csv"),
        kardexCsvPath: path.join(ROOT_DIR, "kardex.csv"),
        logPath: LAST_SESSION_LOG_PATH
      });
      console.log(`Servidor listo en http://${HOST}:${PORT}`);
    });
  } catch (error) {
    const message = trimValue(error?.message || "No se pudo iniciar servidor.");
    try {
      await appendLog("ERROR", "Fallo al iniciar servidor", { message });
    } catch {
      // noop
    }
    console.error(message);
    process.exitCode = 1;
  }
}

start();
