import { useState } from "react";
import { resolveProductImage } from "./storefrontApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

const FREE_SHIPPING_THRESHOLD = 80;
const SHIPPING_COST = 8;

export default function CartDrawer({
  open,
  onClose,
  items,
  onChangeQuantity,
  onSetQuantity,
  onRemove,
  onCheckout,
  onContinueShopping
}) {
  const [promoCode, setPromoCode] = useState("");
  const [promoMsg, setPromoMsg] = useState("");

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
  const total = subtotal + shipping;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  function applyPromo(event) {
    event.preventDefault();
    if (!promoCode.trim()) return;
    setPromoMsg("Código no válido por ahora. Pronto disponible.");
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
                const imageUrl = resolveProductImage({ imageHash: item.imageHash, images: [] });
                return (
                  <li key={item.id} className="cart-drawer-item">
                    <div className="cart-drawer-thumb">
                      {imageUrl ? (
                        <img src={imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden="true">{(item.category || "?").slice(0, 1)}</span>
                      )}
                    </div>
                    <div className="cart-drawer-info">
                      <p className="cart-drawer-name">{item.name}</p>
                      <p className="cart-drawer-price">{formatMoney(item.price)} c/u</p>
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
                <dd>{shipping === 0 ? "Gratis" : formatMoney(shipping)}</dd>
              </div>
              <div className="cart-drawer-total-row">
                <dt>Total</dt>
                <dd>{formatMoney(total)}</dd>
              </div>
            </dl>

            {subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? (
              <p className="cart-drawer-shipping-hint">
                Agrega {formatMoney(FREE_SHIPPING_THRESHOLD - subtotal)} más para envío gratis.
              </p>
            ) : null}

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
