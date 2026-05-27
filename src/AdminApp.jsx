import { useEffect, useState } from "react";
import AdminKardexPage from "./modules/admin/AdminKardexPage.jsx";
import AdminProductsPage from "./modules/admin/AdminProductsPage.jsx";
import AdminSalesPage from "./modules/admin/AdminSalesPage.jsx";
import AdminSettingsPage from "./modules/admin/AdminSettingsPage.jsx";
import { getTodayOperationalDate } from "./modules/admin/adminRules.js";
import { loadDbStatus, loadKardexAll, loadProductsStats, loadSalesAll } from "./modules/admin/adminApi.js";

const MODULES = {
  sales: {
    title: "Ventas diarias",
    badge: "Admin React - ventas",
    description: "Lectura operativa del turno, resumen rapido y tabla principal de ventas."
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

export default function AdminApp() {
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

  async function refreshAllData() {
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
    void refreshAllData();
  }, []);

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

  return (
    <main className="react-admin-shell">
      <button
        type="button"
        className={`react-admin-nav-toggle ${navOpen ? "is-open" : ""}`}
        aria-label={navOpen ? "Cerrar menu principal" : "Abrir menu principal"}
        aria-expanded={navOpen ? "true" : "false"}
        onClick={() => setNavOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      {navOpen ? <button type="button" className="react-admin-nav-backdrop" aria-label="Cerrar menu" onClick={() => setNavOpen(false)} /> : null}

      <section className="react-admin-hero">
        <div>
          <span className="react-admin-badge">{moduleMeta.badge}</span>
          <h1>{moduleMeta.title}</h1>
          <p>{moduleMeta.description}</p>
        </div>
        <div className="react-admin-hero-actions">
          <a className="react-admin-link" href="./admin.html">
            Abrir panel React
          </a>
          <a className="react-admin-link react-admin-link-soft" href="./index.html">
            Abrir tienda React
          </a>
        </div>
      </section>

      <section className="react-admin-layout">
        <aside className={`react-admin-nav ${navOpen ? "is-open" : ""}`}>
          <div className="react-admin-nav-panel">
            <div className="react-admin-nav-panel-head">
              <span>Menu</span>
              <button type="button" className="react-admin-nav-close" aria-label="Cerrar menu principal" onClick={() => setNavOpen(false)}>
                ×
              </button>
            </div>
          <button
            type="button"
            className={`react-admin-nav-item ${currentView === "sales" ? "is-active" : ""}`}
            onClick={() => handleOpenView("sales")}
          >
            Ventas diarias
          </button>
          <button
            type="button"
            className={`react-admin-nav-item ${currentView === "products" ? "is-active" : ""}`}
            onClick={() => handleOpenView("products")}
          >
            Gestion de productos
          </button>
          <button
            type="button"
            className={`react-admin-nav-item ${currentView === "kardex" ? "is-active" : ""}`}
            onClick={() => handleOpenView("kardex")}
          >
            Kardex
          </button>
          <button
            type="button"
            className={`react-admin-nav-item ${currentView === "settings" ? "is-active" : ""}`}
            onClick={() => handleOpenView("settings")}
          >
            Configuracion
          </button>
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
              onOpenProducts={() => handleOpenView("products")}
              onOpenKardex={() => handleOpenView("kardex")}
            />
          ) : currentView === "products" ? (
            <AdminProductsPage />
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
