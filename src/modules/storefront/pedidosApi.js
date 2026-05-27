import { apiFetch } from "./httpClient.js";

export async function fetchMyOrders(filtro = "todos") {
  return apiFetch(`/api/orders/mias?estado=${encodeURIComponent(filtro)}`);
}

export async function fetchMyOrderById(codigo) {
  return apiFetch(`/api/orders/mias/${encodeURIComponent(codigo)}`);
}

export async function repeatMyOrder(codigo) {
  return apiFetch(`/api/orders/mias/${encodeURIComponent(codigo)}/repetir`, { method: "POST", body: {} });
}
