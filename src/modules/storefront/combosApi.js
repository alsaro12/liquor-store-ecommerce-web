import { apiFetch } from "./httpClient.js";

const COMBOS_CACHE_KEY = "licoreria.storefront.combos.v1";
const COMBOS_CACHE_VERSION = 1;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let combosCache = null;
let combosCacheAt = 0;
let combosRequest = null;

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readCache() {
  if (!canUseStorage()) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMBOS_CACHE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.items) || !Number.isFinite(parsed.savedAt)) return null;
    if (parsed.version !== COMBOS_CACHE_VERSION) return null;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(COMBOS_CACHE_KEY, JSON.stringify({ version: COMBOS_CACHE_VERSION, savedAt: Date.now(), items }));
  } catch {
    // best effort
  }
}

export function getComboCacheMeta() {
  const cached = readCache();
  if (!cached) return { state: "empty", savedAt: 0, ageMs: Infinity, isFresh: false };
  const ageMs = Date.now() - cached.savedAt;
  return {
    state: ageMs <= CACHE_TTL_MS ? "fresh" : "stale",
    savedAt: cached.savedAt,
    ageMs,
    isFresh: ageMs <= CACHE_TTL_MS
  };
}

export function getCachedCombos() {
  if (combosCache) return combosCache;
  const cached = readCache();
  if (!cached) return [];
  combosCache = cached.items;
  combosCacheAt = cached.savedAt;
  return combosCache;
}

export async function loadCombos({ force = false } = {}) {
  if (!force && combosCache && Date.now() - combosCacheAt < CACHE_TTL_MS) return combosCache;
  if (!force && combosRequest) return combosRequest;
  const request = apiFetch("/api/combos", { auth: false })
    .then((items) => {
      combosCache = Array.isArray(items) ? items : [];
      combosCacheAt = Date.now();
      writeCache(combosCache);
      return combosCache;
    });
  if (force) return request;
  combosRequest = request.finally(() => {
      combosRequest = null;
    });
  return combosRequest;
}

export async function createCombo(combo) {
  const saved = await apiFetch("/api/combos", { method: "POST", body: combo, auth: true });
  combosCache = null;
  combosCacheAt = 0;
  return saved;
}

export async function loadComboBySlug(slug) {
  return apiFetch(`/api/combos/${encodeURIComponent(slug)}`, { auth: false });
}
