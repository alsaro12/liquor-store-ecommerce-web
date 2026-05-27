import { useEffect, useMemo, useState } from "react";
import { loadPromos } from "../promosApi.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function Countdown({ venceAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!venceAt) return null;
  const target = new Date(venceAt).getTime();
  const remaining = formatRemaining(target - now);
  if (!remaining) return <span className="promo-countdown is-ended">Finalizada</span>;
  return <span className="promo-countdown">termina en {remaining}</span>;
}

export default function PromosPage({ onGoCatalog, productsByCategoria }) {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("TODAS");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPromos()
      .then((items) => {
        if (cancelled) return;
        setPromos(Array.isArray(items) ? items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "No se pudieron cargar las promociones.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    for (const p of promos) if (p.categoria) set.add(p.categoria);
    return ["TODAS", ...Array.from(set)];
  }, [promos]);

  const destacada = promos.find((p) => p.destacada);
  const visible = useMemo(() => {
    return promos.filter((p) => filter === "TODAS" || p.categoria === filter);
  }, [promos, filter]);

  const porCategoria = visible.filter((p) => !p.destacada);
  const tiempoLimitado = visible
    .filter((p) => p.venceAt && new Date(p.venceAt).getTime() - Date.now() < 1000 * 60 * 60 * 48)
    .slice(0, 6);

  function renderHero() {
    if (!destacada) return null;
    return (
      <section className="promo-hero">
        <div className="promo-hero-copy">
          {destacada.badge ? <span className="promo-hero-badge">{destacada.badge}</span> : null}
          <h2>{destacada.titulo}</h2>
          {destacada.subtitulo ? <p>{destacada.subtitulo}</p> : null}
          <Countdown venceAt={destacada.venceAt} />
          <button type="button" className="promo-hero-cta" onClick={onGoCatalog}>VER OFERTA</button>
        </div>
        <div className="promo-hero-bottle" aria-hidden="true">🍻</div>
      </section>
    );
  }

  return (
    <section className="page-shell page-promos">
      <header className="page-head">
        <h1>PROMOS QUE VALEN MÁS</h1>
        <p>Aprovecha ofertas exclusivas por tiempo limitado y ahorra más en tus favoritos.</p>
      </header>

      {loading ? (
        <p className="page-status">Cargando promos...</p>
      ) : error ? (
        <p className="page-status page-status-error">{error}</p>
      ) : promos.length === 0 ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">🎉</div>
          <h3>No hay promos activas</h3>
          <p>Vuelve pronto, las ofertas se renuevan seguido.</p>
          <button type="button" className="page-cta" onClick={onGoCatalog}>Ir al catálogo</button>
        </div>
      ) : (
        <>
          {renderHero()}

          <div className="page-tabs page-tabs-wrap" role="tablist">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={filter === cat}
                className={filter === cat ? "is-active" : ""}
                onClick={() => setFilter(cat)}
              >
                {cat === "TODAS" ? "Todas" : cat}
              </button>
            ))}
          </div>

          <div className="promo-section">
            <h3 className="promo-section-title">Promos por categoría</h3>
            <div className="promo-grid">
              {porCategoria.length === 0 ? (
                <p className="page-status">No hay promos en esta categoría.</p>
              ) : porCategoria.map((promo) => (
                <article key={promo.id} className="promo-card">
                  {promo.descuentoPct ? <span className="promo-card-pct">-{promo.descuentoPct}%</span> : null}
                  <div className="promo-card-image" aria-hidden="true">
                    {promo.categoria === "CERVEZA" ? "🍺"
                      : promo.categoria === "RON" ? "🥃"
                      : promo.categoria === "WHISKY" ? "🥃"
                      : promo.categoria === "VODKA" ? "🍸"
                      : promo.categoria === "GIN" ? "🍹"
                      : promo.categoria === "VINO" ? "🍷"
                      : promo.categoria === "TEQUILA" ? "🌵"
                      : "🍾"}
                  </div>
                  <div className="promo-card-body">
                    <small>{promo.categoria || "PROMO"}</small>
                    <strong>{promo.titulo}</strong>
                    {promo.subtitulo ? <p>{promo.subtitulo}</p> : null}
                    <Countdown venceAt={promo.venceAt} />
                    <button type="button" className="promo-card-cta" onClick={onGoCatalog}>VER PROMOS</button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {tiempoLimitado.length > 0 ? (
            <div className="promo-section">
              <h3 className="promo-section-title">Ofertas por tiempo limitado</h3>
              <div className="promo-grid promo-grid-compact">
                {tiempoLimitado.map((promo) => (
                  <article key={`tl-${promo.id}`} className="promo-card-compact">
                    {promo.badge ? <span className="promo-card-tag">{promo.badge}</span> : null}
                    <strong>{promo.titulo}</strong>
                    {promo.precioAntes ? <span className="promo-card-old">{formatMoney(promo.precioAntes)}</span> : null}
                    {promo.precio ? <b>{formatMoney(promo.precio)}</b> : null}
                    <Countdown venceAt={promo.venceAt} />
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
