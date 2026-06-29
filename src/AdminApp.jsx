import React, { useEffect, useState } from "react";
import AdminKardexPage from "./modules/admin/AdminKardexPage.jsx";
import AdminDeliveryPage from "./modules/admin/AdminDeliveryPage.jsx";
import AdminDeliveryIncomePage from "./modules/admin/AdminDeliveryIncomePage.jsx";
import AdminCouponsPage from "./modules/admin/AdminCouponsPage.jsx";
import AdminOrdersPage from "./modules/admin/AdminOrdersPage.jsx";
import AdminProductsPage from "./modules/admin/AdminProductsPage.jsx";
import AdminSalesPage from "./modules/admin/AdminSalesPage.jsx";
import AdminSettingsPage from "./modules/admin/AdminSettingsPage.jsx";
import {
  fetchCurrentUser,
  getStoredToken,
  loginCustomer,
  logoutCustomer,
  resetCustomerPassword,
  setStoredToken
} from "./modules/storefront/authApi.js";
import { getTodayOperationalDate } from "./modules/admin/adminRules.js";
import { downloadSalesReport, loadDbStatus, loadKardexAll, loadProductsStats, loadSalesAll } from "./modules/admin/adminApi.js";

const MODULES = {
  sales: {
    title: "Ventas diarias",
    badge: "Admin React - ventas",
    description: "Lectura operativa del turno, resumen rapido y tabla principal de ventas."
  },
  orders: {
    title: "Control de pedidos",
    badge: "Admin React - operaciones",
    description: "Aprueba pagos, cambia estados de despacho, rechaza pedidos y controla tienda/delivery."
  },
  delivery: {
    title: "Tienda y delivery",
    badge: "Admin React - delivery",
    description: "Configura el punto de salida, cobertura y tarifas por distancia."
  },
  deliveryIncome: {
    title: "Ingresos delivery",
    badge: "Admin React - margen delivery",
    description: "Controla delivery cobrado, costo real pagado y ganancia por pedido."
  },
  coupons: {
    title: "Cupones",
    badge: "Admin React - descuentos",
    description: "Crea, edita y controla códigos de descuento con vigencia y unidades disponibles."
  },
  products: {
    title: "Gestion de productos",
    badge: "Admin React - productos",
    description: "Catalogo operativo, alertas de stock y acciones base de producto desde una sola vista."
  },
  kardex: {
    title: "Kardex",
    badge: "Admin React - kardex",
    description: "Movimientos de inventario, filtros por turno y limpieza controlada del historial."
  },
  settings: {
    title: "Configuracion",
    badge: "Admin React - ajustes",
    description: "Servidor API, validacion de conexion y soporte para acceso remoto en el mismo panel."
  }
};

const ADMIN_NAV = [
  { key: "sales", label: "Ventas diarias", icon: "▣" },
  { key: "orders", label: "Control de pedidos", icon: "⇄" },
  { key: "deliveryIncome", label: "Ingresos delivery", icon: "$" },
  { key: "coupons", label: "Cupones", icon: "%" },
  { key: "delivery", label: "Tienda y delivery", icon: "⌖" },
  { key: "products", label: "Productos", icon: "◫" },
  { key: "kardex", label: "Kardex", icon: "≡" },
  { key: "settings", label: "Configuracion", icon: "⚙" }
];

function isStaffUser(user) {
  return ["admin", "staff"].includes(String(user?.rol || "").toLowerCase());
}

