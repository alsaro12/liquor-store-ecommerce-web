const NAV = [
  { key: "cuenta", label: "Mi cuenta", icon: "👤" },
  { key: "pedidos", label: "Mis pedidos", icon: "📦" },
  { key: "favoritos", label: "Mis favoritos", icon: "❤️" },
  { key: "direcciones", label: "Mis direcciones", icon: "📍" },
  { key: "pagos", label: "Métodos de pago", icon: "💳" },
  { key: "notificaciones", label: "Notificaciones", icon: "🔔" },
  { key: "invitar", label: "Invitar amigos", icon: "🎁", badge: "Nuevo" }
];

function initialOf(user) {
  if (!user) return "?";
  return (user.nombre || user.email || "?").trim().charAt(0).toUpperCase() || "?";
}

export default function AccountSidebar({ active, user, onNavigate, onLogout, unreadCount = 0 }) {
  return (
    <aside className="account-sidebar">
      <div className="account-sidebar-user">
        <div className="account-sidebar-avatar" aria-hidden="true">{initialOf(user)}</div>
        <div>
          <p className="account-sidebar-greet">
            ¡Hola, <strong>{user?.nombre?.split(" ")[0] || user?.email || ""}</strong>!
          </p>
          <p className="account-sidebar-state">La noche ya está armada ⚡</p>
          <span className="account-sidebar-tag">Miembro Club</span>
        </div>
      </div>

      <nav className="account-sidebar-nav" aria-label="Mi cuenta">
        {NAV.map((item) => {
          const showCount = item.key === "notificaciones" && unreadCount > 0;
          return (
            <button
              key={item.key}
              type="button"
              className={`${active === item.key ? "is-active" : ""}${item.soon ? " is-soon" : ""}`}
              onClick={() => !item.soon && onNavigate?.(item.key)}
              disabled={item.soon}
              title={item.soon ? "Próximamente" : ""}
            >
              <span className="account-sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span className="account-sidebar-label">{item.label}</span>
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
        </button>
      </nav>

      <div className="account-sidebar-club">
        <p className="account-sidebar-club-kicker">La Licorería</p>
        <p className="account-sidebar-club-title">CLUB ⚡</p>
        <p className="account-sidebar-club-text">Más puntos. Más beneficios.</p>
        <button type="button" disabled title="Próximamente">VER MI CLUB</button>
      </div>
    </aside>
  );
}
