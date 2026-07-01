const API_BASE_STORAGE_KEY = "licoreria.api_base_url";
const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";
const REQUIRED_RUNTIME_VERSION = "licoreria-runtime-2026-05-28-csv-lock-v2";
const BLOCKED_LOCAL_API_PORTS = new Set(["8788", "8790"]);
const TOKEN_KEY = "licoreria_auth_token";

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

function isLocalApiBase(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function isBlockedLocalApiBase(url) {
  try {
    const { hostname, port } = new URL(url);
    return (hostname === "127.0.0.1" || hostname === "localhost") && BLOCKED_LOCAL_API_PORTS.has(port);
  } catch {
    return false;
  }
}

function getCurrentOrigin() {
  if (typeof window === "undefined") return "";
  return normalizeApiBaseUrl(window.location.origin || "");
}

export function getApiBaseUrl() {
  const currentOrigin = getCurrentOrigin();
  if (typeof window !== "undefined" && currentOrigin && isLocalApiBase(currentOrigin) && !currentOrigin.endsWith(":8787")) {
    return DEV_BACKEND_ORIGIN;
  }
  try {
    const stored = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY) || "");
    if (stored) {
      if (isBlockedLocalApiBase(stored)) {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      } else {
        return stored;
      }
    }
  } catch {
    // noop
  }
  const configured = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL || "");
  if (configured) return configured;
  if (import.meta.env.DEV && typeof window !== "undefined" && currentOrigin && isLocalApiBase(currentOrigin)) {
    return DEV_BACKEND_ORIGIN;
  }
  if (currentOrigin) return currentOrigin;
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return DEV_BACKEND_ORIGIN;
  }
  return "";
}

