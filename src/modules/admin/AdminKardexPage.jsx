import React, { useMemo, useState } from "react";
import { deleteAllKardexMovements, deleteKardexMovement } from "./adminApi.js";
import {
  buildOperationalRange,
  formatDateTime,
  formatQty,
  formatTurnLabel,
  getTodayOperationalDate,
  getTurnName,
  normalizeText,
  parseDateTime
} from "./adminRules.js";

function kardexMatchesQuery(item, search) {
  if (!search) return true;
  const term = normalizeText(search);
  return [
    item?.["N°"],
    item?.NOMBRE,
    item?.REFERENCIA,
    item?.NOTA,
    item?.TIPO,
    getTurnName(item?.FECHA_HORA)
  ].some((value) => normalizeText(value).includes(term));
}

export default function AdminKardexPage({ kardex = [], loading = false, onRefresh }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("TODOS");
  const [fromDate, setFromDate] = useState(getTodayOperationalDate());
  const [toDate, setToDate] = useState(getTodayOperationalDate());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const filteredItems = useMemo(() => {
    const range = buildOperationalRange(fromDate, toDate);
    return kardex
      .filter((item) => {
        if (!range) return true;
        const movementDate = parseDateTime(item?.FECHA_HORA);
        return movementDate && movementDate >= range.start && movementDate <= range.end;
      })
      .filter((item) => typeFilter === "TODOS" || String(item?.TIPO || "").toUpperCase() === typeFilter)
      .filter((item) => kardexMatchesQuery(item, search))
      .sort((left, right) => {
        const leftDate = parseDateTime(left?.FECHA_HORA);
        const rightDate = parseDateTime(right?.FECHA_HORA);
        return (rightDate?.getTime() || 0) - (leftDate?.getTime() || 0);
      });
  }, [kardex, fromDate, toDate, typeFilter, search]);

  const summary = useMemo(() => {
    const ingress = filteredItems
      .filter((item) => String(item?.TIPO || "").toUpperCase() === "INGRESO")
      .reduce((acc, item) => acc + Number(item?.CANTIDAD || 0), 0);
    const egress = filteredItems
      .filter((item) => String(item?.TIPO || "").toUpperCase() === "SALIDA")
      .reduce((acc, item) => acc + Number(item?.CANTIDAD || 0), 0);
    const productCount = new Set(filteredItems.map((item) => String(item?.["N°"] ?? ""))).size;
    return {
      movements: filteredItems.length,
      ingress,
      egress,
      productCount
    };
  }, [filteredItems]);

  async function handleDelete(item) {
    if (!window.confirm(`Eliminar movimiento kardex #${item?.ID_MOV}?`)) return;
    setBusyId(String(item?.ID_MOV || ""));
    setError("");
    setMessage("");
    try {
      await deleteKardexMovement(item?.ID_MOV);
      setMessage(`Movimiento #${item?.ID_MOV} eliminado.`);
      await onRefresh?.();
    } catch (err) {
      setError(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setBusyId("");
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm("Eliminar todos los movimientos de kardex? Esta accion es sensible.")) return;
    setBusyId("ALL");
    setError("");
    setMessage("");
    try {
      const result = await deleteAllKardexMovements();
      setMessage(`Kardex limpiado. ${Number(result?.deletedCount || 0)} movimiento(s) eliminados.`);
      await onRefresh?.();
    } catch (err) {
      setError(err.message || "No se pudo limpiar el kardex.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="react-admin-kardex-page">
      {(message || error) ? (
        <p className={error ? "react-admin-error" : "react-admin-message"}>{error || message}</p>
      ) : null}

      <div className="react-admin-kpis">
        <article className="react-admin-kpi react-admin-kpi-primary">
          <span>Movimientos</span>
          <strong>{formatQty(summary.movements)}</strong>
          <small>En el turno filtrado</small>
        </article>
        <article className="react-admin-kpi">
          <span>Ingresos</span>
          <strong>{formatQty(summary.ingress)}</strong>
          <small>Unidades repuestas</small>
        </article>
        <article className="react-admin-kpi">
          <span>Salidas</span>
          <strong>{formatQty(summary.egress)}</strong>
          <small>Unidades movidas</small>
        </article>
        <article className="react-admin-kpi">
          <span>Productos</span>
          <strong>{formatQty(summary.productCount)}</strong>
          <small>Con movimiento</small>
        </article>
      </div>

      <article className="react-admin-filter-card">
        <div className="react-admin-filter-head">
          <div>
            <span className="react-admin-filter-kicker">Filtro operativo</span>
            <h2>Kardex por turno</h2>
          </div>
          <div className="react-admin-pagination">
            <button
              type="button"
              onClick={() => {
                const today = getTodayOperationalDate();
                setFromDate(today);
                setToDate(today);
              }}
            >
              Hoy
            </button>
            <button type="button" className="is-danger" disabled={busyId === "ALL"} onClick={handleDeleteAll}>
              {busyId === "ALL" ? "Limpiando..." : "Limpiar kardex"}
            </button>
          </div>
        </div>
        <div className="react-admin-filter-grid is-kardex">
          <label>
            Turno desde
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <small>{formatTurnLabel(fromDate)}</small>
          </label>
          <label>
            Turno hasta
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            <small>{formatTurnLabel(toDate)}</small>
          </label>
          <label className="react-admin-inline-select">
            Tipo
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="TODOS">Todos</option>
              <option value="INGRESO">Ingreso</option>
              <option value="SALIDA">Salida</option>
            </select>
          </label>
          <label className="react-admin-filter-search">
            Buscar
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="N°, nombre, referencia o nota"
            />
          </label>
        </div>
      </article>

      <article className="react-admin-table-card">
        <div className="react-admin-table-head">
          <div>
            <h2>Historial de movimientos</h2>
            <small>{loading ? "Actualizando kardex..." : `${filteredItems.length} registros visibles`}</small>
          </div>
        </div>
        <div className="react-admin-table-wrap">
          <table className="react-admin-table">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Fecha/hora</th>
                <th>N°</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Cantidad</th>
                <th>Antes</th>
                <th>Despues</th>
                <th>Referencia</th>
                <th>Nota</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <tr key={item?.ID_MOV}>
                    <td>{getTurnName(item?.FECHA_HORA)}</td>
                    <td>{formatDateTime(item?.FECHA_HORA)}</td>
                    <td>{String(item?.["N°"] ?? "-")}</td>
                    <td>{String(item?.NOMBRE || "-")}</td>
                    <td>
                      <span className={`react-admin-tag react-admin-tag-${String(item?.TIPO || "").toUpperCase() === "INGRESO" ? "ok" : "low"}`}>
                        {String(item?.TIPO || "-")}
                      </span>
                    </td>
                    <td>{formatQty(item?.CANTIDAD || 0)}</td>
                    <td>{formatQty(item?.STOCK_ANTES || 0)}</td>
                    <td>{formatQty(item?.STOCK_DESPUES || 0)}</td>
                    <td>{String(item?.REFERENCIA || "-")}</td>
                    <td>{String(item?.NOTA || "-")}</td>
                    <td>
                      <div className="react-admin-actions">
                        <button
                          type="button"
                          className="is-danger"
                          disabled={busyId === String(item?.ID_MOV)}
                          onClick={() => handleDelete(item)}
                        >
                          {busyId === String(item?.ID_MOV) ? "Eliminando..." : "Eliminar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="11">No hay movimientos para este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
