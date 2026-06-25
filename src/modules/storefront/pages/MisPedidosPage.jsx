import React, { useEffect, useState } from "react";
import { fetchMyOrders, repeatMyOrder } from "../pedidosApi.js";
import { SkeletonOrderCards } from "../common/Skeleton.jsx";
import { OrderDetailContent } from "./PedidoDetallePage.jsx";
import { loadOrderDetail } from "../orderWhatsapp.js";
import { displayOrderCode, getPublicOrderCode } from "../orderCodes.js";
import { getCachedCombos, loadCombos } from "../combosApi.js";

const PENDING_ORDER_DETAIL_KEY = "licoreria_pending_order_detail_id";

const TABS = [
  { key: "todos", label: "Todos" },
  { key: "pendientes", label: "Pendientes" },
  { key: "en_camino", label: "En camino" },
  { key: "entregados", label: "Entregados" },
  { key: "cancelados", label: "Cancelados" }
];

const STATUS_BADGES = {
  PENDIENTE: { label: "Pendiente", tone: "yellow" },
  VALIDADO: { label: "Pago aprobado", tone: "yellow" },
  EN_CAMINO: { label: "En camino", tone: "blue" },
  "EN CAMINO": { label: "En camino", tone: "blue" },
  ENVIADO: { label: "Enviado", tone: "blue" },
  ENTREGADO: { label: "Entregado", tone: "green" },
  COMPLETADO: { label: "Entregado", tone: "green" },
  CANCELADO: { label: "Cancelado", tone: "red" },
  RECHAZADO: { label: "Rechazado", tone: "red" }
};

const TRACK_STEPS = [
  { key: "PENDIENTE", label: "Pedido" },
  { key: "VALIDADO", label: "Pago" },
  { key: "EN_CAMINO", label: "Camino" },
  { key: "ENTREGADO", label: "Entrega" }
];

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(raw) {
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }
  return String(raw);
}

