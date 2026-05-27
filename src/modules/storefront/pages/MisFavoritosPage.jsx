import { useMemo, useState } from "react";
import { resolveProductImage } from "../storefrontApi.js";

const TABS = [
  { key: "todos", label: "Todos" },
  { key: "productos", label: "Productos" },
  { key: "combos", label: "Combos" }
];

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function ProductFavCard({ product, onAdd, onToggle }) {
  const image = resolveProductImage(product);
  return (
    <article className="favorite-card">
      <button
        type="button"
        className="favorite-card-heart is-active"
        aria-label={`Quitar ${product.name} de favoritos`}
        onClick={() => onToggle(product)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" />
        </svg>
      </button>
      <div className="favorite-card-media">
        {image ? <img src={image} alt="" loading="lazy" /> : <span>{product.category || "?"}</span>}
      </div>
      <div className="favorite-card-info">
        <small>{product.category || "Producto"}</small>
        <strong>{product.name}</strong>
        <p className="favorite-card-price">{formatMoney(product.price)}</p>
        <button type="button" className="favorite-card-cta" onClick={() => onAdd(product)}>
          Agregar al carrito
        </button>
      </div>
    </article>
  );
}

function ComboFavCard({ combo, onAddCombo, onToggle }) {
  return (
    <article className="favorite-card favorite-card-combo">
      <button
        type="button"
        className="favorite-card-heart is-active"
        aria-label={`Quitar ${combo.title} de favoritos`}
        onClick={() => onToggle(combo)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" />
        </svg>
      </button>
      <div className="favorite-card-media">
        {combo.imageUrl ? <img src={combo.imageUrl} alt="" loading="lazy" /> : <span>{combo.tag || "Combo"}</span>}
      </div>
      <div className="favorite-card-info">
        <small>{combo.tag || "Combo"}</small>
        <strong>{combo.title}</strong>
        <p className="favorite-card-price">Desde {formatMoney(combo.price)}</p>
        <button type="button" className="favorite-card-cta" onClick={() => onAddCombo(combo)}>
          Pedir de nuevo
        </button>
      </div>
    </article>
  );
}

export default function MisFavoritosPage({
  productsMap,
  combos,
  favoriteProductIds,
  favoriteComboIds,
  onAdd,
  onAddCombo,
  onToggleProduct,
  onToggleCombo,
  onGoCatalog
}) {
  const [tab, setTab] = useState("todos");

  const favoriteProducts = useMemo(() => {
    const list = [];
    for (const id of favoriteProductIds) {
      const product = productsMap.get(String(id));
      if (product) list.push(product);
    }
    return list;
  }, [favoriteProductIds, productsMap]);

  const favoriteCombos = useMemo(() => {
    return combos.filter((combo) => favoriteComboIds.has(String(combo.id)));
  }, [favoriteComboIds, combos]);

  const total = favoriteProducts.length + favoriteCombos.length;
  const showProducts = tab === "todos" || tab === "productos";
  const showCombos = tab === "todos" || tab === "combos";

  return (
    <section className="page-shell">
      <header className="page-head">
        <h1>MIS FAVORITOS</h1>
        <p>Guarda lo que más te gusta y agrégalo al carrito en un toque.</p>
      </header>

      <div className="page-tabs" role="tablist">
        {TABS.map((it) => (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={tab === it.key}
            className={tab === it.key ? "is-active" : ""}
            onClick={() => setTab(it.key)}
          >
            {it.label} {it.key === "todos" ? `(${total})` : it.key === "productos" ? `(${favoriteProducts.length})` : `(${favoriteCombos.length})`}
          </button>
        ))}
      </div>

      {total === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">💛</div>
          <h3>Aún no tienes favoritos</h3>
          <p>Toca el corazón en cualquier producto o combo para guardarlo aquí.</p>
          <button type="button" className="page-cta" onClick={onGoCatalog}>Ir al catálogo</button>
        </div>
      ) : (
        <div className="favorite-grid">
          {showProducts && favoriteProducts.map((product) => (
            <ProductFavCard
              key={`p-${product.id}`}
              product={product}
              onAdd={onAdd}
              onToggle={onToggleProduct}
            />
          ))}
          {showCombos && favoriteCombos.map((combo) => (
            <ComboFavCard
              key={`c-${combo.id}`}
              combo={combo}
              onAddCombo={onAddCombo}
              onToggle={onToggleCombo}
            />
          ))}
        </div>
      )}
    </section>
  );
}
