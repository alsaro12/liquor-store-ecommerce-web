import { apiFetch } from "./httpClient.js";

export async function loadPromos() {
  return apiFetch("/api/promos", { auth: false });
}

export async function loadPromoDestacada() {
  return apiFetch("/api/promos/destacada", { auth: false });
}

export async function validarPromoCodigo(codigo) {
  return apiFetch("/api/promos/validar", { method: "POST", body: { codigo }, auth: false });
}
