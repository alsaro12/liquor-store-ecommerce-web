const fs = require("fs/promises");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const BASE_CSV_PATH = path.join(ROOT_DIR, "inventario_inicio_grecia.csv");
const DEFAULT_PRODUCTS_CSV_PATH = path.join(ROOT_DIR, "productos.csv");
const VENTAS_CSV_PATH = path.join(ROOT_DIR, "ventas_diarias.csv");
const KARDEX_CSV_PATH = path.join(ROOT_DIR, "kardex.csv");
const PURCHASE_PRICE_HISTORY_CSV_PATH = path.join(ROOT_DIR, "productos_precios_historial.csv");
const SOURCE_CONFIG_PATH = path.join(ROOT_DIR, ".productos_source.json");
const SOURCES_DIR = path.join(ROOT_DIR, "csv_sources");

const PRODUCT_HEADERS = [
  "N°",
  "NOMBRE",
  "DESCRIPCION",
  "CATEGORIA",
  "PRECIO",
  "PRECIO_COMPRA",
  "IMAGENES",
  "VARIANTES",
  "STOCK_MAXIMO",
  "STOCK_MINIMO",
  "STOCK_ACTUAL",
  "ESTADO"
];
const VENTAS_HEADERS = [
  "ID_VENTA",
  "FECHA",
  "N°",
  "NOMBRE",
  "CANTIDAD",
  "PRECIO",
  "TOTAL",
  "TIPO_PAGO",
  "TIPO_PAGO_DETALLE",
  "ORIGEN"
];
const KARDEX_HEADERS = [
  "ID_MOV",
  "FECHA_HORA",
  "N°",
  "NOMBRE",
  "TIPO",
  "CANTIDAD",
  "STOCK_ANTES",
  "STOCK_DESPUES",
  "REFERENCIA",
  "NOTA"
];
const PURCHASE_PRICE_HISTORY_HEADERS = [
  "ID_HISTORIAL",
  "FECHA_HORA",
  "N°",
  "NOMBRE",
  "PRECIO_COMPRA",
  "NOTA",
  "ORIGEN"
];

const VALID_MONTHS = new Set(["SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE"]);
const PAYMENT_TYPES = ["Efectivo", "Yape", "Pedido Ya", "Rappi", "IZIPAY"];

