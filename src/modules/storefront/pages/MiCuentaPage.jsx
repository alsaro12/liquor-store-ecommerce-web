import { useEffect, useState } from "react";
import { fetchCuentaResumen } from "../cuentaApi.js";
import { resolveProductImage } from "../storefrontApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }
  return String(iso);
}

const ICON_BY_TIPO = {
  casa: "🏠",
  trabajo: "🏢",
  playa: "🏖",
  amigo: "👥",
  otro: "📍"
};

export default function MiCuentaPage({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCuentaResumen()
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "No se pudo cargar tu cuenta.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="page-shell">
        <header className="page-head"><h1>MI CUENTA</h1></header>
        <p className="page-status">Cargando...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page-shell">
        <header className="page-head"><h1>MI CUENTA</h1></header>
        <p className="page-status page-status-error">{error}</p>
      </section>
    );
  }

  if (!data) return null;

  const { user, club, beneficios, ultimoPedido, favoritosTop, direccionesTop, invitacion } = data;

  return (
    <section className="page-shell mi-cuenta">
      <div className="cuenta-club-card">
        <div className="cuenta-club-head">
          <div className="cuenta-club-badge" style={{ background: club.color }}>{club.nivel.charAt(0)}</div>
          <div>
            <p className="cuenta-club-kicker">Tu nivel actual</p>
            <p className="cuenta-club-nivel">{club.nivel}</p>
            {club.siguiente ? (
              <p className="cuenta-club-meta">
                Te faltan <strong>{club.faltante} puntos</strong> para llegar a <strong>{club.siguiente}</strong>.
              </p>
            ) : (
              <p className="cuenta-club-meta">¡Eres miembro Oro! Disfruta todos los beneficios.</p>
            )}
          </div>
          <div className="cuenta-club-points">
            <span>Tus puntos</span>
            <b>{club.puntos}</b>
            <small>★</small>
          </div>
        </div>

        <div className="cuenta-club-progress" aria-label={`${Math.round(club.progreso * 100)}% al siguiente nivel`}>
          <div
            className="cuenta-club-progress-bar"
            style={{ width: `${Math.round(club.progreso * 100)}%`, background: club.color }}
          />
        </div>

        <button type="button" className="cuenta-club-cta" disabled title="Próximamente">
          Ver mis beneficios
        </button>
      </div>

      <div className="cuenta-grid">
        <article className="cuenta-card cuenta-pedido">
          <header>
            <h3>Tu último pedido</h3>
            <button type="button" className="cuenta-card-link" onClick={() => onNavigate?.("pedidos")}>Ver todos</button>
          </header>
          {ultimoPedido ? (
            <div className="cuenta-pedido-body">
              <div className="cuenta-pedido-thumb">
                {ultimoPedido.items?.[0]?.imageHash ? (
                  <img src={resolveProductImage({ imageHash: ultimoPedido.items[0].imageHash })} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden="true">📦</span>
                )}
              </div>
              <div>
                <small>{ultimoPedido.modeLabel} · {formatDate(ultimoPedido.createdAt)}</small>
                <strong>{ultimoPedido.id}</strong>
                <ul>
                  {ultimoPedido.items.map((it) => (
                    <li key={`${ultimoPedido.id}-${it.productId}`}>{it.quantity}× {it.name}</li>
                  ))}
                  {ultimoPedido.itemsCount > ultimoPedido.items.length ? (
                    <li className="cuenta-pedido-more">+ {ultimoPedido.itemsCount - ultimoPedido.items.length} más</li>
                  ) : null}
                </ul>
                <p className="cuenta-pedido-total">Total <b>{formatMoney(ultimoPedido.total)}</b></p>
              </div>
            </div>
          ) : (
            <div className="cuenta-empty">
              <p>Aún no tienes pedidos.</p>
              <button type="button" className="page-cta" onClick={() => onNavigate?.("")}>Ir al catálogo</button>
            </div>
          )}
        </article>

        <article className="cuenta-card cuenta-favoritos">
          <header>
            <h3>Tus favoritos</h3>
            <button type="button" className="cuenta-card-link" onClick={() => onNavigate?.("favoritos")}>Ver todos</button>
          </header>
          {favoritosTop.length === 0 ? (
            <div className="cuenta-empty">
              <p>Toca el corazón en tus productos para guardarlos aquí.</p>
            </div>
          ) : (
            <ul className="cuenta-favoritos-list">
              {favoritosTop.map((p) => {
                const img = p.imageHash ? resolveProductImage({ imageHash: p.imageHash }) : "";
                return (
                  <li key={p.id}>
                    <div className="cuenta-fav-thumb">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span>{(p.category || "?").slice(0, 1)}</span>}
                    </div>
                    <div>
                      <small>{p.category}</small>
                      <strong>{p.name}</strong>
                      <b>{formatMoney(p.price)}</b>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>

      <article className="cuenta-card cuenta-invita">
        <div>
          <p className="cuenta-invita-kicker">Invita y gana</p>
          <p className="cuenta-invita-text">
            <strong>S/ {invitacion?.descuentoAmigo || 10} de descuento</strong> para tu amigo.
            Tú sumas <strong>{invitacion?.premioPuntos || 300} puntos</strong>.
          </p>
        </div>
        <button type="button" className="cuenta-invita-cta" onClick={() => onNavigate?.("invitar")}>
          Invitar ahora
        </button>
      </article>

      <article className="cuenta-card">
        <header>
          <h3>Beneficios del Club</h3>
        </header>
        <div className="cuenta-beneficios">
          {beneficios.map((b) => (
            <div key={b.nivel} className={`cuenta-beneficio${club.nivel === b.nivel ? " is-active" : ""}`}>
              <div className="cuenta-beneficio-tag" style={{ background: b.color }}>{b.nivel}</div>
              <ul>
                {b.bullets.map((bul, i) => <li key={i}>{bul}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </article>

      <article className="cuenta-card cuenta-direcciones">
        <header>
          <h3>Direcciones</h3>
          <button type="button" className="cuenta-card-link" onClick={() => onNavigate?.("direcciones")}>Ver todas</button>
        </header>
        {direccionesTop.length === 0 ? (
          <div className="cuenta-empty">
            <p>Aún no tienes direcciones guardadas.</p>
            <button type="button" className="page-cta" onClick={() => onNavigate?.("direcciones")}>Agregar dirección</button>
          </div>
        ) : (
          <ul className="cuenta-direcciones-list">
            {direccionesTop.map((d) => (
              <li key={d.id}>
                <div className="cuenta-dir-icon">{ICON_BY_TIPO[d.icono] || "📍"}</div>
                <div>
                  <div className="cuenta-dir-head">
                    <strong>{d.etiqueta || "Sin etiqueta"}</strong>
                    {d.es_principal ? <span className="cuenta-dir-badge">Principal</span> : null}
                  </div>
                  <p>{d.direccion}</p>
                  <small>{[d.distrito, d.ciudad].filter(Boolean).join(" · ")}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
