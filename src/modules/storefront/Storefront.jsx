import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import React, { useCallback } from "react";
import officialLogo from "../../assets/branding/logofinal.png";
import {
  createOrder,
  getCachedProductCategories,
  getCachedProducts,
  getProductCacheMeta,
  loadProductCategories,
  loadProducts,
  refreshProducts,
  resolveProductImage
} from "./storefrontApi.js";
import AccountModal from "./AccountModal.jsx";
import CardQuantityControl from "./CardQuantityControl.jsx";
import CartDrawer from "./CartDrawer.jsx";
import CartToast from "./CartToast.jsx";
import CheckoutModal from "./CheckoutModal.jsx";
import MisPedidosPage from "./pages/MisPedidosPage.jsx";
import MisFavoritosPage from "./pages/MisFavoritosPage.jsx";
import CombosPage from "./pages/CombosPage.jsx";
import PedidoDetallePage from "./pages/PedidoDetallePage.jsx";
import ComboDetallePage from "./pages/ComboDetallePage.jsx";
import ProductoDetallePage from "./pages/ProductoDetallePage.jsx";
import MisDireccionesPage from "./pages/MisDireccionesPage.jsx";
import MisPagosPage from "./pages/MisPagosPage.jsx";
import NotificacionesPage from "./pages/NotificacionesPage.jsx";
import MiCuentaPage from "./pages/MiCuentaPage.jsx";
import MiClubPage from "./pages/MiClubPage.jsx";
import OpinionPage from "./pages/OpinionPage.jsx";
import AccountLayout from "./account/AccountLayout.jsx";
import { useConfirm } from "./common/ConfirmDialog.jsx";
import { countNoLeidas } from "./notificacionesApi.js";
import { getCachedCombos, getComboCacheMeta, loadCombos } from "./combosApi.js";
import productImageUnavailable from "../../assets/storefront/imagennodisponible2.png";
import comboImageUnavailable from "../../assets/storefront/combos/combo-image-unavailable-red.png";

function isLegacyComboImage(value) {
  const source = String(value || "").toLowerCase();
  return (
    source.includes("frame-46") ||
    source.includes("frame-47") ||
    source.includes("frame-48") ||
    source.includes("frame-49") ||
    source.includes("/storefront/combos/") ||
    source.includes("\\storefront\\combos\\")
  );
}

function fallbackComboImage(combo) {
  const candidates = [combo?.imageData, combo?.imageUrl, resolveProductImage(combo)];
  return candidates.find((candidate) => candidate && !isLegacyComboImage(candidate)) || "";
}

function minutesFromStoreTime(value) {
  const [hour = "0", minute = "0"] = String(value || "00:00").split(":");
  return Number(hour) * 60 + Number(minute);
}

function normalizeStoreSchedule(schedule) {
  const source = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_STORE_SCHEDULE;
  return DEFAULT_STORE_SCHEDULE.map((fallback, index) => {
    const row = source[index] || fallback;
    const shifts = Array.isArray(row.shifts) && row.shifts.length
      ? row.shifts
      : [{ open: row.open || fallback.shifts[0].open, close: row.close || fallback.shifts[0].close }];
    return {
      day: row.day || fallback.day,
      active: row.active !== false,
      shifts: shifts.map((shift) => ({
        open: shift?.open || fallback.shifts[0].open,
        close: shift?.close || fallback.shifts[0].close
      }))
    };
  });
}

function isInsideStoreSchedule(schedule, now = new Date()) {
  const dayIndex = (now.getDay() + 6) % 7;
  const today = normalizeStoreSchedule(schedule)?.[dayIndex];
  if (!today?.active) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return today.shifts.some((shift) => {
    const open = minutesFromStoreTime(shift.open);
    const close = minutesFromStoreTime(shift.close);
    if (open <= close) return current >= open && current < close;
    return current >= open || current < close;
  });
}

function formatStoreOpening(row, shift, dayOffset) {
  if (!row) return "pronto";
  const [hourRaw = "0", minute = "00"] = String(shift?.open || "10:00").split(":");
  const hour24 = Number(hourRaw);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  const dayLabel = dayOffset === 0 ? "hoy" : dayOffset === 1 ? "mañana" : row.day;
  return `${dayLabel} a las ${String(hour12).padStart(2, "0")}:${minute} ${period}`;
}

function nextStoreOpening(schedule = DEFAULT_STORE_SCHEDULE, now = new Date()) {
  const normalized = normalizeStoreSchedule(schedule);
  const currentDayIndex = (now.getDay() + 6) % 7;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset += 1) {
    const dayIndex = (currentDayIndex + offset) % 7;
    const row = normalized[dayIndex];
    if (!row?.active) continue;
    const nextShift = row.shifts
      .slice()
      .sort((a, b) => minutesFromStoreTime(a.open) - minutesFromStoreTime(b.open))
      .find((shift) => offset > 0 || minutesFromStoreTime(shift.open) > currentMinutes);
    if (!nextShift) continue;
    return formatStoreOpening(row, nextShift, offset);
  }
  return "cuando retomemos atencion";
}

function readStoreControl() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_CONTROL_KEY) || "null");
    if (!stored) return { open: true, schedule: DEFAULT_STORE_SCHEDULE, closedReason: "" };
    const schedule = normalizeStoreSchedule(stored.schedule);
    const scheduledOpen = isInsideStoreSchedule(schedule);
    const open = stored.manualClosed ? false : Boolean(stored.open && scheduledOpen);
    return {
      open,
      schedule,
      closedReason: stored.autoClosedReason || (scheduledOpen ? "Cerrado temporalmente" : "Fuera de horario")
    };
  } catch {
    return { open: true, schedule: DEFAULT_STORE_SCHEDULE, closedReason: "" };
  }
}

function canSeeClub(user) {
  return ["admin", "staff"].includes(String(user?.rol || "").toLowerCase());
}
import { fetchCurrentUser, getStoredToken, logoutCustomer, setStoredToken } from "./authApi.js";
import { addFavorito as apiAddFavorito, listFavoritoIds, removeFavoritoByRef as apiRemoveFavorito } from "./favoritosApi.js";

const NAV_ITEMS = [
  { id: "catalogo", label: "Catalogo", to: "/", active: true },
  { id: "combos", label: "Combos", to: "/combos" }
];

const STORE_CONTROL_KEY = "licoreria_admin_store_control";
const FAVORITE_PRODUCT_CACHE_KEY = "licoreria.favorite.products.v1";
const FAVORITE_COMBO_CACHE_KEY = "licoreria.favorite.combos.v1";

function productFavoriteId(product) {
  return String(product?.id ?? product?.ID_PRODUCTO ?? product?.productId ?? "").trim();
}

function comboItemProductKey(item) {
  if (!item) return "";
  if (item.variantId) return `${item.productId}::${item.variantId}`;
  return String(item.productId || "");
}

function readFavoriteCache(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeFavoriteCache(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids].map(String).filter(Boolean)));
  } catch {}
}

function mergeFavoriteIds(current, remoteIds) {
  const next = new Set(current);
  for (const id of remoteIds || []) {
    const clean = String(id || "").trim();
    if (clean) next.add(clean);
  }
  return next;
}

const DEFAULT_STORE_SCHEDULE = [
  { day: "Lunes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Martes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Miercoles", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Jueves", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Viernes", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Sabado", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Domingo", shifts: [{ open: "11:00", close: "22:00" }], active: true }
];

const EVENT_FILTER_CARDS = [
  { id: "todos", label: "Todos", tone: "gold", icon: "grid" },
  { id: "pre", label: "Previa", tone: "orange", icon: "toast" },
  { id: "pareja", label: "Para dos", tone: "coral", icon: "heart" },
  { id: "fiesta", label: "Fiesta", tone: "orange", icon: "party" },
  { id: "relax", label: "Relax", tone: "purple", icon: "chair" },
  { id: "reunion", label: "Reunion", tone: "green", icon: "group" },
  { id: "premium", label: "Premium", tone: "pink", icon: "crown" },
  { id: "more", label: "Mas", tone: "dark", icon: "dots" }
];

