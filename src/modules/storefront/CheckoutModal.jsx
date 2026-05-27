import { useEffect, useState } from "react";
import { createOrder } from "./storefrontApi.js";
import { resolveProductImage } from "./storefrontApi.js";
import AddressPicker from "./AddressPicker.jsx";
import { createDireccion } from "./direccionesApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

const FREE_SHIPPING_THRESHOLD = 80;
const SHIPPING_COST = 8;

export default function CheckoutModal({ open, onClose, items, authUser, onSuccess }) {
  const [mode, setMode] = useState("delivery");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    reference: "",
    pickupDate: ""
  });
  const [location, setLocation] = useState(null); // { direccion, distrito, ciudad, latitud, longitud, geohash }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successCode, setSuccessCode] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
      setSubmitting(false);
      setSuccessCode("");
    }
  }, [open]);

  useEffect(() => {
    if (authUser) {
      setForm((prev) => ({
        ...prev,
        name: prev.name || authUser.nombre || "",
        phone: prev.phone || authUser.telefono || ""
      }));
    }
  }, [authUser]);

  if (!open) return null;

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = mode === "pickup" || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
  const total = subtotal + shipping;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Falta tu nombre.");
    if (!form.phone.trim() || form.phone.trim().length < 6) return setError("Ingresa un celular válido.");
    if (mode === "delivery" && !location) return setError("Elige tu ubicación en el mapa.");
    if (mode === "pickup" && !form.pickupDate) return setError("Elige cuándo vas a recoger el pedido.");
    if (!items.length) return setError("Tu carrito está vacío.");

    setSubmitting(true);
    try {
      const payload = {
        channel: "web",
        mode,
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: mode === "delivery" ? location?.direccion || "" : "",
          reference: form.reference.trim(),
          latitud: mode === "delivery" ? location?.latitud : null,
          longitud: mode === "delivery" ? location?.longitud : null,
          geohash: mode === "delivery" ? location?.geohash : "",
          distrito: mode === "delivery" ? location?.distrito || "" : "",
          ciudad: mode === "delivery" ? location?.ciudad || "" : ""
        },
        pickupDate: mode === "pickup" ? form.pickupDate : "",
        items: items.map((it) => ({
          productId: Number(it.id) || 0,
          name: it.name,
          category: it.category || "",
          price: it.price,
          quantity: it.quantity,
          stock: it.stock || 0,
          imageHash: it.imageHash || ""
        })),
        total,
        notes
      };
      const order = await createOrder(payload);

      // Guardar dirección en cuenta si aplica
      if (authUser && mode === "delivery" && location && saveAddress) {
        try {
          await createDireccion({
            etiqueta: "Casa",
            icono: "casa",
            direccion: location.direccion,
            referencia: form.reference.trim() || null,
            distrito: location.distrito || null,
            ciudad: location.ciudad || null,
            telefono: form.phone.trim() || null,
            latitud: location.latitud,
            longitud: location.longitud,
            es_principal: true
          });
        } catch (_) { /* no bloquea el pedido */ }
      }

      setSuccessCode(order?.id || "");
      onSuccess?.(order);
    } catch (err) {
      setError(err?.message || "No se pudo registrar el pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="checkout-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={successCode || pickerOpen ? undefined : onClose}
    >
      <div className="checkout-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="checkout-modal-close" onClick={onClose} aria-label="Cerrar">×</button>

        {successCode ? (
          <div className="checkout-modal-success">
            <div className="checkout-modal-success-icon" aria-hidden="true">🎉</div>
            <h2>¡Pedido confirmado!</h2>
            <p>Tu pedido <strong>#{successCode}</strong> fue registrado.</p>
            <p className="checkout-modal-meta">Te avisaremos al {form.phone} cuando esté en camino.</p>
            <div className="checkout-modal-success-actions">
              {authUser ? (
                <button
                  type="button"
                  className="checkout-submit"
                  onClick={() => {
                    window.location.hash = "#pedidos";
                    onClose?.();
                  }}
                >
                  Ver mis pedidos
                </button>
              ) : null}
              <button type="button" className="checkout-secondary" onClick={onClose}>
                Seguir comprando
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="checkout-modal-head">
              <h2>Finalizar pedido</h2>
              <p>Completa los datos para enviar tu orden.</p>
            </header>

            <div className="checkout-modal-grid">
              <form className="checkout-form" onSubmit={submit}>
                <div className="checkout-mode" role="tablist">
                  <button
                    type="button"
                    className={mode === "delivery" ? "is-active" : ""}
                    onClick={() => setMode("delivery")}
                  >
                    🚚 Delivery
                  </button>
                  <button
                    type="button"
                    className={mode === "pickup" ? "is-active" : ""}
                    onClick={() => setMode("pickup")}
                  >
                    🏪 Recojo en tienda
                  </button>
                </div>

                <label>
                  <span>Nombre</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    required
                    autoComplete="name"
                  />
                </label>

                <label>
                  <span>Celular</span>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(event) => update("phone", event.target.value)}
                    required
                    autoComplete="tel"
                  />
                </label>

                {mode === "delivery" ? (
                  <>
                    <div className="checkout-address-field">
                      <span className="checkout-address-label">Dirección</span>
                      {location ? (
                        <div className="checkout-address-card">
                          <div>
                            <p className="checkout-address-text">{location.direccion}</p>
                            <p className="checkout-address-meta">
                              {[location.distrito, location.ciudad].filter(Boolean).join(" · ")}
                            </p>
                            <p className="checkout-address-coords">
                              {Number(location.latitud).toFixed(6)}, {Number(location.longitud).toFixed(6)}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="checkout-address-change"
                            onClick={() => setPickerOpen(true)}
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="checkout-address-trigger"
                          onClick={() => setPickerOpen(true)}
                        >
                          <span aria-hidden="true">📍</span> Elegir ubicación en el mapa
                        </button>
                      )}
                    </div>

                    <label>
                      <span>Referencia (opcional)</span>
                      <input
                        type="text"
                        value={form.reference}
                        onChange={(event) => update("reference", event.target.value)}
                        placeholder="Frente al parque"
                      />
                    </label>

                    {authUser ? (
                      <label className="checkout-save-address">
                        <input
                          type="checkbox"
                          checked={saveAddress}
                          onChange={(event) => setSaveAddress(event.target.checked)}
                        />
                        <span>Guardar esta dirección en mi cuenta</span>
                      </label>
                    ) : null}
                  </>
                ) : (
                  <label>
                    <span>Fecha y hora de recojo</span>
                    <input
                      type="datetime-local"
                      value={form.pickupDate}
                      onChange={(event) => update("pickupDate", event.target.value)}
                      required
                    />
                  </label>
                )}

                <label>
                  <span>Notas (opcional)</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={2}
                    placeholder="¿Algo que debamos saber?"
                  />
                </label>

                {error ? <p className="checkout-error">{error}</p> : null}

                <button type="submit" className="checkout-submit" disabled={submitting}>
                  {submitting ? "Procesando..." : `Confirmar pedido · ${formatMoney(total)}`}
                </button>

                {!authUser ? (
                  <p className="checkout-guest-note">
                    Estás haciendo el pedido como invitado. Crea una cuenta para verlo en "Mis pedidos".
                  </p>
                ) : null}
              </form>

              <aside className="checkout-summary">
                <h3>Tu pedido</h3>
                <ul>
                  {items.map((item) => {
                    const imageUrl = resolveProductImage({ imageHash: item.imageHash });
                    return (
                      <li key={item.id}>
                        <div className="checkout-summary-thumb">
                          {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span>{(item.name || "?").charAt(0)}</span>}
                        </div>
                        <div className="checkout-summary-info">
                          <p className="checkout-summary-name">{item.name}</p>
                          <p className="checkout-summary-qty">{item.quantity} × {formatMoney(item.price)}</p>
                        </div>
                        <strong>{formatMoney(item.price * item.quantity)}</strong>
                      </li>
                    );
                  })}
                </ul>
                <dl>
                  <div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
                  <div><dt>Envío</dt><dd>{shipping === 0 ? "Gratis" : formatMoney(shipping)}</dd></div>
                  <div className="checkout-summary-total"><dt>Total</dt><dd>{formatMoney(total)}</dd></div>
                </dl>
              </aside>
            </div>
          </>
        )}
      </div>

      <AddressPicker
        open={pickerOpen}
        initial={location}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          setLocation(picked);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
