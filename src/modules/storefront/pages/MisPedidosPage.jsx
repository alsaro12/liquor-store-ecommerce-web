import { useEffect, useState } from "react";
import { fetchMyOrders, repeatMyOrder } from "../pedidosApi.js";
import { resolveProductImage } from "../storefrontApi.js";
import { SkeletonOrderCards } from "../common/Skeleton.jsx";

const TABS = [
  { key: "todos", label: "Todos" },
  { key: "pendientes", label: "Pendientes" },
  { key: "en_camino", label: "En camino" },
  { key: "entregados", label: "Entregados" },
  { key: "cancelados", label: "Cancelados" }
];

const STATUS_BADGES = {
  PENDIENTE: { label: "Confirmado", tone: "yellow" },
  EN_CAMINO: { label: "En camino", tone: "blue" },
  "EN CAMINO": { label: "En camino", tone: "blue" },
  ENVIADO: { label: "Enviado", tone: "blue" },
  ENTREGADO: { label: "Entregado", tone: "green" },
  COMPLETADO: { label: "Entregado", tone: "green" },
  CANCELADO: { label: "Cancelado", tone: "red" }
};

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

export default function MisPedidosPage({ onRepeat, onGoCatalog, productsMap }) {
  const [filter, setFilter] = useState("todos");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchMyOrders(filter)
      .then((items) => {
        if (cancelled) return;
        setOrders(Array.isArray(items) ? items : []);
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

  async function handleRepeat(order) {
    try {
      const result = await repeatMyOrder(order.id);
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
              STATUS_BADGES[String(order.status || "").toUpperCase()] ||
              { label: order.status || "Desconocido", tone: "neutral" };

            let heroHash = "";
            for (const item of order.items || []) {
              if (item.imageHash) { heroHash = item.imageHash; break; }
              const fromCatalog = productsMap?.get?.(String(item.productId || ""))?.imageHash;
              if (fromCatalog) { heroHash = fromCatalog; break; }
            }
            const heroImage = heroHash ? resolveProductImage({ imageHash: heroHash }) : "";

            return (
              <li key={order.id} className="page-order-card">
                <div className="page-order-hero">
                  {heroImage ? (
                    <img src={heroImage} alt="" loading="lazy" />
                  ) : (
                    <svg viewBox="0 0 24 24" width="38" height="38" fill="none" aria-hidden="true">
                      <path d="M5 7h14l-1.2 11.1a2 2 0 0 1-2 1.7H8.2a2 2 0 0 1-2-1.7L5 7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                      <path d="M9 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>
                <div className="page-order-body">
                  <div className="page-order-meta">
                    <span className={`page-order-badge tone-${badge.tone}`}>{badge.label}</span>
                    <span className="page-order-code">Pedido #{order.id}</span>
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
                </div>
                <div className="page-order-side">
                  <p className="page-order-total-label">Total</p>
                  <p className="page-order-total">{formatMoney(order.total)}</p>
                  <button type="button" className="page-order-btn primary">
                    Ver detalle
                  </button>
                  <button type="button" className="page-order-btn" onClick={() => handleRepeat(order)}>
                    Pedir de nuevo
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
