import { useEffect, useState } from "react";
import { enviarInvitacion, fetchMiCodigo, listMisInvitaciones } from "../referidosApi.js";

const ESTADO_LABEL = {
  enviada: { label: "Pendiente", color: "#8a5a06", bg: "#fff3d2" },
  registrado: { label: "Se registró", color: "#1c4593", bg: "#d8e8ff" },
  primer_pedido: { label: "Primer pedido en curso", color: "#5b3c1a", bg: "#fdf6ea" },
  recompensa_otorgada: { label: "+300 puntos", color: "#1c6a30", bg: "#d5f1dc" }
};

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InvitarPage() {
  const [info, setInfo] = useState(null);
  const [invitaciones, setInvitaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [form, setForm] = useState({ email: "", nombre: "" });
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [codigo, list] = await Promise.all([fetchMiCodigo(), listMisInvitaciones()]);
      setInfo(codigo);
      setInvitaciones(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || "No se pudieron cargar tus referidos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function copy(text) {
    try {
      navigator.clipboard?.writeText(text);
      setFeedback("Copiado al portapapeles ✓");
      window.setTimeout(() => setFeedback(""), 1800);
    } catch {
      setFeedback("No se pudo copiar.");
    }
  }

  function shareWhatsapp() {
    const msg = `Te invito a La Licorería 🍻 Pedí con mi código ${info?.codigo} y recíbe ${info?.beneficio_amigo}. ${info?.link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  function shareMessenger() {
    const url = encodeURIComponent(info?.link || "");
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank", "noopener");
  }

  function shareEmail() {
    const subject = encodeURIComponent("Te invito a La Licorería");
    const body = encodeURIComponent(`Hola! Usa mi código ${info?.codigo} para tu primer pedido y recíbe ${info?.beneficio_amigo}.\n\n${info?.link}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  }

  async function submitInvite(event) {
    event.preventDefault();
    if (!form.email && !form.nombre) {
      setFeedback("Indica un email o un nombre.");
      return;
    }
    setSending(true);
    try {
      await enviarInvitacion(form);
      setForm({ email: "", nombre: "" });
      setFeedback("Invitación registrada ✓");
      await refresh();
    } catch (err) {
      setFeedback(err?.message || "No se pudo enviar.");
    } finally {
      setSending(false);
      window.setTimeout(() => setFeedback(""), 2400);
    }
  }

  if (loading) {
    return (
      <section className="page-shell">
        <header className="page-head"><h1>INVITAR AMIGOS</h1></header>
        <p className="page-status">Cargando...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page-shell">
        <header className="page-head"><h1>INVITAR AMIGOS</h1></header>
        <p className="page-status page-status-error">{error}</p>
      </section>
    );
  }

  return (
    <section className="page-shell">
      <header className="page-head">
        <h1>INVITAR AMIGOS</h1>
        <p>Comparte tu código del club. Tu amigo gana, tú sumas puntos.</p>
      </header>

      <section className="invitar-hero">
        <div className="invitar-hero-copy">
          <span className="invitar-hero-tag">Club La Licorería</span>
          <h2>Invita y gana</h2>
          <p>Tu amigo recibe <strong>{info?.beneficio_amigo || "S/ 10"}</strong> en su primer pedido y tú sumas <strong>{info?.premio_puntos || 300} puntos</strong>.</p>
          <button type="button" className="invitar-hero-cta" onClick={shareWhatsapp}>
            Compartir invitación
          </button>
        </div>
        <div className="invitar-hero-reward">
          <div><span>Tu amigo recibe</span><b>S/ {String(info?.beneficio_amigo || "10").replace(/[^\d.]/g, "") || "10"}</b></div>
          <div><span>Tú ganas</span><b>{info?.premio_puntos || 300}</b><small>puntos</small></div>
        </div>
      </section>

      <div className="invitar-grid">
        <article className="invitar-codigo">
          <h3>Tu código del club</h3>
          <p className="invitar-codigo-big">{info?.codigo || "------"}</p>
          <p className="invitar-codigo-help">Comparte tu código para que tu invitado lo use al registrarse.</p>
          <div className="invitar-codigo-actions">
            <button type="button" onClick={() => copy(info?.codigo || "")}>Copiar código</button>
            <button type="button" onClick={() => copy(info?.link || "")}>Copiar enlace</button>
            <button type="button" onClick={() => setShowQR((q) => !q)}>{showQR ? "Ocultar QR" : "Ver QR"}</button>
          </div>
          {showQR && info?.qrUrl ? (
            <div className="invitar-qr">
              <img src={info.qrUrl} alt="QR para compartir" />
            </div>
          ) : null}
        </article>

        <article className="invitar-share">
          <h3>Compartir por</h3>
          <div className="invitar-share-grid">
            <button type="button" onClick={shareWhatsapp}>
              <span aria-hidden="true">💬</span>
              <span>WhatsApp</span>
            </button>
            <button type="button" onClick={shareMessenger}>
              <span aria-hidden="true">💌</span>
              <span>Messenger</span>
            </button>
            <button type="button" onClick={() => copy(info?.link || "")}>
              <span aria-hidden="true">🔗</span>
              <span>Copiar enlace</span>
            </button>
            <button type="button" onClick={shareEmail}>
              <span aria-hidden="true">✉️</span>
              <span>Mail</span>
            </button>
          </div>

          <form className="invitar-form" onSubmit={submitInvite}>
            <p>O envíale el código directamente:</p>
            <div>
              <input
                type="text"
                value={form.nombre}
                onChange={(event) => setForm((p) => ({ ...p, nombre: event.target.value }))}
                placeholder="Nombre"
                maxLength={120}
              />
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((p) => ({ ...p, email: event.target.value }))}
                placeholder="email@amigo.com"
              />
              <button type="submit" disabled={sending}>
                {sending ? "..." : "Registrar"}
              </button>
            </div>
          </form>

          {feedback ? <p className="invitar-feedback">{feedback}</p> : null}
        </article>
      </div>

      <section className="invitar-list">
        <h3>Tus invitaciones</h3>
        {invitaciones.length === 0 ? (
          <p className="page-status">Aún no has invitado a nadie. ¡Comparte tu código y empieza a sumar!</p>
        ) : (
          <ul>
            {invitaciones.map((inv) => {
              const meta = ESTADO_LABEL[inv.estado] || ESTADO_LABEL.enviada;
              return (
                <li key={inv.id}>
                  <div className="invitar-list-icon" aria-hidden="true">👥</div>
                  <div>
                    <strong>{inv.destinatario_nombre || inv.email || "Invitación"}</strong>
                    {inv.email && inv.destinatario_nombre ? <small>{inv.email}</small> : null}
                    <time>{formatDate(inv.created_at)}</time>
                  </div>
                  <span
                    className="invitar-list-state"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
