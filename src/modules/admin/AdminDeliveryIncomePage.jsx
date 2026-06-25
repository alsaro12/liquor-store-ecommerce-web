import React, { useEffect, useMemo, useState } from "react";
import { loadOrdersAll } from "./adminApi.js";

const ACTIVE_TOTAL_STATUSES = new Set(["EN_CAMINO", "ENTREGADO"]);
const STATUS_OPTIONS = [
  { value: "operativos", label: "En camino + entregados" },
  { value: "todos", label: "Todos" },
  { value: "EN_CAMINO", label: "En camino" },
  { value: "ENTREGADO", label: "Entregados" },
  { value: "CANCELADO", label: "Cancelados" },
  { value: "RECHAZADO", label: "Rechazados" }
];

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateValue(value) {
  const time = new Date(value || "").getTime();
  return Number.isNaN(time) ? 0 : time;
}

function statusLabel(status) {
  return {
    PENDIENTE: "Pendiente",
    VALIDADO: "Validado",
    EN_CAMINO: "En camino",
    ENTREGADO: "Entregado",
    CANCELADO: "Cancelado",
    RECHAZADO: "Rechazado"
  }[status] || status;
}

function normalizeOrder(order) {
  const customer = order?.customer || {};
  const status = String(order?.status || "PENDIENTE").toUpperCase();
  const shipping = Number(order?.shipping || 0);
  const hasCost = Number.isFinite(Number(order?.deliveryCost));
  const cost = hasCost ? Number(order.deliveryCost) : null;
  return {
    id: String(order?.id || ""),
    code: String(order?.publicCode || order?.customerCode || order?.id || ""),
    customer: customer.name || "Cliente",
    createdAt: order?.createdAt || "",
    status,
    shipping,
    deliveryCost: cost,
    deliveryProfit: hasCost ? Number(order?.deliveryProfit ?? shipping - cost) : null,
    deliveryFinanceNote: order?.deliveryFinanceNote || ""
  };
}

export default function AdminDeliveryIncomePage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month");
  const [statusFilter, setStatusFilter] = useState("operativos");
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const items = await loadOrdersAll();
      setOrders((Array.isArray(items) ? items : [])
        .filter((order) => String(order?.mode || "").toLowerCase() === "delivery")
        .map(normalizeOrder)
        .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt)));
    } catch (err) {
      setError(err?.message || "No se pudieron cargar los ingresos delivery.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function setQuickPeriod(nextPeriod) {
    const now = new Date();
    const start = new Date(now);
    if (nextPeriod === "today") {
      setFromDate(toInputDate(now));
      setToDate(toInputDate(now));
    } else if (nextPeriod === "week") {
      const day = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - day);
      setFromDate(toInputDate(start));
      setToDate(toInputDate(now));
    } else if (nextPeriod === "month") {
      setFromDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
      setToDate(toInputDate(now));
    }
    setPeriod(nextPeriod);
  }

  const filteredOrders = useMemo(() => {
    const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
    const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return orders.filter((order) => {
      const created = dateValue(order.createdAt);
      if (created && (created < fromTime || created > toTime)) return false;
      if (statusFilter === "todos") return true;
      if (statusFilter === "operativos") return ACTIVE_TOTAL_STATUSES.has(order.status);
      return order.status === statusFilter;
    });
  }, [fromDate, orders, statusFilter, toDate]);

  const totals = useMemo(() => filteredOrders.reduce((acc, order) => {
    const hasCost = Number.isFinite(Number(order.deliveryCost));
    acc.charged += Number(order.shipping || 0);
    if (hasCost) {
      acc.paid += Number(order.deliveryCost || 0);
      acc.profit += Number(order.deliveryProfit || 0);
      acc.withCost += 1;
    } else {
      acc.pending += 1;
    }
    return acc;
  }, { charged: 0, paid: 0, profit: 0, withCost: 0, pending: 0 }), [filteredOrders]);

  return (
    <section className="react-admin-delivery-income-page">
      <div className="react-admin-table-card admin-delivery-income-card">
        <div className="react-admin-table-head">
          <div>
            <small>Margen de delivery</small>
            <h2>Ingresos delivery</h2>
          </div>
          <button type="button" className="react-admin-link react-admin-link-soft" onClick={refresh} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        <div className="admin-delivery-income-filters">
          <div className="admin-delivery-income-segment">
            {[
              ["today", "Hoy"],
              ["week", "Semana"],
              ["month", "Mes"],
              ["custom", "Rango"]
            ].map(([key, label]) => (
              <button key={key} type="button" className={period === key ? "is-active" : ""} onClick={() => setQuickPeriod(key)}>
                {label}
              </button>
            ))}
          </div>
          <label>
            <span>Desde</span>
            <input type="date" value={fromDate} onChange={(event) => { setPeriod("custom"); setFromDate(event.target.value); }} />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={toDate} onChange={(event) => { setPeriod("custom"); setToDate(event.target.value); }} />
          </label>
          <label>
            <span>Estado</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="admin-delivery-income-summary">
          <article><span>Cobrado</span><strong>{money(totals.charged)}</strong></article>
          <article><span>Pagado</span><strong>{money(totals.paid)}</strong></article>
          <article className={totals.profit < 0 ? "is-negative" : "is-positive"}><span>Ganancia neta</span><strong>{money(totals.profit)}</strong></article>
          <article><span>Con costo</span><strong>{totals.withCost}</strong></article>
          <article><span>Pendientes</span><strong>{totals.pending}</strong></article>
        </div>

        {error ? <p className="react-admin-error">{error}</p> : null}
        {loading ? <p className="react-admin-loading-pill">Cargando ingresos delivery...</p> : null}
        {!loading && filteredOrders.length === 0 ? <p className="react-admin-empty">No hay pedidos delivery en este filtro.</p> : null}

        <div className="react-admin-table-wrap">
          <table className="react-admin-table admin-delivery-income-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Cobrado</th>
                <th>Pagado</th>
                <th>Ganancia</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.code || order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.createdAt || "-"}</td>
                  <td>{statusLabel(order.status)}</td>
                  <td>{money(order.shipping)}</td>
                  <td>{order.deliveryCost === null ? "Pendiente" : money(order.deliveryCost)}</td>
                  <td className={Number(order.deliveryProfit || 0) < 0 ? "is-negative" : "is-positive"}>
                    {order.deliveryCost === null ? "Pendiente" : money(order.deliveryProfit)}
                  </td>
                  <td>{order.deliveryFinanceNote || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
