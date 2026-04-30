const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const https = require("https");
const mysql = require("mysql2/promise");

const {
  nowIso,
  trimValue,
  toNumber,
  toInt,
  round2,
  safeStringify
} = require("../custom-functions");
const { createAiObjectServer } = require("../objects/ai/server");
const { createDbObjectServer } = require("../objects/db/server");
const { createProductosObjectServer } = require("../objects/productos/server");
const { createVentasObjectServer } = require("../objects/ventas/server");
const { createKardexObjectServer } = require("../objects/kardex/server");
const csvDb = require("../../productos_db");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const PROJECT_DIR = path.resolve(__dirname, "../..");
const ROOT_DIR = path.resolve(__dirname, "../../..");
const STATIC_ROOT = PROJECT_DIR;
const PRODUCT_IMAGE_UPLOAD_DIR = path.join(PROJECT_DIR, "uploads", "product-images");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const LAST_SESSION_LOG_PATH = path.join(LOG_DIR, "last_session.log");
const ENV_FILE_PATH = path.join(PROJECT_DIR, ".env");

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
const PRODUCT_CATEGORIES = new Set([
  "AGUA",
  "CERVEZA",
  "CIGARRO",
  "COCTEL",
  "ENERGIZANTE",
  "ESPUMANTE",
  "GASEOSA",
  "GIN",
  "HIELO",
  "JUGO",
  "LICOR",
  "PISCO",
  "RON",
  "SNACK",
  "TEQUILA",
  "VINO",
  "VODKA",
  "WHISKY",
  "ACCESORIO",
  "OTRO"
]);

function normalizeProductCategoryValue(value) {
  const clean = trimValue(value || "OTRO")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = PRODUCT_CATEGORY_ALIASES.get(clean) || clean || "OTRO";
  return PRODUCT_CATEGORIES.has(normalized) ? normalized : "OTRO";
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
    "SELECT id, nombre, categoria, precio, precio_compra, pedido, stock_actual, estado FROM productos FOR UPDATE"
  );
  return buildProductStateMap(rows);
}

