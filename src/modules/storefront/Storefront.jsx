import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import officialLogo from "../../assets/branding/la-licoreria-logo.svg";
import { loadComboCatalog } from "../combos/comboCatalog.js";
import { createOrder, loadProductCategories, loadProducts, resolveProductImage } from "./storefrontApi.js";
import AccountModal from "./AccountModal.jsx";
import CartDrawer from "./CartDrawer.jsx";
import CartToast from "./CartToast.jsx";
import CheckoutModal from "./CheckoutModal.jsx";
import MisPedidosPage from "./pages/MisPedidosPage.jsx";
import MisFavoritosPage from "./pages/MisFavoritosPage.jsx";
import CombosPage from "./pages/CombosPage.jsx";
import PromosPage from "./pages/PromosPage.jsx";
import MisDireccionesPage from "./pages/MisDireccionesPage.jsx";
import MisPagosPage from "./pages/MisPagosPage.jsx";
import NotificacionesPage from "./pages/NotificacionesPage.jsx";
import InvitarPage from "./pages/InvitarPage.jsx";
import MiCuentaPage from "./pages/MiCuentaPage.jsx";
import AccountLayout from "./account/AccountLayout.jsx";
import { useConfirm } from "./common/ConfirmDialog.jsx";
import { countNoLeidas } from "./notificacionesApi.js";
import { loadCombos } from "./combosApi.js";
import comboChillImage from "../../assets/storefront/combos/frame-48.png";
import comboFullImage from "../../assets/storefront/combos/frame-49.png";
import comboPlayaImage from "../../assets/storefront/combos/frame-47.png";
import comboPreImage from "../../assets/storefront/combos/frame-46.png";

const COMBO_FALLBACK_IMAGES = {
  "combo-pre": comboPreImage,
  "combo-playa": comboPlayaImage,
  "combo-chill": comboChillImage,
  "combo-full": comboFullImage,
  "combo-romantico": comboFullImage,
  "combo-premium": comboFullImage,
  "combo-after": comboPlayaImage,
  "combo-gin-tonic": comboChillImage
};

function fallbackComboImage(combo) {
  return COMBO_FALLBACK_IMAGES[String(combo?.slug || combo?.id || "")] || "";
}
import { fetchCurrentUser, getStoredToken, logoutCustomer, setStoredToken } from "./authApi.js";
import { addFavorito as apiAddFavorito, listFavoritoIds, removeFavoritoByRef as apiRemoveFavorito } from "./favoritosApi.js";

const NAV_ITEMS = [
  { id: "catalogo", label: "Catalogo", to: "/", active: true },
  { id: "combos", label: "Combos", to: "/combos" },
  { id: "promos", label: "Promos", to: "/promos" }
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
  { id: "cervezas", category: "CERVEZA", label: "Cervezas", icon: "🍺" },
  { id: "ron", category: "RON", label: "Ron", icon: "🥃" },
  { id: "vodka", category: "VODKA", label: "Vodka", icon: "🍾" },
  { id: "gin", category: "GIN", label: "Gin", icon: "🍸" },
  { id: "whisky", category: "WHISKY", label: "Whisky", icon: "🥃" },
  { id: "vinos", category: "VINO", label: "Vinos", icon: "🍷" },
  { id: "espumantes", category: "ESPUMANTE", label: "Espumantes", icon: "🍾" },
  { id: "mixers", category: "GASEOSA", label: "Mixers", icon: "🧊" },
  { id: "more", category: "TODOS", label: "Mas", icon: "•••" }
];

const HERO_PROMISES = [
  { icon: "⚡", title: "Atencion", body: "en minutos" },
  { icon: "▧", title: "Stock real", body: "siempre disponible" },
  { icon: "♙", title: "Sin filas", body: "ni esperas" }
];

const CLUB_FEATURES = [
  { icon: "◎", title: "Suma puntos", body: "En cada compra" },
  { icon: "▥", title: "Sube de nivel", body: "Bronce · Plata · Oro" },
  { icon: "□", title: "Canjea beneficios", body: "Promos y sorpresas" }
];

const CATEGORY_LABELS = {
  TODOS: "Categorias",
  CERVEZA: "Chelas",
  HIELO: "Hielo",
  RON: "Ron",
  VODKA: "Vodka",
  WHISKY: "Whisky",
  PISCO: "Pisco",
  GIN: "Gin",
  TEQUILA: "Tequila",
  VINO: "Vino",
  SNACK: "Snacks",
  ENERGIZANTE: "Energizantes",
  GASEOSA: "Gaseosas",
  AGUA: "Agua"
};

