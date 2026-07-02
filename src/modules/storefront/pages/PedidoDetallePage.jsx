import React, { useEffect, useMemo, useState } from "react";
import { fetchMyOrderById } from "../pedidosApi.js";
import { formatOrderMoney, loadOrderDetail } from "../orderWhatsapp.js";
import { displayOrderCode } from "../orderCodes.js";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCoords(latitud, longitud) {
  const lat = numberOrNull(latitud);
  const lng = numberOrNull(longitud);
  if (lat === null || lng === null) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function mapUrl(order) {
  const lat = numberOrNull(order.delivery?.latitud);
  const lng = numberOrNull(order.delivery?.longitud);
  if (lat !== null && lng !== null) {
    return `https://www.google.com/maps?q=${lat},${lng}&z=17&output=embed`;
  }
  const query = [
    order.delivery?.address,
    order.delivery?.location,
    order.delivery?.distrito,
    order.delivery?.ciudad,
    "Arequipa"
  ].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : "";
}

function normalizeOrderDetail(order) {
  if (!order) return null;
  const mode = "delivery";
  const subtotal = order.totals?.subtotal ?? order.subtotal ?? order.total;
  const shipping = order.totals?.shipping ?? order.shipping ?? 0;
  const serviceFee = order.totals?.serviceFee ?? order.serviceFee ?? 0;
  const total = order.totals?.total ?? order.total;
  return {
    ...order,
    customer: {
      name: order.customer?.name || "",
      phone: order.customer?.phone || "",
      address: order.customer?.address || ""
    },
    delivery: {
      mode,
      location: order.delivery?.location || order.customer?.location || order.customer?.address || "",
      address: order.delivery?.address || order.customer?.address || "",
      reference: order.delivery?.reference || order.customer?.reference || "",
      latitud: order.delivery?.latitud ?? order.customer?.latitud ?? null,
      longitud: order.delivery?.longitud ?? order.customer?.longitud ?? null,
      distrito: order.delivery?.distrito || order.customer?.distrito || "",
      ciudad: order.delivery?.ciudad || order.customer?.ciudad || "",
      coords: order.delivery?.coords || formatCoords(order.delivery?.latitud ?? order.customer?.latitud, order.delivery?.longitud ?? order.customer?.longitud),
      pickupDate: ""
    },
    totals: {
      subtotal,
      shipping,
      serviceFee,
      total
    },
    items: Array.isArray(order.items) ? order.items : [],
    notes: order.notes || ""
  };
}

const CUSTOMER_ORDER_STEPS = [
  {
    key: "PENDIENTE",
    label: "Pedido recibido",
    message: "Recibimos tu pedido. Estamos revisando el pago."
  },
  {
    key: "VALIDADO",
    label: "Pago aprobado",
    message: "Tu pago fue confirmado. Estamos preparando tu pedido."
  },
  {
    key: "EN_CAMINO",
    label: "En camino",
    message: "Tu pedido salió de tienda y va hacia tu dirección."
  },
  {
    key: "ENTREGADO",
    label: "Entregado",
    message: "Tu pedido fue entregado correctamente."
  }
];

const STATUS_ALIASES = {
  APROBADO: "VALIDADO",
  PAGADO: "VALIDADO",
  ENVIADO: "EN_CAMINO",
  "EN CAMINO": "EN_CAMINO",
  FINALIZADO: "ENTREGADO",
  CERRADO: "ENTREGADO",
  COMPLETADO: "ENTREGADO"
};

function normalizeOrderStatus(status) {
  const normalized = String(status || "PENDIENTE").trim().toUpperCase().replace(/\s+/g, "_");
  return STATUS_ALIASES[normalized] || normalized;
}

function currentCustomerStep(status) {
  const normalized = normalizeOrderStatus(status);
  if (["CANCELADO", "RECHAZADO"].includes(normalized)) {
    return {
      key: normalized,
      label: "Cancelado",
      message: "Este pedido fue cancelado. Revisa el motivo o contáctanos si necesitas ayuda."
    };
  }
  return CUSTOMER_ORDER_STEPS.find((step) => step.key === normalized) || CUSTOMER_ORDER_STEPS[0];
}

function customerStepState(status, stepKey) {
  const normalized = normalizeOrderStatus(status);
  if (["CANCELADO", "RECHAZADO"].includes(normalized)) return "muted";
  const currentIndex = CUSTOMER_ORDER_STEPS.findIndex((step) => step.key === normalized);
  const stepIndex = CUSTOMER_ORDER_STEPS.findIndex((step) => step.key === stepKey);
  if (currentIndex < 0 || stepIndex < 0) return "pending";
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function resolveProductName(productId, productsMap, fallback, variantId = "") {
  const key = String(productId || "");
  const variantKey = variantId ? `${key}::${variantId}` : key;
  const product = productsMap?.get?.(variantKey) || productsMap?.get?.(key) || productsMap?.get?.(Number(key));
  return product?.name || product?.nombre || fallback || "";
}

function findComboForOrderItem(item, combos = []) {
  const comboId = String(item?.comboId || item?.id || item?.productId || "");
  const itemName = normalizeText(item?.name);
  return (Array.isArray(combos) ? combos : []).find((combo) => {
    const candidates = [
      combo?.id,
      combo?.slug,
      combo?.comboId,
      combo?.title,
      combo?.name,
      combo?.nombre
    ].map((value) => String(value || ""));
    return candidates.some((value) => (
      value && (String(value) === comboId || normalizeText(value) === itemName)
    ));
  }) || null;
}

function normalizeComboDetailItems(item, combos = [], productsMap = null) {
  const directSource = Array.isArray(item?.items) && item.items.length
    ? item.items
    : Array.isArray(item?.comboItems) && item.comboItems.length
      ? item.comboItems
      : Array.isArray(item?.includedProducts) && item.includedProducts.length
        ? item.includedProducts
        : [];
  const comboSource = directSource.length ? null : findComboForOrderItem(item, combos);
  const source = directSource.length ? directSource : Array.isArray(comboSource?.items) ? comboSource.items : [];
  return source
    .map((line, index) => ({
      id: String(line.productId || line.id || `${item.name || "combo"}-${index}`),
      quantity: Math.max(1, Number(line.quantity || 1)),
      name: line.name || line.nombre || resolveProductName(line.productId || line.id, productsMap, `Producto ${index + 1}`, line.variantId),
      price: Number(line.price || 0)
    }))
    .filter((line) => line.name);
}

export function OrderDetailContent({ order, productsMap, combos }) {
  const normalizedOrder = normalizeOrderDetail(order);
  const [expandedCombos, setExpandedCombos] = useState(() => new Set());
  if (!normalizedOrder) return null;
  const isDelivery = true;
  const orderCode = displayOrderCode(normalizedOrder);
  const locationMapUrl = isDelivery ? mapUrl(normalizedOrder) : "";
  const visibleDelivery = Number(normalizedOrder.totals?.shipping || 0);
  const activeStatus = currentCustomerStep(normalizedOrder.status);
  const normalizedStatus = normalizeOrderStatus(normalizedOrder.status);

  function toggleComboDetail(key) {
    setExpandedCombos((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <div className="order-detail-head">
        <div>
          <span>Pedido #{orderCode}</span>
          <h1>Detalle del pedido</h1>
          <p>Resumen listo para logística y seguimiento del pedido.</p>
        </div>
        <strong className={`order-detail-status-badge is-${normalizedStatus.toLowerCase()}`}>
          {activeStatus.label}
        </strong>
      </div>

      {["CANCELADO", "RECHAZADO"].includes(normalizedStatus) ? (
        <div className="order-detail-status-cancelled">
          <strong>{activeStatus.label}</strong>
          <span>{normalizedOrder.statusReason || normalizedOrder.reason || activeStatus.message}</span>
        </div>
      ) : (
        <div className="order-detail-timeline" aria-label="Estado del pedido">
          {CUSTOMER_ORDER_STEPS.map((step) => {
            const state = customerStepState(normalizedOrder.status, step.key);
            return (
              <div key={step.key} className={`order-detail-step is-${state}`}>
                <span aria-hidden="true">{state === "done" ? "✓" : ""}</span>
                <div>
                  <strong>{step.label}</strong>
                  {state === "active" ? <small>{step.message}</small> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="order-detail-grid">
        <article className="order-detail-card">
          <h2>Entrega</h2>
          <dl>
            <div><dt>Cliente</dt><dd>{normalizedOrder.customer?.name || "-"}</dd></div>
            <div><dt>Celular</dt><dd>{normalizedOrder.customer?.phone || "-"}</dd></div>
            <div><dt>Modalidad</dt><dd>Delivery</dd></div>
            <div><dt>Ubicación</dt><dd>{normalizedOrder.delivery?.location || "-"}</dd></div>
            <div><dt>Dirección exacta</dt><dd>{normalizedOrder.delivery?.address || "-"}</dd></div>
            <div><dt>Referencia</dt><dd>{normalizedOrder.delivery?.reference || "-"}</dd></div>
            <div><dt>Coordenadas</dt><dd>{normalizedOrder.delivery?.coords || "-"}</dd></div>
            <div><dt>Distrito</dt><dd>{[normalizedOrder.delivery?.distrito, normalizedOrder.delivery?.ciudad].filter(Boolean).join(" · ") || "-"}</dd></div>
            <div><dt>Notas</dt><dd>{normalizedOrder.notes || "-"}</dd></div>
          </dl>
        </article>

        <article className="order-detail-card">
          <h2>Pago</h2>
          <p className="order-detail-payment">Yapear al <strong>987227110</strong> para confirmar el pedido.</p>
          <dl>
            <div><dt>Subtotal</dt><dd>{formatOrderMoney(normalizedOrder.totals?.subtotal)}</dd></div>
            <div><dt>Delivery</dt><dd>{formatOrderMoney(visibleDelivery)}</dd></div>
            <div className="order-detail-total"><dt>Total</dt><dd>{formatOrderMoney(normalizedOrder.totals?.total)}</dd></div>
          </dl>
        </article>
      </div>

      {isDelivery && locationMapUrl ? (
        <article className="order-detail-card order-detail-map">
          <h2>Ubicación en mapa</h2>
          <iframe
            title={`Mapa del pedido ${orderCode}`}
            src={locationMapUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </article>
      ) : null}

      <article className="order-detail-card order-detail-items">
        <h2>Productos</h2>
        <ul>
          {(normalizedOrder.items || []).map((item, index) => {
            const detailItems = normalizeComboDetailItems(item, combos, productsMap);
            const itemKey = `${item.id || item.productId || item.name}-${index}`;
            const expanded = expandedCombos.has(itemKey);
            return (
              <li key={itemKey} className={detailItems.length ? "has-combo-detail" : ""}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.quantity} x {formatOrderMoney(item.price)}</span>
                  {detailItems.length ? (
                    <button
                      type="button"
                      className="order-detail-combo-toggle"
                      aria-expanded={expanded}
                      onClick={() => toggleComboDetail(itemKey)}
                    >
                      <span>{expanded ? "Ocultar detalle" : "Ver detalle"}</span>
                      <b aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <b>{formatOrderMoney(item.price * item.quantity)}</b>
                {detailItems.length && expanded ? (
                  <div className="order-detail-combo-detail">
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
      </article>
    </>
  );
}

export default function PedidoDetallePage({ orderId, onGoCatalog }) {
  const localOrder = useMemo(() => loadOrderDetail(orderId), [orderId]);
  const [remoteOrder, setRemoteOrder] = useState(null);
  const [loading, setLoading] = useState(!localOrder);

  useEffect(() => {
    let cancelled = false;
    if (localOrder || !orderId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    fetchMyOrderById(orderId)
      .then((order) => {
        if (!cancelled) setRemoteOrder(order);
      })
      .catch(() => {
        if (!cancelled) setRemoteOrder(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [localOrder, orderId]);

  const order = localOrder || remoteOrder;

  if (loading) {
    return (
      <div className="order-detail-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalle del pedido">
        <section className="order-detail-modal">
          <button type="button" className="order-detail-modal-close" onClick={onGoCatalog} aria-label="Cerrar detalle">
            ×
          </button>
          <p className="page-status">Cargando pedido...</p>
        </section>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="order-detail-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalle del pedido">
      <section className="order-detail-modal">
        <button type="button" className="order-detail-modal-close" onClick={onGoCatalog} aria-label="Cerrar detalle">
          ×
        </button>
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">📦</div>
          <h3>No encontramos este pedido</h3>
          <p>Vuelve al catálogo o revisa la página Mis pedidos desde tu perfil.</p>
          <button type="button" className="page-cta" onClick={onGoCatalog}>Volver al catálogo</button>
        </div>
      </section>
      </div>
    );
  }

  return (
    <div className="order-detail-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalle del pedido" onClick={onGoCatalog}>
      <section className="order-detail-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="order-detail-modal-close" onClick={onGoCatalog} aria-label="Cerrar detalle">
          ×
        </button>
        <OrderDetailContent order={order} />
      </section>
    </div>
  );
}
