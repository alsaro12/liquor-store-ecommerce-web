const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV && typeof window !== "undefined" && window.location.port === "5173"
    ? DEV_BACKEND_ORIGIN
    : "");

const TOKEN_KEY = "licoreria_auth_token";

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function postJson(path, body, token = "") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  if (!response.ok) {
    const message = await response.text();
    const error = new Error(message || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function registerCustomer(payload) {
  return postJson("/api/auth/register", payload);
}

export async function loginCustomer(payload) {
  return postJson("/api/auth/login", payload);
}

export async function logoutCustomer(token) {
  try {
    await postJson("/api/auth/logout", {}, token);
  } catch {}
}

export async function fetchCurrentUser(token) {
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.user || null;
  } catch {
    return null;
  }
}