const CATEGORY_TONES = ["yellow", "cyan", "coral", "gold", "aqua", "orange", "green", "pink"];

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

function productImage(product) {
  return resolveProductImage(product) || "";
}

function getCatalogLabel(value) {
  return CATEGORY_LABELS[value] || value;
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
      const product = productsMap.get(String(item.productId));
      return product ? { ...product, quantity: Number(item.quantity || 1) } : null;
    })
    .filter(Boolean);

  return {
    comboProducts,
    heroImage: combo.imageUrl || productImage(comboProducts[0] || {}) || ""
  };
}

function Header({ query, onQueryChange, total, cartLines, onJumpToCheckout, cartGlowTick, authUser, onOpenAccount, currentRoute, onNavigate }) {
  const profileInitial = authUser?.nombre?.trim()?.charAt(0)?.toUpperCase() || authUser?.email?.charAt(0)?.toUpperCase() || "";
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
          <span>La noche ya esta armada ⚡</span>
        </a>

        <nav className="official-nav" aria-label="Navegacion principal">
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
      </div>

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
          className={`official-cart${cartGlowTick ? " is-sunburst" : ""}`}
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
          <span className="official-cart-copy">
            <small>{money(total)}</small>
          </span>
          <b>{cartLines}</b>
        </button>
        <button
          type="button"
          className={`official-profile-button${authUser ? " is-authenticated" : ""}`}
          aria-label={authUser ? `Cuenta de ${authUser.nombre || authUser.email}` : "Ingresar o crear cuenta"}
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
        </button>
      </div>
    </header>
  );
}

function ClubBanner() {
  return (
    <section className="official-club-banner" aria-label="Club La Licoreria">
      <div className="official-club-title">
        <strong>Club</strong>
        <b>La Licoreria*</b>
        <span>Compra, suma puntos y sube de nivel.</span>
      </div>
      <div className="official-club-features">
        {CLUB_FEATURES.map((feature) => (
          <article key={feature.title}>
            <i aria-hidden="true">{feature.icon}</i>
            <strong>{feature.title}</strong>
            <span>{feature.body}</span>
          </article>
        ))}
      </div>
      <button type="button">Ver mi club</button>
    </section>
  );
}

