import React, { useEffect, useState } from "react";
import { loginCustomer, logoutCustomer, registerCustomer, resetCustomerPassword, verifyCustomerAdultStatus } from "./authApi.js";

function latestAdultBirthDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 103 }, (_, index) => CURRENT_YEAR - index);

export default function AccountModal({ open, onClose, onAuthenticated, currentUser, authToken, onLogout, onNavigate }) {
  const [mode, setMode] = useState("login");
  const emptyForm = { nombre: "", telefono: "", dni: "", password: "", recoveryPhone: "", fechaNacimiento: "", confirmaMayoriaEdad: false };
  const [form, setForm] = useState(emptyForm);
  const [pendingAdultAuth, setPendingAdultAuth] = useState(null);
  const [adultStep, setAdultStep] = useState("question");
  const [birthParts, setBirthParts] = useState({ day: "", month: "", year: "" });
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setBusy(false);
      setRecoveryPassword("");
      setPendingAdultAuth(null);
      setAdultStep("question");
      setBirthParts({ day: "", month: "", year: "" });
    }
  }, [open]);

  useEffect(() => {
    setMode("login");
  }, [currentUser]);

  useEffect(() => {
    if (!open || !currentUser?.requiereVerificacionEdad || !authToken) return;
    setMode("adultVerification");
    setPendingAdultAuth({ token: authToken, user: currentUser });
    setAdultStep("question");
  }, [open, currentUser, authToken]);

  if (!open) return null;
  if (currentUser && !currentUser.requiereVerificacionEdad) return null;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
    setRecoveryPassword("");
    setPendingAdultAuth(null);
    setAdultStep("question");
    setBirthParts({ day: "", month: "", year: "" });
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = {
        nombre: form.nombre,
        telefono: form.telefono,
        dni: form.dni,
        password: form.password,
        fechaNacimiento: form.fechaNacimiento,
        confirmaMayoriaEdad: form.confirmaMayoriaEdad
      };
      const result = mode === "register"
        ? await registerCustomer(payload)
        : await loginCustomer(payload);
      if (mode === "login" && result?.user?.requiereVerificacionEdad) {
        setPendingAdultAuth({ token: result.token, user: result.user });
        setMode("adultVerification");
        setAdultStep("question");
        setBirthParts({ day: "", month: "", year: "" });
        return;
      }
      onAuthenticated(result.token, result.user);
      setForm(emptyForm);
    } catch (err) {
      setError(err?.message || "No se pudo procesar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdultVerification(event) {
    event.preventDefault();
    if (!pendingAdultAuth?.token) return;
    setError("");
    setBusy(true);
    try {
      const fechaNacimiento = `${birthParts.year}-${String(birthParts.month).padStart(2, "0")}-${String(birthParts.day).padStart(2, "0")}`;
      const result = await verifyCustomerAdultStatus({
        fechaNacimiento,
        confirmaMayoriaEdad: true
      }, pendingAdultAuth.token);
      onAuthenticated(pendingAdultAuth.token, result.user, { preserveRoute: true });
      setPendingAdultAuth(null);
      setForm(emptyForm);
    } catch (err) {
      const message = err?.message || "No se pudo confirmar la mayoría de edad.";
      if (/mayor de 18|mayor de edad/i.test(message)) setAdultStep("denied");
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function denyAdultAccess() {
    setBusy(true);
    if (pendingAdultAuth?.token) await logoutCustomer(pendingAdultAuth.token);
    setBusy(false);
    setAdultStep("denied");
  }

  async function submitRecovery(event) {
    event.preventDefault();
    setError("");
    setRecoveryPassword("");
    setBusy(true);
    try {
      const result = await resetCustomerPassword({ telefono: form.recoveryPhone });
      setRecoveryPassword(result?.temporaryPassword || "");
    } catch (err) {
      setError(err?.message || "No se pudo recuperar la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`account-modal-backdrop${mode === "adultVerification" ? " is-age-gate" : ""}`} role="dialog" aria-modal="true" onClick={mode === "adultVerification" ? undefined : onClose}>
      <div className={`account-modal${mode === "adultVerification" ? " account-age-gate" : ""}`} onClick={(event) => event.stopPropagation()}>
        {mode !== "adultVerification" ? <button type="button" className="account-modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button> : null}

        <div className="account-modal-body">
            <div className="account-modal-welcome">
              <h2>{mode === "adultVerification" ? (adultStep === "question" ? "¿Eres mayor de edad?" : adultStep === "birthday" ? "Ingresa tu cumpleaños" : "Acceso restringido") : "Bienvenido a La Licorería"}</h2>
              {mode === "adultVerification" && adultStep === "birthday" ? null : (
                <p>{mode === "adultVerification" ? (adultStep === "question" ? "Debes tener 18 años o más para acceder a la tienda." : "La venta de alcohol está reservada para mayores de 18 años.") : "Ingresa tus datos para continuar buscando productos, armar tu pedido y recibirlo más rápido."}</p>
              )}
            </div>

            {mode !== "adultVerification" ? <div className="account-modal-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => switchMode("login")}
              >
                Ingresar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => switchMode("register")}
              >
                Crear cuenta
              </button>
            </div> : null}

            {mode === "adultVerification" ? (
              adultStep === "question" ? (
                <div className="account-age-question-actions">
                  <button type="button" className="account-modal-submit" onClick={() => setAdultStep("birthday")}>Sí, soy mayor de edad</button>
                  <button type="button" className="account-modal-secondary" onClick={denyAdultAccess} disabled={busy}>Soy menor de edad</button>
                </div>
              ) : adultStep === "birthday" ? (
                <form onSubmit={submitAdultVerification} className="account-modal-form account-birthday-form">
                  <div className="account-birthday-fields">
                    <label><span>Día</span><select value={birthParts.day} onChange={(event) => setBirthParts((current) => ({ ...current, day: event.target.value }))} required><option value="">Día</option>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
                    <label><span>Mes</span><select value={birthParts.month} onChange={(event) => setBirthParts((current) => ({ ...current, month: event.target.value }))} required><option value="">Mes</option>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
                    <label><span>Año</span><select value={birthParts.year} onChange={(event) => setBirthParts((current) => ({ ...current, year: event.target.value }))} required><option value="">Año</option>{BIRTH_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
                  </div>
                  <p className="account-age-legal">Al continuar confirmas que la fecha ingresada es correcta.</p>
                  {error ? <p className="account-modal-error">{error}</p> : null}
                  <button type="submit" className="account-modal-submit" disabled={busy || !birthParts.day || !birthParts.month || !birthParts.year}>{busy ? "Verificando..." : "Verificar edad"}</button>
                  <button type="button" className="account-modal-secondary" onClick={() => setAdultStep("question")}>Volver</button>
                </form>
              ) : (
                <div className="account-age-denied"><span aria-hidden="true">18+</span><strong>No podemos darte acceso a la tienda.</strong></div>
              )
            ) : mode === "recovery" ? (
              <form onSubmit={submitRecovery} className="account-modal-form">
                <label>
                  <span>Celular de tu cuenta</span>
                  <input
                    type="tel"
                    value={form.recoveryPhone}
                    onChange={(event) => update("recoveryPhone", event.target.value)}
                    required
                    inputMode="numeric"
                    maxLength={9}
                    autoComplete="tel"
                    autoFocus
                  />
                </label>
                {recoveryPassword ? (
                  <p className="account-modal-meta">
                    Nueva contraseña temporal: <strong>{recoveryPassword}</strong>
                  </p>
                ) : (
                  <p className="account-modal-meta">Te enviaremos una nueva contraseña numérica de 6 dígitos por SMS.</p>
                )}
                {error ? <p className="account-modal-error">{error}</p> : null}
                <button type="submit" className="account-modal-submit" disabled={busy}>
                  {busy ? "Generando..." : "Enviar nueva contraseña"}
                </button>
                <button type="button" className="account-modal-secondary" onClick={() => switchMode("login")}>
                  Volver a ingresar
                </button>
              </form>
            ) : (
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
                </>
              ) : null}

              <label>
                <span>DNI</span>
                <input
                  type="text"
                  value={form.dni}
                  onChange={(event) => update("dni", event.target.value)}
                  required
                  inputMode="numeric"
                  maxLength={12}
                  autoComplete="off"
                />
              </label>

              {mode === "register" ? (
                <>
                  <label>
                    <span>Celular</span>
                    <input
                      type="tel"
                      value={form.telefono}
                      onChange={(event) => update("telefono", event.target.value)}
                      required
                      inputMode="numeric"
                      maxLength={9}
                      autoComplete="tel"
                    />
                  </label>
                  <label>
                    <span>Fecha de nacimiento</span>
                    <input
                      type="date"
                      value={form.fechaNacimiento}
                      onChange={(event) => update("fechaNacimiento", event.target.value)}
                      required
                      max={latestAdultBirthDate()}
                      autoComplete="bday"
                      aria-describedby="adult-confirmation-copy"
                    />
                  </label>
                </>
              ) : null}

              <label>
                <span>Contraseña</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => update("password", event.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
              </label>

              {mode === "register" ? (
                <label className="account-adult-confirmation">
                  <input
                    type="checkbox"
                    checked={form.confirmaMayoriaEdad}
                    onChange={(event) => update("confirmaMayoriaEdad", event.target.checked)}
                    required
                  />
                  <span id="adult-confirmation-copy">Confirmo que tengo 18 años o más y que la edad ingresada es correcta.</span>
                </label>
              ) : null}

              {error ? <p className="account-modal-error">{error}</p> : null}

              <button
                type="submit"
                className="account-modal-submit"
                disabled={busy || (mode === "register" && (!form.confirmaMayoriaEdad || !form.fechaNacimiento))}
              >
                {busy ? "Procesando..." : mode === "register" ? "Crear cuenta" : "Ingresar"}
              </button>
              {mode === "login" ? (
                <button type="button" className="account-modal-secondary" onClick={() => switchMode("recovery")}>
                  Olvidé mi contraseña
                </button>
              ) : null}
            </form>
            )}
        </div>
      </div>
    </div>
  );
}
