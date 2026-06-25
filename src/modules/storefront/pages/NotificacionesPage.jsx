import React, { useEffect, useMemo, useState } from "react";
import {
  leerNotificacion,
  leerTodasNotificaciones,
  listNotificaciones
} from "../notificacionesApi.js";
import { SkeletonRows } from "../common/Skeleton.jsx";

const TABS = [
  { key: "", label: "Todas" },
  { key: "pedido", label: "Pedidos" },
  { key: "club", label: "Club" }
];

const TIPO_META = {
  pedido: { emoji: "📦", color: "#1c4593", bg: "#d8e8ff", tone: "pedido" },
  club: { emoji: "🏆", color: "#8a5a06", bg: "#fff3d2", tone: "club" },
  sistema: { emoji: "ℹ️", color: "#5b3c1a", bg: "#ece4d4", tone: "sistema" }
};

const ICONO_META = {
  pedido_confirmado: { emoji: "🧾", color: "#7a4b12", bg: "#fff0c7", tone: "confirmado" },
  pago_aprobado: { emoji: "💸", color: "#166534", bg: "#dff8df", tone: "pago" },
  pedido_camino: { emoji: "🛵", color: "#075985", bg: "#d9f0ff", tone: "camino" },
  pedido_entregado: { emoji: "✓", color: "#276749", bg: "#d9f7e7", tone: "entregado" },
  pedido_cancelado: { emoji: "!", color: "#b42318", bg: "#ffe1dc", tone: "cancelado" },
  pago_rechazado: { emoji: "!", color: "#b42318", bg: "#ffe1dc", tone: "cancelado" },
  club_ganador: { emoji: "🏆", color: "#8a4f00", bg: "#fff1bd", tone: "club" },
  club: { emoji: "🎟", color: "#8a5a06", bg: "#fff3d2", tone: "club" }
};

function timeAgo(iso) {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const diff = Date.now() - target;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Justo ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} día${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `Hace ${weeks} sem`;
  const months = Math.floor(days / 30);
  return `Hace ${months} mes${months === 1 ? "" : "es"}`;
}

export default function NotificacionesPage({ onUnreadChange, onNavigate, showClub = false }) {
  const [tab, setTab] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const requestTab = tab === "club" && !showClub ? "" : tab;
      const list = await listNotificaciones({ tipo: requestTab });
      const visible = showClub ? list : (Array.isArray(list) ? list.filter((item) => item?.tipo !== "club") : []);
      setItems(Array.isArray(visible) ? visible : []);
    } catch (err) {
      setError(err?.message || "No se pudieron cargar las notificaciones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, showClub]);

  useEffect(() => {
    if (tab === "club" && !showClub) setTab("");
  }, [showClub, tab]);

  const unreadCount = useMemo(() => items.filter((it) => !it.leida).length, [items]);
  const newer = items.filter((it) => !it.leida);
  const older = items.filter((it) => it.leida);

  async function handleMarkOne(item) {
    if (item.leida) return;
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, leida: true } : it)));
    try {
      await leerNotificacion(item.id);
      onUnreadChange?.();
    } catch {
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, leida: false } : it)));
    }
  }

  async function handleMarkAll() {
    if (!unreadCount) return;
    setItems((prev) => prev.map((it) => ({ ...it, leida: true })));
    try {
      await leerTodasNotificaciones();
      onUnreadChange?.();
    } catch (err) {
      setError(err?.message || "No se pudo marcar como leídas.");
      refresh();
    }
  }

  function handleClick(item) {
    if (!item.leida) handleMarkOne(item);
    if (item.link && item.link.startsWith("/")) {
      onNavigate?.(item.link.replace(/^\//, ""));
    }
  }

  function renderItem(item) {
    const meta = ICONO_META[item.icono] || TIPO_META[item.tipo] || TIPO_META.sistema;
    const toneClass = ` notif-tone-${meta.tone || "sistema"}`;
    return (
      <li key={item.id} className={`notif-item${toneClass}${item.leida ? "" : " is-unread"}`}>
        <button type="button" className="notif-item-btn" onClick={() => handleClick(item)}>
          <div className="notif-item-icon" style={{ background: meta.bg, color: meta.color }}>
            <span aria-hidden="true">{meta.emoji}</span>
          </div>
          <div className="notif-item-body">
            <strong>{item.titulo}</strong>
            {item.mensaje ? <p>{item.mensaje}</p> : null}
          </div>
          <div className="notif-item-side">
            <time>{timeAgo(item.created_at)}</time>
            {!item.leida ? <span className="notif-dot" aria-hidden="true" /> : null}
          </div>
        </button>
      </li>
    );
  }

  return (
    <section className="page-shell">
      <header className="page-head page-head-row">
        <div>
          <h1>NOTIFICACIONES</h1>
          <p>Mantente al tanto de tus pedidos, pagos y novedades del club.</p>
        </div>
        {unreadCount ? (
          <button type="button" className="checkout-secondary" onClick={handleMarkAll}>
            Marcar todas como leídas
          </button>
        ) : null}
      </header>

      <div className="page-tabs" role="tablist">
        {TABS.filter((it) => showClub || it.key !== "club").map((it) => (
          <button
            key={it.key || "todas"}
            type="button"
            role="tab"
            aria-selected={tab === it.key}
            className={tab === it.key ? "is-active" : ""}
            onClick={() => setTab(it.key)}
          >
            {it.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows count={5} />
      ) : error ? (
        <p className="page-status page-status-error">{error}</p>
      ) : items.length === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">🔔</div>
          <h3>Aún no tienes notificaciones</h3>
          <p>Cuando hagas un pedido o tengamos novedades verás aquí todo lo importante.</p>
        </div>
      ) : (
        <>
          {newer.length > 0 ? (
            <>
              <h3 className="notif-section-title">Nuevas</h3>
              <ul className="notif-list">{newer.map(renderItem)}</ul>
            </>
          ) : null}
          {older.length > 0 ? (
            <>
              <h3 className="notif-section-title">Anteriores</h3>
              <ul className="notif-list">{older.map(renderItem)}</ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
