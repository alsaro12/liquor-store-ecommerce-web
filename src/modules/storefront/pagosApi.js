import { apiFetch } from "./httpClient.js";

export async function listMetodosPago() {
  return apiFetch("/api/metodos-pago");
}

export async function createMetodoPago(payload) {
  return apiFetch("/api/metodos-pago", { method: "POST", body: payload });
}

export async function deleteMetodoPago(id) {
  return apiFetch(`/api/metodos-pago/${id}`, { method: "DELETE" });
}

export async function setMetodoPagoPrincipal(id) {
  return apiFetch(`/api/metodos-pago/${id}/principal`, { method: "POST", body: {} });
}
