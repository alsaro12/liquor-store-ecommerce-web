import React, { useEffect, useMemo, useState } from "react";
import { loadOpinionesAll, updateOpinionStatus } from "./adminApi.js";

const FILTERS = [
  { key: "", label: "Todas" },
  { key: "nueva", label: "Nuevas" },
  { key: "revisada", label: "Revisadas" },
  { key: "archivada", label: "Archivadas" }
];

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function statusLabel(value) {
  return {
    nueva: "Nueva",
    revisada: "Revisada",
    archivada: "Archivada"
  }[value] || value || "Nueva";
}

function sortOpiniones(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    if (left.status === "nueva" && right.status !== "nueva") return -1;
    if (left.status !== "nueva" && right.status === "nueva") return 1;
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  });
}

export default function AdminOpinionesPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");

  async function refreshOpiniones(nextFilter = filter) {
    setLoading(true);
    setError("");
    try {
      const data = await loadOpinionesAll(nextFilter);
      setItems(sortOpiniones(Array.isArray(data) ? data : []));
    } catch (err) {
      setError(err?.message || "No se pudieron cargar las opiniones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshOpiniones(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      },
      { total: 0, nueva: 0, revisada: 0, archivada: 0 }
    );
  }, [items]);

  async function changeStatus(item, status) {
    setUpdatingId(item.id);
    setError("");
    try {
      await updateOpinionStatus(item.id, status);
      await refreshOpiniones(filter);
    } catch (err) {
      setError(err?.message || "No se pudo actualizar la opinión.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <section className="react-admin-opiniones-page">
      <div className="react-admin-table-card admin-opiniones-card">
        <div className="react-admin-table-head">
          <div>
            <span>Feedback</span>
            <h2>Opiniones de usuarios</h2>
            <small>Comentarios enviados desde la cuenta del cliente.</small>
          </div>
          <button type="button" className="react-admin-link" onClick={() => refreshOpiniones(filter)} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        <div className="admin-opiniones-filters" role="tablist" aria-label="Filtrar opiniones">
          {FILTERS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={filter === item.key ? "is-active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="admin-opiniones-summary" aria-label="Resumen de opiniones">
          <span>Total: {totals.total}</span>
          <span>Nuevas: {totals.nueva}</span>
          <span>Revisadas: {totals.revisada}</span>
          <span>Archivadas: {totals.archivada}</span>
        </div>

        {error ? <p className="react-admin-error">{error}</p> : null}

        <div className="react-admin-table-wrap">
          <table className="react-admin-table admin-opiniones-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Comentario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <span className={`admin-opinion-status is-${item.status}`}>{statusLabel(item.status)}</span>
                  </td>
                  <td>{item.nombre || item.usuarioId || "Cliente"}</td>
                  <td>{item.email || "Sin email"}</td>
                  <td>{item.telefono || "Sin teléfono"}</td>
                  <td className="admin-opinion-comment">{item.comentario}</td>
                  <td>
                    <div className="admin-opiniones-row-actions">
                      <button
                        type="button"
                        onClick={() => changeStatus(item, "revisada")}
                        disabled={updatingId === item.id || item.status === "revisada"}
                      >
                        Revisada
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => changeStatus(item, "archivada")}
                        disabled={updatingId === item.id || item.status === "archivada"}
                      >
                        Archivar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={7}>{loading ? "Cargando opiniones..." : "Aún no hay opiniones para mostrar."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
