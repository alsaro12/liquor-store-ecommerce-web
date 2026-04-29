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

const PRODUCT_HEADERS = ["N°", "NOMBRE", "DESCRIPCION", "CATEGORIA", "PRECIO", "PRECIO_COMPRA", "IMAGENES", "STOCK_MAXIMO", "STOCK_MINIMO", "STOCK_ACTUAL"];
const VENTAS_HEADERS = [
  "ID_VENTA",
  "FECHA",
  "NÂ°",
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
  "NÂ°",
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
  "NÂ°",
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
    compact === "Nï¿½" ||
    compact === "NÂ°" ||
    compact === "Nï¿½" ||
    compact === "NÂº" ||
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
    row["NÂ°"] ??
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
  if (["APP", "APLICACION", "APLICACIï¿½N"].includes(normalized)) return "APP";
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
  const id = parseId(raw["NÂ°"] ?? raw.id ?? raw.n);
  if (!id) throw buildError(400, "El campo NÂ° es obligatorio y debe ser un numero entero positivo.");

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
    .slice(0, 4);

  return {
    "NÂ°": id,
    NOMBRE: name,
    DESCRIPCION: description,
    CATEGORIA: normalizeProductCategoryValue(raw.CATEGORIA ?? raw.categoria ?? "OTRO"),
    PRECIO: round2(price),
    PRECIO_COMPRA: round2(purchasePrice),
    IMAGENES: images,
    PEDIDO: stockMaximo ?? 0,
    STOCK_MINIMO: round2(stockMinimo),
    STOCK_ACTUAL: round2(stockActual)
  };
}

function productToRow(product) {
  return [
    product["NÂ°"],
    product.NOMBRE,
    product.DESCRIPCION ?? "",
    product.CATEGORIA ?? "OTRO",
    product.PRECIO,
    product.PRECIO_COMPRA ?? 0,
    JSON.stringify(Array.isArray(product.IMAGENES) ? product.IMAGENES.slice(0, 4) : []),
    product.PEDIDO,
    product.STOCK_MINIMO ?? 0,
    product.STOCK_ACTUAL
  ];
}

function saleToRow(sale) {
  const paymentDisplay = trimValue(sale.TIPO_PAGO_DETALLE || sale.TIPO_PAGO || "Efectivo") || "Efectivo";
  return [
    sale.ID_VENTA,
    sale.FECHA,
    sale["NÂ°"],
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
    move["NÂ°"],
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
    item["NÂ°"],
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
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

async function getSourceInfo() {
  const config = await readSourceConfig();
  const activeCsvPath = resolveConfiguredPath(config?.activeCsvPath);
  const sourceName = trimValue(config?.sourceName) || path.basename(activeCsvPath);
  const sourceType =
    trimValue(config?.sourceType) || (activeCsvPath === DEFAULT_PRODUCTS_CSV_PATH ? "default" : "custom");

  return {
    activeCsvPath,
    defaultCsvPath: DEFAULT_PRODUCTS_CSV_PATH,
    sourceName,
    sourceType,
    exists: await existsFile(activeCsvPath),
    configPath: SOURCE_CONFIG_PATH
  };
}

async function setActiveSourcePath(inputPath, meta = {}) {
  const resolvedPath = resolveConfiguredPath(inputPath);
  if (!resolvedPath.toLowerCase().endsWith(".csv")) {
    throw buildError(400, "El origen debe ser un archivo .csv");
  }

  const sourceName = trimValue(meta.sourceName) || path.basename(resolvedPath);
  const sourceType =
    trimValue(meta.sourceType) || (resolvedPath === DEFAULT_PRODUCTS_CSV_PATH ? "default" : "custom");

  await writeSourceConfig({
    activeCsvPath: resolvedPath,
    sourceName,
    sourceType,
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
      "NÂ°": id,
      NOMBRE: name || previous?.NOMBRE || "",
      DESCRIPCION: previous?.DESCRIPCION || "",
      PRECIO: round2(price ?? previous?.PRECIO ?? 0),
      PRECIO_COMPRA: round2(previous?.PRECIO_COMPRA ?? 0),
      IMAGENES: Array.isArray(previous?.IMAGENES) ? previous.IMAGENES.slice(0, 4) : [],
      PEDIDO: pedido ?? previous?.PEDIDO ?? 0,
      STOCK_MINIMO: round2(previous?.STOCK_MINIMO ?? 0),
      STOCK_ACTUAL: round2(Math.max(0, stockCandidate ?? previous?.STOCK_ACTUAL ?? 0))
    });
  }

  return [...productsById.values()].sort((a, b) => a["NÂ°"] - b["NÂ°"]);
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
        "NÂ°": id,
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
    if (a.FECHA === b.FECHA) return a["NÂ°"] - b["NÂ°"];
    return a.FECHA.localeCompare(b.FECHA);
  });

  return sales.map((item, index) => ({
    ID_VENTA: index + 1,
    ...item
  }));
}

