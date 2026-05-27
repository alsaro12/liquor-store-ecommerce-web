import { useEffect, useState } from "react";
import { useConfirm } from "../common/ConfirmDialog.jsx";
import {
  createMetodoPago,
  deleteMetodoPago,
  listMetodosPago,
  setMetodoPagoPrincipal
} from "../pagosApi.js";

const TIPO_LABEL = {
  yape: { name: "Yape", color: "#7e3aaa", emoji: "💜" },
  plin: { name: "Plin", color: "#00c0bd", emoji: "💎" },
  tarjeta: { name: "Tarjeta", color: "#1f150a", emoji: "💳" }
};

function maskNumero(numero) {
  if (!numero) return "";
  const s = String(numero);
  if (s.length <= 4) return s;
  return s.slice(0, -4).replace(/\d/g, "•") + s.slice(-4);
}

export default function MisPagosPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ tipo: "yape", numero: "", alias: "", es_principal: false });
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const list = await listMetodosPago();
      setItems(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || "No se pudieron cargar los métodos de pago.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function startAdd() {
    setAdding(true);
    setForm({ tipo: "yape", numero: "", alias: "", es_principal: items.length === 0 });
    setError("");
  }

  function cancelAdd() {
    setAdding(false);
    setError("");
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setError("");
    setSubmitting(true);
    try {
      await createMetodoPago(form);
      cancelAdd();
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo agregar el método.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrincipal(item) {
    try {
      await setMetodoPagoPrincipal(item.id);
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo marcar como principal.");
    }
  }

  async function handleDelete(item) {
    const ok = await confirm({
      icon: "💳",
      title: `¿Eliminar este método ${TIPO_LABEL[item.tipo]?.name || ""}?`,
      description: "Lo retiraremos de tu cuenta. Puedes volver a vincularlo en cualquier momento.",
      primaryLabel: "Eliminar",
      cancelLabel: "Cancelar",
      danger: true
    });
    if (!ok) return;
    try {
      await deleteMetodoPago(item.id);
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo eliminar.");
    }
  }

  return (
    <section className="page-shell">
      <header className="page-head page-head-row">
        <div>
          <h1>MÉTODOS DE PAGO</h1>
          <p>Administra tus tarjetas y métodos de pago de forma segura.</p>
        </div>
        {!adding ? (
          <button type="button" className="page-cta" onClick={startAdd}>+ Agregar método</button>
        ) : null}
      </header>

      <div className="pagos-security">
        <span aria-hidden="true">🔒</span>
        <p>Tu información de pago está protegida con encriptación SSL. No almacenamos datos completos de tu tarjeta.</p>
      </div>

      {error ? <p className="page-status page-status-error">{error}</p> : null}

      {loading ? (
        <p className="page-status">Cargando...</p>
      ) : items.length === 0 && !adding ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">💳</div>
          <h3>Aún no tienes métodos de pago</h3>
          <p>Agrega Yape o Plin para pagar más rápido.</p>
          <button type="button" className="page-cta" onClick={startAdd}>+ Agregar método</button>
        </div>
      ) : (
        <div className="pagos-list">
          {items.map((item) => {
            const meta = TIPO_LABEL[item.tipo] || { name: item.tipo, color: "#1f150a", emoji: "💳" };
            return (
              <article key={item.id} className={`pago-card${item.es_principal ? " is-principal" : ""}`}>
                <div className="pago-card-icon" style={{ background: meta.color }}>
                  <span aria-hidden="true">{meta.emoji}</span>
                </div>
                <div className="pago-card-body">
                  <div className="pago-card-head">
                    <strong>{meta.name}</strong>
                    {item.es_principal ? <span className="pago-card-badge">Principal</span> : null}
                  </div>
                  <p className="pago-card-line">{maskNumero(item.numero)}</p>
                  {item.alias ? <p className="pago-card-meta">{item.alias}</p> : null}
                  <p className="pago-card-meta">Vinculado el {new Date(item.created_at).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <div className="pago-card-actions">
                  {!item.es_principal ? (
                    <button type="button" onClick={() => handlePrincipal(item)}>Vincular</button>
                  ) : null}
                  <button type="button" className="is-danger" onClick={() => handleDelete(item)} aria-label="Eliminar">⋯</button>
                </div>
              </article>
            );
          })}

          <button type="button" className="pago-add-card" onClick={startAdd}>
            <span className="pago-add-card-plus" aria-hidden="true">+</span>
            <span>
              <strong>Agregar nuevo método de pago</strong>
              <small>Yape · Plin · Tarjetas (próximamente)</small>
            </span>
          </button>
        </div>
      )}

      {adding ? (
        <div className="direccion-form">
          <h3>Agregar método de pago</h3>

          <div className="direccion-form-row">
            <label>
              <span>Tipo</span>
              <select value={form.tipo} onChange={(event) => update("tipo", event.target.value)}>
                <option value="yape">💜 Yape</option>
                <option value="plin">💎 Plin</option>
                <option value="tarjeta" disabled>💳 Tarjeta (próximamente)</option>
              </select>
            </label>

            <label>
              <span>Número (9 dígitos)</span>
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{9}"
                maxLength={9}
                value={form.numero}
                onChange={(event) => update("numero", event.target.value.replace(/\D/g, ""))}
                placeholder="999999999"
                autoComplete="off"
              />
            </label>
          </div>

          <label>
            <span>Alias (opcional)</span>
            <input
              type="text"
              value={form.alias}
              onChange={(event) => update("alias", event.target.value)}
              placeholder="Yape personal, Yape de trabajo, etc."
              maxLength={120}
            />
          </label>

          <label className="direccion-form-check">
            <input
              type="checkbox"
              checked={!!form.es_principal}
              onChange={(event) => update("es_principal", event.target.checked)}
            />
            <span>Usar como método principal</span>
          </label>

          <div className="direccion-form-actions">
            <button type="button" className="checkout-secondary" onClick={cancelAdd} disabled={submitting}>Cancelar</button>
            <button type="button" className="page-cta" onClick={save} disabled={submitting}>
              {submitting ? "Guardando..." : "Guardar método"}
            </button>
          </div>
        </div>
      ) : null}

      <p className="pagos-footer">🛡 Tu información está 100% segura. Encriptada y protegida.</p>
    </section>
  );
}
