import React from "react";
import CardQuantityControl from "../CardQuantityControl.jsx";
import { resolveProductImage } from "../storefrontApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function comboImage(combo) {
  return combo?.imageData || combo?.imageUrl || resolveProductImage(combo) || "";
}

function productImage(product) {
  return resolveProductImage(product) || "";
}

export default function ComboDetallePage({
  combo,
  productsMap,
  onAddCombo,
  onRemoveCombo,
  getQuantity,
  stockLimit,
  onGoBack,
  isFavorite,
  favoriteBusy = false,
  onToggleFavorite,
  loading
}) {
  if (loading && !combo) {
    return (
      <section className="premium-detail-page combo-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
        <div className="premium-detail-empty combo-detail-empty" onClick={(event) => event.stopPropagation()}>
          <h1>Cargando combo</h1>
          <p>Estamos preparando el detalle con productos incluidos.</p>
        </div>
      </section>
    );
  }

  if (!combo) {
    return (
      <section className="premium-detail-page combo-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
        <div className="premium-detail-empty combo-detail-empty" onClick={(event) => event.stopPropagation()}>
          <h1>Combo no encontrado</h1>
          <p>Puede que este combo aún esté cargando o ya no esté disponible.</p>
          <button type="button" onClick={onGoBack}>Volver</button>
        </div>
      </section>
    );
  }

  const image = comboImage(combo);
  const included = (combo.items || [])
    .map((item) => {
      const product = productsMap.get(item.variantId ? `${item.productId}::${item.variantId}` : String(item.productId));
      const quantity = Math.max(1, Number(item.quantity || 1));
      return product
        ? { ...product, quantity }
        : {
            id: `missing-${item.productId || item.variantId || quantity}`,
            name: item.name || `Producto ${item.productId || item.variantId || "pendiente"}`,
            quantity,
            missing: true
          };
    })
    .filter(Boolean);
  const priceBefore = Number(combo.priceBefore || 0);
  const price = Number(combo.price || 0);
  const savings = priceBefore > price ? priceBefore - price : 0;
  const summary = combo.summary || "Combo listo para una noche sin complicaciones.";
  const selectedQuantity = Math.max(0, Number(getQuantity?.(combo) || 0));
  const availableCombos = Math.max(0, Number(stockLimit ?? 0));
  const selectedTotal = price * selectedQuantity;
  const favoriteClickGuard = React.useRef(0);
  function handleFavoriteAction(event) {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - favoriteClickGuard.current < 280) return;
    favoriteClickGuard.current = now;
    if (favoriteBusy) return;
    onToggleFavorite?.(combo);
  }

  return (
    <section className="premium-detail-page combo-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
      <div className="premium-detail-shell combo-detail-shell" onClick={(event) => event.stopPropagation()}>
        <div className="combo-detail-hero">
          {image ? <img src={image} alt="" loading="eager" fetchPriority="high" decoding="async" /> : <span className="combo-detail-image-placeholder" />}
          <div className="combo-detail-hero-shade" />
          <div className="premium-detail-topbar combo-detail-topbar">
            <button type="button" className="premium-detail-back combo-detail-back" onClick={onGoBack} aria-label="Volver">
              <span aria-hidden="true">←</span>
              Volver
            </button>
            <button
              type="button"
              className={`premium-detail-heart combo-detail-heart${isFavorite ? " is-active" : ""}`}
              aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
              aria-pressed={!!isFavorite}
              aria-disabled={favoriteBusy}
              onClick={handleFavoriteAction}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") handleFavoriteAction(event);
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill={isFavorite ? "currentColor" : "none"} aria-hidden="true">
                <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="combo-detail-body">
          <div className="combo-detail-tags">
            <span>{combo.items?.length ? `${combo.items.length} productos` : "Combo listo"}</span>
            {combo.badge ? <b>{combo.badge}</b> : null}
          </div>

          <div className="combo-detail-main">
            <div>
              <h1>{combo.title}</h1>
              <p>{summary}</p>
              {combo.coverText ? <small className="combo-detail-cover-text">{combo.coverText}</small> : null}
            </div>
          </div>

          <section className="combo-detail-products">
            <h2>Productos incluidos</h2>
            <ul>
              {included.map((product) => {
                const img = productImage(product);
                return (
                  <li key={`${combo.id}-${product.id}`}>
                    <span className={`combo-detail-product-img${product.missing ? " is-missing" : ""}`}>
                      {img ? <img src={img} alt="" loading="lazy" decoding="async" /> : <i>{(product.name || "?").charAt(0)}</i>}
                    </span>
                    <strong>{product.name}</strong>
                    <b>{product.quantity} {product.quantity === 1 ? "unidad" : "unidades"}</b>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="premium-detail-cta combo-detail-sticky-cta">
            <div>
              <strong>{formatMoney(selectedTotal)}</strong>
              <span>Total seleccionado</span>
              {savings ? <span>Ahorras {formatMoney(savings)}</span> : null}
            </div>
            {selectedQuantity > 0 ? (
              <CardQuantityControl
                quantity={selectedQuantity}
                max={availableCombos}
                ariaLabel={`Cantidad de ${combo.title}`}
                onIncrement={() => onAddCombo?.(combo)}
                onDecrement={() => onRemoveCombo?.(combo)}
                className="is-detail-combo"
                expandOnQuantity
              />
            ) : (
              <button type="button" onClick={() => onAddCombo?.(combo)} disabled={availableCombos <= 0}>
                <span aria-hidden="true">+</span>
                Agregar al carrito
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
