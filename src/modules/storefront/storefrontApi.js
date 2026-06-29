import { addDoc, collection, getDocs, query, serverTimestamp } from "firebase/firestore";
import { db, firebaseReady } from "../../firebase/client.js";
import { PRODUCT_CATEGORY_OPTIONS, normalizeProductCategory } from "../productCategories.js";
import { getStoredToken } from "./authApi.js";

const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV && typeof window !== "undefined"
    ? DEV_BACKEND_ORIGIN
    : "");
const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || "api";
const PRODUCT_CACHE_KEY = "licoreria.storefront.products.v6";
const PRODUCT_CATEGORY_CACHE_KEY = "licoreria.storefront.categories.v2";
const PRODUCT_CACHE_VERSION = 6;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let productCache = null;
let productCacheAt = 0;
let productRequest = null;
let categoryCache = null;
let categoryCacheAt = 0;
let categoryRequest = null;
const FALLBACK_PRODUCT_CATEGORIES = PRODUCT_CATEGORY_OPTIONS;

function normalizeCategory(value) {
  return normalizeProductCategory(value);
}

function normalizeProduct(item) {
  const productId = String(
    item?.ID_PRODUCTO ?? item?.productId ?? item?.["N°"] ?? item?.numero ?? item?.id ?? ""
  ).trim();
  const images = Array.isArray(item?.IMAGENES)
    ? item.IMAGENES
    : Array.isArray(item?.images)
      ? item.images
      : item?.image
        ? [item.image]
        : [];
  const imageHash =
    typeof item?.imageHash === "string" && /^[a-f0-9]{64}$/i.test(item.imageHash)
      ? item.imageHash.toLowerCase()
      : "";
  const variants = normalizeProductVariants(item?.VARIANTES ?? item?.variants ?? item?.variantes);
  return {
    id: productId,
    name: String(item?.NOMBRE ?? item?.name ?? "Producto sin nombre"),
    category: normalizeCategory(item?.CATEGORIA ?? item?.category ?? "Aperitivos y Digestivos"),
    description: String(item?.DESCRIPCION ?? item?.shortDescription ?? item?.description ?? ""),
    flavor: String(item?.SABOR ?? item?.sabor ?? item?.flavor ?? item?.variantName ?? "").trim(),
    price: Number(item?.PRECIO_VENTA ?? item?.PRECIO ?? item?.price ?? 0),
    stock: Number(item?.STOCK_ACTUAL ?? item?.stock ?? 0),
    status: String(item?.ESTADO ?? item?.status ?? "ACTIVO").toUpperCase(),
    imageHash,
    imageUrl: String(item?.imageUrl ?? item?.imagen_url ?? ""),
    images,
    cigarettePresentations: Array.isArray(item?.CIGARRO_PRESENTACIONES)
      ? item.CIGARRO_PRESENTACIONES
      : Array.isArray(item?.cigarettePresentations)
        ? item.cigarettePresentations
        : [],
    variants
  };
}

function normalizeProductVariants(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list
    .map((item, index) => {
      const name = String(item?.name ?? item?.NOMBRE ?? item?.nombre ?? "").trim();
      if (!name) return null;
      return {
        id: String(item?.id ?? item?.ID_VARIANTE ?? item?.variantId ?? `variante-${index + 1}`).trim() || `variante-${index + 1}`,
        name,
        description: String(item?.description ?? item?.DESCRIPCION ?? item?.descripcion ?? "").trim(),
        price: item?.price ?? item?.PRECIO ?? item?.precio ?? null,
        stock: Number(item?.stock ?? item?.STOCK_ACTUAL ?? item?.stockActual ?? item?.stock_actual ?? 0),
        status: String(item?.status ?? item?.ESTADO ?? item?.estado ?? "ACTIVO").toUpperCase(),
        images: Array.isArray(item?.images) ? item.images : Array.isArray(item?.IMAGENES) ? item.IMAGENES : []
      };
    })
    .filter(Boolean);
}

