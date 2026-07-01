import { apiFetch } from "./httpClient.js";

export async function createOpinion(payload) {
  return apiFetch("/api/opiniones", {
    method: "POST",
    body: payload
  });
}
