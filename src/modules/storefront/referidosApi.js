import { apiFetch } from "./httpClient.js";

export async function fetchMiCodigo() {
  return apiFetch("/api/referidos/mi-codigo");
}

export async function listMisInvitaciones() {
  return apiFetch("/api/referidos/invitaciones");
}

export async function enviarInvitacion(payload) {
  return apiFetch("/api/referidos/invitar", { method: "POST", body: payload });
}
