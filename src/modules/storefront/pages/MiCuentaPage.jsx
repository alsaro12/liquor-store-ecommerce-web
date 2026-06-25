import React, { useEffect, useState } from "react";
import { fetchCuentaResumen } from "../cuentaApi.js";
import { fetchMyOrders } from "../pedidosApi.js";
import { displayOrderCode } from "../orderCodes.js";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }
  return String(iso);
}

function formatBirthday(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Pendiente de confirmar";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function orderTime(raw) {
  if (!raw) return 0;
  const direct = new Date(raw).getTime();
  if (!Number.isNaN(direct)) return direct;
  const match = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(.+)$/);
  if (!match) return 0;
  const [, day, month, year, timeText] = match;
  const normalizedTime = timeText
    .replace("a. m.", "AM")
    .replace("p. m.", "PM")
    .replace("a.m.", "AM")
    .replace("p.m.", "PM");
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${normalizedTime}`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildLatestOrderSummary(order) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    id: order.id,
    publicCode: order.publicCode || order.customerCode || "",
    createdAt: order.createdAt,
    status: order.status,
    modeLabel: order.modeLabel || (order.mode === "delivery" ? "Delivery" : "Recojo"),
    total: order.total,
    items: items.slice(0, 3).map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      imageHash: item.imageHash || ""
    })),
    itemsCount: items.length
  };
}

const PROFILE_STORAGE_KEY = "licoreria_profile_overrides";

function readProfileOverrides() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveProfileOverrides(next) {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next || {}));
  } catch {}
}

function buildFallbackCuenta(user) {
  return {
    user: user || {},
    club: {
      nivel: "Club",
      color: "#ffc84d",
      puntos: 0,
      boletos: 0,
      progreso: 0,
      missions: [],
      monthlyPrize: "Gift Card Delivery S/25"
    },
    beneficios: [],
    ultimoPedido: null,
    favoritosTop: [],
    direccionesTop: [],
    invitacion: null
  };
}

function canSeeClub(user) {
  return ["admin", "staff"].includes(String(user?.rol || "").toLowerCase());
}

function LoadingProfileState() {
  return (
    <div className="page-loading-icon" role="status" aria-label="Cargando contenido">
      <span aria-hidden="true" />
    </div>
  );
}

export default function MiCuentaPage({ user: sessionUser, onNavigate, onUpdateUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [form, setForm] = useState(() => {
    const overrides = readProfileOverrides();
    return {
      nombre: overrides.nombre || sessionUser?.nombre || "",
      telefono: overrides.telefono || sessionUser?.telefono || "",
      dni: overrides.dni || sessionUser?.dni || ""
    };
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCuentaResumen()
      .then(async (d) => {
        if (cancelled) return;
        let latest = d?.ultimoPedido || null;
        try {
          const orders = await fetchMyOrders("todos");
          const sorted = [...(Array.isArray(orders) ? orders : [])].sort((a, b) => orderTime(b.createdAt) - orderTime(a.createdAt));
          if (sorted[0] && orderTime(sorted[0].createdAt) >= orderTime(latest?.createdAt)) {
            latest = buildLatestOrderSummary(sorted[0]);
          }
        } catch (_) { /* el resumen del backend sigue siendo válido */ }
        setData({ ...d, ultimoPedido: latest });
      })
      .catch(() => {
        if (cancelled) return;
        setError("");
        setData(buildFallbackCuenta(sessionUser));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const overrides = readProfileOverrides();
    const source = { ...(data?.user || {}), ...(sessionUser || {}), ...overrides };
    setForm((prev) => ({
      ...prev,
      nombre: prev.nombre || source.nombre || "",
      telefono: prev.telefono || source.telefono || "",
      dni: prev.dni || source.dni || ""
    }));
  }, [data, sessionUser]);

  if (loading) {
    return (
      <section className="page-shell">
        <header className="page-head"><h1>MI CUENTA</h1></header>
        <LoadingProfileState />
      </section>
    );
  }

  if (!data) return null;

  const profileUser = { ...(data.user || {}), ...(sessionUser || {}), ...readProfileOverrides() };
  const { club, beneficios, ultimoPedido } = data;
  const clubAllowed = canSeeClub(profileUser);
  const clubTickets = Math.max(0, Number(club?.boletos || 0));
  const clubMissions = Array.isArray(club?.missions) ? club.missions : [];
  const clubCompletedMissions = clubMissions.filter((mission) => mission?.completed).length;
  const clubMissionProgress = clubMissions.length
    ? clubCompletedMissions / clubMissions.length
    : Math.max(0, Math.min(1, Number(club?.progreso || 0)));
  const clubPrizeAmount = "S/25.00";

  function update(field, value) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submitProfile(event) {
    event.preventDefault();
    const nextUser = {
      ...profileUser,
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim(),
      dni: form.dni.trim()
    };
    saveProfileOverrides(nextUser);
    onUpdateUser?.(nextUser);
    setError("");
    setSaved(true);
  }

  function updatePassword(field, value) {
    setPasswordSaved(false);
    setRecoverySent(false);
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  }

  function submitPassword(event) {
    event.preventDefault();
    if (passwordForm.next.length < 6) {
      setError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setError("");
    setPasswordSaved(true);
    setEditingPassword(false);
    setPasswordForm({ current: "", next: "", confirm: "" });
  }

  function sendRecoverySms() {
    setError("");
    setPasswordSaved(false);
    setRecoverySent(true);
  }

  return (
    <section className="page-shell mi-cuenta">
      <header className="page-head cuenta-profile-head">
        <div>
          <h1>MI CUENTA</h1>
          <p>Datos listos para comprar rápido, recibir pedidos y mantener tu cuenta ordenada.</p>
        </div>
      </header>

      <article className="cuenta-card cuenta-profile-card">
        <header>
          <div>
            <h3>Datos personales</h3>
          </div>
          <span className="cuenta-profile-state">{saved ? "Guardado" : "Editable"}</span>
        </header>

        {error ? <p className="page-status page-status-error cuenta-profile-error">{error}</p> : null}

        <form className="cuenta-profile-form" onSubmit={submitProfile}>
          <label>
            <span>Nombre</span>
            <input value={form.nombre} onChange={(event) => update("nombre", event.target.value)} placeholder="Tu nombre" autoComplete="name" />
          </label>
          <label>
            <span>Celular</span>
            <input value={form.telefono} onChange={(event) => update("telefono", event.target.value)} placeholder="999 999 999" inputMode="numeric" maxLength={9} autoComplete="tel" />
          </label>
          <label>
            <span>DNI</span>
            <input value={form.dni} onChange={(event) => update("dni", event.target.value)} placeholder="Documento" inputMode="numeric" maxLength={12} autoComplete="off" />
          </label>
          <label>
            <span>Cumpleaños</span>
            <input
              value={formatBirthday(profileUser.fechaNacimiento)}
              readOnly
              className="cuenta-profile-readonly"
              aria-label="Fecha de cumpleaños registrada"
            />
          </label>
          <button type="submit" className="page-cta cuenta-profile-submit">Guardar cambios</button>
        </form>
      </article>

      <article className="cuenta-card cuenta-profile-card">
        <header>
          <div>
            <h3>Contraseña</h3>
          </div>
          <span className="cuenta-profile-state">{passwordSaved ? "Actualizada" : recoverySent ? "SMS enviado" : "Segura"}</span>
        </header>

        {!editingPassword ? (
          <div className="cuenta-password-actions cuenta-password-actions-start">
            <button type="button" className="page-cta cuenta-profile-submit" onClick={() => setEditingPassword(true)}>Editar contraseña</button>
            <button type="button" className="cuenta-password-recovery" onClick={sendRecoverySms}>Recuperar por SMS</button>
          </div>
        ) : (
          <form className="cuenta-profile-form" onSubmit={submitPassword}>
            <label>
              <span>Contraseña actual</span>
              <div className="cuenta-password-field">
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  value={passwordForm.current}
                  onChange={(event) => updatePassword("current", event.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((value) => !value)}
                  aria-label={showCurrentPassword ? "Ocultar contraseña actual" : "Mostrar contraseña actual"}
                >
                  {showCurrentPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                      <path d="M8.4 5.5A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7-0.4 1-1.2 2.2-2.3 3.3" />
                      <path d="M6.1 6.9C4.4 8.2 3.2 10.1 2.5 12c1 2.5 4.5 7 9.5 7 1.6 0 3-.4 4.2-1" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                      <circle cx="12" cy="12" r="2.8" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
            <label>
              <span>Nueva contraseña</span>
              <input type="password" value={passwordForm.next} onChange={(event) => updatePassword("next", event.target.value)} minLength={6} autoComplete="new-password" />
            </label>
            <label>
              <span>Confirmar contraseña</span>
              <input type="password" value={passwordForm.confirm} onChange={(event) => updatePassword("confirm", event.target.value)} minLength={6} autoComplete="new-password" />
            </label>
            <div className="cuenta-password-actions">
              <button type="submit" className="page-cta cuenta-profile-submit">Guardar contraseña</button>
              <button type="button" className="cuenta-card-link" onClick={() => setEditingPassword(false)}>Cancelar</button>
              <button type="button" className="cuenta-password-recovery" onClick={sendRecoverySms}>Recuperar por SMS</button>
            </div>
          </form>
        )}
        {recoverySent ? <p className="cuenta-profile-safe">Te enviaremos un código al celular registrado para recuperar tu acceso.</p> : null}
      </article>

      {clubAllowed ? (
        <div className="cuenta-club-card">
          <div className="cuenta-club-head">
            <div className="cuenta-club-badge" style={{ background: club.color }}>B</div>
            <div>
              <p className="cuenta-club-kicker">Sorteo mensual</p>
              <p className="cuenta-club-nivel">Tus boletos</p>
            </div>
            <div className="cuenta-club-points">
              <span>Tus boletos</span>
              <b>{clubTickets}</b>
              <small>Rifa mensual {clubPrizeAmount}</small>
            </div>
          </div>

          <div className="cuenta-club-progress" aria-label={`${Math.round(clubMissionProgress * 100)}% de metas del mes completadas`}>
            <div
              className="cuenta-club-progress-bar"
              style={{ width: `${Math.round(clubMissionProgress * 100)}%`, background: club.color }}
            />
          </div>

          <button type="button" className="cuenta-club-cta" onClick={() => onNavigate?.("club")}>
            Ver cómo ganar boletos
          </button>
        </div>
      ) : null}

      <div className="cuenta-grid">
        <article className="cuenta-card cuenta-pedido">
          <header>
            <h3>Tu último pedido</h3>
            <button type="button" className="cuenta-card-link" onClick={() => onNavigate?.("pedidos")}>Ver todos</button>
          </header>
          {ultimoPedido ? (
            <div className="cuenta-pedido-body">
              <div>
                <small>{ultimoPedido.modeLabel} · {formatDate(ultimoPedido.createdAt)}</small>
                <strong>{displayOrderCode(ultimoPedido)}</strong>
                <ul>
                  {ultimoPedido.items.map((it) => (
                    <li key={`${ultimoPedido.id}-${it.productId}`}>{it.quantity}× {it.name}</li>
                  ))}
                  {ultimoPedido.itemsCount > ultimoPedido.items.length ? (
                    <li className="cuenta-pedido-more">+ {ultimoPedido.itemsCount - ultimoPedido.items.length} más</li>
                  ) : null}
                </ul>
                <p className="cuenta-pedido-total">Total <b>{formatMoney(ultimoPedido.total)}</b></p>
              </div>
            </div>
          ) : (
            <div className="cuenta-empty">
              <p>Aún no tienes pedidos.</p>
              <button type="button" className="page-cta" onClick={() => onNavigate?.("")}>Ir al catálogo</button>
            </div>
          )}
        </article>

      </div>

      {clubAllowed ? (
        <article className="cuenta-card">
          <header>
            <h3>Beneficios del Club</h3>
          </header>
          <div className="cuenta-beneficios">
            {beneficios.map((b) => (
              <div key={b.nivel} className={`cuenta-beneficio${club.nivel === b.nivel ? " is-active" : ""}`}>
                <div className="cuenta-beneficio-tag" style={{ background: b.color }}>{b.nivel}</div>
                <ul>
                  {b.bullets.map((bul, i) => <li key={i}>{bul}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </article>
      ) : null}

    </section>
  );
}