function buildError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function trimValue(value) {
  return String(value ?? "").trim();
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
const PRODUCT_CATEGORY_LABELS = [
  "Whisky",
  "Ron",
  "Vodka",
  "Gin",
  "Tequila",
  "Pisco",
  "Vinos",
  "Espumantes",
  "Cervezas",
  "Cremas y Aperitivos",
  "Bebidas Preparadas (RTD)",
  "Energizantes",
  "Gaseosas y Mixers",
  "Aguas",
  "Hielo",
  "Snacks"
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
  ["VINO", "Vinos"],
  ["ESPUMANTE", "Espumantes"],
  ["ESPUMANTES", "Espumantes"],
  ["CHAMPAGNE", "Espumantes"],
  ["ESPUMANTES Y CHAMPAGNE", "Espumantes"],
  ["CERVEZA", "Cervezas"],
  ["CERVEZAS", "Cervezas"],
  ["LICOR", "Cremas y Aperitivos"],
  ["LICORES", "Cremas y Aperitivos"],
  ["CREMAS", "Cremas y Aperitivos"],
  ["APERITIVOS", "Cremas y Aperitivos"],
  ["LICORES Y CREMAS", "Cremas y Aperitivos"],
  ["COCTEL", "Bebidas Preparadas (RTD)"],
  ["COCTELES", "Bebidas Preparadas (RTD)"],
  ["RTD", "Bebidas Preparadas (RTD)"],
  ["BEBIDAS PREPARADAS", "Bebidas Preparadas (RTD)"],
  ["RTD Y BEBIDAS PREPARADAS", "Bebidas Preparadas (RTD)"],
  ["ENERGIZANTE", "Energizantes"],
  ["GASEOSA", "Gaseosas y Mixers"],
  ["GASEOSAS", "Gaseosas y Mixers"],
  ["MIXERS", "Gaseosas y Mixers"],
  ["AGUA", "Aguas"],
  ["AGUAS", "Aguas"],
  ["AGUAS Y COMPLEMENTOS", "Aguas"],
  ["COMPLEMENTOS", "Aguas"],
  ["HIELOS", "Hielo"],
  ["SNACK", "Snacks"],
  ["SNACKS", "Snacks"],
  ["SNACKS Y PICOTEO", "Snacks"],
  ["PICOTEO", "Snacks"],
  ["OTRO", "Cremas y Aperitivos"],
  ["OTROS", "Cremas y Aperitivos"]
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
  return PRODUCT_CATEGORIES.has(normalized) ? normalized : "Cremas y Aperitivos";
}

function normalizeProductStatus(value) {
  const clean = trimValue(value || "ACTIVO")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return clean === "INACTIVO" ? "INACTIVO" : "ACTIVO";
}

function normalizeVariantList(value) {
  let variants = [];
  if (Array.isArray(value)) {
    variants = value;
  } else {
    const trimmed = trimValue(value);
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) variants = parsed;
      } catch {
        variants = [];
      }
    }
  }
  return variants
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const name = trimValue(item.name ?? item.NOMBRE ?? item.nombre ?? item.label);
      if (!name) return null;
      const rawId = trimValue(item.id ?? item.ID_VARIANTE ?? item.variantId ?? item.slug);
      const id = rawId || name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `variante-${index + 1}`;
      return {
        ...item,
        id,
        name,
        stock: round2(Math.max(0, parseDecimal(item.stock ?? item.STOCK_ACTUAL ?? item.stockActual ?? 0) ?? 0)),
        status: normalizeProductStatus(item.status ?? item.ESTADO ?? item.estado ?? "ACTIVO")
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

function sumVariantStock(value) {
  return round2(
    normalizeVariantList(value).reduce((acc, variant) => {
      if (variant.status === "INACTIVO") return acc;
      return acc + round2(variant.stock || 0);
    }, 0)
  );
}

function applyVariantStockSale(product, variantId, quantity) {
  const cleanVariantId = trimValue(variantId);
  if (!cleanVariantId) return { product, variantName: "" };
  const variants = normalizeVariantList(product.VARIANTES);
  const index = variants.findIndex((variant) => trimValue(variant.id) === cleanVariantId);
  if (index < 0) throw buildError(404, `No existe la variante ${cleanVariantId} para ${product.NOMBRE}.`);
  const variant = variants[index];
  if (variant.status === "INACTIVO") throw buildError(409, `La variante ${variant.name} está INACTIVA.`);
  const stockBefore = round2(variant.stock || 0);
  const stockAfter = round2(stockBefore - quantity);
  if (stockAfter < 0) {
    throw buildError(400, `Stock insuficiente para ${product.NOMBRE} - ${variant.name}. Stock actual: ${stockBefore}.`);
  }
  variants[index] = { ...variant, stock: stockAfter };
  product.VARIANTES = variants;
  return { product, variantName: variant.name };
}

function normalizeHeader(value) {
  return trimValue(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeaderKey(value) {
  return normalizeHeader(value).replace(/[^A-Z0-9]/g, "");
}

function isIdHeader(value) {
  const compact = normalizeHeader(value).replace(/\s+/g, "");
  const key = normalizeHeaderKey(value);
  return (
    compact === "N°" ||
    compact === "Nº" ||
    compact === "N" ||
    key === "N" ||
    key === "NA" ||
    key === "NO" ||
    key === "NRO" ||
    key === "NUMERO"
  );
}

function parseInteger(value) {
  const raw = trimValue(value).replace(",", ".");
  if (!raw) return null;
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function parseId(value) {
  const number = parseInteger(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function resolveIncomingProductId(row) {
  if (!row || typeof row !== "object") return null;
  const directValue =
    row.productId ??
    row.productoId ??
    row.producto_id ??
    row["N°"] ??
    row["N"] ??
    row.id ??
    row.ID ??
    row.n;
  const directParsed = parseId(directValue);
  if (directParsed) return directParsed;

  for (const [key, value] of Object.entries(row)) {
    const compactKey = normalizeHeaderKey(key);
    if (["N", "NO", "NRO", "NUMERO", "PRODUCTOID", "PRODUCTO_ID"].includes(compactKey)) {
      const parsed = parseId(value);
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseDecimal(value) {
  const raw = trimValue(value).replace(",", ".");
  if (!raw) return null;
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return null;
  return number;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseIsoDate(value) {
  const raw = trimValue(value);
  if (!raw) return null;

  const matchIso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (matchIso) return matchIso[1];

  const matchLatam = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchLatam) {
    const [, dd, mm, yyyy] = matchLatam;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function isBusinessDate(date) {
  if (!/^(\d{4})-\d{2}-\d{2}$/.test(String(date || ""))) return false;
  const year = Number(String(date).slice(0, 4));
  return year >= 2000 && year <= 2100;
}

function normalizePaymentType(value, options = {}) {
  const fallback = options.defaultValue || "Efectivo";
  const raw = trimValue(value);
  if (!raw) return fallback;

  const normalized = normalizeHeader(raw);
  if (["AYAPER", "YAPE"].includes(normalized.replace(/\s+/g, ""))) {
    return "Yape";
  }
  if (["EASY PAY", "EASYPAY", "IZIPAY", "IZI PAY", "IZI-PAY"].includes(normalized)) {
    return "IZIPAY";
  }
  const found = PAYMENT_TYPES.find((item) => normalizeHeader(item) === normalized);
  return found || fallback;
}

function normalizeSaleOrigin(value, options = {}) {
  const fallback = options.defaultValue || "MANUAL";
  const raw = trimValue(value);
  if (!raw) return fallback;
  const normalized = normalizeHeader(raw);
  if (["MANUAL", "MOSTRADOR", "PRESENCIAL", "TIENDA"].includes(normalized)) return "MANUAL";
  if (["DELIVERY", "REPARTO"].includes(normalized)) return "DELIVERY";
  if (["APP", "APLICACION", "APLICACIÓN"].includes(normalized)) return "APP";
  return raw.toUpperCase();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowIsoDateTime() {
  return new Date().toISOString();
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") continue;
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length > 0 && rows[0].length > 0) {
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  }

  return rows;
}

function stringifyCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function normalizeProductRecord(raw) {
  const id = parseId(raw["N°"] ?? raw.id ?? raw.n);
  if (!id) throw buildError(400, "El campo N° es obligatorio y debe ser un numero entero positivo.");

  const name = trimValue(raw.NOMBRE ?? raw.nombre);
  if (!name) throw buildError(400, "El campo NOMBRE es obligatorio.");
  const description = trimValue(raw.DESCRIPCION ?? raw.descripcion ?? raw.descripción);

  const price = parseDecimal(raw.PRECIO ?? raw.precio);
  if (price === null) throw buildError(400, "El campo PRECIO es obligatorio y debe ser numerico.");
  if (price < 0) throw buildError(400, "El campo PRECIO no puede ser negativo.");

  const purchasePrice = parseDecimal(raw.PRECIO_COMPRA ?? raw.precio_compra ?? raw.precioCompra ?? 0);
  if (purchasePrice === null) throw buildError(400, "El campo PRECIO_COMPRA debe ser numerico.");
  if (purchasePrice < 0) throw buildError(400, "El campo PRECIO_COMPRA no puede ser negativo.");

  const stockMaximo = parseInteger(
    raw.STOCK_MAXIMO ?? raw.stock_maximo ?? raw.stockMaximo ?? raw.PEDIDO ?? raw.pedido ?? 0
  );
  if (stockMaximo !== null && stockMaximo < 0) {
    throw buildError(400, "El campo STOCK_MAXIMO no puede ser negativo.");
  }

  const stockActual = parseDecimal(
    raw.STOCK_ACTUAL ?? raw.stockActual ?? raw.stock_actual ?? raw.stock ?? 0
  );

  if (stockActual === null) {
    throw buildError(400, "El campo STOCK_ACTUAL debe ser numerico.");
  }

  if (stockActual < 0) {
    throw buildError(400, "El campo STOCK_ACTUAL no puede ser negativo.");
  }

  const stockMinimo = parseDecimal(
    raw.STOCK_MINIMO ?? raw.stockMinimo ?? raw.stock_minimo ?? raw.stockMin ?? 0
  );
  if (stockMinimo === null) {
    throw buildError(400, "El campo STOCK_MINIMO debe ser numerico.");
  }
  if (stockMinimo < 0) {
    throw buildError(400, "El campo STOCK_MINIMO no puede ser negativo.");
  }

  const imagesRaw = raw.IMAGENES ?? raw.imagenes ?? raw.imagenes_json ?? [];
  const images = (Array.isArray(imagesRaw) ? imagesRaw : String(imagesRaw || "").split("|"))
    .map((item) => {
      if (item && typeof item === "object") {
        const original = trimValue(item.original_image_url ?? item.originalImageUrl ?? item.original ?? item.url ?? item.src ?? "");
        const filtered = trimValue(item.filtered_image_url ?? item.filteredImageUrl ?? item.filtered ?? item.url ?? item.src ?? original);
        if (!original && !filtered) return null;
        return {
          original_image_url: original || filtered,
          filtered_image_url: filtered || original,
          status: trimValue(item.status || (filtered ? "completed" : "pending")) || "pending"
        };
      }
      const src = trimValue(item);
      if (!src) return null;
      return {
        original_image_url: src,
        filtered_image_url: src,
        status: "completed"
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  const variants = normalizeVariantList(raw.VARIANTES ?? raw.variantes ?? raw.variants ?? []);

  return {
    "N°": id,
    NOMBRE: name,
    DESCRIPCION: description,
    CATEGORIA: normalizeProductCategoryValue(raw.CATEGORIA ?? raw.categoria ?? "OTRO"),
    PRECIO: round2(price),
    PRECIO_COMPRA: round2(purchasePrice),
    IMAGENES: images,
    VARIANTES: variants,
    PEDIDO: stockMaximo ?? 0,
    STOCK_MINIMO: round2(stockMinimo),
    STOCK_ACTUAL: round2(stockActual),
    ESTADO: normalizeProductStatus(raw.ESTADO ?? raw.estado ?? raw.status ?? "ACTIVO")
  };
}

function productToRow(product) {
  return [
    product["N°"],
    product.NOMBRE,
    product.DESCRIPCION ?? "",
    product.CATEGORIA ?? "OTRO",
    product.PRECIO,
    product.PRECIO_COMPRA ?? 0,
    JSON.stringify(Array.isArray(product.IMAGENES) ? product.IMAGENES.slice(0, 3) : []),
    JSON.stringify(Array.isArray(product.VARIANTES) ? product.VARIANTES.slice(0, 60) : []),
    product.PEDIDO,
    product.STOCK_MINIMO ?? 0,
    product.STOCK_ACTUAL,
    normalizeProductStatus(product.ESTADO)
  ];
}

function saleToRow(sale) {
  const paymentDisplay = trimValue(sale.TIPO_PAGO_DETALLE || sale.TIPO_PAGO || "Efectivo") || "Efectivo";
  return [
    sale.ID_VENTA,
    sale.FECHA,
    sale["N°"],
    sale.NOMBRE,
    sale.CANTIDAD,
    sale.PRECIO,
    sale.TOTAL,
    paymentDisplay,
    paymentDisplay,
    sale.ORIGEN || "MANUAL"
  ];
}

function movementToRow(move) {
  return [
    move.ID_MOV,
    move.FECHA_HORA,
    move["N°"],
    move.NOMBRE,
    move.TIPO,
    move.CANTIDAD,
    move.STOCK_ANTES,
    move.STOCK_DESPUES,
    move.REFERENCIA || "",
    move.NOTA || ""
  ];
}

function purchasePriceHistoryToRow(item) {
  return [
    item.ID_HISTORIAL,
    item.FECHA_HORA,
    item["N°"],
    item.NOMBRE,
    item.PRECIO_COMPRA,
    item.NOTA || "",
    item.ORIGEN || ""
  ];
}

async function existsFile(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFileName(name) {
  const cleaned = trimValue(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const base = cleaned || "productos.csv";
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

function isInsideRoot(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(ROOT_DIR, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProjectPath(filePath) {
  const resolved = path.resolve(filePath);
  return isInsideRoot(resolved) ? resolved : DEFAULT_PRODUCTS_CSV_PATH;
}

function assertProjectWritePath(filePath) {
  const resolved = path.resolve(filePath);
  if (!isInsideRoot(resolved)) {
    throw buildError(500, `Ruta de escritura fuera del proyecto bloqueada: ${resolved}`);
  }
  return resolved;
}

async function readSourceConfig() {
  try {
    const raw = await fs.readFile(SOURCE_CONFIG_PATH, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function writeSourceConfig(data) {
  await fs.writeFile(SOURCE_CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function resolveConfiguredPath(inputPath) {
  const raw = trimValue(inputPath);
  if (!raw) return DEFAULT_PRODUCTS_CSV_PATH;
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
  return resolveProjectPath(resolved);
}

async function getSourceInfo() {
  return {
    activeCsvPath: DEFAULT_PRODUCTS_CSV_PATH,
    defaultCsvPath: DEFAULT_PRODUCTS_CSV_PATH,
    sourceName: "productos.csv",
    sourceType: "default",
    lockedToProject: true,
    exists: await existsFile(DEFAULT_PRODUCTS_CSV_PATH),
    configPath: SOURCE_CONFIG_PATH
  };
}

async function setActiveSourcePath(inputPath, meta = {}) {
  await writeSourceConfig({
    activeCsvPath: DEFAULT_PRODUCTS_CSV_PATH,
    sourceName: "productos.csv",
    sourceType: "default",
    lockedToProject: true,
    requestedPath: trimValue(inputPath),
    requestedSourceName: trimValue(meta.sourceName),
    requestedSourceType: trimValue(meta.sourceType),
    updatedAt: nowIsoDateTime()
  });
  return getSourceInfo();
}

async function setDefaultSource() {
  return setActiveSourcePath(DEFAULT_PRODUCTS_CSV_PATH, {
    sourceName: "productos.csv",
    sourceType: "default"
  });
}

async function loadBaseRows() {
  const raw = await fs.readFile(BASE_CSV_PATH, "utf8");
  return parseCsv(raw);
}

function findDateForSaleColumn(dateRow, saleColumnIndex) {
  for (let offset = 0; offset <= 8; offset += 1) {
    const idx = saleColumnIndex - offset;
    if (idx < 0) break;
    const parsedDate = parseIsoDate(dateRow[idx]);
    if (parsedDate) return parsedDate;
  }
  return null;
}

function extractProductsFromBaseRows(rows) {
  const productsById = new Map();
  let pedidoColumnIndex = -1;
  let cierreColumns = [];

  for (const row of rows) {
    if (!row || row.length < 4) continue;

    const month = normalizeHeader(row[0]);
    if (!VALID_MONTHS.has(month)) continue;

    if (isIdHeader(row[1])) {
      pedidoColumnIndex = row.findIndex((cell) => {
        const key = normalizeHeaderKey(cell);
        return key === "PEDIDO" || key === "STOCKMAXIMO";
      });
      cierreColumns = row
        .map((cell, index) => ({ key: normalizeHeaderKey(cell), index }))
        .filter((item) => item.key === "CIERRE")
        .map((item) => item.index);
      continue;
    }

    const id = parseId(row[1]);
    if (!id) continue;

    const name = trimValue(row[2]);
    if (!name) continue;

    const price = parseDecimal(row[3]);
    const pedido = pedidoColumnIndex >= 0 ? parseInteger(row[pedidoColumnIndex]) : null;

    let stockCandidate = null;
    for (const col of cierreColumns) {
      const value = parseDecimal(row[col]);
      if (value !== null) stockCandidate = value;
    }

    if (stockCandidate === null) {
      for (let i = row.length - 1; i >= 4; i -= 1) {
        const value = parseDecimal(row[i]);
        if (value !== null) {
          stockCandidate = value;
          break;
        }
      }
    }

    const previous = productsById.get(id);
    productsById.set(id, {
      "N°": id,
      NOMBRE: name || previous?.NOMBRE || "",
      DESCRIPCION: previous?.DESCRIPCION || "",
      PRECIO: round2(price ?? previous?.PRECIO ?? 0),
      PRECIO_COMPRA: round2(previous?.PRECIO_COMPRA ?? 0),
      IMAGENES: Array.isArray(previous?.IMAGENES) ? previous.IMAGENES.slice(0, 3) : [],
      PEDIDO: pedido ?? previous?.PEDIDO ?? 0,
      STOCK_MINIMO: round2(previous?.STOCK_MINIMO ?? 0),
      STOCK_ACTUAL: round2(Math.max(0, stockCandidate ?? previous?.STOCK_ACTUAL ?? 0))
    });
  }

  return [...productsById.values()].sort((a, b) => a["N°"] - b["N°"]);
}

function extractSalesFromBaseRows(rows) {
  if (!rows.length) return [];

  const dateRow = rows[0] || [];
  const salesByKey = new Map();
  let saleColumns = [];

  for (const row of rows) {
    if (!row || row.length < 4) continue;

    const month = normalizeHeader(row[0]);
    if (!VALID_MONTHS.has(month)) continue;

    if (isIdHeader(row[1])) {
      saleColumns = row
        .map((cell, index) => ({ key: normalizeHeaderKey(cell), index }))
        .filter((item) => item.key === "VENTADELDIA")
        .map((item) => ({
          index: item.index,
          date: findDateForSaleColumn(dateRow, item.index)
        }))
        .filter((item) => Boolean(item.date));
      continue;
    }

    const id = parseId(row[1]);
    if (!id) continue;

    const name = trimValue(row[2]);
    if (!name) continue;

    const price = round2(parseDecimal(row[3]) ?? 0);

    for (const saleCol of saleColumns) {
      const qty = parseDecimal(row[saleCol.index]);
      if (qty === null || qty <= 0) continue;

      const key = `${saleCol.date}::${id}`;
      const previous = salesByKey.get(key);
      const nextQty = round2((previous?.CANTIDAD ?? 0) + qty);

      salesByKey.set(key, {
        FECHA: saleCol.date,
        "N°": id,
        NOMBRE: name,
        CANTIDAD: nextQty,
        PRECIO: price,
        TOTAL: round2(nextQty * price),
        TIPO_PAGO: "Efectivo",
        ORIGEN: "MIGRACION_BASE"
      });
    }
  }

  const sales = [...salesByKey.values()];

  sales.sort((a, b) => {
    if (a.FECHA === b.FECHA) return a["N°"] - b["N°"];
    return a.FECHA.localeCompare(b.FECHA);
  });

  return sales.map((item, index) => ({
    ID_VENTA: index + 1,
    ...item
  }));
}

async function writeProductsToPath(products, targetPath) {
  const safeTargetPath = assertProjectWritePath(targetPath);
  const rows = [PRODUCT_HEADERS, ...products.map(productToRow)];
  await fs.mkdir(path.dirname(safeTargetPath), { recursive: true });
  await fs.writeFile(safeTargetPath, stringifyCsv(rows), "utf8");
}

async function writeSalesToPath(sales, targetPath) {
  const safeTargetPath = assertProjectWritePath(targetPath);
  const rows = [VENTAS_HEADERS, ...sales.map(saleToRow)];
  await fs.mkdir(path.dirname(safeTargetPath), { recursive: true });
  await fs.writeFile(safeTargetPath, stringifyCsv(rows), "utf8");
}

async function writeKardexToPath(movements, targetPath) {
  const safeTargetPath = assertProjectWritePath(targetPath);
  const rows = [KARDEX_HEADERS, ...movements.map(movementToRow)];
  await fs.mkdir(path.dirname(safeTargetPath), { recursive: true });
  await fs.writeFile(safeTargetPath, stringifyCsv(rows), "utf8");
}

async function writePurchasePriceHistoryToPath(items, targetPath) {
  const safeTargetPath = assertProjectWritePath(targetPath);
  const rows = [PURCHASE_PRICE_HISTORY_HEADERS, ...items.map(purchasePriceHistoryToRow)];
  await fs.mkdir(path.dirname(safeTargetPath), { recursive: true });
  await fs.writeFile(safeTargetPath, stringifyCsv(rows), "utf8");
}

function parseProductsCsvRows(rows) {
  if (!rows.length) return [];

  const header = rows[0];
  const idIndex = header.findIndex((cell) => isIdHeader(cell));
  const nameIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOMBRE");
  const descriptionIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "DESCRIPCION");
  const categoryIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "CATEGORIA");
  const priceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "PRECIO");
  const purchasePriceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "PRECIOCOMPRA");
  const imagesIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "IMAGENES");
  const variantsIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "VARIANTES");
  const statusIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "ESTADO");
  const pedidoIndex = header.findIndex((cell) => {
    const key = normalizeHeaderKey(cell);
    return key === "PEDIDO" || key === "STOCKMAXIMO";
  });
  const stockMinIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKMINIMO");
  const stockIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKACTUAL");

  if (idIndex < 0 || nameIndex < 0 || priceIndex < 0) {
    throw buildError(400, "CSV invalido. Debe incluir columnas N°, NOMBRE y PRECIO.");
  }

  const productsById = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const id = parseId(row[idIndex]);
    if (!id) continue;

    const name = trimValue(row[nameIndex]);
    if (!name) continue;

    const price = round2(parseDecimal(row[priceIndex]) ?? 0);
    const purchasePrice =
      purchasePriceIndex >= 0 ? round2(parseDecimal(row[purchasePriceIndex]) ?? 0) : 0;
    let images = [];
    if (imagesIndex >= 0) {
      const rawImages = trimValue(row[imagesIndex]);
      if (rawImages) {
        try {
          const parsed = JSON.parse(rawImages);
          if (Array.isArray(parsed)) images = normalizeProductRecord({ "N°": id, NOMBRE: name, PRECIO: price, IMAGENES: parsed }).IMAGENES;
        } catch {
          images = normalizeProductRecord({ "N°": id, NOMBRE: name, PRECIO: price, IMAGENES: rawImages.split("|") }).IMAGENES;
        }
      }
    }
    let variants = [];
    if (variantsIndex >= 0) {
      const rawVariants = trimValue(row[variantsIndex]);
      if (rawVariants) {
        try {
          const parsed = JSON.parse(rawVariants);
          if (Array.isArray(parsed)) variants = parsed;
        } catch {
          variants = [];
        }
      }
    }
    const pedido = pedidoIndex >= 0 ? parseInteger(row[pedidoIndex]) ?? 0 : 0;
    const stockMinimo = stockMinIndex >= 0 ? parseDecimal(row[stockMinIndex]) ?? 0 : 0;
    const stock = stockIndex >= 0 ? parseDecimal(row[stockIndex]) ?? 0 : 0;

    productsById.set(id, {
      "N°": id,
      NOMBRE: name,
      DESCRIPCION: trimValue(descriptionIndex >= 0 ? row[descriptionIndex] : ""),
      CATEGORIA: normalizeProductCategoryValue(categoryIndex >= 0 ? row[categoryIndex] : "OTRO"),
      PRECIO: price,
      PRECIO_COMPRA: purchasePrice,
      IMAGENES: images,
      VARIANTES: variants.filter((item) => item && typeof item === "object").slice(0, 60),
      PEDIDO: pedido,
      STOCK_MINIMO: round2(Math.max(0, stockMinimo)),
      STOCK_ACTUAL: round2(Math.max(0, stock)),
      ESTADO: normalizeProductStatus(statusIndex >= 0 ? row[statusIndex] : "ACTIVO")
    });
  }

  return [...productsById.values()].sort((a, b) => a["N°"] - b["N°"]);
}

function parseSalesCsvRows(rows) {
  if (!rows.length) return [];

  const header = rows[0];
  const idVentaIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "IDVENTA");
  const dateIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "FECHA");
  const productIdIndex = header.findIndex((cell) => isIdHeader(cell));
  const nameIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOMBRE");
  const qtyIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "CANTIDAD");
  const priceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "PRECIO");
  const totalIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "TOTAL");
  const paymentTypeIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "TIPOPAGO");
  const paymentDetailIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "TIPOPAGODETALLE");
  const sourceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "ORIGEN");

  if (dateIndex < 0 || productIdIndex < 0 || nameIndex < 0 || qtyIndex < 0) {
    throw buildError(400, "CSV de ventas invalido.");
  }

  const sales = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const productId = parseId(row[productIdIndex]);
    if (!productId) continue;

    const date = parseIsoDate(row[dateIndex]);
    if (!date) continue;

    const qty = parseDecimal(row[qtyIndex]);
    if (qty === null || qty <= 0) continue;

    const price = round2(parseDecimal(row[priceIndex]) ?? 0);
    const total = round2(parseDecimal(row[totalIndex]) ?? qty * price);
    const idVenta = idVentaIndex >= 0 ? parseId(row[idVentaIndex]) ?? i : i;

    sales.push({
      ID_VENTA: idVenta,
      FECHA: date,
      "N°": productId,
      NOMBRE: trimValue(row[nameIndex]),
      CANTIDAD: round2(qty),
      PRECIO: price,
      TOTAL: total,
      TIPO_PAGO: trimValue(row[paymentTypeIndex]) || "Efectivo",
      TIPO_PAGO_DETALLE:
        trimValue(paymentDetailIndex >= 0 ? row[paymentDetailIndex] : "") ||
        trimValue(row[paymentTypeIndex]) ||
        "Efectivo",
      ORIGEN: trimValue(row[sourceIndex]) || "MANUAL"
    });
  }

  sales.sort((a, b) => {
    if (a.FECHA === b.FECHA) return b.ID_VENTA - a.ID_VENTA;
    return b.FECHA.localeCompare(a.FECHA);
  });

  return sales;
}

function parseKardexCsvRows(rows) {
  if (!rows.length) return [];

  const header = rows[0];
  const idIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "IDMOV");
  const dtIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "FECHAHORA");
  const productIdIndex = header.findIndex((cell) => isIdHeader(cell));
  const nameIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOMBRE");
  const typeIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "TIPO");
  const qtyIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "CANTIDAD");
  const beforeIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKANTES");
  const afterIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKDESPUES");
  const refIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "REFERENCIA");
  const noteIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOTA");

  if (dtIndex < 0 || productIdIndex < 0 || typeIndex < 0 || qtyIndex < 0) {
    throw buildError(400, "CSV de kardex invalido.");
  }

  const items = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const productId = parseId(row[productIdIndex]);
    if (!productId) continue;

    const dtRaw = trimValue(row[dtIndex]);
    if (!dtRaw) continue;

    const qty = parseDecimal(row[qtyIndex]);
    if (qty === null || qty <= 0) continue;

    const id = idIndex >= 0 ? parseId(row[idIndex]) ?? i : i;

    items.push({
      ID_MOV: id,
      FECHA_HORA: dtRaw,
      "N°": productId,
      NOMBRE: trimValue(row[nameIndex]),
      TIPO: normalizeHeader(row[typeIndex]) === "INGRESO" ? "INGRESO" : "SALIDA",
      CANTIDAD: round2(qty),
      STOCK_ANTES: round2(parseDecimal(row[beforeIndex]) ?? 0),
      STOCK_DESPUES: round2(parseDecimal(row[afterIndex]) ?? 0),
      REFERENCIA: trimValue(row[refIndex]),
      NOTA: trimValue(row[noteIndex])
    });
  }

  items.sort((a, b) => {
    if (a.FECHA_HORA === b.FECHA_HORA) return b.ID_MOV - a.ID_MOV;
    return b.FECHA_HORA.localeCompare(a.FECHA_HORA);
  });

  return items;
}

function parsePurchasePriceHistoryCsvRows(rows) {
  if (!rows.length) return [];

  const header = rows[0];
  const idIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "IDHISTORIAL");
  const dtIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "FECHAHORA");
  const productIdIndex = header.findIndex((cell) => isIdHeader(cell));
  const nameIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOMBRE");
  const purchasePriceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "PRECIOCOMPRA");
  const noteIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "NOTA");
  const sourceIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "ORIGEN");

  if (dtIndex < 0 || productIdIndex < 0 || purchasePriceIndex < 0) return [];

  const items = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const productId = parseId(row[productIdIndex]);
    if (!productId) continue;
    const dtRaw = trimValue(row[dtIndex]);
    if (!dtRaw) continue;
    const purchasePrice = parseDecimal(row[purchasePriceIndex]);
    if (purchasePrice === null || purchasePrice < 0) continue;
    const id = idIndex >= 0 ? parseId(row[idIndex]) ?? i : i;
    items.push({
      ID_HISTORIAL: id,
      FECHA_HORA: dtRaw,
      "N°": productId,
      NOMBRE: trimValue(row[nameIndex]),
      PRECIO_COMPRA: round2(purchasePrice),
      NOTA: trimValue(row[noteIndex]),
      ORIGEN: trimValue(row[sourceIndex])
    });
  }

  items.sort((a, b) => {
    if (a.FECHA_HORA === b.FECHA_HORA) return b.ID_HISTORIAL - a.ID_HISTORIAL;
    return b.FECHA_HORA.localeCompare(a.FECHA_HORA);
  });

  return items;
}

