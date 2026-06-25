import React, { useState } from "react";
import { resolveProductImage } from "./storefrontApi.js";
import productImageUnavailable from "../../assets/storefront/imagennodisponible2.png";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

export default function CartDrawer({
  open,
  onClose,
  items,
  onChangeQuantity,
  onSetQuantity,
  onRemove,
  onCheckout,
  onContinueShopping,
  productsMap
}) {
  const [promoCode, setPromoCode] = useState("");
  const [promoMsg, setPromoMsg] = useState("");
  const [expandedCombos, setExpandedCombos] = useState(() => new Set());

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  function applyPromo(event) {
    event.preventDefault();
    if (!promoCode.trim()) return;
    setPromoMsg("Código no válido por ahora. Pronto disponible.");
  }

  function toggleComboDetail(id) {
    setExpandedCombos((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function comboDetailItems(item) {
    if (item.type !== "combo" || !Array.isArray(item.items)) return [];
    return item.items.map((line, index) => {
      const productId = line.variantId ? `${line.productId}::${line.variantId}` : String(line.productId || line.id || "");
      const product = productsMap?.get?.(productId) || {};
      const quantity = Math.max(1, Number(line.quantity || 1));
      return {
        id: productId || `${item.id}-${index}`,
        quantity,
        name: product.name || line.name || `Producto ${index + 1}`,
        price: Number(product.price ?? line.price ?? 0)
      };
    });
  }

  return (
    <>
      <div
        className={`cart-drawer-backdrop${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`cart-drawer${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compras"
      >
        <header className="cart-drawer-head">
          <div>
            <h2>Tu carrito</h2>
            <p className="cart-drawer-sub">{units} producto{units === 1 ? "" : "s"} listo{units === 1 ? "" : "s"} para pedir</p>
          </div>
          <button type="button" className="cart-drawer-close" onClick={onClose} aria-label="Cerrar carrito">×</button>
        </header>

        <div className="cart-drawer-body">
          {items.length === 0 ? (
            <div className="cart-drawer-empty">
              <div className="cart-drawer-empty-icon" aria-hidden="true">🛒</div>
              <p>Tu carrito está vacío.</p>
              <button type="button" className="cart-drawer-secondary" onClick={onContinueShopping}>
                Explorar catálogo
              </button>
            </div>
          ) : (
            <ul className="cart-drawer-items">
              {items.map((item) => {
                const product = productsMap?.get?.(String(item.id)) || {};
                const imageUrl = item.type === "combo"
                  ? item.imageData || item.imageUrl || ""
                  : resolveProductImage({ ...product, ...item, images: product.images || item.images || [] });
                const detailItems = comboDetailItems(item);
                const comboExpanded = expandedCombos.has(item.id);
                return (
                  <li key={item.id} className={`cart-drawer-item${item.type === "combo" ? " is-combo" : ""}`}>
                    <CartItemImage imageUrl={imageUrl} />
                    <div className="cart-drawer-info">
                      <p className="cart-drawer-name">{item.name}</p>
                      <p className="cart-drawer-price">{formatMoney(item.price)} c/u</p>
                      {detailItems.length ? (
                        <button
                          type="button"
                          className="cart-drawer-combo-toggle"
                          onClick={() => toggleComboDetail(item.id)}
                          aria-expanded={comboExpanded}
                        >
                          <span>{comboExpanded ? "Ocultar detalle" : "Ver detalle"}</span>
                          <b className="cart-drawer-combo-chevron" aria-hidden="true" />
                        </button>
                      ) : null}
                      <div className="cart-drawer-qty">
                        <button
                          type="button"
                          onClick={() => onChangeQuantity(item.id, -1)}
                          aria-label="Disminuir"
                          disabled={item.quantity <= 1}
                        >–</button>
                        <input
                          type="number"
                          min="1"
                          max={item.stock || 99}
                          value={item.quantity}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) onSetQuantity(item.id, next);
                          }}
                          aria-label="Cantidad"
                        />
                        <button
                          type="button"
                          onClick={() => onChangeQuantity(item.id, 1)}
                          aria-label="Aumentar"
                          disabled={item.stock ? item.quantity >= item.stock : false}
                        >+</button>
                      </div>
                    </div>
                    <div className="cart-drawer-line-total">
                      <strong>{formatMoney(item.price * item.quantity)}</strong>
                      <button
                        type="button"
                        className="cart-drawer-remove"
                        onClick={() => onRemove(item.id)}
                        aria-label={`Eliminar ${item.name}`}
                      >×</button>
                    </div>
                    {detailItems.length && comboExpanded ? (
                      <div className="cart-drawer-combo-detail">
                        <strong>Productos del combo</strong>
                        <ul>
                          {detailItems.map((detail) => (
                            <li key={detail.id}>
                              <span>{detail.quantity}x {detail.name}</span>
                              {detail.price > 0 ? <b>{formatMoney(detail.price)} c/u</b> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <footer className="cart-drawer-foot">
            <form className="cart-drawer-promo" onSubmit={applyPromo}>
              <label htmlFor="cart-promo-code">¿Tienes un código promocional?</label>
              <div>
                <input
                  id="cart-promo-code"
                  type="text"
                  placeholder="Ingresa tu código"
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                />
                <button type="submit">Aplicar</button>
              </div>
              {promoMsg ? <p className="cart-drawer-promo-msg">{promoMsg}</p> : null}
            </form>

            <dl className="cart-drawer-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(subtotal)}</dd>
              </div>
              <div>
                <dt>Envío</dt>
                <dd>Se calcula al finalizar</dd>
              </div>
              <div className="cart-drawer-total-row">
                <dt>Total</dt>
                <dd>{formatMoney(total)}</dd>
              </div>
            </dl>

            <button type="button" className="cart-drawer-checkout" onClick={onCheckout}>
              IR A PAGAR
            </button>
            <button type="button" className="cart-drawer-secondary" onClick={onContinueShopping}>
              Seguir comprando
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}

function CartItemImage({ imageUrl }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && imageUrl ? imageUrl : productImageUnavailable;
  return (
    <div className="cart-drawer-thumb">
      <img
        src={src}
        alt=""
        loading={imageUrl ? "lazy" : "eager"}
        className={!failed && imageUrl ? "" : "is-fallback"}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