function applyProductSaleToState(productStateMap, productId, quantity) {
  const product = productStateMap.get(productId);
  if (!product) throw createHttpError(404, `No existe producto con N° ${productId}.`);

  const status = normalizeProductStatus(product.estado) || "ACTIVO";
  if (status !== "ACTIVO") {
    throw createHttpError(409, `No puedes vender N° ${productId} porque está INACTIVO.`);
  }

  const stockBefore = round2(product.stock_actual);
  const cigaretteRule = getCigaretteAutoOpenRule(product.nombre);
  if (!cigaretteRule?.isUnit) {
    if (stockBefore < quantity) {
      throw createHttpError(
        400,
        `Stock insuficiente para N° ${productId}. Disponible: ${stockBefore}, solicitado: ${quantity}.`
      );
    }
    const stockAfter = round2(stockBefore - quantity);
    product.stock_actual = stockAfter;
    return {
      product,
      stockBefore,
      stockAfter,
      saleStockBefore: stockBefore,
      price: round2(product.precio),
      total: round2(round2(product.precio) * quantity),
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
  while (round2(workingUnits - quantity) <= 0) {
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
  const stockAfter = round2(saleStockBefore - quantity);
  product.stock_actual = stockAfter;
  boxProduct.stock_actual = workingBoxes;

  return {
    product,
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
    if (round2(original.stock_actual) === round2(current.stock_actual)) continue;
    await connection.query("UPDATE productos SET stock_actual = ? WHERE id = ?", [round2(current.stock_actual), productId]);
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
  const directParsed = toInt(directValue, 0);
  if (directParsed > 0) return directParsed;

  for (const [key, value] of Object.entries(row)) {
    const compactKey = normalizeText(key).replace(/[^a-z0-9]/g, "");
    if (["n", "na", "no", "nro", "numero", "productid", "productoid", "productoid", "productoid"].includes(compactKey)) {
      const parsed = toInt(value, 0);
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
          trimValue(item.original_image_url ?? item.originalImageUrl ?? item.original ?? item.url ?? item.src ?? ""),
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
    .slice(0, 4);
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
  const stockMinimo = round2(Math.max(0, toNumber(base?.STOCK_MINIMO ?? base?.stock_minimo, 0)));
  const stockMaximo = round2(Math.max(0, toNumber(base?.STOCK_MAXIMO ?? base?.stock_maximo ?? base?.PEDIDO ?? base?.pedido, 0)));
  const stockActual = round2(Math.max(0, toNumber(base?.STOCK_ACTUAL ?? base?.stock_actual, 0)));
  const images = normalizeProductImages(base?.IMAGENES ?? base?.imagenes ?? base?.imagenes_json);
  const alert = buildProductAlert(stockActual, stockMinimo, stockMaximo);
  return {
    "N°": productId,
    productId,
    NOMBRE: trimValue(base?.NOMBRE ?? base?.nombre ?? ""),
    DESCRIPCION: trimValue(base?.DESCRIPCION ?? base?.descripcion ?? base?.descripción ?? ""),
    CATEGORIA: normalizeProductCategoryValue(base?.CATEGORIA ?? base?.categoria ?? "OTRO"),
    PRECIO: round2(base?.PRECIO ?? base?.precio),
    PRECIO_COMPRA: round2(Math.max(0, toNumber(base?.PRECIO_COMPRA ?? base?.precio_compra, 0))),
    IMAGENES: images,
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
    connectTimeout: 5000,
    dateStrings: true
  });
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

  const connection = await openMysqlConnection(config);
  try {
    return await executor(connection, config);
  } finally {
    try {
      await connection.end();
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

function setApiCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

function staticPathFromRequestPath(requestPath) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(path.join(STATIC_ROOT, pathname));
  if (!safePath.startsWith(STATIC_ROOT)) return null;
  return safePath;
}

async function serveStatic(req, res, requestPath) {
  const filePath = staticPathFromRequestPath(requestPath);
  if (!filePath) {
    sendText(res, 403, "Acceso denegado.");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      sendText(res, 404, "No encontrado.");
      return;
    }

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
  } catch {
    sendText(res, 404, "No encontrado.");
  }
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

async function withDataSourceFallback(operationName, mysqlExecutor, localExecutor) {
  try {
    return await mysqlExecutor();
  } catch (error) {
    if (!shouldUseLocalCsvFallback(error)) throw error;
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
    map.set(productId, list.slice(0, 4));
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
    await connection.query(
      `INSERT INTO producto_imagenes
        (producto_id, orden, es_portada, original_webp_url, thumb_webp_url, mime, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        index,
        index === 0 ? 1 : 0,
        image.original_webp_url || image.filtered_image_url || image.original_image_url || null,
        image.thumb_webp_url || image.filtered_image_url || image.original_webp_url || image.original_image_url || null,
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
        const [rows] = await connection.query(
          includeImages
            ? "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_minimo, stock_actual, estado FROM productos ORDER BY id ASC"
            : "SELECT id, nombre, descripcion, categoria, precio, precio_compra, pedido, stock_minimo, stock_actual, estado FROM productos ORDER BY id ASC"
        );
        const safeRows = Array.isArray(rows) ? rows : [];
        const imagesMap = includeImages ? await readProductImagesMap(connection, safeRows.map((row) => row.id)) : new Map();
        return safeRows.map((row) => {
          const tableImages = imagesMap.get(toInt(row.id, 0)) || [];
          return buildProductApiShape({
            ...row,
            IMAGENES: tableImages.length ? tableImages : undefined,
            imagenes_json: includeImages ? (tableImages.length ? JSON.stringify(tableImages) : row.imagenes_json) : undefined
          });
        });
      }),
    async () => {
      const rows = await csvDb.readProducts();
      return rows.map(csvProductToApi);
    }
  );
}

async function readProductsPage(query) {
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
          `SELECT id, nombre, descripcion, categoria, precio, precio_compra, pedido, stock_minimo, stock_actual, estado
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
      const items = await readProductsAll();
      const term = normalizeText(query.get("q"));
      const pedidoFilter = normalizeText(query.get("pedido") || "todos");
      const statusFilter = normalizeText(query.get("estado") || "todos");
      const filtered = items.filter((item) => {
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
      return paginate(sorted, {
        page: query.get("page"),
        pageSize: query.get("pageSize")
      });
    }
  );
}

async function readProductById(idInput) {
  const id = parsePositiveInt(idInput, "N°");
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
        const [rows] = await connection.query(
          "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? LIMIT 1",
          [id]
        );
        const row = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!row) throw createHttpError(404, `No existe producto con N° ${id}.`);
        const imagesMap = await readProductImagesMap(connection, [id]);
        const tableImages = imagesMap.get(id) || [];
        return buildProductApiShape({
          ...row,
          IMAGENES: tableImages.length ? tableImages : undefined,
          imagenes_json: tableImages.length ? JSON.stringify(tableImages) : row.imagenes_json
        });
      }),
    async () => {
      const items = await readProductsAll();
      const item = items.find((row) => resolveProductIdValue(row) === id);
      if (!item) throw createHttpError(404, `No existe producto con N° ${id}.`);
      return item;
    }
  );
}

async function readSalesAll() {
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

async function readKardexAll() {
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
  const products = await readProductsAll();
  const activeProducts = products.filter((item) => String(item?.ESTADO || "ACTIVO").toUpperCase() === "ACTIVO");
  return {
    total: products.length,
    conPedido: activeProducts.filter((item) => toNumber(item.STOCK_MAXIMO ?? item.PEDIDO, 0) > 0).length,
    stockTotal: round2(activeProducts.reduce((acc, item) => acc + toNumber(item.STOCK_ACTUAL, 0), 0)),
    lowStockCount: activeProducts.filter((item) => String(item.ALERTA_STOCK || "").toUpperCase() !== "OK").length
  };
}

async function createProduct(payload) {
  return withDataSourceFallback(
    "createProduct",
    () => withMysqlConnection(async (connection) => {
    await ensureProductMinimumStockColumn(connection);
    await ensureProductPurchasePriceColumn(connection);
    await ensureProductImagesColumn(connection);
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
    const stock = parseNonNegativeInteger(
      payload.STOCK_ACTUAL ?? payload.stockActual ?? payload.stock_actual ?? payload.stock ?? 0,
      "STOCK_ACTUAL"
    );
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
        "INSERT INTO productos (id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_actual, stock_minimo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, name, description || null, category, price, purchasePrice, JSON.stringify(productImages), stockMaximo, stock, stockMinimo, status]
      );
      await replaceProductImages(connection, id, productImages);

      let purchasePriceHistory = null;
      if (purchasePrice > 0) {
        purchasePriceHistory = await appendPurchasePriceHistory(connection, {
          productId: nextId,
          productName: name,
          purchasePrice,
          note: "Precio de compra inicial",
          source: "CREACION_PRODUCTO"
        });
      }

      let movement = null;
      if (stock > 0) {
        movement = await insertKardexMovement(connection, {
          productId: nextId,
          nombre: name,
          tipo: "INGRESO",
          cantidad: stock,
          stockAntes: 0,
          stockDespues: stock,
          referencia: "CREACION_PRODUCTO",
          nota: "Stock inicial"
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
          imagenes_json: JSON.stringify(productImages),
          pedido: stockMaximo,
          stock_minimo: stockMinimo,
          stock_actual: stock,
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
    async () => csvProductToApi(await csvDb.createProduct(payload))
  );
}

async function updateProduct(idInput, payload) {
  const id = parsePositiveInt(idInput, "N°");
  return withDataSourceFallback(
    "updateProduct",
    () => withMysqlConnection(async (connection) => {
    await ensureProductMinimumStockColumn(connection);
    await ensureProductPurchasePriceColumn(connection);
    await ensureProductImagesColumn(connection);
    await ensureProductImagesTable(connection);
    await ensureProductDescriptionColumn(connection);
    await ensureProductCategoryColumn(connection);
    await ensureProductPurchasePriceHistoryTable(connection);
    await connection.beginTransaction();
    let foreignKeyChecksDisabled = false;
    try {
      const [rows] = await connection.query(
        "SELECT id, nombre, descripcion, categoria, precio, precio_compra, imagenes_json, pedido, stock_minimo, stock_actual, estado FROM productos WHERE id = ? FOR UPDATE",
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
        "UPDATE productos SET nombre = ?, descripcion = ?, categoria = ?, precio = ?, precio_compra = ?, imagenes_json = ?, pedido = ?, stock_actual = ?, stock_minimo = ?, estado = ? WHERE id = ?",
        [name, description || null, category, price, purchasePrice, JSON.stringify(productImages), stockMaximo, stockBase, stockMinimo, status, nextId]
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
          imagenes_json: JSON.stringify(productImages),
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
    async () => csvProductToApi(await csvDb.updateProduct(id, payload))
  );
}

async function deleteProduct(idInput) {
  const id = parsePositiveInt(idInput, "N°");
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
    async () => ({ ...csvProductToApi(await csvDb.deleteProduct(id)), ESTADO: "INACTIVO" })
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
    async () => csvProductToApi(await csvDb.deleteProduct(id))
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
      return {
        product: csvProductToApi(result.product),
        movement: csvKardexToApi(result.movement)
      };
    }
  );
}

async function registerSale(payload) {
  return withDataSourceFallback(
    "registerSale",
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
    const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN);
    const note = trimValue(payload.nota || payload.NOTA || "");

    await ensureSalesPaymentDetailColumn(connection);
    await connection.beginTransaction();
    try {
      const beforeStateMap = await loadLockedProductStateMap(connection);
      const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
      const salePlan = applyProductSaleToState(stateMap, productId, quantity);
      const product = salePlan.product;
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
          truncateText(product.nombre, 180),
          quantity,
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
              cantidad: quantity,
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
        nombre: product.nombre,
        tipo: "SALIDA",
        cantidad: quantity,
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
      return {
        sale: csvSaleToApi(result.sale),
        product: csvProductToApi(result.product),
        movement: csvKardexToApi(result.movement)
      };
    }
  );
}

async function registerSaleBatch(payload) {
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
        const quantity = parseNonNegativeNumber(row?.cantidad ?? row?.CANTIDAD, "cantidad");
        if (quantity <= 0) throw createHttpError(400, "La cantidad de venta debe ser mayor a 0.");
        const prev = aggregated.get(productId) || 0;
        aggregated.set(productId, round2(prev + quantity));
      }
      const items = Array.from(aggregated.entries()).map(([productId, cantidad]) => ({ productId, cantidad }));

      await connection.beginTransaction();
      try {
        const beforeStateMap = await loadLockedProductStateMap(connection);
        const stateMap = buildProductStateMap(Array.from(beforeStateMap.values()));
        const products = [];
        for (const item of items) {
          products.push({
            item,
            ...applyProductSaleToState(stateMap, item.productId, item.cantidad)
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
              truncateText(row.product.nombre, 180),
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
                nombre: row.product.nombre,
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
  const envValues = await readEnvValuesQuiet();
  const config = buildDbConfig(envValues, "status");

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

  const catalogProducts = (await csvDb.readProducts()).map((row) => ({
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

const API_OBJECT_ROUTE_HANDLERS = [
  createAiObjectServer({
    sendText,
    sendJson,
    analyzeReceiptImage
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
    normalizeText
  }),
  createDbObjectServer({
    sendText,
    sendJson,
    getDbStatus,
    getDbAccessHostStatus,
    logInfo
  }),
  createProductosObjectServer({
    sendText,
    sendJson,
    readProductsAll,
    readProductById,
    getProductStats,
    handleProductsCollection,
    handleProductsById,
    handleProductStockIngress,
    handleProductMovementsHistory,
    handleProductPurchasePriceHistory
  }),
  createKardexObjectServer({
    sendText,
    sendJson,
    readKardexAll,
    handleKardexCollection,
    handleKardexById
  })
];

async function handleApi(req, res, pathname, query) {
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
        setApiCorsHeaders(res);
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
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
        setApiCorsHeaders(res);
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