async function rebuildProductsCsvFromBase() {
  const rows = await loadBaseRows();
  const products = extractProductsFromBaseRows(rows);
  await writeProductsToPath(products, DEFAULT_PRODUCTS_CSV_PATH);
  return products;
}

async function setSourceFromUpload(filename, content) {
  const csvText = String(content ?? "");
  if (!csvText.trim()) {
    throw buildError(400, "El archivo CSV esta vacio.");
  }

  const rows = parseCsv(csvText);
  const products = parseProductsCsvRows(rows);
  if (!products.length) {
    throw buildError(400, "No se encontraron productos validos en el CSV.");
  }

  await writeProductsToPath(products, DEFAULT_PRODUCTS_CSV_PATH);
  await setDefaultSource();

  return getSourceInfo();
}

async function ensureProductsCsv(options = {}) {
  const forceRebuild = Boolean(options.forceRebuild);

  if (forceRebuild) {
    const products = await rebuildProductsCsvFromBase();
    if (options.activateDefault !== false) await setDefaultSource();
    return products;
  }

  if (await existsFile(DEFAULT_PRODUCTS_CSV_PATH)) {
    return null;
  }

  const products = await rebuildProductsCsvFromBase();
  await setDefaultSource();
  return products;
}

async function ensureProductsSchema() {
  await ensureProductsCsv();
  const source = await getSourceInfo();
  const raw = await fs.readFile(source.activeCsvPath, "utf8");
  const rows = parseCsv(raw);

  if (!rows.length) {
    await writeProductsToPath([], source.activeCsvPath);
    return { migrated: true };
  }

  const hasStockColumn = rows[0].some((cell) => normalizeHeaderKey(cell) === "STOCKACTUAL");
  const hasPurchasePriceColumn = rows[0].some((cell) => normalizeHeaderKey(cell) === "PRECIOCOMPRA");
  const hasImagesColumn = rows[0].some((cell) => normalizeHeaderKey(cell) === "IMAGENES");
  const hasCategoryColumn = rows[0].some((cell) => normalizeHeaderKey(cell) === "CATEGORIA");
  if (hasStockColumn && hasPurchasePriceColumn && hasImagesColumn && hasCategoryColumn) return { migrated: false };

  const currentProducts = parseProductsCsvRows(rows);
  let stockById = new Map();

  if (source.activeCsvPath === DEFAULT_PRODUCTS_CSV_PATH && (await existsFile(BASE_CSV_PATH))) {
    try {
      const baseRows = await loadBaseRows();
      const baseProducts = extractProductsFromBaseRows(baseRows);
      stockById = new Map(baseProducts.map((item) => [item["N°"], item.STOCK_ACTUAL]));
    } catch {
      stockById = new Map();
    }
  }

  const migrated = currentProducts.map((item) => ({
    ...item,
    CATEGORIA: normalizeProductCategoryValue(item.CATEGORIA || "OTRO"),
    PRECIO_COMPRA: round2(Math.max(0, item.PRECIO_COMPRA ?? 0)),
    IMAGENES: Array.isArray(item.IMAGENES) ? item.IMAGENES.slice(0, 3) : [],
    STOCK_ACTUAL: round2(Math.max(0, stockById.get(item["N°"]) ?? 0))
  }));

  await writeProductsToPath(migrated, source.activeCsvPath);
  return { migrated: true };
}

