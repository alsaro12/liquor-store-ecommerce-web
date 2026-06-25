import React, { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Storefront from "./modules/storefront/Storefront.jsx";
import AdminApp from "./AdminApp.jsx";
import { ConfirmDialogProvider } from "./modules/storefront/common/ConfirmDialog.jsx";

function CountryAccessGate({ children }) {
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const [access, setAccess] = useState({ state: "checking", country: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isLocalHost) {
      setAccess({ state: "allowed", country: "LOCAL" });
      return undefined;
    }
    const controller = new AbortController();
    setAccess({ state: "checking", country: "" });
    fetch("/api/geo/access", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "No se pudo verificar la cobertura.");
        setAccess({
          state: payload?.allowed ? "allowed" : "blocked",
          country: String(payload?.country || "")
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setAccess({ state: "blocked", country: "" });
      });
    return () => controller.abort();
  }, [attempt, isLocalHost]);

  if (access.state === "checking") {
    return (
      <main className="country-access-screen is-checking" aria-busy="true">
        <div className="country-access-mark" aria-hidden="true">*</div>
        <strong>Verificando cobertura</strong>
      </main>
    );
  }

  if (access.state === "blocked") {
    return (
      <main className="country-access-screen">
        <section className="country-access-panel">
          <span className="country-access-kicker">La Licoreria</span>
          <div className="country-access-pin" aria-hidden="true">!</div>
          <h1>Fuera de cobertura</h1>
          <p>Lo sentimos, no te encuentras en un país con cobertura.</p>
          <small>Actualmente atendemos accesos desde Perú y Francia.</small>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reintentar</button>
        </section>
      </main>
    );
  }

  return children;
}

export default function App() {
  return (
    <CountryAccessGate>
      <ConfirmDialogProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<Storefront />} />
          </Routes>
        </BrowserRouter>
      </ConfirmDialogProvider>
    </CountryAccessGate>
  );
}
