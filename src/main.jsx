import React, { Component, StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ConfirmDialogProvider } from "./modules/storefront/common/ConfirmDialog.jsx";
import "./styles.css";

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Root render failed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        style={{
          minHeight: "100vh",
          padding: "24px",
          background: "#120d0a",
          color: "#fff7f1",
          fontFamily: "system-ui, sans-serif"
        }}
      >
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            padding: "20px",
            borderRadius: "16px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)"
          }}
        >
          <h1 style={{ marginTop: 0 }}>La app encontró un error al cargar</h1>
          <p>Refresca la página. Si vuelve a aparecer, comparte este mensaje.</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              padding: "12px",
              borderRadius: "12px",
              background: "rgba(0,0,0,0.28)"
            }}
          >
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
        </div>
      </main>
    );
  }
}

function renderFatalError(error) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <main style="min-height:100vh;padding:24px;background:#120d0a;color:#fff7f1;font-family:system-ui,sans-serif">
      <div style="max-width:960px;margin:0 auto;padding:20px;border-radius:16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12)">
        <h1 style="margin-top:0">La app encontró un error al cargar</h1>
        <p>Refresca la página. Si vuelve a aparecer, comparte este mensaje.</p>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:12px;background:rgba(0,0,0,0.28)">${String(
          error?.stack || error?.message || error
        )
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>
      </div>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  console.error("Global startup error:", event.error || event.message);
  renderFatalError(event.error || event.message || "Error desconocido");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  renderFatalError(event.reason || "Promesa rechazada sin manejar");
});

createRoot(document.getElementById("root")).render(
  createElement(
    StrictMode,
    null,
    createElement(
      RootErrorBoundary,
      null,
      createElement(
        ConfirmDialogProvider,
        null,
        createElement(App)
      )
    )
  )
);
