import { normalizeProductCategory } from "../productCategories.js";

export const DAYS_ES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

export function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

export function formatQty(value) {
  const amount = Number(value || 0);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function parseDateTime(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] || 0),
      Number(iso[5] || 0),
      Number(iso[6] || 0),
      0
    );
  }
  const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (local) {
    return new Date(
      Number(local[3]),
      Number(local[2]) - 1,
      Number(local[1]),
      Number(local[4] || 0),
      Number(local[5] || 0),
      Number(local[6] || 0),
      0
    );
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function getOperationalBaseDate(date) {
  const base = new Date(date);
  if (base.getHours() < 5) {
    base.setDate(base.getDate() - 1);
  }
  return base;
}

export function toInputDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function getTodayOperationalDate() {
  return toInputDate(getOperationalBaseDate(new Date()));
}

export function buildOperationalRange(from, to) {
  if (!from && !to) return null;
  const startIso = from || to;
  const endIso = to || from;
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd, 5, 0, 0, 0);
  const end = new Date(ey, em - 1, ed, 5, 0, 0, 0);
  if (end < start) return null;
  end.setDate(end.getDate() + 1);
  end.setHours(4, 59, 59, 999);
  return { start, end };
}

export function formatTurnLabel(inputDate) {
  const parsed = parseDateTime(`${inputDate} 12:00:00`);
  if (!parsed) return "Turno -";
  return `Turno ${DAYS_ES[parsed.getDay()]} ${String(parsed.getDate()).padStart(2, "0")}`;
}

export function getTurnName(rawValue) {
  const parsed = parseDateTime(rawValue);
  if (!parsed) return "-";
  const businessDate = getOperationalBaseDate(parsed);
  return DAYS_ES[businessDate.getDay()];
}

export function formatDateTime(rawValue) {
  const parsed = parseDateTime(rawValue);
  if (!parsed) return "-";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function normalizeProduct(item) {
  const productId = Number(item?.["N°"] ?? item?.productId ?? item?.id ?? item?.N ?? 0);
  const stockActual = Number(item?.STOCK_ACTUAL ?? item?.stock ?? 0);
  const stockMinimo = Number(item?.STOCK_MINIMO ?? item?.stockMin ?? 0);
  const stockMaximo = Number(item?.STOCK_MAXIMO ?? item?.PEDIDO ?? item?.stockMax ?? 0);
  const estado = String(item?.ESTADO ?? item?.status ?? "ACTIVO").toUpperCase();
  const alertaTexto = String(item?.ALERTA_STOCK ?? item?.alertLabel ?? "").toUpperCase();
  let alertKey = "ok";
  let alertLabel = "OK";
  if (stockActual <= 0 && estado === "ACTIVO") {
    alertKey = "out";
    alertLabel = "Sin stock";
  } else if (alertaTexto && alertaTexto !== "OK") {
    alertKey = "low";
    alertLabel = "Stock bajo";
  } else if (stockMinimo > 0 && stockActual < stockMinimo) {
    alertKey = "low";
    alertLabel = "Stock bajo";
  }
  return {
    id: productId,
    code: productId,
    name: String(item?.NOMBRE ?? item?.name ?? "").trim(),
    description: String(item?.DESCRIPCION ?? item?.description ?? "").trim(),
    category: normalizeProductCategory(item?.CATEGORIA ?? item?.category ?? "OTRO"),
    price: Number(item?.PRECIO ?? item?.price ?? 0),
    purchasePrice: Number(item?.PRECIO_COMPRA ?? item?.purchasePrice ?? 0),
    images: Array.isArray(item?.IMAGENES)
      ? item.IMAGENES
      : Array.isArray(item?.imagenes)
        ? item.imagenes
        : Array.isArray(item?.images)
          ? item.images
        : [],
    cigarettePresentations: normalizeCigarettePresentations(item?.CIGARRO_PRESENTACIONES ?? item?.cigarettePresentations ?? item?.presentacionesCigarro),
    cigaretteStockLink: item?.CIGARRO_STOCK_LINK ?? item?.cigaretteStockLink ?? item?.stockLinkCigarro ?? null,
    variants: normalizeProductVariants(item?.VARIANTES ?? item?.variants ?? item?.variantes),
    stock: stockActual,
    stockMin: stockMinimo,
    stockMax: stockMaximo,
    status: estado,
    alertKey,
    alertLabel,
    suggestedOrder: Number(item?.PEDIDO_SUGERIDO ?? 0)
  };
}

export function normalizeCigarettePresentations(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const normalized = list
    .map((item) => {
      const id = String(item?.id ?? item?.tipo ?? "").trim().toLowerCase();
      const units = Number(item?.units ?? item?.unidades ?? 1);
      if (!["unit", "box10", "box20"].includes(id) || !Number.isFinite(units) || units <= 0) return null;
      return {
        id,
        label: String(item?.label ?? item?.nombre ?? (id === "unit" ? "Unidad" : id === "box10" ? "Caja x10" : "Caja x20")).trim(),
        units,
        reportUnits: id === "box20" ? 20 : 1,
        enabled: item?.enabled !== false && item?.activo !== false,
        price: Number(item?.price ?? item?.precio ?? 0)
      };
    })
    .filter(Boolean);
  const activeIndex = normalized.findIndex((item) => item.enabled);
  return normalized.map((item, index) => ({
    ...item,
    enabled: activeIndex < 0 ? item.id === "unit" : index === activeIndex
  }));
}

export function normalizeProductVariants(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list
    .map((item, index) => {
      const name = String(item?.name ?? item?.NOMBRE ?? item?.nombre ?? "").trim();
      if (!name) return null;
      return {
        id: String(item?.id ?? item?.ID_VARIANTE ?? item?.variantId ?? `variante-${index + 1}`).trim() || `variante-${index + 1}`,
        name,
        description: String(item?.description ?? item?.DESCRIPCION ?? item?.descripcion ?? "").trim(),
        price: item?.price ?? item?.PRECIO ?? item?.precio ?? "",
        purchasePrice: item?.purchasePrice ?? item?.PRECIO_COMPRA ?? item?.precioCompra ?? item?.precio_compra ?? "",
        stock: item?.stock ?? item?.STOCK_ACTUAL ?? item?.stockActual ?? item?.stock_actual ?? "0",
        stockMin: item?.stockMin ?? item?.STOCK_MINIMO ?? item?.stock_minimo ?? "0",
        stockMax: item?.stockMax ?? item?.STOCK_MAXIMO ?? item?.stock_maximo ?? "0",
        status: String(item?.status ?? item?.ESTADO ?? item?.estado ?? "ACTIVO").toUpperCase(),
        images: Array.isArray(item?.images) ? item.images : Array.isArray(item?.IMAGENES) ? item.IMAGENES : []
      };
    })
    .filter(Boolean);
}
