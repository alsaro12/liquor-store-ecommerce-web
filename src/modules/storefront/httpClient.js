import { getStoredToken } from "./authApi.js";

const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV && typeof window !== "undefined"
    ? DEV_BACKEND_ORIGIN
    : "");

export async function apiFetch(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const finalHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (auth) {
    const token = getStoredToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return null;
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  if (!response.ok) {
    const errorBody = isJson ? await response.json().catch(() => null) : await response.text().catch(() => "");
    const message =
      (errorBody && (errorBody.message || errorBody.error)) ||
      (typeof errorBody === "string" ? errorBody : "") ||
      `Error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    if (response.status === 401 && auth) {
      // Notifica de forma global para que la app cierre sesión y muestre login
      try {
        window.dispatchEvent(new CustomEvent("licoreria:unauthorized"));
      } catch {}
    }
    throw error;
  }
  return isJson ? response.json() : response.text();
}
