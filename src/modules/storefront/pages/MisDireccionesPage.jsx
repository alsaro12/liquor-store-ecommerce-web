import { useEffect, useState } from "react";
import AddressPicker from "../AddressPicker.jsx";
import { useConfirm } from "../common/ConfirmDialog.jsx";
import { SkeletonAddressCards } from "../common/Skeleton.jsx";
import {
  createDireccion,
  deleteDireccion,
  listDirecciones,
  setDireccionPrincipal,
  updateDireccion
} from "../direccionesApi.js";

const ICON_OPTIONS = [
  { value: "casa", label: "Casa", emoji: "🏠" },
  { value: "trabajo", label: "Trabajo", emoji: "🏢" },
  { value: "playa", label: "Playa", emoji: "🏖" },
  { value: "amigo", label: "Casa de amigo", emoji: "👥" },
  { value: "otro", label: "Otro", emoji: "📍" }
];

function iconEmoji(value) {
  const found = ICON_OPTIONS.find((o) => o.value === value);
  return found ? found.emoji : "📍";
}

export default function MisDireccionesPage({ user }) {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // dirección actual en edición o "new"
  const [form, setForm] = useState(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const list = await listDirecciones();
      setItems(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || "No se pudieron cargar tus direcciones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function startNew() {
    setEditing("new");
    setForm({
      etiqueta: "",
      icono: "casa",
      direccion: "",
      referencia: "",
      distrito: "",
      ciudad: "",
      telefono: user?.telefono || "",
      latitud: null,
      longitud: null,
      geohash: "",
      es_principal: items.length === 0
    });
    setPickerOpen(true);
  }

  function startEdit(dir) {
    setEditing(dir);
    setForm({
      etiqueta: dir.etiqueta || "",
      icono: dir.icono || "casa",
      direccion: dir.direccion || "",
      referencia: dir.referencia || "",
      distrito: dir.distrito || "",
      ciudad: dir.ciudad || "",
      telefono: dir.telefono || "",
      latitud: dir.latitud,
      longitud: dir.longitud,
      geohash: dir.geohash || "",
      es_principal: dir.es_principal
    });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(null);
    setPickerOpen(false);
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handlePicked(picked) {
    setForm((prev) => ({
      ...prev,
      direccion: picked.direccion,
      distrito: picked.distrito,
      ciudad: picked.ciudad,
      latitud: picked.latitud,
      longitud: picked.longitud,
      geohash: picked.geohash
    }));
    setPickerOpen(false);
  }

  async function save() {
    if (!form) return;
    if (!form.direccion || !form.latitud || !form.longitud) {
      setError("Elige la ubicación en el mapa.");
      return;
    }
    setError("");
    try {
      if (editing === "new") {
        await createDireccion(form);
      } else if (editing) {
        await updateDireccion(editing.id, form);
      }
      cancelEdit();
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo guardar la dirección.");
    }
  }

  async function handleSetPrincipal(dir) {
    try {
      await setDireccionPrincipal(dir.id);
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo marcar como principal.");
    }
  }

  async function handleDelete(dir) {
    const ok = await confirm({
      icon: "🗑",
      title: "¿Eliminar esta dirección?",
      description: `Quitarás "${dir.etiqueta || dir.direccion}" de tu cuenta. Puedes volver a agregarla más adelante.`,
      primaryLabel: "Eliminar",
      cancelLabel: "Cancelar",
      danger: true
    });
    if (!ok) return;
    try {
      await deleteDireccion(dir.id);
      await refresh();
    } catch (err) {
      setError(err?.message || "No se pudo eliminar.");
    }
  }

  return (
    <section className="page-shell">
      <header className="page-head page-head-row">
        <div>
          <h1>MIS DIRECCIONES</h1>
          <p>Guarda tus puntos de entrega y elige cuál usar al pedir.</p>
        </div>
        <button type="button" className="page-cta" onClick={startNew}>+ Agregar dirección</button>
      </header>

      {error ? <p className="page-status page-status-error">{error}</p> : null}

      {loading ? (
        <SkeletonAddressCards count={2} />
      ) : items.length === 0 && !editing ? (
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">📍</div>
          <h3>Aún no tienes direcciones</h3>
          <p>Agrega una para que tus pedidos lleguen al toque.</p>
          <button type="button" className="page-cta" onClick={startNew}>+ Agregar dirección</button>
        </div>
      ) : (
        <div className="direcciones-grid">
          {items.map((dir) => (
            <article key={dir.id} className={`direccion-card${dir.es_principal ? " is-principal" : ""}`}>
              <div className="direccion-card-icon">
                <span aria-hidden="true">{iconEmoji(dir.icono)}</span>
              </div>
              <div className="direccion-card-body">
                <div className="direccion-card-head">
                  <strong>{dir.etiqueta || "Sin etiqueta"}</strong>
                  {dir.es_principal ? <span className="direccion-card-badge">Principal</span> : null}
                </div>
                <p className="direccion-card-line">{dir.direccion}</p>
                {dir.referencia ? <p className="direccion-card-ref">Ref: {dir.referencia}</p> : null}
                <p className="direccion-card-meta">
                  {[dir.distrito, dir.ciudad].filter(Boolean).join(" · ")}
                </p>
                {dir.telefono ? <p className="direccion-card-meta">Tel: {dir.telefono}</p> : null}
              </div>
              <div className="direccion-card-actions">
                {!dir.es_principal ? (
                  <button type="button" onClick={() => handleSetPrincipal(dir)}>Elegir como principal</button>
                ) : null}
                <button type="button" onClick={() => startEdit(dir)}>Editar</button>
                <button type="button" className="is-danger" onClick={() => handleDelete(dir)}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <div className="direccion-form">
          <h3>{editing === "new" ? "Nueva dirección" : "Editar dirección"}</h3>

          <div className="direccion-form-row">
            <label>
              <span>Etiqueta</span>
              <input
                type="text"
                value={form?.etiqueta || ""}
                onChange={(event) => update("etiqueta", event.target.value)}
                placeholder="Casa, Trabajo, Playa..."
              />
            </label>

            <label>
              <span>Tipo</span>
              <select value={form?.icono || "casa"} onChange={(event) => update("icono", event.target.value)}>
                {ICON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.emoji} {opt.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="direccion-form-mapcard">
            {form?.direccion ? (
              <>
                <div>
                  <p className="direccion-form-mapcard-text">{form.direccion}</p>
                  <p className="direccion-form-mapcard-meta">
                    {[form.distrito, form.ciudad].filter(Boolean).join(" · ")}
                  </p>
                  <p className="direccion-form-mapcard-coords">
                    {form.latitud?.toFixed?.(6)}, {form.longitud?.toFixed?.(6)}
                  </p>
                </div>
                <button type="button" className="direccion-form-mapcard-btn" onClick={() => setPickerOpen(true)}>Cambiar</button>
              </>
            ) : (
              <button type="button" className="direccion-form-trigger" onClick={() => setPickerOpen(true)}>
                📍 Elegir ubicación en el mapa
              </button>
            )}
          </div>

          <label>
            <span>Referencia (opcional)</span>
            <input
              type="text"
              value={form?.referencia || ""}
              onChange={(event) => update("referencia", event.target.value)}
              placeholder="Frente al parque, casa color rojo..."
            />
          </label>

          <label>
            <span>Teléfono de contacto (opcional)</span>
            <input
              type="tel"
              value={form?.telefono || ""}
              onChange={(event) => update("telefono", event.target.value)}
            />
          </label>

          <label className="direccion-form-check">
            <input
              type="checkbox"
              checked={!!form?.es_principal}
              onChange={(event) => update("es_principal", event.target.checked)}
            />
            <span>Usar como dirección principal</span>
          </label>

          <div className="direccion-form-actions">
            <button type="button" className="checkout-secondary" onClick={cancelEdit}>Cancelar</button>
            <button type="button" className="page-cta" onClick={save}>Guardar dirección</button>
          </div>
        </div>
      ) : null}

      <AddressPicker
        open={pickerOpen}
        initial={form && form.latitud ? form : null}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePicked}
      />
    </section>
  );
}