const CATALOG_SPOTLIGHTS = [
  { id: "todos", category: "TODOS", label: "Todos", icon: "▦" },
  { id: "whisky", category: "Whisky", label: "Whisky", icon: "🥃" },
  { id: "ron", category: "Ron", label: "Ron", icon: "🥃" },
  { id: "vodka", category: "Vodka", label: "Vodka", icon: "🍾" },
  { id: "pisco", category: "Pisco", label: "Pisco", icon: "🍸" },
  { id: "tequila", category: "Tequila", label: "Tequila", icon: "🍋" },
  { id: "gin", category: "Gin", label: "Gin", icon: "🍸" },
  { id: "vino", category: "Vino", label: "Vino", icon: "🍷" },
  { id: "espumante", category: "Espumante", label: "Espumante", icon: "🍾" },
  { id: "cerveza", category: "Cerveza", label: "Cerveza", icon: "🍺" },
  { id: "cigarros", category: "Cigarros", label: "Cigarros", icon: "▮" },
  { id: "anis", category: "Anís", label: "Anís", icon: "✦" },
  { id: "fernet", category: "Fernet", label: "Fernet", icon: "🥃" },
  { id: "licores-cremas", category: "Licores y Cremas", label: "Licores y Cremas", icon: "🍶" },
  { id: "aperitivos-digestivos", category: "Aperitivos y Digestivos", label: "Aperitivos y Digestivos", icon: "🍹" },
  { id: "ready-to-drink", category: "Ready To Drink", label: "Ready To Drink", icon: "🥫" },
  { id: "energizantes", category: "Energizantes", label: "Energizantes", icon: "⚡" },
  { id: "gaseosas", category: "Gaseosas", label: "Gaseosas", icon: "🥤" },
  { id: "jugos-nectares", category: "Jugos y Néctares", label: "Jugos y Néctares", icon: "🧃" },
  { id: "agua", category: "Agua", label: "Agua", icon: "💧" },
  { id: "hielo", category: "Hielo", label: "Hielo", icon: "🧊" },
  { id: "snacks-golosinas", category: "Snacks y Golosinas", label: "Snacks y Golosinas", icon: "🍫" },
  { id: "accesorios-regalos", category: "Accesorios y Regalos", label: "Accesorios y Regalos", icon: "🎁" }
];

const CLUB_FEATURES = [
  { icon: "target", title: "Suma boletos", body: "Cumple metas" },
  { icon: "level", title: "Rifa mensual", body: "Premio delivery" },
  { icon: "gift", title: "Gana S/25", body: "Para tu delivery" }
];

const CATEGORY_LABELS = {
  TODOS: "Categorías",
  Whisky: "Whisky",
  Ron: "Ron",
  Vodka: "Vodka",
  Pisco: "Pisco",
  Tequila: "Tequila",
  Gin: "Gin",
  Vino: "Vino",
  Vinos: "Vinos",
  Espumante: "Espumante",
  Espumantes: "Espumantes",
  Cerveza: "Cerveza",
  Cervezas: "Cervezas",
  Cigarros: "Cigarros",
  Anís: "Anís",
  Fernet: "Fernet",
  "Licores y Cremas": "Licores y Cremas",
  "Aperitivos y Digestivos": "Aperitivos y Digestivos",
  "Cremas y Aperitivos": "Cremas y Aperitivos",
  "Ready To Drink": "Ready To Drink",
  "Bebidas Preparadas (RTD)": "Ready To Drink",
  Energizantes: "Energizantes",
  Gaseosas: "Gaseosas",
  "Gaseosas y Mixers": "Gaseosas y Mixers",
  "Jugos y Néctares": "Jugos y Néctares",
  Agua: "Agua",
  Aguas: "Aguas",
  Hielo: "Hielo",
  Snacks: "Snacks",
  "Snacks y Golosinas": "Snacks y Golosinas",
  "Accesorios y Regalos": "Accesorios y Regalos"
};

const CATEGORY_ALIASES = {
  Vino: ["Vino", "Vinos"],
  Espumante: ["Espumante", "Espumantes"],
  Cerveza: ["Cerveza", "Cervezas"],
  Cigarros: ["Cigarros", "Cigarro", "Tabaco", "Tabacos"],
  Agua: ["Agua", "Aguas"],
  Gaseosas: ["Gaseosas", "Gaseosas y Mixers", "Mixers"],
  "Licores y Cremas": ["Licores y Cremas", "Cremas y Aperitivos"],
  "Aperitivos y Digestivos": ["Aperitivos y Digestivos", "Cremas y Aperitivos"],
  "Ready To Drink": ["Ready To Drink", "Bebidas Preparadas (RTD)", "Bebidas Preparadas", "RTD"],
  "Snacks y Golosinas": ["Snacks y Golosinas", "Snacks"],
  "Jugos y Néctares": ["Jugos y Néctares", "Jugos y Nectares"],
  "Accesorios y Regalos": ["Accesorios y Regalos", "Accesorios", "Regalos"]
};

const CATEGORY_TONES = ["yellow", "cyan", "coral", "gold", "aqua", "orange", "green", "pink"];
const PRODUCT_PAGE_SIZE = 20;
const PRODUCT_PHONE_PAGE_SIZE = 18;
const PRODUCT_SORT_OPTIONS = [
  { value: "recommended", label: "Recomendados" },
  { value: "price-asc", label: "Menor precio" },
  { value: "price-desc", label: "Mayor precio" },
  { value: "name-asc", label: "Nombre A-Z" },
  { value: "stock-desc", label: "Más stock" }
];

