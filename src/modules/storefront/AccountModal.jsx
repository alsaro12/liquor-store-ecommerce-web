import { useEffect, useState } from "react";
import { loginCustomer, registerCustomer } from "./authApi.js";

export default function AccountModal({ open, onClose, onAuthenticated, currentUser, onLogout, onNavigate }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", nombre: "", telefono: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (currentUser) setMode("profile");
    else setMode("login");
  }, [currentUser]);

  if (!open) return null;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : {
              email: form.email,
              password: form.password,
              nombre: form.nombre,
              telefono: form.telefono
            };
      const result = mode === "login" ? await loginCustomer(payload) : await registerCustomer(payload);
      onAuthenticated(result.token, result.user);
      setForm({ email: "", password: "", nombre: "", telefono: "" });
    } catch (err) {
      setError(err?.message || "No se pudo procesar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="account-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="account-modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>

        {currentUser ? (
          <div className="account-modal-body">
            <h2>Hola, {currentUser.nombre || currentUser.email}</h2>
            <p className="account-modal-meta">{currentUser.email}</p>
            {currentUser.telefono ? <p className="account-modal-meta">Tel: {currentUser.telefono}</p> : null}

            <nav className="account-modal-nav" aria-label="Mi cuenta">
              <button type="button" onClick={() => { onNavigate?.("cuenta"); onClose?.(); }}>
                <span>👤</span> Mi cuenta
              </button>
              <button type="button" onClick={() => { onNavigate?.("pedidos"); onClose?.(); }}>
                <span>📦</span> Mis pedidos
              </button>
              <button type="button" onClick={() => { onNavigate?.("favoritos"); onClose?.(); }}>
                <span>❤️</span> Mis favoritos
              </button>
              <button type="button" onClick={() => { onNavigate?.("direcciones"); onClose?.(); }}>
                <span>📍</span> Mis direcciones
              </button>
              <button type="button" onClick={() => { onNavigate?.("pagos"); onClose?.(); }}>
                <span>💳</span> Métodos de pago
              </button>
            </nav>

            <button
              type="button"
              className="account-modal-submit"
              onClick={() => {
                onLogout();
              }}
            >
              Cerrar sesión
            </button>
          </div>
        ) : (
          <div className="account-modal-body">
            <div className="account-modal-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => setMode("login")}
              >
                Ingresar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => setMode("register")}
              >
                Crear cuenta
              </button>
            </div>

            <form onSubmit={submit} className="account-modal-form">
              {mode === "register" ? (
                <>
                  <label>
                    <span>Nombre</span>
                    <input
                      type="text"
                      value={form.nombre}
                      onChange={(event) => update("nombre", event.target.value)}
                      required
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    <span>Teléfono (opcional)</span>
                    <input
                      type="tel"
                      value={form.telefono}
                      onChange={(event) => update("telefono", event.target.value)}
                      autoComplete="tel"
                    />
                  </label>
                </>
              ) : null}

              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  required
                  autoComplete="email"
                />
              </label>

              <label>
                <span>Contraseña</span>
                <div className="account-modal-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => update("password", event.target.value)}
                    required
                    minLength={6}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    className="account-modal-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c5 0 9 4 10 6-.4.7-1.1 1.8-2.2 3M6.3 7.4C4 9 2.4 11.2 2 12c1 2 5 6 10 6 1.6 0 3-.3 4.2-.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>

              {error ? <p className="account-modal-error">{error}</p> : null}

              <button type="submit" className="account-modal-submit" disabled={busy}>
                {busy ? "Procesando..." : mode === "login" ? "Ingresar" : "Crear cuenta"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