async function ensureVentasCsvFromBase(options = {}) {
  const exists = await existsFile(VENTAS_CSV_PATH);
  const forceRebuild = Boolean(options.forceRebuild);

  if (exists && !forceRebuild) {
    const raw = await fs.readFile(VENTAS_CSV_PATH, "utf8");
    const rows = parseCsv(raw);
    if (rows.length > 1) {
      let hasInvalidDate = false;
      try {
        const parsed = parseSalesCsvRows(rows);
        hasInvalidDate = parsed.some((sale) => !isBusinessDate(sale.FECHA));
      } catch {
        hasInvalidDate = true;
      }

      if (!hasInvalidDate) {
      return { seeded: false, total: rows.length - 1 };
      }
    }
  }

  const baseRows = await loadBaseRows();
  const sales = extractSalesFromBaseRows(baseRows);
  await writeSalesToPath(sales, VENTAS_CSV_PATH);
  return { seeded: true, total: sales.length };
}

async function ensureKardexCsv() {
  const exists = await existsFile(KARDEX_CSV_PATH);

  if (!exists) {
    await writeKardexToPath([], KARDEX_CSV_PATH);
    return { created: true };
  }

  const raw = await fs.readFile(KARDEX_CSV_PATH, "utf8");
  if (trimValue(raw)) return { created: false };

  await writeKardexToPath([], KARDEX_CSV_PATH);
  return { created: true };
}