function expandProductVariants(items) {
  return (Array.isArray(items) ? items : []).flatMap((product) => {
    const variants = (Array.isArray(product.variants) ? product.variants : []).filter(
      (variant) => variant.status !== "INACTIVO" && Number(variant.stock || 0) >= 0
    );
    if (!variants.length) return [product];
    return variants.map((variant) => ({
      ...product,
      id: `${product.id}::${variant.id}`,
      parentProductId: product.id,
      variantId: variant.id,
      variantName: variant.name,
      flavor: variant.name,
      name: `${product.name} ${variant.name}`,
      description: variant.description || product.description,
      price: variant.price === "" || variant.price === null || variant.price === undefined ? product.price : Number(variant.price || 0),
      stock: Number(variant.stock || 0),
      images: variant.images?.length ? variant.images : product.images,
      imageUrl: variant.images?.length ? "" : product.imageUrl,
      imageHash: variant.images?.length ? "" : product.imageHash,
      variants: []
    }));
  });
}

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readCache(key) {
  if (!canUseStorage()) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!parsed || !Array.isArray(parsed.items) || !Number.isFinite(parsed.savedAt)) return null;
    if (key === PRODUCT_CACHE_KEY && parsed.version !== PRODUCT_CACHE_VERSION) return null;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key, items) {
  if (!canUseStorage()) return;
  try {
    const payload = key === PRODUCT_CACHE_KEY
      ? { version: PRODUCT_CACHE_VERSION, savedAt: Date.now(), items }
      : { savedAt: Date.now(), items };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage is best-effort; fresh network data still powers the UI.
  }
}

export function getProductCacheMeta() {
  const cached = readCache(PRODUCT_CACHE_KEY);
  if (!cached) return { state: "empty", savedAt: 0, ageMs: Infinity, isFresh: false };
  const ageMs = Date.now() - cached.savedAt;
  return {
    state: ageMs <= CACHE_TTL_MS ? "fresh" : "stale",
    savedAt: cached.savedAt,
    ageMs,
    isFresh: ageMs <= CACHE_TTL_MS
  };
}

export function getCachedProducts() {
  if (productCache) return productCache;
  const cached = readCache(PRODUCT_CACHE_KEY);
  if (!cached) return [];
  productCache = expandProductVariants(cached.items.map(normalizeProduct))
    .filter((product) => product.status === "ACTIVO" && Number(product.stock || 0) >= 0);
  productCacheAt = cached.savedAt;
  return productCache;
}

export function getCachedProductCategories() {
  if (categoryCache) return categoryCache;
  const cached = readCache(PRODUCT_CATEGORY_CACHE_KEY);
  if (!cached) return [];
  categoryCache = cached.items.map(normalizeCategory);
  categoryCacheAt = cached.savedAt;
  return categoryCache;
}

function publicImage(product) {
  if (typeof product?.imageUrl === "string" && product.imageUrl.trim()) {
    const imageUrl = product.imageUrl.trim();
    return imageUrl.startsWith("/") && API_BASE_URL ? `${API_BASE_URL}${imageUrl}` : imageUrl;
  }
  const images = Array.isArray(product?.images) ? product.images : [];
  for (const image of images) {
    if (typeof image === "string" && image.trim()) return image.trim();
    if (image?.thumb_webp_url) return String(image.thumb_webp_url).trim();
    if (image?.filtered_image_url) return String(image.filtered_image_url).trim();
    if (image?.original_webp_url) return String(image.original_webp_url).trim();
    if (image?.original_image_url) return String(image.original_image_url).trim();
    if (image?.url) return String(image.url).trim();
  }
  if (product?.imageHash) {
    return `${API_BASE_URL}/api/productos/imagen/${product.imageHash}`;
  }
  return "";
}

export function resolveProductImage(product) {
  return publicImage(product);
}

