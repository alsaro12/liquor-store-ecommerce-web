import React, { useEffect, useMemo, useState } from "react";
import { loadOrdersAll, updateOrderStatus } from "./adminApi.js";

const STORE_KEY = "licoreria_admin_store_control";

const CANCEL_REASONS = [
  "Tienda cerrada",
  "Atencion suspendida por fecha especial",
  "Delivery no disponible temporalmente",
  "Zona fuera de cobertura",
  "Pago no validado",
  "Cliente no responde WhatsApp",
  "Cliente no recepciona",
  "Direccion incorrecta o incompleta",
  "Pedido duplicado"
];

const AUTO_CLOSE_STORE_REASONS = new Set([
  "Tienda cerrada",
  "Atencion suspendida por fecha especial"
]);

const AUTO_PAUSE_DELIVERY_REASONS = new Set([
  "Delivery no disponible temporalmente"
]);

const DEFAULT_SCHEDULE = [
  { day: "Lunes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Martes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Miercoles", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Jueves", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Viernes", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Sabado", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Domingo", shifts: [{ open: "11:00", close: "22:00" }], active: true }
];

const HOURS_12 = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];
const PERIODS = ["AM", "PM"];
const ORDERS_PAGE_SIZE = 10;
const CLOSED_ORDER_STATUSES = new Set(["entregado", "rechazado", "cancelado"]);

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function parseMoneyInput(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function orderTimestamp(order) {
  const direct = new Date(order?.createdAt || "").getTime();
  if (!Number.isNaN(direct)) return direct;
  const match = String(order?.createdAt || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(.+)$/);
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

function sortOperationalQueue(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftClosed = CLOSED_ORDER_STATUSES.has(left?.status);
    const rightClosed = CLOSED_ORDER_STATUSES.has(right?.status);
    if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
    const diff = leftClosed
      ? orderTimestamp(right) - orderTimestamp(left)
      : orderTimestamp(left) - orderTimestamp(right);
    if (diff !== 0) return diff;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

function buildPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const items = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) items.push("ellipsis-start");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push("ellipsis-end");
  items.push(totalPages);
  return items;
}

function toTimeParts(value) {
  const [rawHour, minute = "00"] = String(value || "10:00").split(":");
  const hour24 = Math.max(0, Math.min(23, Number(rawHour || 0)));
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return {
    hour: String(hour12).padStart(2, "0"),
    minute: MINUTES.includes(minute) ? minute : "00",
    period
  };
}

function fromTimeParts(parts) {
  let hour = Number(parts.hour || 12);
  if (parts.period === "PM" && hour < 12) hour += 12;
  if (parts.period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${parts.minute || "00"}`;
}

function minutesFromTime(value) {
  const [hour = "0", minute = "0"] = String(value || "00:00").split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatScheduleTime(value) {
  const parts = toTimeParts(value);
  return `${parts.hour}:${parts.minute} ${parts.period}`;
}

function normalizeSchedule(schedule) {
  const source = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_SCHEDULE;
  return DEFAULT_SCHEDULE.map((fallback, index) => {
    const row = source[index] || fallback;
    const shifts = Array.isArray(row.shifts) && row.shifts.length
      ? row.shifts
      : [{ open: row.open || fallback.shifts[0].open, close: row.close || fallback.shifts[0].close }];
    return {
      day: row.day || fallback.day,
      active: row.active !== false,
      shifts: shifts.map((shift) => ({
        open: shift?.open || fallback.shifts[0].open,
        close: shift?.close || fallback.shifts[0].close
      }))
    };
  });
}

function isNowInsideSchedule(schedule, now = new Date()) {
  return Boolean(getActiveScheduleShift(schedule, now));
}

function getActiveScheduleShift(schedule, now = new Date()) {
  const dayIndex = (now.getDay() + 6) % 7;
  const today = normalizeSchedule(schedule)?.[dayIndex];
  if (!today?.active) return null;
  const current = now.getHours() * 60 + now.getMinutes();
  const activeShift = today.shifts.find((shift) => {
    const open = minutesFromTime(shift.open);
    const close = minutesFromTime(shift.close);
    if (open <= close) return current >= open && current < close;
    return current >= open || current < close;
  });
  if (!activeShift) return null;
  return {
    day: today.day,
    label: `${formatScheduleTime(activeShift.open)} - ${formatScheduleTime(activeShift.close)}`
  };
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value || fallback;
  } catch {
    return fallback;
  }
}

function statusLabel(status) {
  return {
    pendiente: "Pendiente",
    validado: "Aprobado",
    en_camino: "En camino",
    entregado: "Finalizado",
    rechazado: "Rechazado",
    cancelado: "Cancelado"
  }[status] || status;
}

function statusIcon(status) {
  return {
    pendiente: "!",
    validado: "✓",
    en_camino: "→",
    entregado: "✓",
    rechazado: "×",
    cancelado: "×"
  }[status] || "•";
}

function nextActionFor(status) {
  return {
    pendiente: { status: "validado", apiStatus: "VALIDADO", icon: "✓", label: "Aprobar pago", title: "Validar pago recibido" },
    validado: { status: "en_camino", apiStatus: "EN_CAMINO", icon: "→", label: "Enviar pedido", title: "Marcar pedido en camino" },
    en_camino: { status: "entregado", apiStatus: "ENTREGADO", icon: "✓", label: "Entregar", title: "Marcar pedido entregado" }
  }[status] || null;
}

function normalizeAdminStatus(status) {
  const raw = String(status || "PENDIENTE").trim().toUpperCase().replace(/\s+/g, "_");
  return {
    PENDIENTE: "pendiente",
    PENDING: "pendiente",
    VALIDADO: "validado",
    APROBADO: "validado",
    PAGO_VALIDADO: "validado",
    PAGO_APROBADO: "validado",
    PAGO_VERIFICADO: "validado",
    EN_PREPARACION: "validado",
    EN_CAMINO: "en_camino",
    ENVIADO: "en_camino",
    ENTREGADO: "entregado",
    COMPLETADO: "entregado",
    FINALIZADO: "entregado",
    CANCELADO: "cancelado"
  }[raw] || raw.toLowerCase();
}

function apiStatusFromAdmin(status) {
  return {
    pendiente: "PENDIENTE",
    validado: "VALIDADO",
    en_camino: "EN_CAMINO",
    entregado: "ENTREGADO",
    cancelado: "CANCELADO"
  }[status] || String(status || "").toUpperCase();
}

function normalizeAdminOrder(order) {
  const customer = order?.customer || {};
  const deliveryText = [
    customer.location,
    customer.address,
    customer.distrito,
    customer.ciudad
  ].filter(Boolean).join(" · ");
  return {
    id: String(order?.id || ""),
    publicCode: String(order?.publicCode || order?.customerCode || ""),
    customer: customer.name || "Cliente",
    phone: customer.phone || "",
    address: deliveryText || customer.address || order?.modeLabel || "",
    total: Number(order?.total || order?.totals?.total || 0),
    mode: "delivery",
    modeLabel: "Delivery",
    shipping: Number(order?.shipping || 0),
    deliveryCost: Number.isFinite(Number(order?.deliveryCost)) ? Number(order.deliveryCost) : null,
    deliveryProfit: Number.isFinite(Number(order?.deliveryProfit)) ? Number(order.deliveryProfit) : null,
    deliveryFinanceNote: order?.deliveryFinanceNote || "",
    deliveryFinanceAt: order?.deliveryFinanceAt || "",
    payment: order?.payment || "Yape / Plin",
    status: normalizeAdminStatus(order?.status),
    items: Array.isArray(order?.items)
      ? order.items.map((item) => `${item.quantity || 1}x ${item.name || "Producto"}`)
      : [],
    reason: order?.reason || order?.statusReason || "",
    createdAt: order?.createdAt || "",
    note: order?.notes || ""
  };
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [store, setStore] = useState(() => {
    const stored = readJson(STORE_KEY, {
      open: true,
      delivery: true,
      schedule: DEFAULT_SCHEDULE,
      showSchedule: false,
      manualClosed: false,
      autoClosedReason: ""
    });
    return { ...stored, schedule: normalizeSchedule(stored.schedule) };
  });
  const [reasonDraft, setReasonDraft] = useState({});
  const [deliveryFinanceOrder, setDeliveryFinanceOrder] = useState(null);
  const [deliveryFinanceIntent, setDeliveryFinanceIntent] = useState("edit");
  const [deliveryFinanceForm, setDeliveryFinanceForm] = useState({ cost: "", note: "" });
  const [deliveryFinanceError, setDeliveryFinanceError] = useState("");

  function persistStore(next) {
    const normalized = { ...next, schedule: normalizeSchedule(next.schedule) };
    setStore(normalized);
    localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
  }

  function toggleStoreOpen() {
    persistStore({
      ...store,
      open: !store.open,
      manualClosed: store.open,
      autoClosedReason: store.open ? "Cierre manual" : ""
    });
  }

  function applyOperationalClosure(reason) {
    if (AUTO_CLOSE_STORE_REASONS.has(reason)) {
      persistStore({
        ...store,
        open: false,
        manualClosed: true,
        autoClosedReason: reason
      });
      return;
    }
    if (AUTO_PAUSE_DELIVERY_REASONS.has(reason)) {
      persistStore({
        ...store,
        delivery: false,
        autoClosedReason: reason
      });
    }
  }

  async function refreshOrders({ silent = false } = {}) {
    if (!silent) setOrdersLoading(true);
    setOrdersError("");
    try {
      const items = await loadOrdersAll();
      const nextOrders = sortOperationalQueue((Array.isArray(items) ? items : []).map(normalizeAdminOrder));
      setOrders(nextOrders);
      return nextOrders;
    } catch (err) {
      setOrdersError(err?.message || "No se pudieron cargar los pedidos.");
      return null;
    } finally {
      if (!silent) setOrdersLoading(false);
    }
  }

  async function updateOrder(id, patch) {
    const previous = orders;
    const nextPatch = { ...patch };
    const optimisticPatch = { ...nextPatch };
    delete optimisticPatch.apiStatus;
    setUpdatingOrderId(id);
    setOrdersError("");
    setOrders(previous.map((order) => (
      order.id === id ? { ...order, ...optimisticPatch, updatedAt: new Date().toISOString() } : order
    )));
    try {
      const updated = await updateOrderStatus(id, {
        ...nextPatch,
        status: nextPatch.apiStatus || (nextPatch.status ? apiStatusFromAdmin(nextPatch.status) : undefined),
        statusReason: nextPatch.reason || ""
      });
      setOrders((current) => sortOperationalQueue(current.map((order) => (
        order.id === id ? normalizeAdminOrder(updated) : order
      ))));
      void refreshOrders({ silent: true });
    } catch (err) {
      setOrders(previous);
      setOrdersError(`No se pudo actualizar ${id}: ${err?.message || "Error desconocido"}`);
    } finally {
      setUpdatingOrderId("");
    }
  }

  function setReason(id, type, value) {
    setReasonDraft((current) => ({ ...current, [`${id}:${type}`]: value }));
  }

  function applyReason(id, type, fallback) {
    const key = `${id}:${type}`;
    return reasonDraft[key] || fallback;
  }

  function advanceOrderStatus(order) {
    const nextAction = nextActionFor(order?.status);
    if (!nextAction || updatingOrderId) return;
    if (order?.mode === "delivery" && order?.status === "validado" && nextAction.status === "en_camino") {
      openDeliveryFinance(order, "send");
      return;
    }
    updateOrder(order.id, { status: nextAction.status, apiStatus: nextAction.apiStatus, reason: "" });
  }

  function openDeliveryFinance(order, intent = "edit") {
    setDeliveryFinanceOrder(order);
    setDeliveryFinanceIntent(intent);
    setDeliveryFinanceForm({
      cost: Number.isFinite(Number(order?.deliveryCost)) ? String(Number(order.deliveryCost).toFixed(2)) : "",
      note: order?.deliveryFinanceNote || ""
    });
    setDeliveryFinanceError("");
  }

  function closeDeliveryFinance() {
    if (updatingOrderId) return;
    setDeliveryFinanceOrder(null);
    setDeliveryFinanceIntent("edit");
    setDeliveryFinanceError("");
  }

  async function submitDeliveryFinance(event) {
    event.preventDefault();
    if (!deliveryFinanceOrder || updatingOrderId) return;
    const cost = parseMoneyInput(deliveryFinanceForm.cost);
    if (!Number.isFinite(cost) || cost <= 0) {
      setDeliveryFinanceError("Ingresa el costo real del delivery antes de continuar.");
      return;
    }
    const nextAction = nextActionFor(deliveryFinanceOrder.status);
    const shouldAdvance = deliveryFinanceIntent === "send" && nextAction?.status === "en_camino";
    await updateOrder(deliveryFinanceOrder.id, {
      ...(shouldAdvance ? { status: nextAction.status, apiStatus: nextAction.apiStatus, reason: "" } : {}),
      deliveryCost: cost,
      deliveryFinanceNote: deliveryFinanceForm.note
    });
    setDeliveryFinanceOrder(null);
    setDeliveryFinanceIntent("edit");
    setDeliveryFinanceError("");
  }

  function updateSchedule(index, field, value) {
    const schedule = store.schedule.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    ));
    persistStore({ ...store, schedule });
  }

  function updateScheduleTime(index, shiftIndex, field, part, value) {
    const row = store.schedule[index];
    const shifts = row.shifts.map((shift, currentShiftIndex) => {
      if (currentShiftIndex !== shiftIndex) return shift;
      const parts = { ...toTimeParts(shift[field]), [part]: value };
      return { ...shift, [field]: fromTimeParts(parts) };
    });
    updateSchedule(index, "shifts", shifts);
  }

  function addScheduleShift(index) {
    const row = store.schedule[index];
    updateSchedule(index, "shifts", [...row.shifts, { open: "06:00", close: "18:00" }]);
  }

  function removeScheduleShift(index, shiftIndex) {
    const row = store.schedule[index];
    if (row.shifts.length <= 1) return;
    updateSchedule(index, "shifts", row.shifts.filter((_, currentShiftIndex) => currentShiftIndex !== shiftIndex));
  }

  useEffect(() => {
    function syncStoreWithSchedule() {
      setStore((current) => {
        const scheduledOpen = isNowInsideSchedule(current.schedule || DEFAULT_SCHEDULE);
        if (current.manualClosed) return current;
        if (current.open === scheduledOpen) return current;
        const next = { ...current, open: scheduledOpen, autoClosedReason: scheduledOpen ? "" : "Fuera de horario" };
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
        return next;
      });
    }
    syncStoreWithSchedule();
    const id = window.setInterval(syncStoreWithSchedule, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void refreshOrders();
    const id = window.setInterval(() => {
      void refreshOrders({ silent: true });
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  const stats = useMemo(() => ({
    pendientes: orders.filter((order) => order.status === "pendiente").length,
    activos: orders.filter((order) => ["validado", "en_camino"].includes(order.status)).length,
    cerrados: orders.filter((order) => CLOSED_ORDER_STATUSES.has(order.status)).length
  }), [orders]);
  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PAGE_SIZE));
  const paginationItems = useMemo(() => buildPaginationItems(currentPage, totalPages), [currentPage, totalPages]);
  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (safePage - 1) * ORDERS_PAGE_SIZE;
    return orders.slice(start, start + ORDERS_PAGE_SIZE);
  }, [currentPage, orders, totalPages]);
  const pageStart = orders.length ? (Math.min(Math.max(1, currentPage), totalPages) - 1) * ORDERS_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(orders.length, pageStart + ORDERS_PAGE_SIZE - 1);
  const activeScheduleShift = getActiveScheduleShift(store.schedule || DEFAULT_SCHEDULE);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    setCurrentPage(nextPage);
  }

  function renderPagination(position) {
    if (orders.length <= ORDERS_PAGE_SIZE) return null;
    return (
      <div className={`official-product-pagination admin-orders-pagination is-${position}`}>
        <span>
          Pedidos {pageStart}-{pageEnd} de {orders.length}
        </span>
        <div className="official-product-pagination-controls" aria-label={`Paginacion de pedidos ${position}`}>
          <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1 || ordersLoading}>
            Anterior
          </button>
          <div className="official-product-page-numbers">
            {paginationItems.map((item, index) =>
              String(item).startsWith("ellipsis") ? (
                <span key={`orders-${position}-${item}-${index}`} className="official-product-page-ellipsis">...</span>
              ) : (
                <button
                  key={`orders-${position}-${item}`}
                  type="button"
                  className={Number(item) === currentPage ? "is-active" : ""}
                  disabled={ordersLoading || Number(item) === currentPage}
                  aria-current={Number(item) === currentPage ? "page" : undefined}
                  onClick={() => goToPage(item)}
                >
                  {item}
                </button>
              )
            )}
          </div>
          <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages || ordersLoading}>
            Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="admin-orders-page">
      <div className="admin-orders-toolbar">
        <article className={`admin-store-switch ${store.open ? "is-open" : "is-closed"}`}>
            <span className="admin-store-icon" aria-hidden="true">🏪</span>
          <div>
            <span>Tienda</span>
            <strong>{store.open ? "Abierta" : "Cerrada"}</strong>
            {store.autoClosedReason ? <small>{store.autoClosedReason}</small> : null}
          </div>
          <button type="button" onClick={toggleStoreOpen}>
            {store.open ? "Cerrar" : "Abrir"}
          </button>
        </article>
        <article className={`admin-store-switch ${store.delivery ? "is-open" : "is-closed"}`}>
          <span className="admin-store-icon" aria-hidden="true">🛵</span>
          <div>
            <span>Delivery</span>
            <strong>{store.delivery ? "Activo" : "Pausado"}</strong>
          </div>
          <button type="button" onClick={() => persistStore({ ...store, delivery: !store.delivery })}>
            {store.delivery ? "Pausar" : "Activar"}
          </button>
        </article>
        <div className={`admin-hours-menu ${store.showSchedule ? "is-open" : ""}`}>
          <button
            type="button"
            className="admin-hours-button"
            onClick={() => persistStore({ ...store, showSchedule: !store.showSchedule })}
            aria-expanded={store.showSchedule}
          >
            <span className="admin-hours-button-icon" aria-hidden="true">⌚</span>
            <span className="admin-hours-button-copy">
              <strong>Horario</strong>
              <small>{activeScheduleShift ? `Turno activo: ${activeScheduleShift.label}` : "Sin turno activo"}</small>
            </span>
          </button>

          {store.showSchedule ? (
            <section className="admin-hours-panel" aria-label="Horario semanal editable">
              <div className="admin-hours-panel-head">
                <div>
                  <span>Horario configurable</span>
                  <h2>Semana operativa</h2>
                </div>
                <button
                  type="button"
                  className="admin-hours-close"
                  onClick={() => persistStore({ ...store, showSchedule: false })}
                  aria-label="Cerrar horario"
                >
                  ×
                </button>
              </div>
              <div className="admin-hours-grid">
                {store.schedule.map((row, index) => (
                  <div key={row.day} className={`admin-hours-row ${row.active ? "is-active" : "is-disabled"}`}>
                    <div className="admin-hours-day-cell">
                      <span className="admin-hours-day">{row.day}</span>
                      <label className="admin-hours-active">
                        <input type="checkbox" checked={row.active} onChange={(event) => updateSchedule(index, "active", event.target.checked)} />
                        <span>Activo</span>
                      </label>
                    </div>
                    <div className="admin-hours-shifts">
                      {row.shifts.map((shift, shiftIndex) => (
                        <div key={`${row.day}-${shiftIndex}`} className="admin-hours-shift">
                          <div className="admin-hours-range">
                            {["open", "close"].map((field) => {
                              const parts = toTimeParts(shift[field]);
                              return (
                                <div key={field} className="admin-hours-time">
                                  <small>{field === "open" ? "Abre" : "Cierra"}</small>
                                  <select value={parts.hour} onChange={(event) => updateScheduleTime(index, shiftIndex, field, "hour", event.target.value)} disabled={!row.active}>
                                    {HOURS_12.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                                  </select>
                                  <span>:</span>
                                  <select value={parts.minute} onChange={(event) => updateScheduleTime(index, shiftIndex, field, "minute", event.target.value)} disabled={!row.active}>
                                    {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                                  </select>
                                  <select value={parts.period} onChange={(event) => updateScheduleTime(index, shiftIndex, field, "period", event.target.value)} disabled={!row.active}>
                                    {PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            className="admin-hours-remove"
                            onClick={() => removeScheduleShift(index, shiftIndex)}
                            disabled={!row.active || row.shifts.length <= 1}
                            aria-label={`Quitar turno de ${row.day}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button type="button" className="admin-hours-add" onClick={() => addScheduleShift(index)} disabled={!row.active}>
                        + Agregar turno
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="admin-orders-stats">
        <article><span>!</span><div><small>Pendientes</small><strong>{stats.pendientes}</strong></div></article>
        <article><span>→</span><div><small>Activos</small><strong>{stats.activos}</strong></div></article>
        <article><span>✓</span><div><small>Cerrados</small><strong>{stats.cerrados}</strong></div></article>
        <button type="button" className="admin-hours-add" onClick={refreshOrders} disabled={ordersLoading}>
          {ordersLoading ? "Actualizando..." : "Actualizar pedidos"}
        </button>
      </div>

      <div className="admin-orders-list">
        {ordersError ? <p className="react-admin-error">{ordersError}</p> : null}
        {ordersLoading ? <p className="react-admin-loading-pill">Cargando pedidos...</p> : null}
        {!ordersLoading && orders.length === 0 ? <p className="react-admin-empty">No hay pedidos registrados.</p> : null}
        {renderPagination("top")}
        {paginatedOrders.map((order) => (
          <article key={order.id} className={`admin-order-card is-${order.status}`}>
            {(() => {
              const nextAction = nextActionFor(order.status);
              return (
                <>
            <div className="admin-order-main">
              <div className="admin-order-status" aria-hidden="true">{statusIcon(order.status)}</div>
              <header>
                <div>
                  <span>Código interno {order.id}</span>
                  <small>Código cliente/vendedor {order.publicCode || order.id}</small>
                  <h2>{order.customer}</h2>
                  <p>{order.phone} · {order.address}</p>
                </div>
                <strong>{money(order.total)}</strong>
              </header>
            </div>

            <div className="admin-order-meta">
              <span className={`is-status is-${order.status}`}>{statusLabel(order.status)}</span>
              <span>{order.payment}</span>
              <span>{order.modeLabel}</span>
              <span>{order.items.join(" + ")}</span>
            </div>
            {order.mode === "delivery" ? (
              <div className={`admin-order-delivery-finance ${order.deliveryCost === null ? "is-pending" : ""}`}>
                <div>
                  <small>Delivery cobrado</small>
                  <strong>{money(order.shipping)}</strong>
                </div>
                <div>
                  <small>Delivery pagado</small>
                  <strong>{order.deliveryCost === null ? "Pendiente" : money(order.deliveryCost)}</strong>
                </div>
                <div>
                  <small>Ganancia delivery</small>
                  <strong className={Number(order.deliveryProfit || 0) < 0 ? "is-negative" : "is-positive"}>
                    {order.deliveryCost === null ? "Pendiente" : money(order.deliveryProfit)}
                  </strong>
                </div>
                <button type="button" onClick={() => openDeliveryFinance(order)} disabled={updatingOrderId === order.id}>
                  {order.deliveryCost === null ? "Registrar costo" : "Editar costo"}
                </button>
              </div>
            ) : null}
            {order.reason ? <p className="admin-order-reason">Motivo: {order.reason}</p> : null}

            <div className="admin-order-flow">
              {nextAction ? (
                <button
                  type="button"
                  className={`admin-order-next is-${nextAction.status}`}
                  title={nextAction.title}
                  disabled={updatingOrderId === order.id}
                  aria-busy={updatingOrderId === order.id ? "true" : "false"}
                  onClick={() => advanceOrderStatus(order)}
                >
                  <span aria-hidden="true">{updatingOrderId === order.id ? "…" : nextAction.icon}</span>
                  {updatingOrderId === order.id ? "Actualizando..." : nextAction.label}
                </button>
              ) : (
                <span className="admin-order-complete">{statusLabel(order.status)}</span>
              )}

              <div className="admin-order-decision">
                <label className="is-cancel">
                  <span>Cancelacion</span>
                  <select value={reasonDraft[`${order.id}:cancel`] || ""} onChange={(event) => setReason(order.id, "cancel", event.target.value)}>
                    <option value="">Motivo</option>
                    {CANCEL_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                  <button type="button" className="is-danger" disabled={updatingOrderId === order.id} onClick={() => {
                    const reason = applyReason(order.id, "cancel", "Cliente no recepciona");
                    updateOrder(order.id, {
                      status: "cancelado",
                      reason
                    });
                    applyOperationalClosure(reason);
                  }}>
                    Cancelar
                  </button>
                </label>
              </div>
            </div>
                </>
              );
            })()}
          </article>
        ))}
        {renderPagination("bottom")}
      </div>
      {deliveryFinanceOrder ? (
        <div className="react-admin-modal-backdrop admin-delivery-finance-backdrop" role="dialog" aria-modal="true" aria-label="Costo real de delivery">
          <form className="admin-delivery-finance-modal" onSubmit={submitDeliveryFinance}>
            <div className="admin-delivery-finance-head">
              <div>
                <span>Delivery real</span>
                <h2>{deliveryFinanceIntent === "send" ? "Enviar pedido" : "Editar costo"}</h2>
                <p>Pedido {deliveryFinanceOrder.publicCode || deliveryFinanceOrder.id} · {deliveryFinanceOrder.customer}</p>
              </div>
              <button type="button" onClick={closeDeliveryFinance} aria-label="Cerrar">×</button>
            </div>
            <div className="admin-delivery-finance-summary">
              <div>
                <small>Cobrado al cliente</small>
                <strong>{money(deliveryFinanceOrder.shipping)}</strong>
              </div>
              <div>
                <small>Ganancia</small>
                <strong className={(Number(deliveryFinanceOrder.shipping || 0) - (parseMoneyInput(deliveryFinanceForm.cost) || 0)) < 0 ? "is-negative" : "is-positive"}>
                  {Number.isFinite(parseMoneyInput(deliveryFinanceForm.cost))
                    ? money(Number(deliveryFinanceOrder.shipping || 0) - parseMoneyInput(deliveryFinanceForm.cost))
                    : money(deliveryFinanceOrder.shipping)}
                </strong>
              </div>
            </div>
            <label>
              <span>Costo real pagado por delivery</span>
              <input
                type="number"
                min="0"
                step="0.10"
                inputMode="decimal"
                value={deliveryFinanceForm.cost}
                onChange={(event) => setDeliveryFinanceForm((current) => ({ ...current, cost: event.target.value }))}
                autoFocus
                required
              />
            </label>
            <label>
              <span>Nota opcional</span>
              <textarea
                rows={3}
                value={deliveryFinanceForm.note}
                onChange={(event) => setDeliveryFinanceForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Repartidor, app, comprobante u observacion"
              />
            </label>
            {deliveryFinanceError ? <p className="react-admin-error">{deliveryFinanceError}</p> : null}
            <div className="admin-delivery-finance-actions">
              <button type="button" onClick={closeDeliveryFinance} disabled={Boolean(updatingOrderId)}>Cancelar</button>
              <button type="submit" disabled={Boolean(updatingOrderId)}>
                {updatingOrderId ? "Guardando..." : deliveryFinanceIntent === "send" ? "Guardar y enviar" : "Guardar costo"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
