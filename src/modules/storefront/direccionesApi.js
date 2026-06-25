import { apiFetch } from "./httpClient.js";

export async function listDirecciones() {
  return apiFetch("/api/direcciones");
}

export async function createDireccion(payload) {
  return apiFetch("/api/direcciones", { method: "POST", body: payload });
}

export async function updateDireccion(id, payload) {
  return apiFetch(`/api/direcciones/${id}`, { method: "PUT", body: payload });
}

export async function deleteDireccion(id) {
  return apiFetch(`/api/direcciones/${id}`, { method: "DELETE" });
}

export async function setDireccionPrincipal(id) {
  return apiFetch(`/api/direcciones/${id}/principal`, { method: "POST", body: {} });
}

// Nominatim (OSM) — sin API key. Respeta su política de uso.
const NOMINATIM = "https://nominatim.openstreetmap.org";
export const AREQUIPA_CENTER = { lat: -16.39889, lng: -71.53696 };
export const AREQUIPA_BOUNDS = {
  minLat: -16.55,
  maxLat: -16.25,
  minLng: -71.75,
  maxLng: -71.35
};
const AREQUIPA_VIEWBOX = `${AREQUIPA_BOUNDS.minLng},${AREQUIPA_BOUNDS.maxLat},${AREQUIPA_BOUNDS.maxLng},${AREQUIPA_BOUNDS.minLat}`;

export function isInsideArequipa(point = {}) {
  const lat = Number(point.latitud ?? point.lat);
  const lng = Number(point.longitud ?? point.lng ?? point.lon);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= AREQUIPA_BOUNDS.minLat
    && lat <= AREQUIPA_BOUNDS.maxLat
    && lng >= AREQUIPA_BOUNDS.minLng
    && lng <= AREQUIPA_BOUNDS.maxLng;
}

export async function searchPlaces(query, { signal } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const scopedQuery = /arequipa/i.test(q) ? q : `${q}, Arequipa, Perú`;
  const params = new URLSearchParams({
    q: scopedQuery,
    format: "json",
    addressdetails: "1",
    limit: "6",
    "accept-language": "es",
    countrycodes: "pe",
    viewbox: AREQUIPA_VIEWBOX,
    bounded: "1"
  });
  const response = await fetch(`${NOMINATIM}/search?${params.toString()}`, {
    signal,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("No se pudo buscar la dirección.");
  const items = await response.json();
  return Array.isArray(items) ? items.filter(isInsideArequipa) : [];
}

export async function reverseGeocode(lat, lng, { signal } = {}) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "json",
    addressdetails: "1",
    "accept-language": "es"
  });
  const response = await fetch(`${NOMINATIM}/reverse?${params.toString()}`, {
    signal,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("No se pudo obtener la dirección.");
  return response.json();
}

export function geohashEncode(latitude, longitude, precision = 10) {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (longitude >= mid) {
        bits = (bits << 1) | 1;
        lngMin = mid;
      } else {
        bits = bits << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += alphabet[bits];
      bit = 0;
      bits = 0;
    }
  }
  return hash;
}
