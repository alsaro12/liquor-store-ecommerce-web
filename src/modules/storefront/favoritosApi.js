import { apiFetch } from "./httpClient.js";

export async function listFavoritos() {
  return apiFetch("/api/favoritos");
}

export async function listFavoritoIds() {
  return apiFetch("/api/favoritos/ids");
}

export async function addFavorito(tipo, referenciaId) {
  return apiFetch("/api/favoritos", {
    method: "POST",
    body: { tipo, referencia_id: String(referenciaId) }
  });
}

export async function removeFavoritoByRef(tipo, referenciaId) {
  return apiFetch(
    `/api/favoritos?tipo=${encodeURIComponent(tipo)}&referencia_id=${encodeURIComponent(referenciaId)}`,
    { method: "DELETE" }
  );
}
