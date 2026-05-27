import AccountSidebar from "./AccountSidebar.jsx";

export default function AccountLayout({ active, user, onNavigate, onLogout, unreadCount, children }) {
  return (
    <div className="account-layout">
      <AccountSidebar
        active={active}
        user={user}
        onNavigate={onNavigate}
        onLogout={onLogout}
        unreadCount={unreadCount}
      />
      <div className="account-layout-content">{children}</div>
    </div>
  );
}
