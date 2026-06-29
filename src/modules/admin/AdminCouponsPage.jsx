import { useEffect, useState } from "react";
import { deleteCoupon, loadCouponsAll, saveCoupon } from "./adminApi.js";

const EMPTY_COUPON = {
  title: "",
  code: "",
  description: "",
  discountType: "amount",
  discountValue: "",
  unlimitedDates: true,
  startsAt: "",
  endsAt: "",
  unlimitedUses: true,
  maxUses: "",
  status: "ACTIVO"
};

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "Ilimitado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(date);
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function couponDiscountLabel(coupon) {
  return coupon.discountType === "percent"
    ? `${Number(coupon.discountValue || 0).toFixed(0)}%`
    : formatMoney(coupon.discountValue);
}

function couponAvailability(coupon) {
  if (coupon.unlimitedUses) return "Usos ilimitados";
  const max = Number(coupon.maxUses || 0);
  const used = Number(coupon.usedCount || 0);
  return `${Math.max(0, max - used)} de ${max} disponibles`;
}

export default function AdminCouponsPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_COUPON);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function refreshCoupons() {
    setLoading(true);
    setError("");
    try {
      const data = await loadCouponsAll();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "No se pudieron cargar los cupones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshCoupons();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY_COUPON);
    setEditingId("");
    setError("");
  }

  function editCoupon(coupon) {
    setEditingId(coupon.id);
    setForm({
      title: coupon.title || "",
      code: coupon.code || "",
      description: coupon.description || "",
      discountType: coupon.discountType || "amount",
      discountValue: String(coupon.discountValue || ""),
      unlimitedDates: coupon.unlimitedDates !== false,
      startsAt: toDateInput(coupon.startsAt),
      endsAt: toDateInput(coupon.endsAt),
      unlimitedUses: coupon.unlimitedUses !== false,
      maxUses: coupon.maxUses ? String(coupon.maxUses) : "",
      status: coupon.status || "ACTIVO"
    });
  }

  async function submitCoupon(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        appliesTo: "delivery",
        discountValue: Number(String(form.discountValue || "0").replace(",", ".")),
        maxUses: form.unlimitedUses ? null : Number(form.maxUses || 0),
        startsAt: form.unlimitedDates || !form.startsAt ? "" : `${form.startsAt}T00:00:00-05:00`,
        endsAt: form.unlimitedDates || !form.endsAt ? "" : `${form.endsAt}T23:59:59-05:00`
      };
      await saveCoupon(editingId, payload);
      resetForm();
      await refreshCoupons();
    } catch (err) {
      setError(err?.message || "No se pudo guardar el cupón.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCoupon(coupon) {
    if (!window.confirm(`¿Eliminar cupón ${coupon.code}?`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteCoupon(coupon.id);
      if (editingId === coupon.id) resetForm();
      await refreshCoupons();
    } catch (err) {
      setError(err?.message || "No se pudo eliminar el cupón.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="react-admin-coupons-page">
      <div className="react-admin-table-card admin-coupons-card">
        <div className="react-admin-products-head">
          <div>
            <span>Cupones</span>
            <h2>{editingId ? "Editar cupón" : "Crear cupón"}</h2>
            <small>Códigos de descuento aplicados solo al delivery, con vigencia, unidades disponibles y estado operativo.</small>
          </div>
          <button type="button" className="react-admin-link" onClick={resetForm}>
            Nuevo cupón
          </button>
        </div>

        {error ? <p className="react-admin-error">{error}</p> : null}

        <form className="react-admin-form-grid admin-coupons-form" onSubmit={submitCoupon}>
          <label>
            <span>Título visible</span>
            <input value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="Promo lanzamiento" required />
          </label>
          <label>
            <span>Código</span>
            <input value={form.code} onChange={(event) => updateForm("code", event.target.value.toUpperCase())} placeholder="LICOR10" required />
          </label>
          <label>
            <span>Estado</span>
            <select value={form.status} onChange={(event) => updateForm("status", event.target.value)}>
              <option value="ACTIVO">Activo</option>
              <option value="INACTIVO">Inactivo</option>
            </select>
          </label>

          <label>
            <span>Tipo de descuento delivery</span>
            <select value={form.discountType} onChange={(event) => updateForm("discountType", event.target.value)}>
              <option value="amount">Monto en soles</option>
              <option value="percent">Porcentaje</option>
            </select>
          </label>
          <label>
            <span>Valor sobre delivery</span>
            <input type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => updateForm("discountValue", event.target.value)} required />
          </label>
          <label className="admin-coupons-check">
            <input type="checkbox" checked={form.unlimitedUses} onChange={(event) => updateForm("unlimitedUses", event.target.checked)} />
            <span>Usos ilimitados</span>
          </label>

          {!form.unlimitedUses ? (
            <label>
              <span>Unidades disponibles</span>
              <input type="number" min="1" step="1" value={form.maxUses} onChange={(event) => updateForm("maxUses", event.target.value)} required />
            </label>
          ) : null}

          <label className="admin-coupons-check">
            <input type="checkbox" checked={form.unlimitedDates} onChange={(event) => updateForm("unlimitedDates", event.target.checked)} />
            <span>Vigencia ilimitada</span>
          </label>

          {!form.unlimitedDates ? (
            <>
              <label>
                <span>Desde</span>
                <input type="date" value={form.startsAt} onChange={(event) => updateForm("startsAt", event.target.value)} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={form.endsAt} onChange={(event) => updateForm("endsAt", event.target.value)} />
              </label>
            </>
          ) : null}

          <label className="is-span-3">
            <span>Descripción interna</span>
            <textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="Condición o nota breve para el equipo" />
          </label>

          <div className="admin-coupons-actions is-span-3">
            <button type="button" onClick={resetForm} disabled={saving}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar cupón"}</button>
          </div>
        </form>
      </div>

      <div className="react-admin-table-card admin-coupons-card">
        <div className="react-admin-table-head">
          <div>
            <span>Listado</span>
            <h2>Cupones creados</h2>
          </div>
          <button type="button" className="react-admin-link" onClick={refreshCoupons} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
        <table className="react-admin-table admin-coupons-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Título</th>
              <th>Descuento</th>
              <th>Aplica a</th>
              <th>Vigencia</th>
              <th>Usos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((coupon) => (
              <tr key={coupon.id}>
                <td><strong>{coupon.code}</strong></td>
                <td>{coupon.title}</td>
                <td>{couponDiscountLabel(coupon)}</td>
                <td>Delivery</td>
                <td>{coupon.unlimitedDates ? "Ilimitada" : `${formatDate(coupon.startsAt)} - ${formatDate(coupon.endsAt)}`}</td>
                <td>{couponAvailability(coupon)}</td>
                <td><span className={`admin-coupon-status is-${String(coupon.status || "").toLowerCase()}`}>{coupon.status}</span></td>
                <td>
                  <div className="admin-coupons-row-actions">
                    <button type="button" onClick={() => editCoupon(coupon)}>Editar</button>
                    <button type="button" className="is-danger" onClick={() => removeCoupon(coupon)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={8}>{loading ? "Cargando cupones..." : "Aún no hay cupones creados."}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
