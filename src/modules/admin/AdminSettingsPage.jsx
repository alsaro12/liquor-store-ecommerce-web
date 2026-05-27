import { useMemo, useState } from "react";
import {
  getApiBaseUrl,
  requestJsonWithBase,
  saveApiBaseUrlPreference
} from "./adminApi.js";

function normalizeApiBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).toString().replace(/\/$/, "");
  } catch {
    if (/^https?:\/\//i.test(text)) return text.replace(/\/$/, "");
    return "";
  }
}

function formatJson(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getDbBadge(status) {
  if (!status?.checked) return { label: "Sin verificar", className: "react-admin-tag-muted" };
  if (status.connected && status.method === "mysql2") return { label: "DB conectada", className: "react-admin-tag-ok" };
  if (status.connected) return { label: "Respaldo local", className: "react-admin-tag-low" };
  return { label: "Sin conexion", className: "react-admin-tag-out" };
}

function getProbeBadge(probe) {
  if (probe.state === "ok") return { label: "OK", className: "react-admin-tag-ok" };
  if (probe.state === "error") return { label: "Error", className: "react-admin-tag-out" };
  if (probe.state === "loading") return { label: "Probando...", className: "react-admin-tag-low" };
  return { label: "Sin probar", className: "react-admin-tag-muted" };
}

export default function AdminSettingsPage({ dbStatus = null, onRefreshAll }) {
  const [apiBaseInput, setApiBaseInput] = useState(getApiBaseUrl());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accessHost, setAccessHost] = useState(null);
  const [probe, setProbe] = useState({ state: "idle", url: "", payload: null, error: "" });
  const [busy, setBusy] = useState("");

  const currentApiBase = useMemo(() => getApiBaseUrl() || window.location.origin, [apiBaseInput, message]);
  const dbBadge = getDbBadge(dbStatus);
  const probeBadge = getProbeBadge(probe);

  async function handleSave(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const normalized = normalizeApiBaseUrl(apiBaseInput);
    if (!normalized) {
      setError("Ingresa una URL valida del servidor API.");
      return;
    }
    saveApiBaseUrlPreference(normalized);
    setApiBaseInput(normalized);
    setMessage(`Servidor guardado: ${normalized}`);
    await onRefreshAll?.();
  }

  function handleUseCurrentOrigin() {
    const origin = window.location.origin;
    setApiBaseInput(origin);
    setMessage(`Usando la URL actual: ${origin}`);
    setError("");
  }

  async function handleTestApiBase() {
    setBusy("test-api");
    setError("");
    setMessage("");
    try {
      const normalized = normalizeApiBaseUrl(apiBaseInput);
      if (!normalized) throw new Error("Ingresa una URL valida para probar.");
      const payload = await requestJsonWithBase("/api/db/status", normalized);
      setMessage(`Conexion HTTP OK con ${normalized}.`);
      setProbe({
        state: "ok",
        url: `${normalized}/api/db/status`,
        payload,
        error: ""
      });
    } catch (err) {
      setError(err.message || "No se pudo probar la URL.");
      setProbe((current) => ({
        ...current,
        state: "error",
        error: err.message || "Error de prueba."
      }));
    } finally {
      setBusy("");
    }
  }

  async function handleTestDbStatus() {
    setBusy("test-db");
    setError("");
    setMessage("");
    try {
      const normalized = normalizeApiBaseUrl(apiBaseInput);
      if (!normalized) throw new Error("Ingresa una URL valida para probar.");
      setProbe({ state: "loading", url: `${normalized}/api/db/status`, payload: null, error: "" });
      const payload = await requestJsonWithBase("/api/db/status", normalized);
      if (typeof payload?.connected !== "boolean") {
        throw new Error("La respuesta de /api/db/status no incluye el campo 'connected'.");
      }
      setProbe({
        state: payload.connected ? "ok" : "error",
        url: `${normalized}/api/db/status`,
        payload,
        error: payload.connected ? "" : payload.error || payload.message || "Sin conexion"
      });
      if (payload.connected) {
        setMessage(`DB probada correctamente en ${normalized}.`);
      } else {
        setError(payload.error || payload.message || "La DB no se pudo validar.");
      }
    } catch (err) {
      setProbe((current) => ({
        ...current,
        state: "error",
        error: err.message || "Error de prueba."
      }));
      setError(err.message || "No se pudo probar la DB.");
    } finally {
      setBusy("");
    }
  }

  async function handleRefreshAccessHost() {
    setBusy("access-host");
    setError("");
    setMessage("");
    try {
      const normalized = normalizeApiBaseUrl(apiBaseInput);
      if (!normalized) throw new Error("Ingresa una URL valida para detectar el host.");
      const payload = await requestJsonWithBase("/api/db/access-host", normalized);
      setAccessHost(payload || null);
      setMessage("Host detectado correctamente.");
    } catch (err) {
      setError(err.message || "No se pudo detectar el host.");
    } finally {
      setBusy("");
    }
  }

  async function handleCopyAccessHost() {
    try {
      const host = String(accessHost?.host || "").trim();
      if (!host) throw new Error("Todavia no hay host detectado.");
      await navigator.clipboard.writeText(host);
      setMessage(`Host copiado: ${host}`);
      setError("");
    } catch (err) {
      setError(err.message || "No se pudo copiar el host.");
    }
  }

  return (
    <>
      {(message || error) ? (
        <p className={error ? "react-admin-error" : "react-admin-message"}>{error || message}</p>
      ) : null}

      <div className="react-admin-kpis">
        <article className="react-admin-kpi react-admin-kpi-primary">
          <span>Servidor activo</span>
          <strong className="react-admin-kpi-url">{currentApiBase || "-"}</strong>
          <small>Base actual del API</small>
        </article>
        <article className="react-admin-kpi">
          <span>Estado DB</span>
          <strong>{dbStatus?.method === "mysql2" ? "MySQL" : dbStatus?.method === "local_csv" ? "CSV" : "-"}</strong>
          <small>{dbStatus?.message || "Sin verificar"}</small>
        </article>
        <article className="react-admin-kpi">
          <span>Ultima verificacion</span>
          <strong>{formatDateTime(dbStatus?.checkedAt)}</strong>
          <small>{dbStatus?.probeMs ? `${dbStatus.probeMs} ms` : "Sin medicion"}</small>
        </article>
        <article className="react-admin-kpi">
          <span>Host cPanel</span>
          <strong>{String(accessHost?.host || "-")}</strong>
          <small>{accessHost?.sourceLabel || "Pendiente de deteccion"}</small>
        </article>
      </div>

      <article className="react-admin-filter-card">
        <div className="react-admin-filter-head">
          <div>
            <span className="react-admin-filter-kicker">Configuracion operativa</span>
            <h2>Conexion del panel</h2>
          </div>
          <span className={`react-admin-tag ${dbBadge.className}`}>{dbBadge.label}</span>
        </div>
        <form className="react-admin-form-grid" onSubmit={handleSave}>
          <label className="is-span-3">
            URL servidor API
            <input
              type="text"
              inputMode="url"
              placeholder="https://api.escon.pe"
              value={apiBaseInput}
              onChange={(event) => setApiBaseInput(event.target.value)}
            />
          </label>
          <div className="react-admin-modal-actions is-span-3">
            <button type="submit" className="react-admin-link">Guardar servidor</button>
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={handleUseCurrentOrigin}>
              Usar esta pestana
            </button>
            <button type="button" className="react-admin-link react-admin-link-soft" disabled={busy === "test-api"} onClick={handleTestApiBase}>
              {busy === "test-api" ? "Probando..." : "Probar conexion"}
            </button>
            <button type="button" className="react-admin-link react-admin-link-soft" disabled={busy === "test-db"} onClick={handleTestDbStatus}>
              {busy === "test-db" ? "Probando DB..." : "Probar DB cPanel"}
            </button>
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={() => onRefreshAll?.()}>
              Reintentar estado
            </button>
          </div>
        </form>
      </article>

      <div className="react-admin-settings-grid">
        <article className="react-admin-table-card">
          <div className="react-admin-table-head">
            <div>
              <h2>Access Host para cPanel</h2>
              <small>Autoriza este host en cPanel &gt; Remote MySQL.</small>
            </div>
          </div>
          <div className="react-admin-settings-stack">
            <div className="react-admin-settings-row">
              <input type="text" readOnly value={String(accessHost?.host || "-")} />
              <button type="button" className="react-admin-link react-admin-link-soft" disabled={!accessHost?.host} onClick={handleCopyAccessHost}>
                Copiar
              </button>
              <button type="button" className="react-admin-link react-admin-link-soft" disabled={busy === "access-host"} onClick={handleRefreshAccessHost}>
                {busy === "access-host" ? "Detectando..." : "Detectar host"}
              </button>
            </div>
            <small>{accessHost?.message || 'Pulsa "Detectar host" para obtener el valor correcto.'}</small>
            {accessHost?.checkedAt ? <small>Ultima verificacion: {formatDateTime(accessHost.checkedAt)}</small> : null}
          </div>
        </article>

        <article className="react-admin-table-card">
          <div className="react-admin-table-head">
            <div>
              <h2>Respuesta de prueba backend</h2>
              <small>Lectura real de /api/db/status.</small>
            </div>
            <span className={`react-admin-tag ${probeBadge.className}`}>{probeBadge.label}</span>
          </div>
          <div className="react-admin-settings-stack">
            <small>{probe.url || "Sin prueba ejecutada."}</small>
            <pre className="react-admin-probe-body">{probe.error ? `${probe.error}\n\n${formatJson(probe.payload)}` : formatJson(probe.payload)}</pre>
          </div>
        </article>
      </div>
    </>
  );
}