export default function AdminApp() {
  const [authToken, setAuthToken] = useState(() => getStoredToken());
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ telefono: "", dni: "", email: "", password: "" });
  const [loginMode, setLoginMode] = useState("phone");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [currentView, setCurrentView] = useState("sales");
  const [navOpen, setNavOpen] = useState(false);
  const [sales, setSales] = useState([]);
  const [kardex, setKardex] = useState([]);
  const [productStats, setProductStats] = useState(null);
  const [dbStatus, setDbStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(getTodayOperationalDate());
  const [toDate, setToDate] = useState(getTodayOperationalDate());
  const [quickIngressRequest, setQuickIngressRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      setAuthLoading(true);
      const user = await fetchCurrentUser(authToken);
      if (cancelled) return;
      setAuthUser(user);
      setAuthLoading(false);
      if (!user) {
        setStoredToken("");
        setAuthToken("");
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  async function refreshAllData() {
    if (!isStaffUser(authUser)) return;
    setLoading(true);
    setError("");
    try {
      const [salesData, kardexData, statsData, dbData] = await Promise.all([
        loadSalesAll(),
        loadKardexAll(),
        loadProductsStats(),
        loadDbStatus()
      ]);
      setSales(Array.isArray(salesData) ? salesData : []);
      setKardex(Array.isArray(kardexData) ? kardexData : []);
      setProductStats(statsData || null);
      setDbStatus(dbData || null);
    } catch (err) {
      setError(err.message || "No se pudo actualizar el panel admin React.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isStaffUser(authUser)) void refreshAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authUser?.rol]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setNavOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const moduleMeta = MODULES[currentView];

  function handleOpenView(viewKey) {
    setCurrentView(viewKey);
    setNavOpen(false);
  }

  function updateLoginForm(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    setLoginNotice("");
    try {
      const payload = loginMode === "phone"
        ? { dni: loginForm.dni, password: loginForm.password }
        : { email: loginForm.email, password: loginForm.password };
      const result = await loginCustomer(payload);
      if (!isStaffUser(result?.user)) {
        await logoutCustomer(result?.token || "");
        throw new Error("Tu cuenta existe, pero no tiene permiso de admin o staff.");
      }
      setStoredToken(result.token);
      setAuthToken(result.token);
      setAuthUser(result.user);
    } catch (err) {
      setLoginError(err?.message || "No se pudo iniciar sesion.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleRecoverAdminAccess() {
    setLoginError("");
    setLoginNotice("");
    const telefono = String(loginForm.telefono || "").replace(/\D+/g, "");
    if (telefono.length !== 9) {
      setLoginError("Ingresa el celular admin de 9 dígitos para recuperar el acceso.");
      setLoginMode("phone");
      return;
    }
    setRecoverBusy(true);
    try {
      const result = await resetCustomerPassword({ telefono });
      setLoginNotice(`Acceso temporal generado para ${result.telefono}: ${result.temporaryPassword}`);
      setLoginMode("phone");
      updateLoginForm("password", result.temporaryPassword || "");
    } catch (err) {
      setLoginError(err?.message || "No se pudo recuperar el acceso admin.");
    } finally {
      setRecoverBusy(false);
    }
  }

  async function handleAdminLogout() {
    const token = authToken;
    setStoredToken("");
    setAuthToken("");
    setAuthUser(null);
    setSales([]);
    setKardex([]);
    setProductStats(null);
    setDbStatus(null);
    if (token) await logoutCustomer(token);
  }

  if (authLoading) {
    return (
      <main className="react-admin-shell react-admin-auth-shell">
        <section className="react-admin-auth-panel">
          <span className="react-admin-badge">Panel interno</span>
          <h1>Validando sesion</h1>
          <p>Un momento mientras verificamos tus permisos.</p>
        </section>
      </main>
    );
  }

  if (!isStaffUser(authUser)) {
    return (
      <main className="react-admin-shell react-admin-auth-shell">
        <section className="react-admin-auth-panel">
          <span className="react-admin-badge">Panel interno</span>
          <h1>Acceso administrativo</h1>
          <p>Entra con DNI o email. La cuenta debe tener rol admin o staff.</p>

          <div className="react-admin-auth-tabs" role="tablist">
            <button type="button" className={loginMode === "phone" ? "is-active" : ""} onClick={() => setLoginMode("phone")}>
              DNI
            </button>
            <button type="button" className={loginMode === "email" ? "is-active" : ""} onClick={() => setLoginMode("email")}>
              Email
            </button>
          </div>

          <form className="react-admin-auth-form" onSubmit={handleAdminLogin}>
            {loginMode === "phone" ? (
              <>
                <label>
                  <span>DNI</span>
                  <input
                    type="text"
                    value={loginForm.dni}
                    onChange={(event) => updateLoginForm("dni", event.target.value)}
                    inputMode="numeric"
                    maxLength={12}
                    required
                  />
                </label>
                <label>
                  <span>Contraseña</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => updateLoginForm("password", event.target.value)}
                    minLength={6}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => updateLoginForm("email", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Contraseña</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => updateLoginForm("password", event.target.value)}
                    minLength={6}
                    required
                  />
                </label>
              </>
            )}
            {loginError ? <p className="react-admin-auth-error">{loginError}</p> : null}
            {loginNotice ? <p className="react-admin-auth-notice">{loginNotice}</p> : null}
            <button type="submit" className="react-admin-auth-submit" disabled={loginBusy}>
              {loginBusy ? "Ingresando..." : "Entrar al panel"}
            </button>
            <button
              type="button"
              className="react-admin-auth-recover"
              onClick={handleRecoverAdminAccess}
              disabled={recoverBusy}
            >
              {recoverBusy ? "Generando acceso..." : "Recuperar contraseña o acceso admin"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={`react-admin-shell react-admin-view-${currentView}`}>
      <section className="react-admin-hero">
        <div>
          <span className="react-admin-badge">{moduleMeta.badge}</span>
          <h1>{moduleMeta.title}</h1>
          <p>{moduleMeta.description}</p>
        </div>
        <div className="react-admin-hero-actions">
          <span className="react-admin-session-pill">{authUser.nombre || authUser.telefono} · {authUser.rol}</span>
          <button type="button" className="react-admin-link react-admin-link-soft" onClick={handleAdminLogout}>
            Salir
          </button>
          <a className="react-admin-link react-admin-link-soft" href="./index.html">
            Abrir tienda React
          </a>
        </div>
      </section>

      <section className="react-admin-layout">
        <aside className={`react-admin-nav ${navOpen ? "is-open" : "is-compact"}`}>
          <div className="react-admin-nav-panel">
            <div className="react-admin-nav-panel-head">
              <span>{navOpen ? "Menu" : ""}</span>
              <button
                type="button"
                className="react-admin-nav-close"
                aria-label={navOpen ? "Comprimir menu" : "Expandir menu"}
                aria-expanded={navOpen ? "true" : "false"}
                onClick={() => setNavOpen((current) => !current)}
              >
                ☰
              </button>
            </div>
            {ADMIN_NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`react-admin-nav-item ${currentView === item.key ? "is-active" : ""}`}
                onClick={() => handleOpenView(item.key)}
                title={item.label}
              >
                <span className="react-admin-nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="react-admin-nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="react-admin-content">
          {currentView === "sales" ? (
            <AdminSalesPage
              sales={sales}
              kardex={kardex}
              productStats={productStats}
              dbStatus={dbStatus}
              loading={loading}
              error={error}
              search={search}
              fromDate={fromDate}
              toDate={toDate}
              onSearchChange={setSearch}
              onFromDateChange={setFromDate}
              onToDateChange={setToDate}
              onResetToday={() => {
                const today = getTodayOperationalDate();
                setFromDate(today);
                setToDate(today);
              }}
              onOpenOrders={() => handleOpenView("orders")}
              onOpenProducts={() => {
                setQuickIngressRequest((current) => current + 1);
                handleOpenView("products");
              }}
              onOpenKardex={() => handleOpenView("kardex")}
              onDownloadSalesReport={downloadSalesReport}
              onRefresh={refreshAllData}
            />
          ) : currentView === "orders" ? (
            <AdminOrdersPage />
          ) : currentView === "deliveryIncome" ? (
            <AdminDeliveryIncomePage />
          ) : currentView === "coupons" ? (
            <AdminCouponsPage />
          ) : currentView === "delivery" ? (
            <AdminDeliveryPage />
          ) : currentView === "products" ? (
            <AdminProductsPage quickIngressRequest={quickIngressRequest} />
          ) : currentView === "kardex" ? (
            <AdminKardexPage kardex={kardex} loading={loading} onRefresh={refreshAllData} />
          ) : (
            <AdminSettingsPage dbStatus={dbStatus} onRefreshAll={refreshAllData} />
          )}
        </section>
      </section>
    </main>
  );
}