async function writeProductsToPath(products, targetPath) {
  const rows = [PRODUCT_HEADERS, ...products.map(productToRow)];
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, stringifyCsv(rows), "utf8");
}

async function writeSalesToPath(sales, targetPath) {
  const rows = [VENTAS_HEADERS, ...sales.map(saleToRow)];
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, stringifyCsv(rows), "utf8");
}

async function writeKardexToPath(movements, targetPath) {
  const rows = [KARDEX_HEADERS, ...movements.map(movementToRow)];
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, stringifyCsv(rows), "utf8");
}

async function writePurchasePriceHistoryToPath(items, targetPath) {
  const rows = [PURCHASE_PRICE_HISTORY_HEADERS, ...items.map(purchasePriceHistoryToRow)];
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, stringifyCsv(rows), "utf8");
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
  const pedidoIndex = header.findIndex((cell) => {
    const key = normalizeHeaderKey(cell);
    return key === "PEDIDO" || key === "STOCKMAXIMO";
  });
  const stockMinIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKMINIMO");
  const stockIndex = header.findIndex((cell) => normalizeHeaderKey(cell) === "STOCKACTUAL");

  if (idIndex < 0 || nameIndex < 0 || priceIndex < 0) {
    throw buildError(400, "CSV invalido. Debe incluir columnas NÂ°, NOMBRE y PRECIO.");
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
          if (Array.isArray(parsed)) images = normalizeProductRecord({ "NÂ°": id, NOMBRE: name, PRECIO: price, IMAGENES: parsed }).IMAGENES;
        } catch {
          images = normalizeProductRecord({ "NÂ°": id, NOMBRE: name, PRECIO: price, IMAGENES: rawImages.split("|") }).IMAGENES;
        }
      }
    }
    const pedido = pedidoIndex >= 0 ? parseInteger(row[pedidoIndex]) ?? 0 : 0;
    const stockMinimo = stockMinIndex >= 0 ? parseDecimal(row[stockMinIndex]) ?? 0 : 0;
    const stock = stockIndex >= 0 ? parseDecimal(row[stockIndex]) ?? 0 : 0;

    productsById.set(id, {
      "NÂ°": id,
      NOMBRE: name,
      DESCRIPCION: trimValue(descriptionIndex >= 0 ? row[descriptionIndex] : ""),
      CATEGORIA: normalizeProductCategoryValue(categoryIndex >= 0 ? row[categoryIndex] : "OTRO"),
      PRECIO: price,
      PRECIO_COMPRA: purchasePrice,
      IMAGENES: images,
      PEDIDO: pedido,
      STOCK_MINIMO: round2(Math.max(0, stockMinimo)),
      STOCK_ACTUAL: round2(Math.max(0, stock))
    });
  }

  return [...productsById.values()].sort((a, b) => a["NÂ°"] - b["NÂ°"]);
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
      "NÂ°": productId,
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
      "NÂ°": productId,
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
      "NÂ°": productId,
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

  const safeName = sanitizeFileName(filename || "productos_manual.csv");
  const targetPath = path.join(SOURCES_DIR, `${Date.now()}_${safeName}`);
  await writeProductsToPath(products, targetPath);

  await setActiveSourcePath(targetPath, {
    sourceName: safeName,
    sourceType: "uploaded"
  });

  return getSourceInfo();
}