export function saveApiBaseUrlPreference(url) {
  const normalized = normalizeApiBaseUrl(url);
  const safeUrl = isBlockedLocalApiBase(normalized) ? "" : normalized;
  try {
    if (safeUrl) {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, safeUrl);
    } else {
      window.localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch {
    // noop
  }
  return safeUrl;
}

function buildApiUrl(path, baseUrl = "") {
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${String(path || "")}`;
  const requestedBase = normalizeApiBaseUrl(baseUrl);
  const runtimeBase = isBlockedLocalApiBase(requestedBase) ? getApiBaseUrl() : requestedBase || getApiBaseUrl();
  return runtimeBase ? `${runtimeBase}${normalizedPath}` : normalizedPath;
}

function buildApiUrlCandidates(path) {
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${String(path || "")}`;
  const candidates = [
    buildApiUrl(normalizedPath),
    getCurrentOrigin() ? `${getCurrentOrigin()}${normalizedPath}` : "",
    `${DEV_BACKEND_ORIGIN}${normalizedPath}`
  ].filter(Boolean);
  return [...new Set(candidates)];
}

async function requestJson(path) {
  const response = await fetch(buildApiUrl(path), {
    cache: "no-store",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `No se pudo cargar ${path}: ${response.status}`);
  }
  return response.json();
}

function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function buildAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readErrorMessage(response) {
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  if (isJson) {
    const data = await response.json().catch(() => null);
    return data?.error || data?.message || "";
  }
  return response.text().catch(() => "");
}

export function loadSalesAll() {
  return requestJson("/api/ventas/all");
}

export function loadOrdersAll() {
  return requestJson("/api/orders");
}

export async function updateOrderStatus(id, payload) {
  const path = `/api/orders/${encodeURIComponent(id)}`;
  const options = {
    method: "PATCH",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  };
  let response = null;
  let networkError = null;
  for (const url of buildApiUrlCandidates(path)) {
    try {
      response = await fetch(url, options);
      networkError = null;
      break;
    } catch (error) {
      networkError = error;
    }
  }
  if (!response) {
    throw new Error(networkError?.message || "No se pudo conectar con el servidor de pedidos.");
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo actualizar el pedido.");
  }
  return response.json();
}

export async function createSale(payload) {
  const response = await fetch(buildApiUrl("/api/ventas"), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo registrar la venta.");
  }
  return response.json();
}

export async function analyzeReceiptImage(payload) {
  const response = await fetch(buildApiUrl("/api/ai/receipt/analyze"), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo analizar la imagen.");
  }
  return response.json();
}

export async function downloadSalesReport({ from = "", to = "", q = "", format = "xlsx" } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (q) params.set("q", q);
  params.set("format", format);
  const response = await fetch(buildApiUrl(`/api/ventas/export/csv?${params.toString()}`), {
    cache: "no-store",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo descargar el reporte.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `ventas_diarias.${format === "xlsx" ? "xlsx" : "csv"}`;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return { fileName };
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

export function loadOpinionesAll(status = "") {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const query = params.toString();
  return requestJson(`/api/opiniones${query ? `?${query}` : ""}`);
}

export async function updateOpinionStatus(id, status) {
  const response = await fetch(buildApiUrl(`/api/opiniones/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status })
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo actualizar la opinión.");
  }
  return response.json();
}

export function loadStoreDeliveryConfig() {
  return requestJson("/api/store-delivery-config");
}

export async function saveStoreDeliveryConfig(payload) {
  const response = await fetch(buildApiUrl("/api/store-delivery-config"), {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo guardar la configuración de delivery.");
  }
  return response.json();
}

export async function quoteDelivery(payload) {
  const response = await fetch(buildApiUrl("/api/delivery/quote"), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "No se pudo calcular el delivery.");
    error.payload = data;
    throw error;
  }
  return data;
}

export async function loadRuntimeStatus(baseUrl = "") {
  const response = await fetch(buildApiUrl("/api/runtime", baseUrl), {
    cache: "no-store",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error("Servidor antiguo detectado. Abre el admin en http://127.0.0.1:8787/admin.");
  }
  const runtime = await response.json();
  if (runtime?.runtimeVersion !== REQUIRED_RUNTIME_VERSION || runtime?.productsLockedToProject !== true) {
    throw new Error("Servidor antiguo detectado. Abre el admin en http://127.0.0.1:8787/admin.");
  }
  return runtime;
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

export function loadProductsAll() {
  return requestJson("/api/productos/all");
}

export function loadCombosAll() {
  return requestJson("/api/combos");
}

export function loadCouponsAll() {
  return requestJson("/api/coupons");
}

export async function saveCoupon(id, payload) {
  const path = id ? `/api/coupons/${encodeURIComponent(id)}` : "/api/coupons";
  const response = await fetch(buildApiUrl(path), {
    method: id ? "PUT" : "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo guardar el cupón.");
  }
  return response.json();
}

export async function deleteCoupon(id) {
  const response = await fetch(buildApiUrl(`/api/coupons/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo eliminar el cupón.");
  }
  return response.json();
}

export async function createCombo(payload) {
  const response = await fetch(buildApiUrl("/api/combos"), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo crear el combo.");
  }
  return response.json();
}

export async function updateCombo(id, payload) {
  const response = await fetch(buildApiUrl(`/api/combos/${encodeURIComponent(id)}`), {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo actualizar el combo.");
  }
  return response.json();
}

export async function deleteCombo(id) {
  const response = await fetch(buildApiUrl(`/api/combos/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response) || "No se pudo eliminar el combo.");
  }
  return response.json();
}

export function loadProductById(id) {
  return requestJson(`/api/productos/${id}`);
}

export async function createProduct(payload) {
  const response = await fetch(buildApiUrl("/api/productos"), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
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
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo actualizar el producto.");
  }
  return response.json();
}

export async function inactivateProduct(id) {
  const response = await fetch(buildApiUrl(`/api/productos/${id}`), {
    method: "DELETE",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo inactivar el producto.");
  }
  return response.json();
}

export async function registerProductIngress(id, payload) {
  const response = await fetch(buildApiUrl(`/api/productos/${id}/ingreso`), {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo registrar el ingreso.");
  }
  return response.json();
}

export async function deleteKardexMovement(id) {
  const response = await fetch(buildApiUrl(`/api/kardex/${id}`), {
    method: "DELETE",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo eliminar el movimiento.");
  }
  return response.json();
}

export async function deleteAllKardexMovements() {
  const response = await fetch(buildApiUrl("/api/kardex"), {
    method: "DELETE",
    headers: buildAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(await response.text() || "No se pudo limpiar el kardex.");
  }
  return response.json();
}

export async function requestJsonWithBase(path, baseUrl) {
  const response = await fetch(buildApiUrl(path, baseUrl), {
    cache: "no-store",
    headers: buildAuthHeaders()
  });
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