function buildPaginationItems(pageInput, totalInput) {
  const total = Math.max(1, Number(totalInput) || 1);
  const page = Math.min(total, Math.max(1, Number(pageInput) || 1));
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const items = [];
  for (let current = start; current <= end; current += 1) {
    items.push(current);
  }
  if (end < total - 1) items.push("ellipsis");
  if (end < total) items.push(total);
  return items;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener?.("change", updateMatches);
    return () => mediaQuery.removeEventListener?.("change", updateMatches);
  }, [query]);

  return matches;
}

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function useDebouncedValue(value, delayMs = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function productImage(product) {
  return resolveProductImage(product) || "";
}

function getCatalogLabel(value) {
  return CATEGORY_LABELS[value] || value;
}

function matchesCatalogCategory(productCategory, selectedCategory) {
  if (selectedCategory === "TODOS") return true;
  const productValue = normalizeText(productCategory);
  const accepted = CATEGORY_ALIASES[selectedCategory] || [selectedCategory];
  return accepted.some((value) => normalizeText(value) === productValue);
}

function getCategoryTone(index) {
  return CATEGORY_TONES[index % CATEGORY_TONES.length];
}

function getCategoryMarker(value) {
  const normalized = getCatalogLabel(value)
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!normalized.length) return "CAT";
  if (normalized.length === 1) return normalized[0].slice(0, 3).toUpperCase();
  return normalized.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderEventIcon(type) {
  switch (type) {
    case "grid":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "toast":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7 5h3v6a2 2 0 1 1-4 0V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 5h3v6a2 2 0 1 1-4 0V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 19c1.5-1.5 2.8-2.2 4-2.2S14.5 17.5 16 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "heart":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 20.3 4.9 13.2a4.5 4.5 0 1 1 6.4-6.4L12 7.5l.7-.7a4.5 4.5 0 0 1 6.4 6.4L12 20.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "party":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 4.8 19.2 11 9.7 13.5 7.2 23 5 4.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M15 4v3M19 5.5l-1.8 2.2M11.5 2.8l1.3 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "chair":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7 12V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M5 13h14v2.5A2.5 2.5 0 0 1 16.5 18H7.5A2.5 2.5 0 0 1 5 15.5V13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 18v2M16 18v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "group":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="16.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.8 18.2A4.8 4.8 0 0 1 8.5 14h1A4.8 4.8 0 0 1 14.2 18.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M14.8 17a4 4 0 0 1 3.4-1.8h.3A3.7 3.7 0 0 1 21 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "crown":
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="m4 18 1.5-9 4.2 3.6L12 7l2.3 5.6L18.5 9 20 18H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M6 20h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="6" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}

function uniqueCategories(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function resolveComboDisplay(combo, productsMap) {
  const comboProducts = (combo.items || [])
    .map((item) => {
      const product = productsMap.get(comboItemProductKey(item));
      return product ? { ...product, quantity: Number(item.quantity || 1) } : null;
    })
    .filter(Boolean);

  return {
    comboProducts,
    heroImage: fallbackComboImage(combo)
  };
}

function Header({
  query,
  onQueryChange,
  total,
  cartLines,
  cartUnits = cartLines,
  onJumpToCheckout,
  cartGlowTick,
  authUser,
  unreadNotifs = 0,
  onOpenAccount,
  currentRoute,
  onNavigate
}) {
  const profileInitial = authUser?.nombre?.trim()?.charAt(0)?.toUpperCase() || authUser?.telefono?.charAt(0) || authUser?.email?.charAt(0)?.toUpperCase() || "";
  const hasCartTotal = Number(total) > 0;
  const showCartBadge = Number(cartUnits) > 0;
  const isCartEmpty = !hasCartTotal && !showCartBadge;
  return (
    <header className="official-store-header">
      <div className="official-header-brand">
        <a
          className="official-logo official-logo-final"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onNavigate?.("/");
          }}
          aria-label="La Licoreria"
        >
          <img src={officialLogo} alt="La Licoreria" />
        </a>
      </div>

      <nav className="official-nav official-nav-main" aria-label="Navegacion principal">
        {NAV_ITEMS.map((item) => {
          const isActive = currentRoute === item.to.replace(/^\//, "") || (item.to === "/" && !currentRoute);
          return (
            <a
              key={item.id}
              className={isActive ? "is-active" : ""}
              href={item.to}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate?.(item.to);
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <label className="official-search">
        <span className="official-search-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar chelas, ron, hielo..." />
        <i aria-hidden="true">Buscar</i>
      </label>

      <div className="official-header-actions">
        <button
          type="button"
          className={`official-notifications-quick${unreadNotifs > 0 ? " has-unread" : ""}`}
          aria-label={`Notificaciones pendientes: ${unreadNotifs}`}
          onClick={() => onNavigate?.("/notificaciones")}
        >
          <span aria-hidden="true" className="official-notifications-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6.8 10.5a5.2 5.2 0 0 1 10.4 0v2.8l1.35 2.45H5.45L6.8 13.3v-2.8Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
              <path d="M9.8 18a2.35 2.35 0 0 0 4.4 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              <path d="M12 4.1V3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </span>
          {unreadNotifs > 0 ? <b>{unreadNotifs > 99 ? "99+" : unreadNotifs}</b> : null}
        </button>
        <button
          type="button"
          className={`official-cart${cartGlowTick ? " is-sunburst" : ""}${isCartEmpty ? " is-empty" : ""}`}
          onClick={onJumpToCheckout}
        >
          <span aria-hidden="true" className="official-cart-glow" />
          <span aria-hidden="true" className="official-cart-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 5h2.2l1.25 8.1a1 1 0 0 0 .98.84h7.7a1 1 0 0 0 .97-.76L18.4 8.5H7.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 18.3a1.35 1.35 0 1 0 0 .01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16.2 18.3a1.35 1.35 0 1 0 0 .01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {hasCartTotal ? (
            <span className="official-cart-copy">
              <small>{money(total)}</small>
            </span>
          ) : null}
          {showCartBadge ? <b>{cartUnits > 99 ? "99+" : cartUnits}</b> : null}
        </button>
        <button
          type="button"
          className={`official-profile-button${authUser ? " is-authenticated" : ""}`}
          aria-label={authUser ? `Cuenta de ${authUser.nombre || authUser.telefono || authUser.email}` : "Ingresar o crear cuenta"}
          onClick={onOpenAccount}
        >
          {authUser ? (
            <span className="official-profile-initial" aria-hidden="true">{profileInitial}</span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5.5 19a6.6 6.6 0 0 1 13 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          <span className="official-profile-label">Mi perfil</span>
        </button>
      </div>
    </header>
  );
}

function ClubBanner({ onOpenClub, clubTickets = 0 }) {
  const visibleTickets = Math.max(0, Number(clubTickets) || 0);

  function renderClubIcon(type) {
    if (type === "target") {
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" />
        </svg>
      );
    }
    if (type === "level") {
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
          <path d="m8.2 13.2 3.8-3.8 3.8 3.8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 9.6v7" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.5 10h15v10h-15V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M3.5 7h17v3h-17V7ZM12 7v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 7c-2.8 0-4.2-.8-4.2-2.2C7.8 3.7 8.7 3 9.8 3 11.4 3 12 7 12 7Zm0 0c2.8 0 4.2-.8 4.2-2.2 0-1.1-.9-1.8-2-1.8C12.6 3 12 7 12 7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <section className="official-club-banner" aria-label="Club La Licoreria">
      <div className="official-club-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none">
          <defs>
            <radialGradient id="clubGoldGlow" cx="34%" cy="24%" r="72%">
              <stop offset="0%" stopColor="#fff6b8" />
              <stop offset="38%" stopColor="#ffd13b" />
              <stop offset="72%" stopColor="#c88900" />
              <stop offset="100%" stopColor="#6d4300" />
            </radialGradient>
            <linearGradient id="clubGoldEdge" x1="12" y1="5" x2="54" y2="58">
              <stop offset="0%" stopColor="#fff9ce" />
              <stop offset="40%" stopColor="#ffc422" />
              <stop offset="100%" stopColor="#8b5600" />
            </linearGradient>
            <filter id="clubCrownShine" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feColorMatrix in="blur" type="matrix" values="1 0 0 0 1 0 0.82 0 0 0.58 0 0 0.25 0 0 0 0 0 1 0" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx="32" cy="32" r="28" fill="rgba(255, 196, 34, 0.07)" stroke="url(#clubGoldEdge)" strokeWidth="4.5" />
          <circle cx="32" cy="32" r="22" stroke="rgba(255, 246, 184, 0.2)" strokeWidth="1.2" />
          <path
            d="M16.8 39.2 20.2 20l9.1 8.1L32 17.4l2.7 10.7 9.1-8.1 3.4 19.2H16.8Z"
            fill="url(#clubGoldGlow)"
            stroke="#fff4a9"
            strokeWidth="2.1"
            strokeLinejoin="round"
            filter="url(#clubCrownShine)"
          />
          <path d="M20.4 44.5h23.2" stroke="url(#clubGoldEdge)" strokeWidth="4.2" strokeLinecap="round" />
          <path d="M23.4 27.2 29 32.4M32 23.4l1.6 6.4M40.7 27.2 35 32.4" stroke="#fff8c9" strokeWidth="1.5" strokeLinecap="round" opacity="0.72" />
          <path d="M22 18.2c3.6-3.8 9.8-5.8 15.9-3.4" stroke="#fff7bc" strokeWidth="1.4" strokeLinecap="round" opacity="0.42" />
        </svg>
      </div>
      <div className="official-club-title">
        <strong>Club</strong>
        <b>La Licoreria*</b>
        <span><i aria-hidden="true">🎟</i> Mis boletos: {visibleTickets} <em>|</em> sorteo mensual</span>
      </div>
      <div className="official-club-features">
        {CLUB_FEATURES.map((feature) => (
          <article key={feature.title}>
            <div className="official-club-feature-content">
              <i aria-hidden="true">{renderClubIcon(feature.icon)}</i>
              <strong>{feature.title}</strong>
              <span>{feature.body}</span>
            </div>
          </article>
        ))}
      </div>
      <button type="button" onClick={onOpenClub}>Mi club <span aria-hidden="true">↗</span></button>
    </section>
  );
}

function comboCartId(combo) {
  return `combo:${combo?.id || combo?.slug || ""}`;
}

function getProductStockBadge(stockInput) {
  const stock = Math.max(0, Number(stockInput || 0));
  if (stock >= 5) {
    return { label: "Stock", tone: "high" };
  }
  return { label: "Escaso", tone: "low" };
}

function getProductFlavorLabel(product) {
  const flavor = String(product?.flavor || product?.variantName || "").trim();
  if (!flavor) return "";
  return flavor.length > 18 ? `${flavor.slice(0, 17).trim()}...` : flavor;
}

function getComboStockLimit(combo, productsMap) {
  const comboProducts = (combo?.items || [])
    .map((item) => {
      const product = productsMap?.get?.(comboItemProductKey(item));
      return product ? { product, quantity: Math.max(1, Number(item.quantity || 1)) } : null;
    })
    .filter(Boolean);
  if (!comboProducts.length) return 0;
  return comboProducts.reduce((limit, { product, quantity }) => {
    const productStock = Math.max(0, Number(product.stock || 0));
    return Math.min(limit, Math.floor(productStock / quantity));
  }, 99);
}

function ComboShowcase({ combos, productsMap, onAddCombo, onRemoveCombo, comboQuantities, loading, onOpenCombo }) {
  const comboCount = combos.length;
  const comboFromPrice = combos.length ? Math.min(...combos.map((combo) => Number(combo.price || 0))) : 0;
  const previewLimit = 5;
  const visibleCombos = combos.slice(0, previewLimit);
  const showLoadingCards = loading && !visibleCombos.length;

  return (
    <section id="official-combos" className="official-combos-shell">
      <div className="official-combos-head">
        <div className="official-combos-copy">
          <div className="official-combos-hero">
            <div className="official-combos-title-block">
              <div className="official-combos-topline">
                <div className="official-combos-topline-copy">
                  <span>Combos nocturnos</span>
                  <i aria-hidden="true" className="official-combos-burst">✳</i>
                </div>
              </div>
              <h1>
                <span>Tu plan</span>
                <span>listo</span>
                <b>en minutos</b>
              </h1>
              <div className="official-combos-side">
                <p>Combos armados, stock completo y sin cola de espera.</p>
                <button type="button" onClick={() => { window.location.href = "/combos"; }}>Ver todos los combos</button>
                <div className="official-combos-meta" aria-label="Resumen de combos">
                  <span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9.5 7h8M9.5 12h8M9.5 17h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <circle cx="6" cy="7" r="1.2" fill="currentColor" />
                      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
                      <circle cx="6" cy="17" r="1.2" fill="currentColor" />
                    </svg>
                    {comboCount} planes listos
                  </span>
                  <span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M10 6h7l1 5-7 7-6-6 7-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <circle cx="14.5" cy="9.5" r="1.1" fill="currentColor" />
                    </svg>
                    Desde {money(comboFromPrice)}
                  </span>
                </div>
              </div>
            </div>
            <div className="official-combos-row" role="list" aria-label="Combos destacados">
              {showLoadingCards ? Array.from({ length: previewLimit }).map((_, index) => (
                <article key={`combo-loading-${index}`} className="official-combo-card is-loading" role="listitem" aria-hidden="true">
                  <div className="official-combo-content">
                    <span className="official-combo-badge official-combo-skeleton-badge" />
                    <div className="official-combo-copy">
                      <h3 className="official-combo-skeleton-line is-title" />
                      <p className="official-combo-skeleton-line is-body" />
                    </div>
                    <div className="official-combo-footer">
                      <div className="official-combo-price-block">
                        <strong className="official-combo-skeleton-line is-price" />
                      </div>
                      <span className="official-combo-skeleton-button" />
                    </div>
                    <div className="official-combo-media">
                      <span className="official-combo-loading-visual" />
                    </div>
                  </div>
                </article>
              )) : visibleCombos.map((combo) => {
                const { heroImage } = resolveComboDisplay(combo, productsMap);
                const comboLimit = getComboStockLimit(combo, productsMap);
                return (
                  <article
                    key={combo.id}
                    className={`official-combo-card is-${combo.theme}`}
                    role="listitem"
                    tabIndex={0}
                    onClick={() => onOpenCombo?.(combo)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenCombo?.(combo);
                      }
                    }}
                  >
                    <div className="official-combo-content">
                      {combo.badge ? <span className="official-combo-badge">{combo.badge}</span> : null}
                      <div className="official-combo-copy">
                        <h3>{combo.title}</h3>
                        <p>{combo.summary || "Combo listo para una noche sin complicaciones."}</p>
                      </div>

                      <div className="official-combo-footer">
                        <div className="official-combo-price-block">
                          <strong>{money(combo.price)}</strong>
                        </div>
                        <CardQuantityControl
                          quantity={comboQuantities?.get?.(comboCartId(combo)) || 0}
                          max={comboLimit}
                          aria-label={`Agregar ${combo.title}`}
                          onIncrement={() => onAddCombo(combo)}
                          onDecrement={() => onRemoveCombo(combo)}
                          className="is-combo-showcase"
                        />
                      </div>
                      <div className="official-combo-media">
                        <ComboHeroImage image={heroImage} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PromoPanel({ panel }) {
  return (
    <article className={`official-side-card is-${panel.tone}`}>
      <div className="official-side-card-copy">
        {panel.eyebrow ? <span>{panel.eyebrow}</span> : null}
        <h3>{panel.title}</h3>
        <p>{panel.body}</p>
        {panel.price ? <strong>{panel.price}</strong> : null}
      </div>
      <button type="button">{panel.action}</button>
    </article>
  );
}

function OccasionStrip() {
  return (
    <section id="official-occasions" className="official-plan-section" aria-label="Planes">
      <div className="official-plan-headline">
        <div className="official-section-kicker">Filtra por categorias y eventos</div>
      </div>
      <div className="official-plan-row" role="list">
        {EVENT_FILTER_CARDS.map((plan) => (
          <button type="button" key={plan.id} className={`official-plan-card is-${plan.tone}`} role="listitem">
            <span aria-hidden="true" className="official-plan-icon">
              {renderEventIcon(plan.icon)}
            </span>
            <strong>{plan.label}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function getProductPlaceholder(product) {
  const seed = normalizeText(`${product?.category || ""}-${product?.name || ""}`);
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = Number.isFinite(hash) ? hash : 34;
  return {
    "--product-placeholder-a": `hsl(${hue} 64% 24%)`,
    "--product-placeholder-b": `hsl(${(hue + 34) % 360} 78% 54%)`,
    "--product-placeholder-c": `hsl(${(hue + 68) % 360} 58% 14%)`
  };
}

function ProductImage({ product, image, priority = false }) {
  const [failed, setFailed] = useState(false);
  const shouldShowImage = !failed && !!image;
  const src = shouldShowImage ? image : productImageUnavailable;
  const [loaded, setLoaded] = useState(false);
  const placeholderStyle = getProductPlaceholder(product);
  return (
    <div className="official-product-image-stage" style={placeholderStyle} aria-hidden="true">
      <img
        src={src}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className={`${loaded ? "is-loaded" : "is-loading"}${shouldShowImage ? "" : " is-fallback"}`}
        onLoad={() => window.setTimeout(() => setLoaded(true), 80)}
        onError={() => {
          setFailed(true);
          setLoaded(false);
        }}
      />
    </div>
  );
}

function ComboHeroImage({ image }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = !failed && image ? image : comboImageUnavailable;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`official-combo-hero ${loaded ? "is-loaded" : "is-loading"}${failed || !image ? " is-fallback" : ""}`}
      onLoad={() => window.setTimeout(() => setLoaded(true), 80)}
      onError={() => {
        setFailed(true);
        setLoaded(false);
      }}
    />
  );
}

function ProductCard({ product, quantityInCart = 0, onAdd, onDecrease, isFavorite, favoriteBusy = false, onToggleFavorite, onOpenProduct, priorityImage = false }) {
  const image = productImage(product);
  const stockBadge = getProductStockBadge(product.stock);
  const flavorLabel = getProductFlavorLabel(product);
  const isOutOfStock = Math.max(0, Number(product.stock || 0)) <= 0;
  const favoriteClickGuard = React.useRef(0);
  function openDetail(event) {
    if (event?.target?.closest?.("button, a, input, select, textarea")) return;
    onOpenProduct?.(product);
  }
  function toggleFavorite(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - favoriteClickGuard.current < 280) return;
    favoriteClickGuard.current = now;
    if (favoriteBusy) return;
    onToggleFavorite?.(product);
  }
  return (
    <article
      className={`official-product-card${isOutOfStock ? " is-out-of-stock" : ""}`}
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(event) => {
        if (event.target?.closest?.("button, a, input, select, textarea")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail(event);
        }
      }}
    >
      <div className="official-product-media">
        <button
          type="button"
          className={`official-product-heart${isFavorite ? " is-active" : ""}`}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onPointerUp={toggleFavorite}
          onClick={toggleFavorite}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              toggleFavorite(event);
            }
          }}
          aria-label={isFavorite ? `Quitar ${product.name} de favoritos` : `Agregar ${product.name} a favoritos`}
          aria-pressed={!!isFavorite}
          aria-disabled={favoriteBusy}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill={isFavorite ? "currentColor" : "none"} aria-hidden="true">
            <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
          </svg>
        </button>
        <ProductImage product={product} image={image} priority={priorityImage} />
      </div>
      <div className="official-product-copy">
        <div className="official-product-topline">
          <span className="official-product-chip">{getCatalogLabel(product.category || "OTRO")}</span>
          <span className={`official-product-stock is-${stockBadge.tone}`}>{stockBadge.label}</span>
          {flavorLabel ? <span className="official-product-flavor">{flavorLabel}</span> : null}
        </div>
        <strong>{product.name}</strong>
        <div className="official-product-footer">
          <div className="official-product-price">
            <span>Precio</span>
            <b>{money(product.price)}</b>
          </div>
          <CardQuantityControl
            quantity={quantityInCart}
            max={product.stock}
            aria-label={`Agregar ${product.name}`}
            onIncrement={() => onAdd(product)}
            onDecrement={() => onDecrease?.(product)}
            className="is-product-card"
          />
        </div>
      </div>
    </article>
  );
}

function ProductSkeletonCard() {
  return (
    <article className="official-product-card is-loading" aria-hidden="true">
      <div className="official-product-media">
        <div className="official-product-image-stage">
          <span className="official-product-blur" />
        </div>
      </div>
      <div className="official-product-copy">
        <div className="official-product-topline">
          <span className="official-product-skeleton is-chip" />
          <span className="official-product-skeleton is-stock" />
        </div>
        <span className="official-product-skeleton is-title" />
        <div className="official-product-footer">
          <div className="official-product-price">
            <span className="official-product-skeleton is-label" />
            <span className="official-product-skeleton is-price" />
          </div>
          <span className="official-product-skeleton is-button" />
        </div>
      </div>
    </article>
  );
}

function ProductGrid({ products, status, loading, refreshing = false, category, onCategoryChange, query, onQueryChange, onAdd, onDecrease, productQuantities, favoriteIds, favoritePendingIds, onToggleFavorite, onOpenProduct }) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("recommended");
  const isPhoneCatalog = useMediaQuery("(max-width: 520px)");
  const pageSize = isPhoneCatalog ? PRODUCT_PHONE_PAGE_SIZE : PRODUCT_PAGE_SIZE;
  const sortedProducts = useMemo(() => {
    const list = [...products];
    if (sortBy === "price-asc") {
      return list.sort((left, right) => Number(left.price || 0) - Number(right.price || 0) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    }
    if (sortBy === "price-desc") {
      return list.sort((left, right) => Number(right.price || 0) - Number(left.price || 0) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    }
    if (sortBy === "name-asc") {
      return list.sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    }
    if (sortBy === "stock-desc") {
      return list.sort((left, right) => Number(right.stock || 0) - Number(left.stock || 0) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    }
    return list;
  }, [products, sortBy]);
  const totalItems = sortedProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginationItems = useMemo(() => buildPaginationItems(currentPage, totalPages), [currentPage, totalPages]);
  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedProducts.slice(start, start + pageSize);
  }, [sortedProducts, currentPage, pageSize]);
  const preloadedProducts = useMemo(() => {
    const indexes = [currentPage - 1, currentPage + 1].filter((item) => item >= 1 && item <= totalPages);
    return indexes.flatMap((item) => {
      const start = (item - 1) * pageSize;
      return sortedProducts.slice(start, start + pageSize);
    });
  }, [sortedProducts, currentPage, totalPages, pageSize]);
  const selectedCategoryLabel = CATALOG_SPOTLIGHTS.find((item) => item.category === category)?.label || "Todos";

  useEffect(() => {
    setPage(1);
  }, [products, category, sortBy]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const uniqueImages = [...new Set(preloadedProducts.map((product) => productImage(product)).filter(Boolean))];
    const imagePreloads = uniqueImages.map((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image;
    });
    return () => {
      imagePreloads.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [preloadedProducts]);

  function goToPage(nextPage) {
    const safePage = Math.min(totalPages, Math.max(1, Number(nextPage) || 1));
    setPage(safePage);
    requestAnimationFrame(() => {
      document.getElementById("official-products")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderPagination(position) {
    if (loading) return null;
    return (
    <div className={`official-product-pagination is-${position}`}>
      <span>
        Página {currentPage} de {totalPages}
      </span>
      <div className="official-product-pagination-controls" aria-label="Paginación del catálogo">
        <button type="button" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} aria-label="Página anterior">
          <span aria-hidden="true">←</span>
        </button>
        <div className="official-product-page-numbers">
          {paginationItems.map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="official-product-page-ellipsis">...</span>
            ) : (
              <button
                key={item}
                type="button"
                className={Number(item) === currentPage ? "is-active" : ""}
                disabled={Number(item) === currentPage}
                onClick={() => goToPage(item)}
                aria-current={Number(item) === currentPage ? "page" : undefined}
              >
                {item}
              </button>
            )
          )}
        </div>
        <button type="button" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Página siguiente">
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
    );
  }

  return (
    <section id="official-products" className="official-products">
      <div className="official-product-panel">
        <div className="official-section-head">
          <div>
            <div className="official-section-kicker">Catalogo de productos</div>
            <small>{totalItems} productos disponibles</small>
          </div>
        </div>

        <div className="official-category-row" aria-label="Categorias destacadas">
          {CATALOG_SPOTLIGHTS.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              className={`is-${getCategoryTone(index)}${category === item.category ? " is-active" : ""}`}
              onClick={() => onCategoryChange(item.category)}
            >
              <span aria-hidden="true">{item.icon}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>

        <div className="official-mobile-filter-row" aria-label="Filtros rápidos del catálogo">
          <label>
            <span>Categoría</span>
            <select
              value={category}
              onChange={(event) => onCategoryChange(event.target.value)}
              style={{ "--mobile-select-ch": selectedCategoryLabel.length }}
            >
              {CATALOG_SPOTLIGHTS.map((item, index) => (
                <option key={`mobile-${item.id}-${index}`} value={item.category}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="official-catalog-tools" aria-label="Filtros del catálogo">
          <label className="official-catalog-sort-select">
            <span>Ordenar</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            {PRODUCT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            </select>
          </label>
          <label className="official-catalog-search">
            <span className="official-catalog-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar por nombre del producto"
              aria-label="Buscar productos del catálogo"
            />
          </label>
        </div>

        {refreshing && !loading ? (
          <div className="official-catalog-refresh" role="status">Actualizando catálogo...</div>
        ) : null}

        {renderPagination("top")}

        <div id="catalog-grid" className="official-product-grid" aria-busy={loading ? "true" : "false"}>
          {loading
            ? Array.from({ length: pageSize }, (_, index) => <ProductSkeletonCard key={`product-skeleton-${index}`} />)
            : visibleProducts.map((product, index) => (
              <ProductCard
                key={productFavoriteId(product) || `product-${index}`}
                product={product}
                quantityInCart={productQuantities?.get?.(productFavoriteId(product)) || 0}
                onAdd={onAdd}
                onDecrease={onDecrease}
                isFavorite={favoriteIds?.has(productFavoriteId(product))}
                favoriteBusy={favoritePendingIds?.has(productFavoriteId(product))}
                onToggleFavorite={onToggleFavorite}
                onOpenProduct={onOpenProduct}
                priorityImage={currentPage === 1 && index < 8}
              />
            ))}
        </div>
        {renderPagination("bottom")}
      </div>
    </section>
  );
}

function BenefitsBar() {
  return (
    <section className="official-benefit-bar" aria-label="Beneficios">
      <strong>Compra rapido, sin vueltas <i aria-hidden="true">⚡</i></strong>
      <span>
        <i aria-hidden="true">♙</i>
        <b>Pedido rapido</b>
        <small>Confirmacion al instante.</small>
      </span>
      <span>
        <i aria-hidden="true">☄</i>
        <b>Sin esperas</b>
        <small>Compra facil desde casa.</small>
      </span>
      <span>
        <i aria-hidden="true">☾</i>
        <b>Delivery claro</b>
        <small>Envio calculado por zona.</small>
      </span>
    </section>
  );
}

function StoreClosedScreen({ nextOpening, reason }) {
  return (
    <section className="store-closed-screen" aria-live="polite">
      <div className="store-closed-mark" aria-hidden="true">CERRADO</div>
      <h1>Vuelve pronto</h1>
      <p>No estamos tomando pedidos en este momento para evitar cancelaciones o demoras.</p>
      <div className="store-closed-next">
        <span>Abrimos</span>
        <strong>{nextOpening}</strong>
      </div>
      {reason ? <small>{reason}</small> : null}
    </section>
  );
}

export default function Storefront() {
  const [storeControl, setStoreControl] = useState(() => readStoreControl());
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("TODOS");
  const [cart, setCart] = useState(() => {
    try {
      const raw = localStorage.getItem("licoreria_cart_v1");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [cartGlowTick, setCartGlowTick] = useState(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartToast, setCartToast] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deliveryCouponCode, setDeliveryCouponCode] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("licoreria_cart_v1", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  useEffect(() => {
    if (!cartOpen) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setCartOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cartOpen]);
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "" });
  const [status, setStatus] = useState("Cargando catalogo...");
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsRefreshing, setProductsRefreshing] = useState(false);
  const [combosLoading, setCombosLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authToken, setAuthToken] = useState(() => getStoredToken());
  const [authUser, setAuthUser] = useState(null);
  const location = useLocation();
  const reactNavigate = useNavigate();
  const confirmDialog = useConfirm();
  const route = location.pathname.replace(/^\/+/, "").split("/")[0] || "";
  const routeParts = location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const comboBackgroundRoute = route === "combo"
    ? String(location.state?.comboBackground || "").replace(/^\/+/, "").split("/")[0] || ""
    : route;
  const productBackgroundRoute = route === "producto"
    ? String(location.state?.productBackground || "").replace(/^\/+/, "").split("/")[0] || ""
    : route;
  const visibleRoute = route === "combo" ? comboBackgroundRoute : route === "producto" ? productBackgroundRoute : route;
  const clubAllowed = canSeeClub(authUser);
  const storeClosed = !storeControl.open;
  const canViewClosedStoreProfile = storeClosed && visibleRoute === "cuenta";
  const nextOpening = useMemo(
    () => nextStoreOpening(storeControl.schedule || DEFAULT_STORE_SCHEDULE),
    [storeControl.schedule]
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [route]);

  useEffect(() => {
    function refreshStoreControl() {
      setStoreControl(readStoreControl());
    }
    refreshStoreControl();
    const id = window.setInterval(refreshStoreControl, 60000);
    window.addEventListener("storage", refreshStoreControl);
    window.addEventListener("focus", refreshStoreControl);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", refreshStoreControl);
      window.removeEventListener("focus", refreshStoreControl);
    };
  }, []);

  useEffect(() => {
    if (!storeClosed) return;
    setCartOpen(false);
    setCheckoutOpen(false);
  }, [storeClosed]);

  useEffect(() => {
    if (visibleRoute === "club" && authUser && !clubAllowed) {
      reactNavigate("/cuenta", { replace: true });
    }
  }, [authUser, clubAllowed, reactNavigate, visibleRoute]);
  const [favoriteProductIds, setFavoriteProductIds] = useState(() => readFavoriteCache(FAVORITE_PRODUCT_CACHE_KEY));
  const [favoriteComboIds, setFavoriteComboIds] = useState(() => readFavoriteCache(FAVORITE_COMBO_CACHE_KEY));
  const [favoriteProductPendingIds, setFavoriteProductPendingIds] = useState(() => new Set());
  const [favoriteComboPendingIds, setFavoriteComboPendingIds] = useState(() => new Set());
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 180);

  useEffect(() => {
    const image = new Image();
    image.src = productImageUnavailable;
  }, []);

  useEffect(() => {
    function onUnauthorized() {
      setStoredToken("");
      setAuthToken("");
      setAuthUser(null);
      setAccountOpen(true);
      reactNavigate("/");
    }
    window.addEventListener("licoreria:unauthorized", onUnauthorized);
    return () => window.removeEventListener("licoreria:unauthorized", onUnauthorized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshUnreadNotifs() {
    if (!authToken) return;
    try {
      const r = await countNoLeidas();
      setUnreadNotifs(Number(r?.total || 0));
    } catch {}
  }

  async function refreshFavoriteIds() {
    const token = getStoredToken();
    if (!token) {
      setFavoriteProductIds(new Set());
      setFavoriteComboIds(new Set());
      writeFavoriteCache(FAVORITE_PRODUCT_CACHE_KEY, new Set());
      writeFavoriteCache(FAVORITE_COMBO_CACHE_KEY, new Set());
      setFavoriteProductPendingIds(new Set());
      setFavoriteComboPendingIds(new Set());
      return;
    }
    const data = await listFavoritoIds();
    setFavoriteProductIds((current) => {
      const next = mergeFavoriteIds(current, data?.productoIds);
      writeFavoriteCache(FAVORITE_PRODUCT_CACHE_KEY, next);
      return next;
    });
    setFavoriteComboIds((current) => {
      const next = mergeFavoriteIds(current, data?.comboIds);
      writeFavoriteCache(FAVORITE_COMBO_CACHE_KEY, next);
      return next;
    });
  }

  const refreshFavoriteIdsSafe = useCallback(() => {
    refreshFavoriteIds().catch((error) => {
      setStatus(error?.message || "No se pudo sincronizar favoritos.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authToken) {
      setUnreadNotifs(0);
      return undefined;
    }
    refreshUnreadNotifs();
    const id = window.setInterval(refreshUnreadNotifs, 60000);
    function onFocus() {
      refreshUnreadNotifs();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    if (!["pedidos", "notificaciones"].includes(visibleRoute)) return;
    refreshUnreadNotifs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, visibleRoute]);

  useEffect(() => {
    if (!authToken) {
      setFavoriteProductIds(new Set());
      setFavoriteComboIds(new Set());
      writeFavoriteCache(FAVORITE_PRODUCT_CACHE_KEY, new Set());
      writeFavoriteCache(FAVORITE_COMBO_CACHE_KEY, new Set());
      setFavoriteProductPendingIds(new Set());
      setFavoriteComboPendingIds(new Set());
      return undefined;
    }
    refreshFavoriteIdsSafe();
    function onFocus() {
      refreshFavoriteIdsSafe();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, refreshFavoriteIdsSafe]);

  useEffect(() => {
    if (visibleRoute !== "favoritos") return;
    refreshFavoriteIdsSafe();
  }, [visibleRoute, authToken, refreshFavoriteIdsSafe]);

  function toggleFavoriteProduct(product) {
    const id = productFavoriteId(product);
    if (!id || favoriteProductPendingIds.has(id)) return;
    const willAdd = !favoriteProductIds.has(id);
    setFavoriteProductPendingIds((prev) => new Set(prev).add(id));
    setFavoriteProductIds((prev) => {
      const next = new Set(prev);
      if (willAdd) next.add(id);
      else next.delete(id);
      writeFavoriteCache(FAVORITE_PRODUCT_CACHE_KEY, next);
      return next;
    });
    const token = getStoredToken();
    if (!token) {
      setFavoriteProductPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    if (token !== authToken) setAuthToken(token);
    (willAdd ? apiAddFavorito("producto", id) : apiRemoveFavorito("producto", id))
      .catch((error) => {
        if (error?.status === 401) {
          setStoredToken("");
          setAuthToken("");
          setAuthUser(null);
          setAccountOpen(true);
        }
        setStatus(error?.message || "No se pudo actualizar favoritos.");
      })
      .finally(() => {
        setFavoriteProductPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  }

  function toggleFavoriteCombo(combo) {
    const id = String(combo?.id || "");
    if (!id || favoriteComboPendingIds.has(id)) return;
    const willAdd = !favoriteComboIds.has(id);
    setFavoriteComboPendingIds((prev) => new Set(prev).add(id));
    setFavoriteComboIds((prev) => {
      const next = new Set(prev);
      if (willAdd) next.add(id);
      else next.delete(id);
      writeFavoriteCache(FAVORITE_COMBO_CACHE_KEY, next);
      return next;
    });
    const token = getStoredToken();
    if (!token) {
      setFavoriteComboPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    if (token !== authToken) setAuthToken(token);
    (willAdd ? apiAddFavorito("combo", id) : apiRemoveFavorito("combo", id))
      .catch((error) => {
        if (error?.status === 401) {
          setStoredToken("");
          setAuthToken("");
          setAuthUser(null);
          setAccountOpen(true);
        }
        setStatus(error?.message || "No se pudo actualizar favoritos.");
      })
      .finally(() => {
        setFavoriteComboPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  }

  function navigate(target) {
    reactNavigate(target ? `/${target}` : "/");
  }

  function handleOpenAccount() {
    if (authUser) {
      setAccountOpen(false);
      reactNavigate("/cuenta");
      return;
    }
    setAccountOpen(true);
  }

  function openComboDetail(combo) {
    const slug = combo?.slug || combo?.id;
    if (!slug) return;
    reactNavigate(`/combo/${encodeURIComponent(slug)}`, { state: { comboBackground: location.pathname || "/" } });
  }

  function openProductDetail(product) {
    const id = productFavoriteId(product);
    if (!id) return;
    reactNavigate(`/producto/${encodeURIComponent(id)}`, { state: { productBackground: location.pathname || "/" } });
  }

  useEffect(() => {
    let cancelled = false;
    if (!authToken) {
      setAuthUser(null);
      setCart([]);
      return undefined;
    }
    fetchCurrentUser(authToken).then((user) => {
      if (cancelled) return;
      if (user) {
        setAuthUser(user);
      } else {
        setStoredToken("");
        setAuthToken("");
        setAuthUser(null);
        setCart([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  function handleAuthenticated(token, user, options = {}) {
    setStoredToken(token);
    setAuthToken(token);
    setAuthUser(user);
    setAccountOpen(false);
    window.setTimeout(() => {
      refreshFavoriteIdsSafe();
    }, 0);
    if (!options.preserveRoute) reactNavigate("/cuenta");
  }

  async function handleLogout() {
    const ok = await confirmDialog({
      icon: "🚪",
      title: "¿Cerrar sesión?",
      description: "Tu cuenta seguirá segura. Puedes volver a ingresar cuando quieras.",
      primaryLabel: "Cerrar sesión",
      cancelLabel: "Cancelar",
      danger: true
    });
    if (!ok) return;
    const token = authToken;
    setStoredToken("");
    setAuthToken("");
    setAuthUser(null);
    setCart([]);
    setAccountOpen(false);
    if (token) await logoutCustomer(token);
    reactNavigate("/");
  }

  useEffect(() => {
    if (!cartGlowTick) return undefined;
    const timeoutId = window.setTimeout(() => setCartGlowTick(0), 680);
    return () => window.clearTimeout(timeoutId);
  }, [cartGlowTick]);

  useEffect(() => {
    if (authUser?.requiereVerificacionEdad && authToken) setAccountOpen(true);
  }, [authUser, authToken]);

  function requireCartSession() {
    if (authUser) return true;
    setCartOpen(false);
    setCheckoutOpen(false);
    setAccountOpen(true);
    setStatus("Inicia sesion o crea una cuenta para agregar productos al carrito.");
    return false;
  }

  useEffect(() => {
    let cancelled = false;
    if (storeClosed) {
      setProducts([]);
      setCategories([]);
      setProductsLoading(false);
      setProductsRefreshing(false);
      setStatus("Tienda cerrada temporalmente.");
      return undefined;
    }
    const cachedProducts = getCachedProducts();
    const cachedCategories = getCachedProductCategories();
    const cacheMeta = getProductCacheMeta();
    const hasCachedProducts = cachedProducts.length > 0;
    if (cachedProducts.length) {
      setProducts(cachedProducts);
      setStatus(
        cacheMeta.isFresh
          ? `${cachedProducts.length} productos listos para pedir.`
          : `${cachedProducts.length} productos listos. Actualizando stock...`
      );
      setProductsLoading(false);
      setProductsRefreshing(true);
    }
    if (cachedCategories.length) {
      setCategories(uniqueCategories(cachedCategories));
    }
    if (!hasCachedProducts) {
      setProductsLoading(true);
      setProductsRefreshing(false);
      setStatus("Cargando catálogo...");
    }
    Promise.all([hasCachedProducts ? refreshProducts() : loadProducts(), loadProductCategories().catch(() => [])])
      .then(([items, categoryItems]) => {
        if (cancelled) return;
        setProducts(items);
        setCategories(uniqueCategories(categoryItems || []));
        setStatus(`${items.length} productos listos para pedir.`);
      })
      .catch((error) => {
        if (cancelled) return;
        if (hasCachedProducts) {
          setStatus(`${cachedProducts.length} productos disponibles sin conexión. Reintentaremos luego.`);
        } else {
          setStatus(error.message || "No se pudo cargar el catalogo.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProductsLoading(false);
          setProductsRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storeClosed]);

  useEffect(() => {
    let cancelled = false;
    if (storeClosed) {
      setCombos([]);
      setCombosLoading(false);
      return undefined;
    }
    const cachedCombos = getCachedCombos();
    const comboMeta = getComboCacheMeta();
    if (cachedCombos.length) {
      const list = cachedCombos.map((c) => ({
        id: String(c.id),
        slug: c.slug,
        badge: c.badge || "",
        title: c.title,
        summary: c.summary,
        price: c.price,
        theme: c.theme || "gold",
        imageHash: c.imageHash || "",
        imageUrl: c.imageUrl || "",
        imageData: c.imageData || "",
        tipo: c.tipo || "general",
        items: Array.isArray(c.items) ? c.items : []
      }));
      setCombos(list);
      setCombosLoading(false);
      if (!comboMeta.isFresh) setCombosLoading(true);
    } else {
      setCombosLoading(true);
    }
    loadCombos()
      .then((items) => {
        if (cancelled) return;
        const list = (Array.isArray(items) ? items : []).map((c) => ({
          id: String(c.id),
          slug: c.slug,
          badge: c.badge || "",
          title: c.title,
          summary: c.summary,
          price: c.price,
          theme: c.theme || "gold",
          imageHash: c.imageHash || "",
          imageUrl: c.imageUrl || "",
          imageData: c.imageData || "",
          tipo: c.tipo || "general",
          items: Array.isArray(c.items) ? c.items : []
        }));
        if (list.length) setCombos(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCombosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeClosed]);

  const filteredProducts = useMemo(() => {
    const term = normalizeText(debouncedQuery);
    return products.filter((product) => {
      const matchesQuery =
        !term ||
        normalizeText(product.name).includes(term) ||
        normalizeText(product.category).includes(term) ||
        normalizeText(product.description).includes(term);
      const matchesCategory = matchesCatalogCategory(product.category, category);
      return matchesQuery && matchesCategory;
    });
  }, [products, debouncedQuery, category]);

  const featuredProducts = useMemo(() => {
    const source = filteredProducts.length ? filteredProducts : products;
    return [...source].sort((left, right) => {
      const leftHasImage = productImage(left) ? 1 : 0;
      const rightHasImage = productImage(right) ? 1 : 0;
      return rightHasImage - leftHasImage;
    }).slice(0, 4);
  }, [filteredProducts, products]);

  const productsMap = useMemo(() => new Map(products.map((product) => [productFavoriteId(product), product])), [products]);
  const selectedComboId = route === "combo" ? decodeURIComponent(routeParts[1] || "") : "";
  const selectedCombo = selectedComboId
    ? combos.find((combo) => String(combo.slug || combo.id) === selectedComboId || String(combo.id) === selectedComboId)
    : null;
  const selectedProductId = route === "producto" ? decodeURIComponent(routeParts[1] || "") : "";
  const selectedProduct = selectedProductId
    ? products.find((product) => productFavoriteId(product) === selectedProductId)
    : null;
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const units = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartLines = cart.length;
  const productQuantities = useMemo(
    () => new Map(cart.filter((item) => item.type !== "combo").map((item) => [String(item.id), Number(item.quantity || 0)])),
    [cart]
  );
  const comboQuantities = useMemo(
    () => new Map(cart.filter((item) => item.type === "combo").map((item) => [String(item.id), Number(item.quantity || 0)])),
    [cart]
  );

  function addToCart(product) {
    if (!requireCartSession()) return;
    const stockLimit = Math.max(0, Number(product.stock || 0));
    if (stockLimit <= 0) {
      setStatus(`No hay stock suficiente para agregar ${product.name}.`);
      return;
    }
    let added = false;
    let blockedByStock = false;
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        if (Number(existing.quantity || 0) >= stockLimit) {
          blockedByStock = true;
          return current;
        }
        added = true;
        return current.map((item) =>
          item.id === product.id ? { ...item, stock: stockLimit, quantity: Math.min(item.quantity + 1, stockLimit) } : item
        );
      }
      added = true;
      return [
        ...current,
        {
          id: product.id,
          productId: product.parentProductId || product.id,
          parentProductId: product.parentProductId || "",
          variantId: product.variantId || "",
          variantName: product.variantName || "",
          name: product.name,
          price: product.price,
          quantity: 1,
          stock: stockLimit,
          imageHash: product.imageHash || "",
          imageUrl: product.imageUrl || "",
          category: product.category || "",
          cigarettePresentation: product.cigarettePresentation || "",
          cigarettePresentationLabel: product.cigarettePresentationLabel || "",
          cigarettePresentationUnits: product.cigarettePresentationUnits || 0,
          cigarettePresentationReportUnits: product.cigarettePresentationReportUnits || 0
        }
      ];
    });
    if (blockedByStock || !added) {
      setStatus(`No hay stock para agregar mas unidades de ${product.name}.`);
      return;
    }
    setCartGlowTick(Date.now());
    setCartToast((current) => current || {
      key: Date.now(),
      name: product.name,
      imageHash: product.imageHash || ""
    });
  }

  function decreaseProductFromCart(product) {
    if (!product?.id) return;
    setCartQuantity(product.id, (productQuantities.get(String(product.id)) || 0) - 1);
  }

  function removeFromCart(id) {
    setCart((current) => current.filter((item) => item.id !== id));
  }

  function setCartQuantity(id, quantity) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;
          const max = item.stock || quantity;
          const next = Math.max(0, Math.min(quantity, max));
          return { ...item, quantity: next };
        })
        .filter((item) => item.quantity > 0)
    );
  }

  function addComboToCart(combo) {
    if (!requireCartSession()) return;
    const comboProducts = (combo.items || [])
      .map((item) => {
        const product = productsMap.get(comboItemProductKey(item));
        return product ? { product, source: item, quantity: Math.max(1, Number(item.quantity || 1)) } : null;
      })
      .filter(Boolean);

    if (!comboProducts.length) {
      setStatus("Este combo aun no tiene productos asignados. Configuralo desde el admin.");
      return;
    }

    const id = comboCartId(combo);
    const stockLimit = getComboStockLimit(combo, productsMap);

    if (stockLimit <= 0) {
      setStatus(`No hay stock suficiente para agregar ${combo.title}.`);
      return;
    }

    let added = false;
    let blockedByStock = false;
    setCart((current) => {
      const existing = current.find((item) => item.id === id);
      if (existing) {
        if (Number(existing.quantity || 0) >= stockLimit) {
          blockedByStock = true;
          return current;
        }
        added = true;
        return current.map((item) =>
          item.id === id ? { ...item, stock: stockLimit, quantity: Math.min(item.quantity + 1, stockLimit) } : item
        );
      }
      const { heroImage } = resolveComboDisplay(combo, productsMap);
      added = true;
      return [
        ...current,
        {
          id,
          type: "combo",
          comboId: combo.id,
          name: combo.title,
          price: Number(combo.price || 0),
          quantity: 1,
          stock: stockLimit || 99,
          imageUrl: heroImage || combo.imageUrl || "",
          imageData: combo.imageData || "",
          category: "Combo",
          items: comboProducts.map(({ product, source, quantity }) => ({
            productId: String(source.productId || product.parentProductId || product.id),
            variantId: source.variantId || product.variantId || "",
            quantity,
            name: product.name,
            price: Number(product.price || 0),
            category: product.category || ""
          }))
        }
      ];
    });
    if (blockedByStock || !added) {
      setStatus(`No hay stock para agregar mas unidades de ${combo.title}.`);
      return;
    }
    setCartGlowTick(Date.now());
    setCartToast((current) => current || {
      key: Date.now(),
      name: combo.title,
      imageUrl: combo.imageUrl || ""
    });
    setStatus(`Combo agregado: ${combo.title}.`);
  }

  function decreaseComboFromCart(combo) {
    const id = comboCartId(combo);
    setCartQuantity(id, (comboQuantities.get(id) || 0) - 1);
  }

  function changeCartQuantity(id, delta) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;
          const nextQuantity = Math.max(0, Math.min(item.quantity + delta, item.stock || item.quantity + delta));
          return { ...item, quantity: nextQuantity };
        })
        .filter((item) => item.quantity > 0)
    );
  }

  function jumpToCheckout() {
    if (!requireCartSession()) return;
    if (!cart.length) return;
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  function openCart() {
    if (!requireCartSession()) return;
    setCartOpen(true);
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!cart.length) {
      setStatus("Agrega productos antes de registrar el pedido.");
      return;
    }
    if (!customer.name.trim() || !customer.phone.trim()) {
      setStatus("Completa el nombre y el celular del cliente.");
      return;
    }

    setSubmitting(true);
    try {
      const order = {
        channel: "web",
        customer,
        items: cart,
        total,
        units,
        createdAtText: new Date().toISOString()
      };
      const result = await createOrder(order);
      setCart([]);
      setCustomer({ name: "", phone: "", address: "" });
      setStatus(`Pedido registrado${result?.id ? `: ${result.id}` : ""}.`);
    } catch (error) {
      setStatus(error.message || "No se pudo registrar el pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (storeClosed && !canViewClosedStoreProfile) {
    return (
      <main className="official-store-shell" id="contenido-principal">
        <a href="#contenido-principal" className="skip-to-content">Saltar al contenido</a>
        <Header
          query={query}
          onQueryChange={setQuery}
          total={0}
          cartLines={0}
          cartUnits={0}
          onJumpToCheckout={() => {}}
          cartGlowTick={0}
          authUser={authUser}
          unreadNotifs={unreadNotifs}
          onOpenAccount={handleOpenAccount}
          currentRoute={route}
          onNavigate={(target) => reactNavigate(target)}
        />
        <AccountModal
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          currentUser={authUser}
          authToken={authToken}
          onAuthenticated={(token, user, options) => {
            handleAuthenticated(token, user, options);
          }}
          onLogout={handleLogout}
          onNavigate={navigate}
        />
        <StoreClosedScreen nextOpening={nextOpening} reason={storeControl.closedReason} />
      </main>
    );
  }

  return (
    <main className="official-store-shell" id="contenido-principal">
      <a href="#contenido-principal" className="skip-to-content">Saltar al contenido</a>
      <Header
        query={query}
        onQueryChange={setQuery}
        total={canViewClosedStoreProfile || !authUser ? 0 : total}
        cartLines={canViewClosedStoreProfile || !authUser ? 0 : cartLines}
        cartUnits={canViewClosedStoreProfile || !authUser ? 0 : units}
        onJumpToCheckout={canViewClosedStoreProfile ? () => {} : openCart}
        cartGlowTick={authUser ? cartGlowTick : 0}
        authUser={authUser}
        unreadNotifs={unreadNotifs}
        onOpenAccount={handleOpenAccount}
        currentRoute={route}
        onNavigate={(target) => reactNavigate(target)}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cart}
        onChangeQuantity={changeCartQuantity}
        onSetQuantity={setCartQuantity}
        onRemove={removeFromCart}
        onCheckout={jumpToCheckout}
        onContinueShopping={() => setCartOpen(false)}
        productsMap={productsMap}
        couponCode={deliveryCouponCode}
        onCouponCodeChange={setDeliveryCouponCode}
      />

      <CartToast
        key={cartToast?.key || "empty"}
        toast={cartToast}
        onAction={() => {
          setCartToast(null);
          openCart();
        }}
        onDismiss={() => setCartToast(null)}
      />

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        currentUser={authUser}
        authToken={authToken}
        onAuthenticated={(token, user, options) => {
          handleAuthenticated(token, user, options);
        }}
        onLogout={handleLogout}
        onNavigate={navigate}
      />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        items={cart}
        authUser={authUser}
        couponDraft={deliveryCouponCode}
        onCouponDraftChange={setDeliveryCouponCode}
        onSuccess={() => {
          setCart([]);
          setDeliveryCouponCode("");
        }}
      />

      <div key={visibleRoute} className={`route-fade${visibleRoute === "combos" ? " route-fade-combos" : ""}`}>
      {visibleRoute === "pedido" ? (
        <PedidoDetallePage orderId={routeParts[1] || ""} onGoCatalog={() => navigate("")} />
      ) : visibleRoute === "combos" ? (
        <CombosPage
          onAddCombo={addComboToCart}
          onRemoveCombo={decreaseComboFromCart}
          comboQuantities={comboQuantities}
          onOpenCombo={openComboDetail}
          onGoCatalog={() => navigate("")}
          favoriteComboIds={favoriteComboIds}
          onToggleFavorite={toggleFavoriteCombo}
          fallbackImageFor={fallbackComboImage}
        />
      ) : visibleRoute === "cuenta" ? (
        authUser ? (
          <AccountLayout active="cuenta" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MiCuentaPage user={authUser} onNavigate={navigate} onUpdateUser={setAuthUser} />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para ver tu cuenta</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "club" ? (
        authUser && clubAllowed ? (
          <AccountLayout active="club" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MiClubPage user={authUser} onNavigate={navigate} />
          </AccountLayout>
        ) : authUser ? (
          <AccountLayout active="cuenta" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MiCuentaPage user={authUser} onNavigate={navigate} onUpdateUser={setAuthUser} />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para continuar</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "notificaciones" ? (
        authUser ? (
          <AccountLayout active="notificaciones" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <NotificacionesPage onUnreadChange={refreshUnreadNotifs} onNavigate={navigate} showClub={clubAllowed} />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para ver tus notificaciones</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "opinion" ? (
        authUser ? (
          <AccountLayout active="opinion" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <OpinionPage user={authUser} />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para contarnos tu opinión</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "pagos" ? (
        authUser ? (
          <AccountLayout active="pagos" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MisPagosPage />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para gestionar tus métodos de pago</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "direcciones" ? (
        authUser ? (
          <AccountLayout active="direcciones" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MisDireccionesPage user={authUser} />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para gestionar tus direcciones</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "favoritos" ? (
        authUser ? (
          <AccountLayout active="favoritos" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MisFavoritosPage
              productsMap={productsMap}
              combos={combos}
              onAdd={addToCart}
              onAddCombo={addComboToCart}
              onToggleProduct={toggleFavoriteProduct}
              onToggleCombo={toggleFavoriteCombo}
              favoriteProductIds={favoriteProductIds}
              favoriteComboIds={favoriteComboIds}
              onRefreshFavorites={refreshFavoriteIdsSafe}
              onGoCatalog={() => navigate("")}
            />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para ver tus favoritos</h3>
              <p>Guarda lo que más te gusta y pídelo de un toque.</p>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : visibleRoute === "pedidos" ? (
        authUser ? (
          <AccountLayout active="pedidos" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MisPedidosPage
              productsMap={productsMap}
              onGoCatalog={() => navigate("")}
              onRepeat={(items) => {
                for (const it of items) {
                  const product = productsMap.get(String(it.productId)) || {
                    id: String(it.productId),
                    name: it.name,
                    price: it.price,
                    stock: it.stock || 99,
                    imageHash: it.imageHash || ""
                  };
                  for (let i = 0; i < (it.quantity || 1); i += 1) addToCart(product);
                }
                navigate("");
                setCartOpen(true);
              }}
            />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para ver tus pedidos</h3>
              <p>Necesitamos saber quién eres para mostrarte tu historial.</p>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="official-store-grid">
            <section className="official-main-column">
              {clubAllowed ? <ClubBanner onOpenClub={() => navigate("club")} clubTickets={authUser?.club?.boletos} /> : null}
              <ComboShowcase
                combos={combos}
                productsMap={productsMap}
                onAddCombo={addComboToCart}
                onRemoveCombo={decreaseComboFromCart}
                comboQuantities={comboQuantities}
                loading={combosLoading}
                onOpenCombo={openComboDetail}
              />
              <ProductGrid
                products={filteredProducts}
                status={status}
                loading={productsLoading}
                refreshing={productsRefreshing}
                category={category}
                onCategoryChange={setCategory}
                query={query}
                onQueryChange={setQuery}
                onAdd={addToCart}
                onDecrease={decreaseProductFromCart}
                productQuantities={productQuantities}
                favoriteIds={favoriteProductIds}
                favoritePendingIds={favoriteProductPendingIds}
                onToggleFavorite={toggleFavoriteProduct}
                onOpenProduct={openProductDetail}
              />
            </section>
          </div>

          <BenefitsBar />
        </>
      )}
      </div>
      {route === "combo" ? (
        <ComboDetallePage
          combo={selectedCombo}
          productsMap={productsMap}
          onAddCombo={addComboToCart}
          onRemoveCombo={decreaseComboFromCart}
          getQuantity={(combo) => comboQuantities.get(comboCartId(combo)) || 0}
          stockLimit={getComboStockLimit(selectedCombo, productsMap)}
          onGoBack={() => {
            if (location.state?.comboBackground) reactNavigate(-1);
            else navigate("");
          }}
          isFavorite={favoriteComboIds.has(String(selectedCombo?.id || ""))}
          favoriteBusy={favoriteComboPendingIds.has(String(selectedCombo?.id || ""))}
          onToggleFavorite={toggleFavoriteCombo}
          loading={combosLoading}
        />
      ) : null}
      {route === "producto" ? (
        <ProductoDetallePage
          key={selectedProductId}
          product={selectedProduct}
          products={products}
          onAdd={addToCart}
          onDecrease={decreaseProductFromCart}
          getQuantity={(product) => productQuantities.get(String(product?.id || "")) || 0}
          onGoBack={() => {
            if (location.state?.productBackground) reactNavigate(-1);
            else navigate("");
          }}
          isFavorite={favoriteProductIds.has(String(selectedProduct?.id || ""))}
          favoriteBusy={favoriteProductPendingIds.has(String(selectedProduct?.id || ""))}
          onToggleFavorite={toggleFavoriteProduct}
          loading={productsLoading}
        />
      ) : null}
    </main>
  );
}