async function ensureProductsCsv(options = {}) {
  const forceRebuild = Boolean(options.forceRebuild);

  if (forceRebuild) {
    const products = await rebuildProductsCsvFromBase();
    if (options.activateDefault !== false) await setDefaultSource();
    return products;
  }

  const source = await getSourceInfo();
  if (await existsFile(source.activeCsvPath)) {
    return null;
  }

  if (source.activeCsvPath !== DEFAULT_PRODUCTS_CSV_PATH) {
    await setDefaultSource();
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
      stockById = new Map(baseProducts.map((item) => [item["NÂ°"], item.STOCK_ACTUAL]));
    } catch {
      stockById = new Map();
    }
  }

  const migrated = currentProducts.map((item) => ({
    ...item,
    CATEGORIA: normalizeProductCategoryValue(item.CATEGORIA || "OTRO"),
    PRECIO_COMPRA: round2(Math.max(0, item.PRECIO_COMPRA ?? 0)),
    IMAGENES: Array.isArray(item.IMAGENES) ? item.IMAGENES.slice(0, 4) : [],
    STOCK_ACTUAL: round2(Math.max(0, stockById.get(item["NÂ°"]) ?? 0))
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
      String(item["NÂ°"]).includes(query) ||
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
      String(item["NÂ°"]).includes(query) ||
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
      String(item["NÂ°"]).includes(query) ||
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
    "NÂ°": payload["NÂ°"],
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
    "NÂ°": payload["NÂ°"],
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
  return history.filter((item) => item["NÂ°"] === productId);
}

async function createProduct(payload) {
  const products = await readProducts();
  const hasCustomId =
    payload["Nï¿½"] !== undefined || payload["NÂ°"] !== undefined || payload.id !== undefined || payload.n !== undefined;
  const nextId = products.reduce((max, item) => Math.max(max, item["NÂ°"]), 0) + 1;
  const withId = {
    ...payload,
    "NÂ°": hasCustomId ? payload["Nï¿½"] ?? payload["NÂ°"] ?? payload.id ?? payload.n : nextId
  };

  const stockInitial =
    payload.STOCK_ACTUAL ?? payload.stockActual ?? payload.stock_actual ?? payload.stockInicial ?? 0;

  const product = normalizeProductRecord({ ...withId, STOCK_ACTUAL: stockInitial });

  if (products.some((item) => item["NÂ°"] === product["NÂ°"])) {
    throw buildError(409, `Ya existe un producto con NÂ° ${product["NÂ°"]}.`);
  }

  products.push(product);
  products.sort((a, b) => a["NÂ°"] - b["NÂ°"]);
  await writeProducts(products);

  if (Number(product.PRECIO_COMPRA || 0) > 0) {
    await appendPurchasePriceHistory({
      "NÂ°": product["NÂ°"],
      NOMBRE: product.NOMBRE,
      PRECIO_COMPRA: Number(product.PRECIO_COMPRA || 0),
      NOTA: "Precio de compra inicial",
      ORIGEN: "CREACION_PRODUCTO"
    });
  }

  if (Number(product.STOCK_ACTUAL) > 0) {
    await appendKardexMovement({
      "NÂ°": product["NÂ°"],
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
  const index = products.findIndex((item) => item["NÂ°"] === id);
  if (index < 0) throw buildError(404, `No existe producto con NÂ° ${id}.`);

  const current = products[index];
  const hasNextId =
    payload["Nï¿½"] !== undefined ||
    payload["NÂ°"] !== undefined ||
    payload["N°"] !== undefined ||
    payload.id !== undefined ||
    payload.n !== undefined;
  const nextId = hasNextId ? parseId(payload["Nï¿½"] ?? payload["NÂ°"] ?? payload["N°"] ?? payload.id ?? payload.n) : id;
  if (!nextId) throw buildError(400, "El campo NÂ° debe ser un numero entero positivo.");
  const shouldSwapProductCode =
    payload.swapProductCode === true ||
    payload.intercambiarCodigo === true ||
    payload.intercambiar_orden === true;
  const targetIndex = products.findIndex((item) => item["NÂ°"] === nextId);
  if (nextId !== id && targetIndex >= 0 && !shouldSwapProductCode) {
    throw buildError(409, `Ya existe un producto con NÂ° ${nextId}.`);
  }

  const stockDelta = parseStockDelta(payload);
  const nextStock = round2(Number(current.STOCK_ACTUAL || 0) + stockDelta);

  if (nextStock < 0) {
    throw buildError(400, `Stock insuficiente para NÂ° ${id}. Stock actual: ${current.STOCK_ACTUAL}.`);
  }

  const merged = {
    "NÂ°": nextId,
    NOMBRE: payload.NOMBRE ?? current.NOMBRE,
    DESCRIPCION: payload.DESCRIPCION ?? payload.descripcion ?? current.DESCRIPCION ?? "",
    CATEGORIA: normalizeProductCategoryValue(payload.CATEGORIA ?? payload.categoria ?? current.CATEGORIA ?? "OTRO"),
    PRECIO: payload.PRECIO ?? current.PRECIO,
    PRECIO_COMPRA:
      payload.PRECIO_COMPRA ?? payload.precio_compra ?? payload.precioCompra ?? current.PRECIO_COMPRA ?? 0,
    IMAGENES: payload.IMAGENES ?? payload.imagenes ?? payload.imagenes_json ?? current.IMAGENES ?? [],
    PEDIDO:
      payload.STOCK_MAXIMO ??
      payload.stock_maximo ??
      payload.stockMaximo ??
      payload.PEDIDO ??
      current.PEDIDO,
    STOCK_MINIMO: payload.STOCK_MINIMO ?? payload.stock_minimo ?? payload.stockMinimo ?? current.STOCK_MINIMO ?? 0,
    STOCK_ACTUAL: nextStock
  };

  const updated = normalizeProductRecord(merged);
  products[index] = updated;
  if (nextId !== id && targetIndex >= 0) {
    products[targetIndex] = normalizeProductRecord({ ...products[targetIndex], "NÂ°": id });
  }
  products.sort((a, b) => a["NÂ°"] - b["NÂ°"]);
  await writeProducts(products);

  if (nextId !== id) {
    const sales = await readSales();
    const updatedSales = sales.map((sale) => {
      if (sale["NÂ°"] === id) return { ...sale, "NÂ°": nextId };
      if (targetIndex >= 0 && sale["NÂ°"] === nextId) return { ...sale, "NÂ°": id };
      return sale;
    });
    await writeSales(updatedSales);

    const movements = await readKardex();
    const updatedMovements = movements.map((movement) => {
      if (movement["NÂ°"] === id) return { ...movement, "NÂ°": nextId };
      if (targetIndex >= 0 && movement["NÂ°"] === nextId) return { ...movement, "NÂ°": id };
      return movement;
    });
    await writeKardex(updatedMovements);

    const history = await readPurchasePriceHistory();
    const updatedHistory = history.map((item) => {
      if (item["NÂ°"] === id) return { ...item, "NÂ°": nextId };
      if (targetIndex >= 0 && item["NÂ°"] === nextId) return { ...item, "NÂ°": id };
      return item;
    });
    await writePurchasePriceHistory(updatedHistory);
  }

  if (round2(updated.PRECIO_COMPRA || 0) !== round2(current.PRECIO_COMPRA || 0)) {
    await appendPurchasePriceHistory({
      "NÂ°": updated["NÂ°"],
      NOMBRE: updated.NOMBRE,
      PRECIO_COMPRA: Number(updated.PRECIO_COMPRA || 0),
      NOTA: trimValue(payload.nota) || "Cambio de precio de compra",
      ORIGEN: "EDICION_PRODUCTO"
    });
  }

  if (stockDelta !== 0) {
    await appendKardexMovement({
      "NÂ°": updated["NÂ°"],
      NOMBRE: updated.NOMBRE,
      TIPO: stockDelta > 0 ? "INGRESO" : "SALIDA",
      CANTIDAD: Math.abs(stockDelta),
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
  const index = products.findIndex((item) => item["NÂ°"] === id);
  if (index < 0) throw buildError(404, `No existe producto con NÂ° ${id}.`);

  const [removed] = products.splice(index, 1);
  await writeProducts(products);
  return removed;
}

async function registerSale(payload) {
  const productId = parseId(payload["NÂ°"] ?? payload.id ?? payload.productId);
  if (!productId) throw buildError(400, "Debes indicar un producto valido.");

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
  const index = products.findIndex((item) => item["NÂ°"] === productId);
  if (index < 0) throw buildError(404, `No existe producto con NÂ° ${productId}.`);

  const product = products[index];
  const stockBefore = Number(product.STOCK_ACTUAL || 0);
  const stockAfter = round2(stockBefore - quantity);

  if (stockAfter < 0) {
    throw buildError(400, `Stock insuficiente para NÂ° ${productId}. Stock actual: ${stockBefore}.`);
  }

  product.STOCK_ACTUAL = stockAfter;
  products[index] = product;
  await writeProducts(products);

  const sales = await readSales();
  const nextSaleId = sales.reduce((max, item) => Math.max(max, item.ID_VENTA || 0), 0) + 1;
  const price = Number(product.PRECIO || 0);

  const sale = {
    ID_VENTA: nextSaleId,
    FECHA: fecha,
    "NÂ°": product["NÂ°"],
    NOMBRE: product.NOMBRE,
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
    "NÂ°": product["NÂ°"],
    NOMBRE: product.NOMBRE,
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
    const quantity = parseDecimal(row?.cantidad ?? row?.CANTIDAD);
    if (quantity === null || quantity <= 0) {
      throw buildError(400, "La cantidad de venta debe ser mayor a 0.");
    }
    const prev = aggregated.get(productId) || 0;
    aggregated.set(productId, round2(prev + quantity));
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
  for (const [productId, cantidad] of aggregated.entries()) {
    const index = products.findIndex((item) => Number(item["NÂ°"]) === Number(productId));
    if (index < 0) throw buildError(404, `No existe producto con NÂ° ${productId}.`);
    const product = products[index];
    const stockBefore = round2(Number(product.STOCK_ACTUAL || 0));
    const stockAfter = round2(stockBefore - cantidad);
    if (stockAfter < 0) {
      throw buildError(400, `Stock insuficiente para NÂ° ${productId}. Stock actual: ${stockBefore}.`);
    }
    const price = round2(Number(product.PRECIO || 0));
    items.push({
      index,
      productId,
      cantidad: round2(cantidad),
      product,
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
      "NÂ°": item.product["NÂ°"],
      NOMBRE: item.product.NOMBRE,
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
        "NÂ°": item.product["NÂ°"],
        NOMBRE: item.product.NOMBRE,
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
    payload["NÂ°"] ?? payload.id ?? payload.productId ?? currentSale["NÂ°"]
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
  const currentProductId = Number(currentSale["NÂ°"]);
  const currentQty = round2(Number(currentSale.CANTIDAD || 0));

  const currentProductIndex = products.findIndex((item) => item["NÂ°"] === currentProductId);
  if (currentProductIndex < 0) {
    throw buildError(404, `No existe producto NÂ° ${currentProductId} asociado a la venta.`);
  }

  const nextProductIndex = products.findIndex((item) => item["NÂ°"] === nextProductId);
  if (nextProductIndex < 0) {
    throw buildError(404, `No existe producto con NÂ° ${nextProductId}.`);
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
        `Stock insuficiente para NÂ° ${nextProductId}. Stock actual: ${stockBefore}.`
      );
    }

    products[currentProductIndex] = { ...product, STOCK_ACTUAL: stockAfter };

    if (delta !== 0) {
      stockMovementsPayload.push({
        "NÂ°": product["NÂ°"],
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
        `Stock insuficiente para NÂ° ${nextProductId}. Stock actual: ${targetStockBefore}.`
      );
    }

    products[currentProductIndex] = { ...currentProduct, STOCK_ACTUAL: currentStockAfter };
    products[nextProductIndex] = { ...targetProduct, STOCK_ACTUAL: targetStockAfter };

    stockMovementsPayload.push({
      "NÂ°": currentProduct["NÂ°"],
      NOMBRE: currentProduct.NOMBRE,
      TIPO: "INGRESO",
      CANTIDAD: currentQty,
      STOCK_ANTES: currentStockBefore,
      STOCK_DESPUES: currentStockAfter,
      REFERENCIA: `VENTA_EDITADA:${saleId}`,
      NOTA: `${nota} (reversion producto original)`
    });

    stockMovementsPayload.push({
      "NÂ°": targetProduct["NÂ°"],
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
    "NÂ°": finalProduct["NÂ°"],
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
  const index = products.findIndex((item) => item["Nï¿½"] === id);
  if (index < 0) throw buildError(404, `No existe producto con Nï¿½ ${id}.`);

  const current = products[index];
  const stockBefore = round2(Number(current.STOCK_ACTUAL || 0));
  const stockAfter = round2(stockBefore + quantity);
  const updated = { ...current, STOCK_ACTUAL: stockAfter };

  products[index] = updated;
  await writeProducts(products);

  const movement = await appendKardexMovement({
    "Nï¿½": updated["Nï¿½"],
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
  const productId = Number(sale["Nï¿½"]);
  const quantity = round2(Number(sale.CANTIDAD || 0));
  const products = await readProducts();
  const productIndex = products.findIndex((item) => item["Nï¿½"] === productId);
  if (productIndex < 0) {
    throw buildError(404, `No existe producto Nï¿½ ${productId} asociado a la venta.`);
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
    "Nï¿½": updatedProduct["Nï¿½"],
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



