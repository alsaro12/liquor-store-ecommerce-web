import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { db, firebaseReady } from "../../firebase/client.js";
import { getStoredToken } from "./authApi.js";

const DEV_BACKEND_ORIGIN = "http://127.0.0.1:8787";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV && typeof window !== "undefined" && window.location.port === "5173"
    ? DEV_BACKEND_ORIGIN
    : "");
const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || "api";
const FALLBACK_PRODUCT_CATEGORIES = [
  "AGUA",
  "CERVEZA",
  "CIGARRO",
  "COCTEL",
  "ENERGIZANTE",
  "ESPUMANTE",
  "GASEOSA",
  "GIN",
  "HIELO",
  "JUGO",
  "LICOR",
  "PISCO",
  "RON",
  "SNACK",
  "TEQUILA",
  "VINO",
  "VODKA",
  "WHISKY",
  "ACCESORIO",
  "OTRO"
];

function normalizeProduct(item) {
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
  return {
    id: String(item?.ID_PRODUCTO ?? item?.id ?? ""),
    name: String(item?.NOMBRE ?? item?.name ?? "Producto sin nombre"),
    category: String(item?.CATEGORIA ?? item?.category ?? "OTRO"),
    description: String(item?.DESCRIPCION ?? item?.shortDescription ?? item?.description ?? ""),
    price: Number(item?.PRECIO_VENTA ?? item?.PRECIO ?? item?.price ?? 0),
    stock: Number(item?.STOCK_ACTUAL ?? item?.stock ?? 0),
    status: String(item?.ESTADO ?? item?.status ?? "ACTIVO").toUpperCase(),
    imageHash,
    images
  };
}

function publicImage(product) {
  if (product?.imageHash) {
    return `${API_BASE_URL}/api/productos/imagen/${product.imageHash}`;
  }
  const images = Array.isArray(product?.images) ? product.images : [];
  for (const image of images) {
    if (typeof image === "string" && image.trim()) return image.trim();
    if (image?.filtered_image_url) return String(image.filtered_image_url).trim();
    if (image?.original_image_url) return String(image.original_image_url).trim();
    if (image?.url) return String(image.url).trim();
  }
  return "";
}

export function resolveProductImage(product) {
  return publicImage(product);
}

async function loadProductsFromApi() {
  const response = await fetch(`${API_BASE_URL}/api/productos/storefront`, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar catálogo: ${response.status}`);
  const items = await response.json();
  return (Array.isArray(items) ? items : [])
    .map(normalizeProduct)
    .filter((product) => product.status === "ACTIVO")
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}

async function loadProductsFromFirebase() {
  if (!firebaseReady || !db) throw new Error("Firebase no está configurado.");
  const productsQuery = query(
    collection(db, "products"),
    where("status", "==", "active"),
    orderBy("name")
  );
  const snapshot = await getDocs(productsQuery);
  return snapshot.docs.map((doc) => normalizeProduct({ id: doc.id, ...doc.data() }));
}

export async function loadProducts() {
  if (DATA_SOURCE === "firebase") return loadProductsFromFirebase();
  return loadProductsFromApi();
}

export async function loadProductCategories() {
  if (DATA_SOURCE === "firebase") return [...FALLBACK_PRODUCT_CATEGORIES];
  const response = await fetch(`${API_BASE_URL}/api/productos/categorias`, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar categorías: ${response.status}`);
  const items = await response.json();
  return Array.isArray(items) && items.length ? items : [...FALLBACK_PRODUCT_CATEGORIES];
}

export async function createOrder(order) {
  if (DATA_SOURCE === "firebase") {
    if (!firebaseReady || !db) throw new Error("Firebase no está configurado.");
    const docRef = await addDoc(collection(db, "orders"), {
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