function orderTime(raw) {
  if (!raw) return 0;
  const direct = new Date(raw).getTime();
  if (!Number.isNaN(direct)) return direct;
  const match = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(.+)$/);
  if (!match) return 0;
  const [, day, month, year, timeText] = match;
  const normalizedTime = timeText
    .replace("a. m.", "AM")
    .replace("p. m.", "PM")
    .replace("a.m.", "AM")
    .replace("p.m.", "PM");
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${normalizedTime}`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRecentFirst(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => (
    orderTime(right.createdAt || right.lastUpdatedAt) - orderTime(left.createdAt || left.lastUpdatedAt)
  ));
}

function normalizeStatus(status) {
  return String(status || "PENDIENTE").toUpperCase().replace(/\s+/g, "_");
}

function stepState(orderStatus, stepKey) {
  const current = normalizeStatus(orderStatus);
  if (["CANCELADO", "RECHAZADO"].includes(current)) return "muted";
  const currentIndex = TRACK_STEPS.findIndex((step) => step.key === current);
  const stepIndex = TRACK_STEPS.findIndex((step) => step.key === stepKey);
  if (currentIndex < 0 || stepIndex < 0) return "pending";
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

export default function MisPedidosPage({ onRepeat, onGoCatalog, productsMap }) {
  const [filter, setFilter] = useState("todos");
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [comboCatalog, setComboCatalog] = useState(() => getCachedCombos());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchMyOrders(filter)
      .then((items) => {
        if (cancelled) return;
        setOrders(sortRecentFirst(items));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "No se pudieron cargar tus pedidos.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    loadCombos()
      .then((items) => {
        if (!cancelled) setComboCatalog(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (!cancelled) setComboCatalog((current) => current);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || selectedOrder || typeof window === "undefined") return;
    let pendingOrderId = "";
    try {
      pendingOrderId = window.sessionStorage.getItem(PENDING_ORDER_DETAIL_KEY) || "";
      if (pendingOrderId) window.sessionStorage.removeItem(PENDING_ORDER_DETAIL_KEY);
    } catch {
      pendingOrderId = "";
    }
    if (!pendingOrderId) return;
    const order =
      orders.find((item) => String(getPublicOrderCode(item)) === String(pendingOrderId) || String(item.id) === String(pendingOrderId)) ||
      loadOrderDetail(pendingOrderId);
    if (order) setSelectedOrder(order);
  }, [loading, orders, selectedOrder]);

  async function handleRepeat(order) {
    try {
      const result = await repeatMyOrder(getPublicOrderCode(order) || order.id);
      if (Array.isArray(result?.items) && result.items.length) {
        onRepeat?.(result.items);
      }
    } catch (err) {
      alert(err?.message || "No se pudo repetir el pedido.");
    }
  }

  return (
    <section className="page-shell page-pedidos">
      <header className="page-head">
        <h1>MIS PEDIDOS</h1>
        <p>Consulta tu historial, repite tus combos favoritos y sigue tu entrega.</p>
      </header>

      <div className="page-tabs" role="tablist">
        {TABS.map((tab) => (
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
        <SkeletonOrderCards count={3} />
      ) : error ? (
        <p className="page-status page-status-error">{error}</p>
      ) : orders.length === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">📦</div>
          <h3>Aún no tienes pedidos en esta vista</h3>
          <p>Cuando hagas tu primer pedido aparecerá aquí con su estado en tiempo real.</p>
          <button type="button" className="page-cta" onClick={onGoCatalog}>
            Ir al catálogo
          </button>
        </div>
      ) : (
        <ul className="page-order-list">
          {orders.map((order) => {
            const itemsPreview = (order.items || []).slice(0, 3);
            const restCount = (order.items?.length || 0) - itemsPreview.length;
            const badge =
              STATUS_BADGES[normalizeStatus(order.status)] ||
              { label: order.status || "Desconocido", tone: "neutral" };
            const currentStatus = normalizeStatus(order.status);

            return (
              <li key={order.id} className="page-order-card">
                <div className="page-order-body">
                  <div className="page-order-meta">
                    <span className={`page-order-badge tone-${badge.tone}`}>{badge.label}</span>
                    <span className="page-order-code">Pedido {displayOrderCode(order)}</span>
                  </div>
                  <p className="page-order-date">{formatDate(order.createdAt)}</p>
                  <ul className="page-order-items">
                    {itemsPreview.map((item, idx) => (
                      <li key={`${order.id}-${item.productId || idx}`}>
                        <span className="page-order-item-qty">{item.quantity}×</span> {item.name}
                      </li>
                    ))}
                    {restCount > 0 ? <li className="page-order-more">+ {restCount} producto{restCount === 1 ? "" : "s"} más</li> : null}
                  </ul>
                  <div className={`page-order-track ${["CANCELADO", "RECHAZADO"].includes(currentStatus) ? "is-closed" : ""}`}>
                    {TRACK_STEPS.map((step) => (
                      <span key={step.key} className={`is-${stepState(currentStatus, step.key)}`}>
                        <i aria-hidden="true" />
                        {step.label}
                      </span>
                    ))}
                  </div>
                  {order.statusReason ? <p className="page-order-reason">Motivo: {order.statusReason}</p> : null}
                </div>
                <div className="page-order-side">
                  <div className="page-order-actions">
                    <button type="button" className="page-order-btn primary" onClick={() => setSelectedOrder(order)}>
                      Ver detalle
                    </button>
                    <button type="button" className="page-order-btn" onClick={() => handleRepeat(order)}>
                      Pedir de nuevo
                    </button>
                  </div>
                  <p className="page-order-total-row">
                    <span>Total</span>
                    <b>{formatMoney(order.total)}</b>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selectedOrder ? (
        <div className="order-detail-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalle del pedido" onClick={() => setSelectedOrder(null)}>
          <section className="order-detail-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="order-detail-modal-close" onClick={() => setSelectedOrder(null)} aria-label="Cerrar detalle">
              ×
            </button>
            <OrderDetailContent order={selectedOrder} productsMap={productsMap} combos={comboCatalog} />
          </section>
        </div>
      ) : null}
    </section>
  );
}