async function ensurePurchasePriceHistoryCsv() {
  const exists = await existsFile(PURCHASE_PRICE_HISTORY_CSV_PATH);
  if (!exists) {
    await writePurchasePriceHistoryToPath([], PURCHASE_PRICE_HISTORY_CSV_PATH);
    return { created: true };
  }

  const raw = await fs.readFile(PURCHASE_PRICE_HISTORY_CSV_PATH, "utf8");
  if (trimValue(raw)) return { created: false };

  await writePurchasePriceHistoryToPath([], PURCHASE_PRICE_HISTORY_CSV_PATH);
  return { created: true };
}

async function ensureInventoryData(options = {}) {
  await ensureProductsCsv({
    forceRebuild: Boolean(options.forceRebuildProducts),
    activateDefault: options.activateDefault
  });
  await ensureProductsSchema();

  const ventasStatus = await ensureVentasCsvFromBase({
    forceRebuild: Boolean(options.forceRebuildSales)
  });
  const kardexStatus = await ensureKardexCsv();
  const purchasePriceHistoryStatus = await ensurePurchasePriceHistoryCsv();

  return {
    ventasStatus,
    kardexStatus,
    purchasePriceHistoryStatus
  };
}

async function readProducts() {
  await ensureProductsCsv();
  await ensureProductsSchema();

  const source = await getSourceInfo();
  const raw = await fs.readFile(source.activeCsvPath, "utf8");
  return parseProductsCsvRows(parseCsv(raw));
}

async function writeProducts(products) {
  const source = await getSourceInfo();
  await writeProductsToPath(products, source.activeCsvPath);
}

async function readSales() {
  await ensureVentasCsvFromBase();
  const raw = await fs.readFile(VENTAS_CSV_PATH, "utf8");
  return parseSalesCsvRows(parseCsv(raw));
}

async function writeSales(sales) {
  await writeSalesToPath(sales, VENTAS_CSV_PATH);
}

async function readKardex() {
  await ensureKardexCsv();
  const raw = await fs.readFile(KARDEX_CSV_PATH, "utf8");
  return parseKardexCsvRows(parseCsv(raw));
}

async function writeKardex(movements) {
  await writeKardexToPath(movements, KARDEX_CSV_PATH);
}

async function readPurchasePriceHistory() {
  await ensurePurchasePriceHistoryCsv();
  const raw = await fs.readFile(PURCHASE_PRICE_HISTORY_CSV_PATH, "utf8");
  return parsePurchasePriceHistoryCsvRows(parseCsv(raw));
}

async function writePurchasePriceHistory(items) {
  await writePurchasePriceHistoryToPath(items, PURCHASE_PRICE_HISTORY_CSV_PATH);
}

async function readRawActiveCsv() {
  await ensureProductsCsv();
  const source = await getSourceInfo();
  return fs.readFile(source.activeCsvPath, "utf8");
}

function normalizePage(value, defaultValue = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function normalizePageSize(value, defaultValue = 20) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, 200);
}

