import { apiFetch } from "./httpClient.js";

export async function loadCombos() {
  return apiFetch("/api/combos", { auth: false });
}

export async function loadComboBySlug(slug) {
  return apiFetch(`/api/combos/${encodeURIComponent(slug)}`, { auth: false });
}