async function loadProductsFromApi() {
  const response = await fetch(`${API_BASE_URL}/api/productos/storefront`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`No se pudo cargar catálogo: ${response.status}`);
  const items = await response.json();
  return expandProductVariants((Array.isArray(items) ? items : []).map(normalizeProduct))
    .filter((product) => product.status === "ACTIVO" && Number(product.stock || 0) >= 0)
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}

async function loadProductsFromFirebase() {
  if (!firebaseReady || !db) throw new Error("Firebase no está configurado.");
  const productsQuery = query(collection(db, "products_v2"));
  const snapshot = await getDocs(productsQuery);
  return snapshot.docs
    .flatMap((doc) => expandProductVariants([normalizeProduct({ id: doc.id, ...doc.data() })]))
    .filter((product) => product.status === "ACTIVO" && Number(product.stock || 0) >= 0)
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}

export async function loadProducts() {
  if (productCache && Date.now() - productCacheAt < CACHE_TTL_MS) return productCache;
  if (productRequest) return productRequest;
  productRequest = (DATA_SOURCE === "firebase" ? loadProductsFromFirebase() : loadProductsFromApi())
    .then((items) => {
      productCache = items;
      productCacheAt = Date.now();
      writeCache(PRODUCT_CACHE_KEY, items);
      return items;
    })
    .finally(() => {
      productRequest = null;
    });
  return productRequest;
}

export async function refreshProducts() {
  productCache = null;
  productCacheAt = 0;
  productRequest = null;
  return loadProducts();
}

export async function loadComboEditorProducts() {
  if (DATA_SOURCE === "firebase") return loadProductsFromFirebase();
  const headers = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}/api/productos/all?includeImages=1`, {
    cache: "no-cache",
    headers
  });
  if (!response.ok) return loadProducts();
  const items = await response.json();
  return expandProductVariants((Array.isArray(items) ? items : []).map(normalizeProduct))
    .filter((product) => product.id)
    .sort((left, right) => Number(left.id) - Number(right.id) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}

export async function loadProductCategories() {
  if (categoryCache && Date.now() - categoryCacheAt < CACHE_TTL_MS) return categoryCache;
  if (categoryRequest) return categoryRequest;
  categoryRequest = (async () => {
    if (DATA_SOURCE === "firebase") return [...FALLBACK_PRODUCT_CATEGORIES];
    const response = await fetch(`${API_BASE_URL}/api/productos/categorias`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`No se pudo cargar categorías: ${response.status}`);
    const items = await response.json();
    return Array.isArray(items) && items.length ? items.map(normalizeCategory) : [...FALLBACK_PRODUCT_CATEGORIES];
  })()
    .then((items) => {
      categoryCache = items;
      categoryCacheAt = Date.now();
      writeCache(PRODUCT_CATEGORY_CACHE_KEY, items);
      return items;
    })
    .finally(() => {
      categoryRequest = null;
    });
  return categoryRequest;
}

export async function createOrder(order) {
  if (DATA_SOURCE === "firebase") {
    if (!firebaseReady || !db) throw new Error("Firebase no está configurado.");
    const docRef = await addDoc(collection(db, "orders_v2"), {
      ...order,
      status: "pending",
      createdAt: serverTimestamp()
    });
    return { id: docRef.id };
  }

  const headers = { "Content-Type": "application/json" };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}/api/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(order)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `No se pudo registrar el pedido: ${response.status}`);
  }
  return response.json();
}

export async function loadStoreDeliveryConfig() {
  const response = await fetch(`${API_BASE_URL}/api/store-delivery-config`, { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo cargar la configuración de delivery.");
  return response.json();
}

export async function quoteDelivery({ latitud, longitud }) {
  const response = await fetch(`${API_BASE_URL}/api/delivery/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitud, longitud })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || "No se pudo calcular el delivery.");
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function validateDeliveryCoupon({ code, shipping }) {
  const response = await fetch(`${API_BASE_URL}/api/coupons/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, shipping })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Cupón no disponible.");
  }
  return payload;
}
