import { apiFetch } from "./httpClient.js";

export async function listNotificaciones({ tipo = "", soloNoLeidas = false } = {}) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  if (soloNoLeidas) params.set("soloNoLeidas", "1");
  const qs = params.toString();
  return apiFetch(`/api/notificaciones${qs ? `?${qs}` : ""}`);
}

export async function countNoLeidas() {
  return apiFetch("/api/notificaciones/no-leidas");
}

export async function leerNotificacion(id) {
  return apiFetch(`/api/notificaciones/${id}/leer`, { method: "POST", body: {} });
}

export async function leerTodasNotificaciones() {
  return apiFetch("/api/notificaciones/leer-todas", { method: "POST", body: {} });
}
