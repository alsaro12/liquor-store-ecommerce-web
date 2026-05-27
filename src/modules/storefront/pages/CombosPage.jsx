import { useEffect, useMemo, useState } from "react";
import { loadCombos } from "../combosApi.js";
import { resolveProductImage } from "../storefrontApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

const TIPO_FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "pre", label: "Para previa" },
  { key: "playa", label: "Para playa" },
  { key: "fiesta", label: "Para fiesta" },
  { key: "romantico", label: "Romántico" },
  { key: "premium", label: "Premium" },
  { key: "mixers", label: "Mixers" }
];

const FEATURE_BAR = [
  { icon: "⚡", title: "Siempre encuentras", text: "Stock real al instante" },
  { icon: "💸", title: "Descuentos especiales", text: "Mejor precio armado" },
  { icon: "🧊", title: "Hielo y mixers", text: "Ya incluidos en el combo" },
  { icon: "🚚", title: "Llega rápido", text: "Listo para tu reunión" }
];

export default function CombosPage({
  onAddCombo,
  onGoCatalog,
  favoriteComboIds,
  onToggleFavorite,
  fallbackImageFor
}) {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("todos");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCombos()
      .then((items) => {
        if (cancelled) return;
        setCombos(Array.isArray(items) ? items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "No se pudieron cargar los combos.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "todos") return combos;
    return combos.filter((c) => String(c.tipo).toLowerCase() === filter);
  }, [combos, filter]);

  function resolveComboImage(combo) {
    if (combo.imageHash) {
      return resolveProductImage({ imageHash: combo.imageHash });
    }
    if (combo.imageUrl) return combo.imageUrl;
    return fallbackImageFor?.(combo) || "";
  }

  return (
    <section className="page-shell page-combos">
      <header className="page-head">
        <h1>COMBOS PARA CADA PLAN</h1>
        <p>Combos armados, stock real y precios mejores. Pídelo de un toque.</p>
      </header>

      <ul className="combos-feature-bar">
        {FEATURE_BAR.map((feature) => (
          <li key={feature.title}>
            <span aria-hidden="true">{feature.icon}</span>
            <div>
              <strong>{feature.title}</strong>
              <small>{feature.text}</small>
            </div>
          </li>
        ))}
      </ul>

      <div className="page-tabs page-tabs-wrap" role="tablist">
        {TIPO_FILTERS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            className={filter === tab.key ? "is-active" : ""}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="page-status">Cargando combos...</p>
      ) : error ? (
        <p className="page-status page-status-error">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">🍻</div>
          <h3>No hay combos en esta categoría</h3>
          <p>Prueba con otro filtro o vuelve al catálogo.</p>
          <button type="button" className="page-cta" onClick={onGoCatalog}>Ir al catálogo</button>
        </div>
      ) : (
        <div className="combos-grid">
          {filtered.map((combo) => {
            const image = resolveComboImage(combo);
            const isFav = favoriteComboIds?.has(String(combo.id));
            return (
              <article key={combo.id} className={`combo-card theme-${combo.theme || "gold"}`}>
                {combo.badge ? <span className="combo-card-badge">{combo.badge}</span> : null}
                <button
                  type="button"
                  className={`combo-card-heart${isFav ? " is-active" : ""}`}
                  aria-label={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                  aria-pressed={!!isFav}
                  onClick={() => onToggleFavorite?.(combo)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill={isFav ? "currentColor" : "none"} aria-hidden="true">
                    <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  </svg>
                </button>
                <div className="combo-card-media">
                  {image ? <img src={image} alt="" loading="lazy" /> : <span aria-hidden="true">🥂</span>}
                </div>
                <div className="combo-card-body">
                  <strong>{combo.title}</strong>
                  <small>{combo.summary}</small>
                  <div className="combo-card-foot">
                    <div>
                      {combo.priceBefore ? <span className="combo-card-old">{formatMoney(combo.priceBefore)}</span> : null}
                      <b>{formatMoney(combo.price)}</b>
                    </div>
                    <button
                      type="button"
                      className="combo-card-plus"
                      aria-label={`Agregar ${combo.title} al carrito`}
                      onClick={() => onAddCombo?.(combo)}
                    >+</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="combos-cta-footer">
        <p>¿No encuentras tu combo ideal?</p>
        <button type="button" className="page-cta" disabled title="Próximamente">CREAR MI COMBO</button>
      </div>
    </section>
  );
}
