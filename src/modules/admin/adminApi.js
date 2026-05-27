const API_BASE_STORAGE_KEY = "licoreria.api_base_url";
const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";

function normalizeApiBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).toString().replace(/\/$/, "");
  } catch {
    if (/^https?:\/\//i.test(text)) {
      return text.replace(/\/$/, "");
    }
    return "";
  }
}

export function getApiBaseUrl() {
  try {
    const stored = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY) || "");
    if (stored) return stored;
  } catch {
    // noop
  }
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) return configured;
  if (import.meta.env.DEV && typeof window !== "undefined" && window.location.port === "5173") {
    return DEV_BACKEND_ORIGIN;
  }
  return "";
}

export function saveApiBaseUrlPreference(url) {
  const normalized = normalizeApiBaseUrl(url);
  try {
    if (normalized) {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch {
    // noop
  }
  return normalized;
}

function buildApiUrl(path, baseUrl = "") {
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${String(path || "")}`;
  const runtimeBase = normalizeApiBaseUrl(baseUrl) || getApiBaseUrl();
  return runtimeBase ? `${runtimeBase}${normalizedPath}` : normalizedPath;
}

async function requestJson(path) {
  const response = await fetch(buildApiUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path}: ${response.status}`);
  }
  return response.json();
}

export function loadSalesAll() {
  return requestJson("/api/ventas/all");
}

export function loadKardexAll() {
  return requestJson("/api/kardex/all");
}

export function loadProductsStats() {
  return requestJson("/api/productos/stats");
}

export function loadDbStatus() {
  return requestJson("/api/db/status");
}

export function loadProductsPage(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.q) query.set("q", String(params.q));
  if (params.sortBy) query.set("sortBy", String(params.sortBy));
  if (params.sortDir) query.set("sortDir", String(params.sortDir));
  return requestJson(`/api/productos?${query.toString()}`);
}

export function loadProductById(id) {
  return requestJson(`/api/productos/${id}`);
}

export async function createProduct(payload) {
  const response = await fetch(buildApiUrl("/api/productos"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo crear el producto.");
  }
  return response.json();
}

export async function updateProduct(id, payload) {
  const response = await fetch(buildApiUrl(`/api/productos/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo actualizar el producto.");
  }
  return response.json();
}

export async function inactivateProduct(id) {
  const response = await fetch(buildApiUrl(`/api/productos/${id}`), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo inactivar el producto.");
  }
  return response.json();
}

export async function registerProductIngress(id, payload) {
  const response = await fetch(buildApiUrl(`/api/productos/${id}/ingreso`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo registrar el ingreso.");
  }
  return response.json();
}

export async function deleteKardexMovement(id) {
  const response = await fetch(buildApiUrl(`/api/kardex/${id}`), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo eliminar el movimiento.");
  }
  return response.json();
}

export async function deleteAllKardexMovements() {
  const response = await fetch(buildApiUrl("/api/kardex"), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo limpiar el kardex.");
  }
  return response.json();
}

export async function requestJsonWithBase(path, baseUrl) {
  const response = await fetch(buildApiUrl(path, baseUrl), { cache: "no-store" });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    throw new Error(typeof payload === "string" && payload ? payload : `No se pudo cargar ${path}: ${response.status}`);
  }
  return payload;
}

export function getApiBaseStorageKey() {
  return API_BASE_STORAGE_KEY;
}
