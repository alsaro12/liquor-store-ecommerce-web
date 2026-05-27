import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to native confirm en pruebas si el provider no está montado
    return async (opts) => window.confirm(opts?.title || "¿Confirmar?");
  }
  return ctx;
}

function DialogShell({ state, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!state) return undefined;
    function onKey(event) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    // foco al botón principal por defecto
    const t = window.setTimeout(() => {
      const btn = dialogRef.current?.querySelector("[data-primary]");
      btn?.focus();
    }, 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [state, onConfirm, onCancel]);

  if (!state) return null;
  if (typeof document === "undefined") return null;

  const {
    icon = null,
    title = "¿Confirmar?",
    description = "",
    primaryLabel = "Confirmar",
    cancelLabel = "Cancelar",
    danger = false
  } = state;

  return createPortal(
    <div
      className="confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(event) => {
        // close en click fuera
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className={`confirm-card${danger ? " is-danger" : ""}`} ref={dialogRef}>
        <button type="button" className="confirm-close" onClick={onCancel} aria-label="Cerrar">×</button>
        <div className="confirm-icon" aria-hidden="true">
          {icon || (danger ? "⚠️" : "❓")}
        </div>
        <h2 id="confirm-title">{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="confirm-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            data-primary
            className={`confirm-primary${danger ? " is-danger" : ""}`}
            onClick={onConfirm}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState(opts);
    });
  }, []);

  function close(result) {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    if (typeof r === "function") r(result);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogShell
        state={state}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </ConfirmContext.Provider>
  );
}
