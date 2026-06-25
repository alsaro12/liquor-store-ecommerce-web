import { apiFetch } from "./httpClient.js";

export async function fetchCuentaResumen() {
  return apiFetch("/api/cuenta/resumen");
}
