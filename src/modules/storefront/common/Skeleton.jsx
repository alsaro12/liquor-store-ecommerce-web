import React from "react";
export function SkeletonBlock({ width = "100%", height = 14, radius = 8, style = {} }) {
  return (
    <span
      className="skeleton-block"
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonOrderCards({ count = 3 }) {
  return (
    <ul className="page-order-list" aria-busy="true" aria-label="Cargando pedidos">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="page-order-card is-skeleton">
          <div className="page-order-hero">
            <span className="skeleton-block" style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="page-order-body">
            <SkeletonBlock width={80} height={18} radius={999} />
            <div style={{ marginTop: 8 }}><SkeletonBlock width="60%" /></div>
            <div style={{ marginTop: 6 }}><SkeletonBlock width="40%" height={10} /></div>
            <div style={{ marginTop: 10 }}><SkeletonBlock width="70%" height={10} /></div>
            <div style={{ marginTop: 4 }}><SkeletonBlock width="55%" height={10} /></div>
          </div>
          <div className="page-order-side">
            <SkeletonBlock width={60} height={10} />
            <div style={{ marginTop: 4 }}><SkeletonBlock width={90} height={24} /></div>
            <div style={{ marginTop: 8 }}><SkeletonBlock width={140} height={36} /></div>
            <div style={{ marginTop: 6 }}><SkeletonBlock width={140} height={36} /></div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SkeletonCardGrid({ count = 6 }) {
  return (
    <div className="favorite-grid" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="favorite-card is-skeleton">
          <SkeletonBlock width="100%" height={140} radius={14} />
          <div style={{ marginTop: 10 }}><SkeletonBlock width="50%" height={10} /></div>
          <div style={{ marginTop: 6 }}><SkeletonBlock width="80%" height={14} /></div>
          <div style={{ marginTop: 6 }}><SkeletonBlock width="40%" height={18} /></div>
          <div style={{ marginTop: 10 }}><SkeletonBlock width="100%" height={36} radius={10} /></div>
        </article>
      ))}
    </div>
  );
}

export function SkeletonAddressCards({ count = 2 }) {
  return (
    <div className="direcciones-grid" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="direccion-card is-skeleton">
          <div className="direccion-card-icon"><span className="skeleton-block" style={{ width: "100%", height: "100%", borderRadius: 12 }} /></div>
          <div>
            <SkeletonBlock width={120} height={14} />
            <div style={{ marginTop: 6 }}><SkeletonBlock width="90%" height={12} /></div>
            <div style={{ marginTop: 4 }}><SkeletonBlock width="60%" height={10} /></div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 4 }) {
  return (
    <ul className="notif-list" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="notif-item is-skeleton">
          <div className="notif-item-btn">
            <div className="notif-item-icon"><span className="skeleton-block" style={{ width: 28, height: 28, borderRadius: 8 }} /></div>
            <div>
              <SkeletonBlock width="50%" height={12} />
              <div style={{ marginTop: 6 }}><SkeletonBlock width="90%" height={10} /></div>
            </div>
            <SkeletonBlock width={60} height={10} />
          </div>
        </li>
      ))}
    </ul>
  );
}