function paginate(items, options = {}) {
  const pageSize = normalizePageSize(options.pageSize, 20);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(normalizePage(options.page, 1), totalPages);
  const start = (page - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);

  return {
    items: pagedItems,
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

function filterProducts(products, options = {}) {
  const query = trimValue(options.q).toLowerCase();
  const pedidoFilter = trimValue(options.pedido).toLowerCase() || "todos";

  return products.filter((item) => {
    const matchesQuery =
      !query ||
      String(item["N°"]).includes(query) ||
      String(item.NOMBRE ?? "")
        .toLowerCase()
        .includes(query) ||
      String(item.PRECIO ?? "").includes(query) ||
      String(item.PRECIO_COMPRA ?? "").includes(query) ||
      String(item.STOCK_ACTUAL ?? "").includes(query);

    const pedido = Number(item.STOCK_MAXIMO ?? item.PEDIDO) || 0;
    const matchesPedido =
      pedidoFilter === "todos" ||
      (pedidoFilter === "con-pedido" && pedido > 0) ||
      (pedidoFilter === "sin-pedido" && pedido <= 0);

    return matchesQuery && matchesPedido;
  });
}

function filterSales(sales, options = {}) {
  const query = trimValue(options.q).toLowerCase();
  if (!query) return sales;

  return sales.filter((item) => {
    return (
      String(item["N°"]).includes(query) ||
      String(item.NOMBRE ?? "")
        .toLowerCase()
        .includes(query) ||
      String(item.FECHA ?? "").toLowerCase().includes(query) ||
      String(item.CANTIDAD ?? "").includes(query) ||
      String(item.TIPO_PAGO ?? "").toLowerCase().includes(query) ||
      String(item.TOTAL ?? "").includes(query)
    );
  });
}

function filterKardex(movements, options = {}) {
  const query = trimValue(options.q).toLowerCase();
  const tipo = trimValue(options.tipo).toUpperCase();

  return movements.filter((item) => {
    const matchesTipo = !tipo || tipo === "TODOS" || item.TIPO === tipo;

    const matchesQuery =
      !query ||
      String(item["N°"]).includes(query) ||
      String(item.NOMBRE ?? "")
        .toLowerCase()
        .includes(query) ||
      String(item.FECHA_HORA ?? "").toLowerCase().includes(query) ||
      String(item.REFERENCIA ?? "")
        .toLowerCase()
        .includes(query) ||
      String(item.NOTA ?? "")
        .toLowerCase()
        .includes(query);

    return matchesTipo && matchesQuery;
  });
}

async function listProducts(options = {}) {
  const products = await readProducts();
  const filtered = filterProducts(products, options);
  return paginate(filtered, options);
}

async function listSales(options = {}) {
  const sales = await readSales();
  const filtered = filterSales(sales, options);
  return paginate(filtered, options);
}

async function listKardex(options = {}) {
  const movements = await readKardex();
  const filtered = filterKardex(movements, options);
  return paginate(filtered, options);
}

async function getProductStats() {
  const products = await readProducts();
  return {
    total: products.length,
    conPedido: products.filter((item) => Number(item.STOCK_MAXIMO ?? item.PEDIDO) > 0).length,
    stockTotal: round2(products.reduce((acc, item) => acc + (Number(item.STOCK_ACTUAL) || 0), 0))
  };
}

async function appendKardexMovement(payload) {
  const movements = await readKardex();
  const nextId = movements.reduce((max, item) => Math.max(max, item.ID_MOV || 0), 0) + 1;

  const movement = {
    ID_MOV: nextId,
    FECHA_HORA: payload.FECHA_HORA || nowIsoDateTime(),
    "N°": payload["N°"],
    NOMBRE: payload.NOMBRE,
    TIPO: payload.TIPO,
    CANTIDAD: round2(payload.CANTIDAD),
    STOCK_ANTES: round2(payload.STOCK_ANTES),
    STOCK_DESPUES: round2(payload.STOCK_DESPUES),
    REFERENCIA: trimValue(payload.REFERENCIA),
    NOTA: trimValue(payload.NOTA)
  };

  movements.push(movement);
  await writeKardex(movements);
  return movement;
}

async function appendPurchasePriceHistory(payload) {
  const history = await readPurchasePriceHistory();
  const nextId = history.reduce((max, item) => Math.max(max, item.ID_HISTORIAL || 0), 0) + 1;
  const item = {
    ID_HISTORIAL: nextId,
    FECHA_HORA: payload.FECHA_HORA || nowIsoDateTime(),
    "N°": payload["N°"],
    NOMBRE: payload.NOMBRE,
    PRECIO_COMPRA: round2(payload.PRECIO_COMPRA),
    NOTA: trimValue(payload.NOTA),
    ORIGEN: trimValue(payload.ORIGEN || "PRODUCTO_EDICION")
  };
  history.push(item);
  history.sort((a, b) => {
    if (a.FECHA_HORA === b.FECHA_HORA) return b.ID_HISTORIAL - a.ID_HISTORIAL;
    return b.FECHA_HORA.localeCompare(a.FECHA_HORA);
  });
  await writePurchasePriceHistory(history);
  return item;
}

async function readProductPurchasePriceHistory(productIdInput) {
  const productId = parseId(productIdInput);
  if (!productId) throw buildError(400, "El id del producto es invalido.");
  const history = await readPurchasePriceHistory();
  return history.filter((item) => item["N°"] === productId);
}

async function createProduct(payload) {
  const products = await readProducts();
  const hasCustomId = payload["N°"] !== undefined || payload.id !== undefined || payload.n !== undefined;
  const nextId = products.reduce((max, item) => Math.max(max, item["N°"]), 0) + 1;
  const withId = {
    ...payload,
    "N°": hasCustomId ? payload["N°"] ?? payload.id ?? payload.n : nextId
  };

  const stockInitial =
    payload.STOCK_ACTUAL ?? payload.stockActual ?? payload.stock_actual ?? payload.stockInicial ?? 0;

  const variantStockTotal = sumVariantStock(payload.VARIANTES ?? payload.variantes ?? payload.variants ?? []);
  const product = normalizeProductRecord({
    ...withId,
    STOCK_ACTUAL: Math.max(round2(parseDecimal(stockInitial) ?? 0), variantStockTotal)
  });

  if (products.some((item) => item["N°"] === product["N°"])) {
    throw buildError(409, `Ya existe un producto con N° ${product["N°"]}.`);
  }

  products.push(product);
  products.sort((a, b) => a["N°"] - b["N°"]);
  await writeProducts(products);

  if (Number(product.PRECIO_COMPRA || 0) > 0) {
    await appendPurchasePriceHistory({
      "N°": product["N°"],
      NOMBRE: product.NOMBRE,
      PRECIO_COMPRA: Number(product.PRECIO_COMPRA || 0),
      NOTA: "Precio de compra inicial",
      ORIGEN: "CREACION_PRODUCTO"
    });
  }

  if (Number(product.STOCK_ACTUAL) > 0) {
    await appendKardexMovement({
      "N°": product["N°"],
      NOMBRE: product.NOMBRE,
      TIPO: "INGRESO",
      CANTIDAD: Number(product.STOCK_ACTUAL),
      STOCK_ANTES: 0,
      STOCK_DESPUES: Number(product.STOCK_ACTUAL),
      REFERENCIA: "CREACION_PRODUCTO",
      NOTA: "Stock inicial"
    });
  }

  return product;
}

function parseStockDelta(payload) {
  const raw =
    payload.stockAjuste ??
    payload.stock_ajuste ??
    payload.cantidadIngreso ??
    payload.cantidad_ingreso ??
    payload.stockDelta ??
    0;

  if (raw === null || raw === undefined || trimValue(raw) === "") return 0;
  const parsed = parseDecimal(raw);
  if (parsed === null) {
    throw buildError(400, "El ajuste de stock debe ser numerico.");
  }
  return round2(parsed);
}

async function updateProduct(idInput, payload) {
  const id = parseId(idInput);
  if (!id) throw buildError(400, "El id del producto es invalido.");

  const products = await readProducts();
  const index = products.findIndex((item) => item["N°"] === id);
  if (index < 0) throw buildError(404, `No existe producto con N° ${id}.`);

  const current = products[index];
  const hasNextId =
    payload["N°"] !== undefined ||
    payload.id !== undefined ||
    payload.n !== undefined;
  const nextId = hasNextId ? parseId(payload["N°"] ?? payload.id ?? payload.n) : id;
  if (!nextId) throw buildError(400, "El campo N° debe ser un numero entero positivo.");
  const shouldSwapProductCode =
    payload.swapProductCode === true ||
    payload.intercambiarCodigo === true ||
    payload.intercambiar_orden === true;
  const targetIndex = products.findIndex((item) => item["N°"] === nextId);
  if (nextId !== id && targetIndex >= 0 && !shouldSwapProductCode) {
    throw buildError(409, `Ya existe un producto con N° ${nextId}.`);
  }

  const variantsChanged =
    payload.VARIANTES !== undefined || payload.variantes !== undefined || payload.variants !== undefined;
  const nextVariants = payload.VARIANTES ?? payload.variantes ?? payload.variants ?? current.VARIANTES ?? [];
  const stockManagedSeparately =
    payload.STOCK_BASE_ACTUAL !== undefined || payload.stockBaseActual !== undefined || payload.stock_base_actual !== undefined;
  const variantStockDelta = variantsChanged && !stockManagedSeparately
    ? round2(sumVariantStock(nextVariants) - sumVariantStock(current.VARIANTES))
    : 0;
  const explicitStock =
    payload.STOCK_ACTUAL ?? payload.stockActual ?? payload.stock_actual ?? payload.stock ?? null;
  const stockBase =
    explicitStock !== null && explicitStock !== undefined && trimValue(explicitStock) !== ""
      ? round2(parseDecimal(explicitStock) ?? 0)
      : round2(Number(current.STOCK_ACTUAL || 0) + parseStockDelta(payload));
  const nextStock = stockManagedSeparately
    ? Math.max(stockBase, sumVariantStock(nextVariants))
    : round2(stockBase + variantStockDelta);

  if (nextStock < 0) {
    throw buildError(400, `Stock insuficiente para N° ${id}. Stock actual: ${current.STOCK_ACTUAL}.`);
  }

  const merged = {
    "N°": nextId,
    NOMBRE: payload.NOMBRE ?? current.NOMBRE,
    DESCRIPCION: payload.DESCRIPCION ?? payload.descripcion ?? current.DESCRIPCION ?? "",
    CATEGORIA: normalizeProductCategoryValue(payload.CATEGORIA ?? payload.categoria ?? current.CATEGORIA ?? "OTRO"),
    PRECIO: payload.PRECIO ?? current.PRECIO,
    PRECIO_COMPRA:
      payload.PRECIO_COMPRA ?? payload.precio_compra ?? payload.precioCompra ?? current.PRECIO_COMPRA ?? 0,
    IMAGENES: payload.IMAGENES ?? payload.imagenes ?? payload.imagenes_json ?? current.IMAGENES ?? [],
    VARIANTES: payload.VARIANTES ?? payload.variantes ?? payload.variants ?? current.VARIANTES ?? [],
    PEDIDO:
      payload.STOCK_MAXIMO ??
      payload.stock_maximo ??
      payload.stockMaximo ??
      payload.PEDIDO ??
      current.PEDIDO,
    STOCK_MINIMO: payload.STOCK_MINIMO ?? payload.stock_minimo ?? payload.stockMinimo ?? current.STOCK_MINIMO ?? 0,
    STOCK_ACTUAL: nextStock,
    ESTADO: payload.ESTADO ?? payload.estado ?? payload.status ?? current.ESTADO ?? "ACTIVO"
  };

  const updated = normalizeProductRecord(merged);
  products[index] = updated;
  if (nextId !== id && targetIndex >= 0) {
    products[targetIndex] = normalizeProductRecord({ ...products[targetIndex], "N°": id });
  }
  products.sort((a, b) => a["N°"] - b["N°"]);
  await writeProducts(products);

  if (nextId !== id) {
    const sales = await readSales();
    const updatedSales = sales.map((sale) => {
      if (sale["N°"] === id) return { ...sale, "N°": nextId };
      if (targetIndex >= 0 && sale["N°"] === nextId) return { ...sale, "N°": id };
      return sale;
    });
    await writeSales(updatedSales);

    const movements = await readKardex();
    const updatedMovements = movements.map((movement) => {
      if (movement["N°"] === id) return { ...movement, "N°": nextId };
      if (targetIndex >= 0 && movement["N°"] === nextId) return { ...movement, "N°": id };
      return movement;
    });
    await writeKardex(updatedMovements);

    const history = await readPurchasePriceHistory();
    const updatedHistory = history.map((item) => {
      if (item["N°"] === id) return { ...item, "N°": nextId };
      if (targetIndex >= 0 && item["N°"] === nextId) return { ...item, "N°": id };
      return item;
    });
    await writePurchasePriceHistory(updatedHistory);
  }

  if (round2(updated.PRECIO_COMPRA || 0) !== round2(current.PRECIO_COMPRA || 0)) {
    await appendPurchasePriceHistory({
      "N°": updated["N°"],
      NOMBRE: updated.NOMBRE,
      PRECIO_COMPRA: Number(updated.PRECIO_COMPRA || 0),
      NOTA: trimValue(payload.nota) || "Cambio de precio de compra",
      ORIGEN: "EDICION_PRODUCTO"
    });
  }

  const effectiveStockDelta = round2(Number(updated.STOCK_ACTUAL || 0) - Number(current.STOCK_ACTUAL || 0));
  if (effectiveStockDelta !== 0) {
    await appendKardexMovement({
      "N°": updated["N°"],
      NOMBRE: updated.NOMBRE,
      TIPO: effectiveStockDelta > 0 ? "INGRESO" : "SALIDA",
      CANTIDAD: Math.abs(effectiveStockDelta),
      STOCK_ANTES: Number(current.STOCK_ACTUAL || 0),
      STOCK_DESPUES: Number(updated.STOCK_ACTUAL || 0),
      REFERENCIA: "AJUSTE_EDICION",
      NOTA: trimValue(payload.nota) || "Ajuste manual en edicion"
    });
  }

  return updated;
}

async function deleteProduct(idInput) {
  const id = parseId(idInput);
  if (!id) throw buildError(400, "El id del producto es invalido.");

  const products = await readProducts();
  const index = products.findIndex((item) => item["N°"] === id);
  if (index < 0) throw buildError(404, `No existe producto con N° ${id}.`);

  const [removed] = products.splice(index, 1);
  await writeProducts(products);
  return removed;
}

async function registerSale(payload) {
  const productId = parseId(payload["N°"] ?? payload.id ?? payload.productId);
  if (!productId) throw buildError(400, "Debes indicar un producto valido.");
  const variantId = trimValue(payload.variantId ?? payload.variant_id ?? "");

  const quantity = parseDecimal(payload.cantidad ?? payload.qty ?? payload.CANTIDAD);
  if (quantity === null || quantity <= 0) {
    throw buildError(400, "La cantidad de venta debe ser mayor a 0.");
  }

  const fecha =
    parseIsoDate(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA ?? payload.fecha ?? payload.FECHA) ||
    todayIso();
  const tipoPago = normalizePaymentType(payload.tipoPago ?? payload.tipo_pago ?? payload.TIPO_PAGO, {
    defaultValue: "Efectivo"
  });
  const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN, {
    defaultValue: "MANUAL"
  });
  const nota = trimValue(payload.nota);

  const products = await readProducts();
  const index = products.findIndex((item) => item["N°"] === productId);
  if (index < 0) throw buildError(404, `No existe producto con N° ${productId}.`);

  const product = products[index];
  const stockBefore = Number(product.STOCK_ACTUAL || 0);
  const stockAfter = round2(stockBefore - quantity);

  if (stockAfter < 0) {
    throw buildError(400, `Stock insuficiente para N° ${productId}. Stock actual: ${stockBefore}.`);
  }

  product.STOCK_ACTUAL = stockAfter;
  const variantResult = applyVariantStockSale(product, variantId, quantity);
  const saleProductName = variantResult.variantName ? `${product.NOMBRE} - ${variantResult.variantName}` : product.NOMBRE;
  products[index] = product;
  await writeProducts(products);

  const sales = await readSales();
  const nextSaleId = sales.reduce((max, item) => Math.max(max, item.ID_VENTA || 0), 0) + 1;
  const price = Number(product.PRECIO || 0);

  const sale = {
    ID_VENTA: nextSaleId,
    FECHA: fecha,
    "N°": product["N°"],
    NOMBRE: saleProductName,
    CANTIDAD: round2(quantity),
    PRECIO: round2(price),
    TOTAL: round2(price * quantity),
    TIPO_PAGO: tipoPago,
    TIPO_PAGO_DETALLE: tipoPago,
    ORIGEN: origin
  };

  sales.push(sale);
  await writeSales(sales);

  const movement = await appendKardexMovement({
    "N°": product["N°"],
    NOMBRE: saleProductName,
    TIPO: "SALIDA",
    CANTIDAD: round2(quantity),
    STOCK_ANTES: stockBefore,
    STOCK_DESPUES: stockAfter,
    REFERENCIA: `VENTA_DIARIA:${nextSaleId}`,
    NOTA: nota || `Venta registrada (${fecha})`
  });

  return {
    sale,
    product,
    movement
  };
}

async function registerSaleBatch(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  if (!rawItems.length) {
    throw buildError(400, "Debes enviar al menos un producto en items.");
  }

  const aggregated = new Map();
  for (const row of rawItems) {
    const productId = resolveIncomingProductId(row);
    if (!productId) throw buildError(400, "Producto invalido en items.");
    const variantId = trimValue(row?.variantId ?? row?.variant_id ?? "");
    const quantity = parseDecimal(row?.cantidad ?? row?.CANTIDAD);
    if (quantity === null || quantity <= 0) {
      throw buildError(400, "La cantidad de venta debe ser mayor a 0.");
    }
    const key = `${productId}::${variantId}`;
    const prev = aggregated.get(key) || { productId, variantId, cantidad: 0 };
    aggregated.set(key, { productId, variantId, cantidad: round2(prev.cantidad + quantity) });
  }

  const fecha =
    parseIsoDate(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA ?? payload.fecha ?? payload.FECHA) ||
    todayIso();
  const origin = normalizeSaleOrigin(payload.tipoVenta ?? payload.origen ?? payload.ORIGEN, {
    defaultValue: "MANUAL"
  });
  const nota = trimValue(payload.nota);

  const products = await readProducts();
  const items = [];
  for (const { productId, variantId, cantidad } of aggregated.values()) {
    const index = products.findIndex((item) => Number(item["N°"]) === Number(productId));
    if (index < 0) throw buildError(404, `No existe producto con N° ${productId}.`);
    const product = products[index];
    const stockBefore = round2(Number(product.STOCK_ACTUAL || 0));
    const stockAfter = round2(stockBefore - cantidad);
    if (stockAfter < 0) {
      throw buildError(400, `Stock insuficiente para N° ${productId}. Stock actual: ${stockBefore}.`);
    }
    const price = round2(Number(product.PRECIO || 0));
    const variantResult = applyVariantStockSale(product, variantId, cantidad);
    const saleProductName = variantResult.variantName ? `${product.NOMBRE} - ${variantResult.variantName}` : product.NOMBRE;
    items.push({
      index,
      productId,
      cantidad: round2(cantidad),
      product,
      saleProductName,
      stockBefore,
      stockAfter,
      price,
      total: round2(price * cantidad)
    });
  }

  const total = round2(items.reduce((acc, item) => acc + item.total, 0));
  let paymentSplit = Array.isArray(payload?.paymentSplit)
    ? payload.paymentSplit
        .map((row) => ({
          tipoPago: normalizePaymentType(row?.tipoPago ?? row?.tipo, { defaultValue: "Efectivo" }),
          monto: round2(Number(row?.monto || 0))
        }))
        .filter((row) => row.monto > 0)
    : [];
  if (!paymentSplit.length) {
    paymentSplit = [
      {
        tipoPago: normalizePaymentType(payload.tipoPago ?? payload.tipo_pago ?? payload.TIPO_PAGO, {
          defaultValue: "Efectivo"
        }),
        monto: total
      }
    ];
  }
  const paidTotal = round2(paymentSplit.reduce((acc, row) => acc + row.monto, 0));
  if (round2(paidTotal) !== round2(total)) {
    throw buildError(400, `La suma de pagos (${paidTotal.toFixed(2)}) debe coincidir con el total (${total.toFixed(2)}).`);
  }
  const tipoPago =
    paymentSplit.length === 1
      ? paymentSplit[0].tipoPago
      : paymentSplit.map((row) => `${row.tipoPago} S/${row.monto.toFixed(2)}`).join(" + ");

  for (const item of items) {
    products[item.index] = { ...item.product, STOCK_ACTUAL: item.stockAfter };
  }
  await writeProducts(products);

  const sales = await readSales();
  let nextSaleId = sales.reduce((max, item) => Math.max(max, item.ID_VENTA || 0), 0) + 1;
  const createdSales = [];
  const createdMovements = [];
  const updatedProducts = [];

  for (const item of items) {
    const sale = {
      ID_VENTA: nextSaleId++,
      FECHA: fecha,
      "N°": item.product["N°"],
      NOMBRE: item.saleProductName,
      CANTIDAD: item.cantidad,
      PRECIO: item.price,
      TOTAL: item.total,
      TIPO_PAGO: tipoPago,
      TIPO_PAGO_DETALLE: tipoPago,
      ORIGEN: origin
    };
    sales.push(sale);
    createdSales.push(sale);
    updatedProducts.push(products[item.index]);
    createdMovements.push(
      await appendKardexMovement({
        "N°": item.product["N°"],
        NOMBRE: item.saleProductName,
        TIPO: "SALIDA",
        CANTIDAD: item.cantidad,
        STOCK_ANTES: item.stockBefore,
        STOCK_DESPUES: item.stockAfter,
        REFERENCIA: `VENTA_DIARIA:${sale.ID_VENTA}`,
        NOTA: nota || `Venta compuesta (${fecha})`
      })
    );
  }
  await writeSales(sales);

  return {
    sales: createdSales,
    products: updatedProducts,
    movements: createdMovements,
    total,
    tipoPago,
    paymentSplit,
    origen: origin
  };
}

async function updateSale(idInput, payload) {
  const saleId = parseId(idInput);
  if (!saleId) throw buildError(400, "El id de la venta es invalido.");

  const sales = await readSales();
  const saleIndex = sales.findIndex((item) => Number(item.ID_VENTA) === saleId);
  if (saleIndex < 0) throw buildError(404, `No existe venta con ID ${saleId}.`);

  const currentSale = sales[saleIndex];
  const nextProductId = parseId(
    payload["N°"] ?? payload.id ?? payload.productId ?? currentSale["N°"]
  );
  if (!nextProductId) throw buildError(400, "Debes indicar un producto valido.");

  const rawNextQty = payload.cantidad ?? payload.qty ?? payload.CANTIDAD;
  const parsedNextQty =
    rawNextQty === undefined || rawNextQty === null || trimValue(rawNextQty) === ""
      ? Number(currentSale.CANTIDAD || 0)
      : parseDecimal(rawNextQty);
  if (parsedNextQty === null || parsedNextQty <= 0) {
    throw buildError(400, "La cantidad de venta debe ser mayor a 0.");
  }

  const nextQty = round2(parsedNextQty);
  const nextFecha =
    parseIsoDate(payload.fecha_venta ?? payload.fechaVenta ?? payload.FECHA_VENTA ?? payload.fecha ?? payload.FECHA) ||
    currentSale.FECHA ||
    todayIso();
  if (!isBusinessDate(nextFecha)) {
    throw buildError(400, "La fecha de la venta es invalida.");
  }

  const nextTipoPago = normalizePaymentType(
    payload.tipoPago ?? payload.tipo_pago ?? payload.TIPO_PAGO ?? currentSale.TIPO_PAGO,
    { defaultValue: "Efectivo" }
  );
  const nota = trimValue(payload.nota) || `Correccion de venta #${saleId}`;

  const products = await readProducts();
  const currentProductId = Number(currentSale["N°"]);
  const currentQty = round2(Number(currentSale.CANTIDAD || 0));

  const currentProductIndex = products.findIndex((item) => item["N°"] === currentProductId);
  if (currentProductIndex < 0) {
    throw buildError(404, `No existe producto N° ${currentProductId} asociado a la venta.`);
  }

  const nextProductIndex = products.findIndex((item) => item["N°"] === nextProductId);
  if (nextProductIndex < 0) {
    throw buildError(404, `No existe producto con N° ${nextProductId}.`);
  }

  const stockMovementsPayload = [];

  if (currentProductId === nextProductId) {
    const product = products[currentProductIndex];
    const stockBefore = Number(product.STOCK_ACTUAL || 0);
    const delta = round2(nextQty - currentQty);
    const stockAfter = round2(stockBefore - delta);

    if (stockAfter < 0) {
      throw buildError(
        400,
        `Stock insuficiente para N° ${nextProductId}. Stock actual: ${stockBefore}.`
      );
    }

    products[currentProductIndex] = { ...product, STOCK_ACTUAL: stockAfter };

    if (delta !== 0) {
      stockMovementsPayload.push({
        "N°": product["N°"],
        NOMBRE: product.NOMBRE,
        TIPO: delta > 0 ? "SALIDA" : "INGRESO",
        CANTIDAD: Math.abs(delta),
        STOCK_ANTES: stockBefore,
        STOCK_DESPUES: stockAfter,
        REFERENCIA: `VENTA_EDITADA:${saleId}`,
        NOTA: nota
      });
    }
  } else {
    const currentProduct = products[currentProductIndex];
    const targetProduct = products[nextProductIndex];

    const currentStockBefore = Number(currentProduct.STOCK_ACTUAL || 0);
    const currentStockAfter = round2(currentStockBefore + currentQty);
    const targetStockBefore = Number(targetProduct.STOCK_ACTUAL || 0);
    const targetStockAfter = round2(targetStockBefore - nextQty);

    if (targetStockAfter < 0) {
      throw buildError(
        400,
        `Stock insuficiente para N° ${nextProductId}. Stock actual: ${targetStockBefore}.`
      );
    }

    products[currentProductIndex] = { ...currentProduct, STOCK_ACTUAL: currentStockAfter };
    products[nextProductIndex] = { ...targetProduct, STOCK_ACTUAL: targetStockAfter };

    stockMovementsPayload.push({
      "N°": currentProduct["N°"],
      NOMBRE: currentProduct.NOMBRE,
      TIPO: "INGRESO",
      CANTIDAD: currentQty,
      STOCK_ANTES: currentStockBefore,
      STOCK_DESPUES: currentStockAfter,
      REFERENCIA: `VENTA_EDITADA:${saleId}`,
      NOTA: `${nota} (reversion producto original)`
    });

    stockMovementsPayload.push({
      "N°": targetProduct["N°"],
      NOMBRE: targetProduct.NOMBRE,
      TIPO: "SALIDA",
      CANTIDAD: nextQty,
      STOCK_ANTES: targetStockBefore,
      STOCK_DESPUES: targetStockAfter,
      REFERENCIA: `VENTA_EDITADA:${saleId}`,
      NOTA: `${nota} (aplicacion producto corregido)`
    });
  }

  await writeProducts(products);

  const finalProduct = products[nextProductIndex];
  const isSameProduct = currentProductId === nextProductId;
  const finalPrice = isSameProduct
    ? round2(Number(currentSale.PRECIO || finalProduct.PRECIO || 0))
    : round2(Number(finalProduct.PRECIO || 0));
  const updatedSale = {
    ...currentSale,
    ID_VENTA: saleId,
    FECHA: nextFecha,
    "N°": finalProduct["N°"],
    NOMBRE: finalProduct.NOMBRE,
    CANTIDAD: nextQty,
    PRECIO: finalPrice,
    TOTAL: round2(finalPrice * nextQty),
    TIPO_PAGO: nextTipoPago,
    TIPO_PAGO_DETALLE: trimValue(
      payload.tipoPagoDetalle ?? payload.TIPO_PAGO_DETALLE ?? currentSale.TIPO_PAGO_DETALLE ?? nextTipoPago
    ),
    ORIGEN: trimValue(currentSale.ORIGEN) || "MANUAL"
  };

  sales[saleIndex] = updatedSale;
  await writeSales(sales);

  const movements = [];
  for (const movementPayload of stockMovementsPayload) {
    const movement = await appendKardexMovement(movementPayload);
    movements.push(movement);
  }

  return {
    sale: updatedSale,
    product: finalProduct,
    movements
  };
}

async function registerStockIngress(idInput, payload) {
  const id = parseId(idInput);
  if (!id) throw buildError(400, "El id del producto es invalido.");

  const quantity = parseDecimal(payload.cantidad ?? payload.CANTIDAD);
  if (quantity === null || quantity <= 0) {
    throw buildError(400, "La cantidad de ingreso debe ser mayor a 0.");
  }

  const products = await readProducts();
  const index = products.findIndex((item) => item["N°"] === id);
  if (index < 0) throw buildError(404, `No existe producto con N° ${id}.`);

  const current = products[index];
  const stockBefore = round2(Number(current.STOCK_ACTUAL || 0));
  const stockAfter = round2(stockBefore + quantity);
  const updated = { ...current, STOCK_ACTUAL: stockAfter };

  products[index] = updated;
  await writeProducts(products);

  const movement = await appendKardexMovement({
    "N°": updated["N°"],
    NOMBRE: updated.NOMBRE,
    TIPO: "INGRESO",
    CANTIDAD: round2(quantity),
    STOCK_ANTES: stockBefore,
    STOCK_DESPUES: stockAfter,
    REFERENCIA: trimValue(payload.referencia ?? payload.REFERENCIA) || "INGRESO_MANUAL",
    NOTA: trimValue(payload.nota ?? payload.NOTA) || "Ingreso manual"
  });

  return {
    product: updated,
    movement
  };
}

async function deleteSale(idInput, payload = {}) {
  const saleId = parseId(idInput);
  if (!saleId) throw buildError(400, "El id de la venta es invalido.");

  const sales = await readSales();
  const saleIndex = sales.findIndex((item) => Number(item.ID_VENTA) === saleId);
  if (saleIndex < 0) throw buildError(404, `No existe venta con ID ${saleId}.`);

  const sale = sales[saleIndex];
  const productId = Number(sale["N°"]);
  const quantity = round2(Number(sale.CANTIDAD || 0));
  const products = await readProducts();
  const productIndex = products.findIndex((item) => item["N°"] === productId);
  if (productIndex < 0) {
    throw buildError(404, `No existe producto N° ${productId} asociado a la venta.`);
  }

  const product = products[productIndex];
  const stockBefore = round2(Number(product.STOCK_ACTUAL || 0));
  const stockAfter = round2(stockBefore + quantity);
  const updatedProduct = { ...product, STOCK_ACTUAL: stockAfter };
  products[productIndex] = updatedProduct;

  sales.splice(saleIndex, 1);
  await writeProducts(products);
  await writeSales(sales);

  const reason =
    trimValue(payload.motivo ?? payload.anulada_motivo ?? payload.reason) ||
    `Anulacion manual venta #${saleId}`;
  const movement = await appendKardexMovement({
    "N°": updatedProduct["N°"],
    NOMBRE: updatedProduct.NOMBRE,
    TIPO: "INGRESO",
    CANTIDAD: quantity,
    STOCK_ANTES: stockBefore,
    STOCK_DESPUES: stockAfter,
    REFERENCIA: `VENTA_ANULADA:${saleId}`,
    NOTA: reason
  });

  return {
    ok: true,
    sale: {
      ...sale,
      ESTADO: "ANULADA",
      ANULADA_AT: nowIsoDateTime(),
      ANULADA_MOTIVO: reason
    },
    product: updatedProduct,
    movement
  };
}

async function deleteKardexMovement(idInput) {
  const movementId = parseId(idInput);
  if (!movementId) throw buildError(400, "El id del movimiento es invalido.");

  const movements = await readKardex();
  const index = movements.findIndex((item) => Number(item.ID_MOV) === movementId);
  if (index < 0) throw buildError(404, `No existe movimiento kardex #${movementId}.`);

  const [removed] = movements.splice(index, 1);
  await writeKardex(movements);
  return removed;
}

async function deleteAllKardexMovements() {
  const movements = await readKardex();
  const deletedCount = movements.length;
  await writeKardex([]);
  return { deletedCount };
}

module.exports = {
  BASE_CSV_PATH,
  DEFAULT_PRODUCTS_CSV_PATH,
  VENTAS_CSV_PATH,
  KARDEX_CSV_PATH,
  PURCHASE_PRICE_HISTORY_CSV_PATH,
  SOURCE_CONFIG_PATH,
  ensureProductsCsv,
  ensureInventoryData,
  listProducts,
  listSales,
  listKardex,
  getProductStats,
  getSourceInfo,
  setDefaultSource,
  setSourceFromUpload,
  readRawActiveCsv,
  readProducts,
  readSales,
  readKardex,
  readProductPurchasePriceHistory,
  createProduct,
  updateProduct,
  deleteProduct,
  registerStockIngress,
  registerSale,
  registerSaleBatch,
  updateSale,
  deleteSale,
  deleteKardexMovement,
  deleteAllKardexMovements,
  rebuildProductsCsvFromBase
};
