import React, { useEffect, useState } from "react";
import { createOrder, loadStoreDeliveryConfig, quoteDelivery, resolveProductImage, validateDeliveryCoupon } from "./storefrontApi.js";
import AddressPicker from "./AddressPicker.jsx";
import { createDireccion } from "./direccionesApi.js";
import { formatOrderMoney, getOrderDetailUrl, getWhatsappOrderUrl, saveOrderDetail } from "./orderWhatsapp.js";

function formatMoney(value) {
  return formatOrderMoney(value);
}

const LAST_CHECKOUT_FORM_KEY = "licoreria_last_checkout_form_v1";

function readLastCheckoutForm() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_CHECKOUT_FORM_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveLastCheckoutForm(data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CHECKOUT_FORM_KEY, JSON.stringify({
      ...data,
      savedAt: new Date().toISOString()
    }));
  } catch {}
}

export default function CheckoutModal({ open, onClose, items, authUser, onSuccess, couponDraft = "", onCouponDraftChange = () => {} }) {
  const mode = "delivery";
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    reference: ""
  });
  const [location, setLocation] = useState(null); // { direccion, distrito, ciudad, latitud, longitud, geohash }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successCode, setSuccessCode] = useState("");
  const [deliveryConfig, setDeliveryConfig] = useState(null);
  const [deliveryConfigLoading, setDeliveryConfigLoading] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState(null);
  const [deliveryQuoteLoading, setDeliveryQuoteLoading] = useState(false);
  const [expandedCombos, setExpandedCombos] = useState(() => new Set());
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setSubmitting(false);
      setSuccessCode("");
      setExpandedCombos(new Set());
      setCouponResult(null);
      setCouponMessage("");
      return;
    }
    setCouponCode(String(couponDraft || "").toUpperCase());

    const saved = readLastCheckoutForm();
    if (!saved) return;
    setForm((prev) => ({
      ...prev,
      name: saved.form?.name || prev.name,
      phone: saved.form?.phone || prev.phone,
      address: saved.form?.address || prev.address,
      reference: saved.form?.reference || prev.reference
    }));
    setNotes(saved.notes || "");
    setSaveAddress(saved.saveAddress !== false);
    if (saved.location && Number.isFinite(Number(saved.location.latitud)) && Number.isFinite(Number(saved.location.longitud))) {
      setLocation({
        direccion: saved.location.direccion || "",
        distrito: saved.location.distrito || "",
        ciudad: saved.location.ciudad || "",
        latitud: Number(saved.location.latitud),
        longitud: Number(saved.location.longitud),
        geohash: saved.location.geohash || "",
        confirmedByMapMove: true
      });
    }
  }, [open, couponDraft]);

  useEffect(() => {
    if (authUser) {
      setForm((prev) => ({
        ...prev,
        name: prev.name || authUser.nombre || "",
        phone: prev.phone || authUser.telefono || ""
      }));
    }
  }, [authUser]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDeliveryConfigLoading(true);
    loadStoreDeliveryConfig()
      .then((config) => {
        if (cancelled) return;
        setDeliveryConfig(config);
        const hasStore = config?.store?.latitud !== null
          && config?.store?.latitud !== undefined
          && config?.store?.longitud !== null
          && config?.store?.longitud !== undefined
          && Number.isFinite(Number(config.store.latitud))
          && Number.isFinite(Number(config.store.longitud));
        if (!hasStore) setDeliveryQuote({ available: false, message: "Delivery no disponible por ahora." });
      })
      .catch(() => {
        if (!cancelled) {
          setDeliveryConfig(null);
          setDeliveryQuote({ available: false, message: "Delivery no disponible por ahora." });
        }
      })
      .finally(() => {
        if (!cancelled) setDeliveryConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "delivery" || !location?.latitud || !location?.longitud) {
      setDeliveryQuote(null);
      setDeliveryQuoteLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDeliveryQuoteLoading(true);
    setDeliveryQuote(null);
    quoteDelivery({ latitud: location.latitud, longitud: location.longitud })
      .then((quote) => {
        if (!cancelled) setDeliveryQuote(quote);
      })
      .catch((err) => {
        if (!cancelled) setDeliveryQuote(err?.payload || { available: false, message: err?.message || "No se pudo calcular el delivery." });
      })
      .finally(() => {
        if (!cancelled) setDeliveryQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, location?.latitud, location?.longitud]);

  useEffect(() => {
    setCouponResult(null);
    setCouponMessage("");
  }, [deliveryQuote?.price]);

  if (!open) return null;

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryAvailable = deliveryConfig?.store?.latitud !== null
    && deliveryConfig?.store?.latitud !== undefined
    && deliveryConfig?.store?.longitud !== null
    && deliveryConfig?.store?.longitud !== undefined
    && Number.isFinite(Number(deliveryConfig.store.latitud))
    && Number.isFinite(Number(deliveryConfig.store.longitud));
  const shipping = mode === "delivery" && deliveryQuote?.available ? Number(deliveryQuote.price || 0) : 0;
  const deliveryDiscount = Math.min(shipping, Math.max(0, Number(couponResult?.deliveryDiscount || 0)));
  const chargedShipping = Math.max(0, shipping - deliveryDiscount);
  const serviceFee = 0;
  const total = subtotal + chargedShipping + serviceFee;

  async function applyCoupon(event) {
    event.preventDefault();
    setCouponMessage("");
    setCouponResult(null);
    const code = couponCode.trim();
    if (!code) {
      setCouponMessage("Ingresa un código de cupón.");
      return;
    }
    if (!deliveryQuote?.available || !shipping) {
      setCouponMessage("El cupón se aplica cuando el delivery ya está calculado.");
      return;
    }
    setCouponLoading(true);
    try {
      const result = await validateDeliveryCoupon({ code, shipping });
      setCouponResult(result);
      const normalizedCode = result.code || code.toUpperCase();
      setCouponCode(normalizedCode);
      onCouponDraftChange(normalizedCode);
      setCouponMessage(`Cupón aplicado al delivery: -${formatMoney(result.deliveryDiscount)}.`);
    } catch (err) {
      setCouponMessage(err?.message || "Cupón no disponible.");
    } finally {
      setCouponLoading(false);
    }
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
      const quantity = Math.max(1, Number(line.quantity || 1));
      return {
        id: String(line.variantId ? `${line.productId}::${line.variantId}` : line.productId || line.id || `${item.id}-${index}`),
        variantId: line.variantId || "",
        quantity,
        name: line.name || `Producto ${index + 1}`
      };
    });
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Falta tu nombre.");
    if (!form.phone.trim() || form.phone.trim().length < 6) return setError("Ingresa un celular válido.");
    if (!deliveryAvailable) return setError("Delivery no disponible por ahora.");
    if (mode === "delivery" && !location) return setError("Elige tu ubicación en el mapa.");
    if (mode === "delivery" && !location.confirmedByMapMove) return setError("Mueve el mapa para confirmar tu ubicación exacta.");
    if (mode === "delivery" && !form.address.trim()) return setError("Ingresa tu dirección exacta.");
    if (mode === "delivery" && deliveryQuoteLoading) return setError("Estamos calculando el delivery. Intenta nuevamente en unos segundos.");
    if (mode === "delivery" && !deliveryQuote?.available) return setError(deliveryQuote?.message || "Tu dirección está fuera de cobertura.");
    if (!items.length) return setError("Tu carrito está vacío.");

    setSubmitting(true);
    try {
      const payload = {
        channel: "web",
        mode,
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: mode === "delivery" ? form.address.trim() : "",
          location: mode === "delivery" ? location?.direccion || "" : "",
          reference: form.reference.trim(),
          latitud: mode === "delivery" ? location?.latitud : null,
          longitud: mode === "delivery" ? location?.longitud : null,
          geohash: mode === "delivery" ? location?.geohash : "",
          distrito: mode === "delivery" ? location?.distrito || "" : "",
          ciudad: mode === "delivery" ? location?.ciudad || "" : ""
        },
        pickupDate: "",
        items: items.map((it) => ({
          productId: it.productId || it.parentProductId || it.id || "",
          id: it.id,
          parentProductId: it.parentProductId || "",
          variantId: it.variantId || "",
          variantName: it.variantName || "",
          presentacionCigarro: it.cigarettePresentation || it.presentacionCigarro || "",
          cigarettePresentation: it.cigarettePresentation || it.presentacionCigarro || "",
          cigarettePresentationLabel: it.cigarettePresentationLabel || "",
          cigarettePresentationUnits: it.cigarettePresentationUnits || 0,
          cigarettePresentationReportUnits: it.cigarettePresentationReportUnits || 0,
          type: it.type || "product",
          comboId: it.comboId || null,
          name: it.name,
          category: it.category || "",
          price: it.price,
          quantity: it.quantity,
          stock: it.stock || 0,
          imageHash: it.imageHash || "",
          items: it.type === "combo" && Array.isArray(it.items)
            ? it.items.map((line, index) => ({
              productId: line.productId || line.id || `combo-item-${index + 1}`,
              variantId: line.variantId || "",
              quantity: Math.max(1, Number(line.quantity || 1)),
              name: line.name || `Producto ${index + 1}`,
              price: Number(line.price || 0),
              category: line.category || ""
            }))
            : []
        })),
        total,
        subtotal,
        shipping: chargedShipping,
        shippingBeforeDiscount: shipping,
        deliveryDiscount,
        coupon: couponResult ? {
          id: couponResult.id || "",
          code: couponResult.code || couponCode.trim(),
          title: couponResult.title || "",
          appliesTo: "delivery",
          discountType: couponResult.discountType || "amount",
          discountValue: Number(couponResult.discountValue || 0),
          deliveryDiscount
        } : null,
        couponCode: couponResult?.code || "",
        serviceFee,
        serviceFeeRate: 0,
        deliveryDistanceKm: mode === "delivery" ? deliveryQuote?.distanceKm ?? null : null,
        deliveryPricingRange: mode === "delivery" ? deliveryQuote?.range ?? null : null,
        storeLatitud: mode === "delivery" ? deliveryConfig?.store?.latitud ?? null : null,
        storeLongitud: mode === "delivery" ? deliveryConfig?.store?.longitud ?? null : null,
        notes
      };
      const order = await createOrder(payload);
      const orderId = String(order?.id || "");
      const orderCode = String(order?.publicCode || order?.customerCode || "");
      if (!orderId) throw new Error("El servidor no devolvió número de pedido.");
      const detailUrl = getOrderDetailUrl(orderCode || orderId);
      const orderDetail = {
        id: orderId,
        publicCode: orderCode || "",
        createdAt: new Date().toISOString(),
        customer: payload.customer,
        delivery: {
          mode,
          location: mode === "delivery" ? location?.direccion || "" : "",
          address: mode === "delivery" ? form.address.trim() : "",
          reference: form.reference.trim(),
          coords: mode === "delivery" && location?.latitud && location?.longitud
            ? `${Number(location.latitud).toFixed(6)}, ${Number(location.longitud).toFixed(6)}`
            : "",
          pickupDate: ""
        },
        items: payload.items,
        totals: {
          subtotal,
          shipping: chargedShipping,
          shippingBeforeDiscount: shipping,
          deliveryDiscount,
          serviceFee,
          serviceFeeRate: 0,
          total
        },
        coupon: payload.coupon,
        deliveryQuote: mode === "delivery" ? deliveryQuote : null,
        notes: notes.trim(),
        detailUrl
      };
      saveOrderDetail(orderDetail);
      saveLastCheckoutForm({
        mode,
        form: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: mode === "delivery" ? form.address.trim() : "",
          reference: form.reference.trim(),
          pickupDate: ""
        },
        location: mode === "delivery" && location ? {
          direccion: location.direccion || "",
          distrito: location.distrito || "",
          ciudad: location.ciudad || "",
          latitud: location.latitud,
          longitud: location.longitud,
          geohash: location.geohash || ""
        } : null,
        saveAddress,
        notes: notes.trim()
      });

      // Guardar dirección en cuenta si aplica
      if (authUser && mode === "delivery" && location && saveAddress) {
        try {
          await createDireccion({
            etiqueta: "Casa",
            icono: "casa",
            direccion: form.address.trim(),
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

      setSuccessCode(orderCode || orderId);
      onSuccess?.(orderDetail);
      window.open(getWhatsappOrderUrl(orderDetail), "_blank", "noopener");
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
            <h2>Pedido listo para enviar</h2>
            <p>Tu pedido <strong>#{successCode}</strong> fue registrado.</p>
            <p className="checkout-modal-meta">Se abrió WhatsApp con el resumen listo. Recuerda yapear {formatMoney(total)} al 940189609 para confirmar.</p>
            <div className="checkout-modal-success-actions">
              <button
                type="button"
                className="checkout-success-button checkout-success-button-primary"
                onClick={() => {
                  try {
                    window.sessionStorage.setItem("licoreria_pending_order_detail_id", successCode);
                  } catch {}
                  window.location.href = "/pedidos";
                  onClose?.();
                }}
              >
                Ver detalle
              </button>
              {authUser ? (
                <button
                  type="button"
                  className="checkout-success-button checkout-success-button-secondary"
                  onClick={() => {
                    window.location.href = "/pedidos";
                    onClose?.();
                  }}
                >
                  Mis pedidos
                </button>
              ) : null}
              <button
                type="button"
                className="checkout-success-button checkout-success-button-tertiary"
                onClick={() => {
                  window.location.href = "/";
                  onClose?.();
                }}
              >
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
                <div className="checkout-mode is-delivery-only" role="status" aria-live="polite">
                  <span>🚚 Delivery</span>
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

                <div className="checkout-address-field">
                  <span className="checkout-address-label">Ubicación</span>
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
                  <span>Dirección exacta</span>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(event) => update("address", event.target.value)}
                    placeholder="Mz B Lt 4, piso 2, puerta negra"
                    required
                    autoComplete="street-address"
                  />
                </label>

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
                  {submitting ? "Procesando..." : `Enviar pedido · ${formatMoney(total)}`}
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
                    const detailItems = comboDetailItems(item);
                    const comboExpanded = expandedCombos.has(item.id);
                    return (
                      <li key={item.id} className={detailItems.length ? "has-combo-detail" : ""}>
                        <div className="checkout-summary-thumb">
                          {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span>{(item.name || "?").charAt(0)}</span>}
                        </div>
                        <div className="checkout-summary-info">
                          <p className="checkout-summary-name">{item.name}</p>
                          <p className="checkout-summary-qty">{item.quantity} × {formatMoney(item.price)}</p>
                          {detailItems.length ? (
                            <button
                              type="button"
                              className="checkout-combo-toggle"
                              onClick={() => toggleComboDetail(item.id)}
                              aria-expanded={comboExpanded}
                            >
                              <span>{comboExpanded ? "Ocultar detalle" : "Ver detalle"}</span>
                              <b className="checkout-combo-chevron" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                        <strong>{formatMoney(item.price * item.quantity)}</strong>
                        {detailItems.length && comboExpanded ? (
                          <div className="checkout-combo-detail">
                            <strong>Productos del combo</strong>
                            <ul>
                              {detailItems.map((detail) => (
                                <li key={detail.id}>
                                  <span>{detail.quantity}x {detail.name}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <dl>
                  <div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
                  <div><dt>Delivery</dt><dd>{deliveryQuoteLoading || !deliveryQuote ? "Calculando..." : !deliveryQuote.available ? "Sin cobertura" : formatMoney(shipping)}</dd></div>
                  {deliveryDiscount > 0 ? (
                    <div className="checkout-summary-discount"><dt>Cupón delivery</dt><dd>-{formatMoney(deliveryDiscount)}</dd></div>
                  ) : null}
                  <div className="checkout-summary-total"><dt>Total</dt><dd>{formatMoney(total)}</dd></div>
                </dl>
                <form className="checkout-coupon-form" onSubmit={applyCoupon}>
                  <label htmlFor="checkout-coupon-code">Cupón de delivery</label>
                  <div>
                    <input
                      id="checkout-coupon-code"
                      type="text"
                      value={couponCode}
                      onChange={(event) => {
                        const nextCode = event.target.value.toUpperCase();
                        setCouponCode(nextCode);
                        onCouponDraftChange(nextCode);
                        setCouponResult(null);
                        setCouponMessage("");
                      }}
                      placeholder="Código"
                      autoComplete="off"
                    />
                    <button type="submit" disabled={couponLoading || !deliveryQuote?.available}>
                      {couponLoading ? "..." : "Aplicar"}
                    </button>
                  </div>
                  {couponMessage ? (
                    <p className={couponResult ? "is-success" : ""}>{couponMessage}</p>
                  ) : (
                    <small>Solo descuenta el delivery. No modifica el precio de productos.</small>
                  )}
                </form>
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
