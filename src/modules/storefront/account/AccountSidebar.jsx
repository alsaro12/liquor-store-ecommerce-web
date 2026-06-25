import React from "react";
const NAV = [
  { key: "cuenta", label: "Mi cuenta", shortLabel: "Cuenta", icon: "👤" },
  { key: "pedidos", label: "Mis pedidos", shortLabel: "Pedidos", icon: "📦" },
  { key: "favoritos", label: "Mis favoritos", shortLabel: "Favoritos", icon: "♡" },
  { key: "direcciones", label: "Mis direcciones", shortLabel: "Direcc.", icon: "⌖" },
  { key: "pagos", label: "Cómo pagar", shortLabel: "Pagos", icon: "💳" },
  { key: "notificaciones", label: "Notificaciones", shortLabel: "Avisos", icon: "🔔" }
];

function initialOf(user) {
  if (!user) return "?";
  return (user.nombre || user.telefono || user.email || "?").trim().charAt(0).toUpperCase() || "?";
}

function canSeeClub(user) {
  return ["admin", "staff"].includes(String(user?.rol || "").toLowerCase());
}

function canSeeAdmin(user) {
  return String(user?.rol || "").toLowerCase() === "admin";
}

export default function AccountSidebar({ active, user, onNavigate, onLogout, unreadCount = 0 }) {
  const clubAllowed = canSeeClub(user);
  const adminAllowed = canSeeAdmin(user);
  const navItems = adminAllowed
    ? [...NAV, { key: "admin", label: "Admin pedidos", shortLabel: "Admin", icon: "▦", admin: true }]
    : NAV;

  return (
    <aside className="account-sidebar">
      <div className="account-sidebar-user">
        <div className="account-sidebar-avatar" aria-hidden="true">{initialOf(user)}</div>
        <div>
          <p className="account-sidebar-greet">
            ¡Hola, <strong>{user?.nombre?.split(" ")[0] || user?.telefono || user?.email || ""}</strong>!
          </p>
          <p className="account-sidebar-state">La noche ya está armada ⚡</p>
          {clubAllowed ? <span className="account-sidebar-tag">Miembro Club</span> : null}
        </div>
      </div>

      <nav className="account-sidebar-nav" aria-label="Mi cuenta">
        {navItems.map((item) => {
          const showCount = item.key === "notificaciones" && unreadCount > 0;
          return (
            <button
              key={item.key}
              type="button"
              className={`${active === item.key ? "is-active" : ""}${item.soon ? " is-soon" : ""}`}
              onClick={() => {
                if (item.soon) return;
                if (item.admin) {
                  window.location.assign("/admin");
                  return;
                }
                onNavigate?.(item.key);
              }}
              disabled={item.soon}
              title={item.soon ? "Próximamente" : ""}
            >
              <span className="account-sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span className="account-sidebar-label">{item.label}</span>
              <span className="account-sidebar-short-label">{item.shortLabel || item.label}</span>
              {showCount ? (
                <span className="account-sidebar-count">{unreadCount}</span>
              ) : item.badge ? (
                <span className="account-sidebar-badge">{item.badge}</span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className="account-sidebar-logout" onClick={onLogout}>
          <span aria-hidden="true">🚪</span>
          <span>Cerrar sesión</span>
          <span className="account-sidebar-short-label">Salir</span>
        </button>
      </nav>

      {clubAllowed ? (
        <div className="account-sidebar-club">
          <p className="account-sidebar-club-kicker">La Licorería</p>
          <p className="account-sidebar-club-title">CLUB ⚡</p>
          <p className="account-sidebar-club-text">Más boletos. Más opciones.</p>
          <button type="button" onClick={() => onNavigate?.("club")}>VER MI CLUB</button>
        </div>
      ) : null}
    </aside>
  );
}