function ComboShowcase({ combos, productsMap, onAddCombo }) {
  const comboCount = combos.length;
  const comboFromPrice = combos.length ? Math.min(...combos.map((combo) => Number(combo.price || 0))) : 0;
  const combosPerPage = 4;
  const totalPages = Math.max(1, Math.ceil(comboCount / combosPerPage));
  const [activePage, setActivePage] = useState(0);
  const visibleCombos = combos.slice(activePage * combosPerPage, activePage * combosPerPage + combosPerPage);
  const canPage = totalPages > 1;

  useEffect(() => {
    if (activePage < totalPages) return;
    setActivePage(totalPages - 1);
  }, [activePage, totalPages]);

  function goToComboPage(page) {
    setActivePage(Math.max(0, Math.min(page, totalPages - 1)));
  }

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
                <span>Tu plan listo</span>
                <b>en minutos</b>
              </h1>
              <div className="official-combos-side">
                <p>Combos armados, stock completo y sin cola de espera.</p>
                <div className="official-hero-promises" aria-label="Promesas del servicio">
                  {HERO_PROMISES.map((promise) => (
                    <span key={promise.title}>
                      <i aria-hidden="true">{promise.icon}</i>
                      <b>{promise.title}</b>
                      <small>{promise.body}</small>
                    </span>
                  ))}
                </div>
                <button type="button">Ver todos los combos</button>
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
              {visibleCombos.map((combo) => {
                const { comboProducts, heroImage } = resolveComboDisplay(combo, productsMap);
                return (
                  <article key={combo.id} className={`official-combo-card is-${combo.theme}`} role="listitem">
                    <div className="official-combo-content">
                      {combo.badge ? <span className="official-combo-badge">{combo.badge}</span> : null}
                      <div className="official-combo-copy">
                        <h3>{combo.title}</h3>
                        <p>{combo.summary || "Combo listo para una noche sin complicaciones."}</p>
                        <div className="official-combo-price-block">
                          <strong>{money(combo.price)}</strong>
                        </div>
                      </div>

                      <div className="official-combo-footer">
                        <button type="button" onClick={() => onAddCombo(combo)}>
                          <span aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none">
                              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                            </svg>
                          </span>
                          Agregar
                        </button>
                      </div>
                      <div className="official-combo-media">
                        {heroImage ? <img src={heroImage} alt="" loading="lazy" className="official-combo-hero" /> : null}
                        {comboProducts.length > 1 ? (
                          <div className="official-combo-stack">
                            {comboProducts.slice(0, 4).map((product, index) => {
                              const image = productImage(product);
                              return image ? <img key={`${combo.id}-${product.id}-${index}`} src={image} alt="" loading="lazy" /> : null;
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="official-combos-controls" aria-label="Paginas de combos">
        <div className="official-combos-dots" role="tablist" aria-label="Grupos de combos">
          {Array.from({ length: totalPages }).map((_, index) => (
            <button
              key={`combo-page-${index}`}
              type="button"
              className={index === activePage ? "is-active" : ""}
              onClick={() => goToComboPage(index)}
              aria-label={`Ver combos ${index * combosPerPage + 1} al ${Math.min((index + 1) * combosPerPage, comboCount)}`}
              aria-selected={index === activePage}
            />
          ))}
        </div>
        {canPage ? (
          <button
            type="button"
            className="official-combos-next"
            onClick={() => goToComboPage(activePage + 1 >= totalPages ? 0 : activePage + 1)}
            aria-label="Ver siguiente grupo de combos"
          >
            →
          </button>
        ) : null}
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

function ProductCard({ product, onAdd, isFavorite, onToggleFavorite }) {
  const image = productImage(product);
  const stockLabel = product.stock <= 3 ? `Quedan ${product.stock}` : `${product.stock} disponibles`;
  return (
    <article className="official-product-card">
      <button
        type="button"
        className={`official-product-heart${isFavorite ? " is-active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite?.(product);
        }}
        aria-label={isFavorite ? `Quitar ${product.name} de favoritos` : `Agregar ${product.name} a favoritos`}
        aria-pressed={!!isFavorite}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill={isFavorite ? "currentColor" : "none"} aria-hidden="true">
          <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        </svg>
      </button>
      <button type="button" className="official-product-plus" onClick={() => onAdd(product)} aria-label={`Agregar ${product.name}`}>
        +
      </button>
      <div className="official-product-media">
        {image ? <img src={image} alt="" loading="lazy" /> : <span>{product.category}</span>}
      </div>
      <div className="official-product-copy">
        <div className="official-product-topline">
          <span className="official-product-chip">{getCatalogLabel(product.category || "OTRO")}</span>
          <span className={`official-product-stock${product.stock <= 3 ? " is-low" : ""}`}>{stockLabel}</span>
        </div>
        <strong>{product.name}</strong>
        <small>{product.description || product.category || "Producto listo para sumar al pedido."}</small>
        <div className="official-product-footer">
          <div className="official-product-price">
            <span>Precio</span>
            <b>{money(product.price)}</b>
          </div>
          <button type="button" className="official-product-cart" onClick={() => onAdd(product)} aria-label={`Agregar ${product.name}`}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 5h2l1.2 7.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L18.5 8H7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="18.2" r="1.6" fill="currentColor" />
              <circle cx="16.7" cy="18.2" r="1.6" fill="currentColor" />
            </svg>
            <span>Sumar</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductGrid({ products, status, category, onCategoryChange, onAdd, favoriteIds, onToggleFavorite }) {
  return (
    <section id="official-products" className="official-products">
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
      <div className="official-product-panel">
        <div className="official-section-head">
          <div>
            <div className="official-section-kicker">Catalogo de productos</div>
          </div>
          <button type="button" className="official-view-all">Ver todo</button>
        </div>

        <div id="catalog-grid" className="official-product-grid">
          {products.map((product, index) => (
            <ProductCard
              key={`${product.id}-${index}`}
              product={product}
              onAdd={onAdd}
              isFavorite={favoriteIds?.has(String(product.id))}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BenefitsBar() {
  return (
    <section className="official-benefit-bar" aria-label="Beneficios">
      <strong>La noche no espera <i aria-hidden="true">⚡</i></strong>
      <span>
        <i aria-hidden="true">♙</i>
        <b>Tu pedido en minutos</b>
        <small>Confirmacion inmediata.</small>
      </span>
      <span>
        <i aria-hidden="true">▧</i>
        <b>Stock completo siempre</b>
        <small>Miles de productos disponibles.</small>
      </span>
      <span>
        <i aria-hidden="true">☄</i>
        <b>Sin filas ni esperas</b>
        <small>Compra rapido y facil.</small>
      </span>
      <span>
        <i aria-hidden="true">☾</i>
        <b>Siempre disponibles</b>
        <small>Cuando quieras, donde estes.</small>
      </span>
      <span>
        <i aria-hidden="true">♢</i>
        <b>Compra 100% segura</b>
        <small>Protegemos tu compra siempre.</small>
      </span>
    </section>
  );
}

export default function Storefront() {
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState(() => loadComboCatalog());
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
  const [submitting, setSubmitting] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authToken, setAuthToken] = useState(() => getStoredToken());
  const [authUser, setAuthUser] = useState(null);
  const location = useLocation();
  const reactNavigate = useNavigate();
  const confirmDialog = useConfirm();
  const route = location.pathname.replace(/^\/+/, "").split("/")[0] || "";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [route]);
  const [favoriteProductIds, setFavoriteProductIds] = useState(() => new Set());
  const [favoriteComboIds, setFavoriteComboIds] = useState(() => new Set());
  const [unreadNotifs, setUnreadNotifs] = useState(0);

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

  useEffect(() => {
    if (!authToken) {
      setUnreadNotifs(0);
      return undefined;
    }
    refreshUnreadNotifs();
    const id = window.setInterval(refreshUnreadNotifs, 60000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setFavoriteProductIds(new Set());
      setFavoriteComboIds(new Set());
      return undefined;
    }
    let cancelled = false;
    listFavoritoIds()
      .then((data) => {
        if (cancelled) return;
        setFavoriteProductIds(new Set((data?.productoIds || []).map(String)));
        setFavoriteComboIds(new Set((data?.comboIds || []).map(String)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  function toggleFavoriteProduct(product) {
    if (!authToken) {
      setAccountOpen(true);
      return;
    }
    const id = String(product.id);
    const willAdd = !favoriteProductIds.has(id);
    setFavoriteProductIds((prev) => {
      const next = new Set(prev);
      if (willAdd) next.add(id);
      else next.delete(id);
      return next;
    });
    (willAdd ? apiAddFavorito("producto", id) : apiRemoveFavorito("producto", id)).catch(() => {
      setFavoriteProductIds((prev) => {
        const next = new Set(prev);
        if (willAdd) next.delete(id);
        else next.add(id);
        return next;
      });
    });
  }

  function toggleFavoriteCombo(combo) {
    if (!authToken) {
      setAccountOpen(true);
      return;
    }
    const id = String(combo.id);
    const willAdd = !favoriteComboIds.has(id);
    setFavoriteComboIds((prev) => {
      const next = new Set(prev);
      if (willAdd) next.add(id);
      else next.delete(id);
      return next;
    });
    (willAdd ? apiAddFavorito("combo", id) : apiRemoveFavorito("combo", id)).catch(() => {
      setFavoriteComboIds((prev) => {
        const next = new Set(prev);
        if (willAdd) next.delete(id);
        else next.add(id);
        return next;
      });
    });
  }

  function navigate(target) {
    reactNavigate(target ? `/${target}` : "/");
  }

  useEffect(() => {
    let cancelled = false;
    if (!authToken) {
      setAuthUser(null);
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
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  function handleAuthenticated(token, user) {
    setStoredToken(token);
    setAuthToken(token);
    setAuthUser(user);
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
    let cancelled = false;
    Promise.all([loadProducts(), loadProductCategories().catch(() => [])])
      .then(([items, categoryItems]) => {
        if (cancelled) return;
        setProducts(items);
        setCategories(uniqueCategories(categoryItems || []));
        setStatus(`${items.length} productos listos para pedir.`);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error.message || "No se pudo cargar el catalogo.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
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
          tipo: c.tipo || "general",
          items: Array.isArray(c.items) ? c.items : []
        }));
        if (list.length) setCombos(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const term = normalizeText(query);
    return products.filter((product) => {
      const matchesQuery =
        !term ||
        normalizeText(product.name).includes(term) ||
        normalizeText(product.category).includes(term) ||
        normalizeText(product.description).includes(term);
      const matchesCategory = category === "TODOS" || product.category === category;
      return matchesQuery && matchesCategory && product.stock > 0;
    });
  }, [products, query, category]);

  const featuredProducts = useMemo(() => {
    const source = filteredProducts.length ? filteredProducts : products.filter((product) => product.stock > 0);
    return [...source].sort((left, right) => {
      const leftHasImage = productImage(left) ? 1 : 0;
      const rightHasImage = productImage(right) ? 1 : 0;
      return rightHasImage - leftHasImage;
    }).slice(0, 4);
  }, [filteredProducts, products]);

  const productsMap = useMemo(() => new Map(products.map((product) => [String(product.id), product])), [products]);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const units = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartLines = cart.length;

  function addToCart(product) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) } : item
        );
      }
      return [
        ...current,
        {
          id: product.id,
          name: product.name,
          price: product.price,
          quantity: 1,
          stock: product.stock,
          imageHash: product.imageHash || "",
          category: product.category || ""
        }
      ];
    });
    setCartGlowTick(Date.now());
    setCartToast({
      key: Date.now(),
      name: product.name,
      imageHash: product.imageHash || ""
    });
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
    const comboProducts = (combo.items || [])
      .map((item) => {
        const product = productsMap.get(String(item.productId));
        return product ? { product, quantity: Math.max(1, Number(item.quantity || 1)) } : null;
      })
      .filter(Boolean);

    if (!comboProducts.length) {
      setStatus("Este combo aun no tiene productos asignados. Configuralo desde el admin.");
      return;
    }

    comboProducts.forEach(({ product, quantity }) => {
      for (let index = 0; index < quantity; index += 1) {
        addToCart(product);
      }
    });
    setStatus(`Combo agregado: ${combo.title}.`);
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
    if (!cart.length) return;
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  function openCart() {
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

  return (
    <main className="official-store-shell" id="contenido-principal">
      <a href="#contenido-principal" className="skip-to-content">Saltar al contenido</a>
      <Header
        query={query}
        onQueryChange={setQuery}
        total={total}
        cartLines={cartLines}
        onJumpToCheckout={openCart}
        cartGlowTick={cartGlowTick}
        authUser={authUser}
        onOpenAccount={() => setAccountOpen(true)}
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
        onAuthenticated={(token, user) => {
          handleAuthenticated(token, user);
        }}
        onLogout={handleLogout}
        onNavigate={navigate}
      />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        items={cart}
        authUser={authUser}
        onSuccess={() => {
          setCart([]);
        }}
      />

      <div key={route} className="route-fade">
      {route === "combos" ? (
        <CombosPage
          onAddCombo={addComboToCart}
          onGoCatalog={() => navigate("")}
          favoriteComboIds={favoriteComboIds}
          onToggleFavorite={toggleFavoriteCombo}
          fallbackImageFor={fallbackComboImage}
        />
      ) : route === "promos" ? (
        <PromosPage onGoCatalog={() => navigate("")} />
      ) : route === "cuenta" ? (
        authUser ? (
          <AccountLayout active="cuenta" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <MiCuentaPage onNavigate={navigate} />
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
      ) : route === "invitar" ? (
        authUser ? (
          <AccountLayout active="invitar" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <InvitarPage />
          </AccountLayout>
        ) : (
          <div className="page-shell">
            <div className="page-empty">
              <div className="page-empty-icon" aria-hidden="true">🔐</div>
              <h3>Inicia sesión para invitar amigos</h3>
              <button type="button" className="page-cta" onClick={() => setAccountOpen(true)}>
                Ingresar
              </button>
            </div>
          </div>
        )
      ) : route === "notificaciones" ? (
        authUser ? (
          <AccountLayout active="notificaciones" user={authUser} onNavigate={navigate} onLogout={handleLogout} unreadCount={unreadNotifs}>
            <NotificacionesPage onUnreadChange={refreshUnreadNotifs} onNavigate={navigate} />
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
      ) : route === "pagos" ? (
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
      ) : route === "direcciones" ? (
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
      ) : route === "favoritos" ? (
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
      ) : route === "pedidos" ? (
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
              <ClubBanner />
              <ComboShowcase combos={combos} productsMap={productsMap} onAddCombo={addComboToCart} />
              <ProductGrid
                products={filteredProducts}
                status={status}
                category={category}
                onCategoryChange={setCategory}
                onAdd={addToCart}
                favoriteIds={favoriteProductIds}
                onToggleFavorite={toggleFavoriteProduct}
              />
            </section>
          </div>

          <BenefitsBar />
        </>
      )}
      </div>
    </main>
  );
}

