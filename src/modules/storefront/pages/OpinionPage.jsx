import React, { useState } from "react";
import { createOpinion } from "../opinionesApi.js";

const MAX_COMMENT_LENGTH = 2000;

export default function OpinionPage({ user }) {
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submitOpinion(event) {
    event.preventDefault();
    const clean = comentario.trim();
    setError("");
    setSuccess(false);
    if (clean.length < 5) {
      setError("Cuéntanos un poco más para poder revisar tu opinión.");
      return;
    }
    if (clean.length > MAX_COMMENT_LENGTH) {
      setError("Tu opinión no puede superar 2000 caracteres.");
      return;
    }
    setSaving(true);
    try {
      await createOpinion({
        comentario: clean,
        usuarioId: user?.id || "",
        nombre: user?.nombre || "",
        telefono: user?.telefono || "",
        email: user?.email || "",
        sourceRoute: window.location.pathname || "/opinion"
      });
      setComentario("");
      setSuccess(true);
    } catch (err) {
      setError(err?.message || "No se pudo enviar tu opinión.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-shell opinion-page">
      <header className="page-head opinion-page-head">
        <div>
          <h1>CUÉNTANOS TU OPINIÓN</h1>
          <p>Déjanos saber qué podemos mejorar o qué te gustó de tu experiencia.</p>
        </div>
      </header>

      <article className="cuenta-card opinion-card">
        <header>
          <div>
            <h3>Tu comentario</h3>
            <p>Lo revisará el equipo de La Licorería desde el panel admin.</p>
          </div>
          <span className="cuenta-profile-state">{success ? "Enviada" : "Nueva"}</span>
        </header>

        <form className="opinion-form" onSubmit={submitOpinion}>
          <label>
            <span>Opinión</span>
            <textarea
              value={comentario}
              onChange={(event) => {
                setSuccess(false);
                setComentario(event.target.value);
              }}
              maxLength={MAX_COMMENT_LENGTH}
              rows={7}
              placeholder="Escribe aquí tu comentario..."
              required
            />
          </label>
          <div className="opinion-form-foot">
            <small>{comentario.length}/{MAX_COMMENT_LENGTH}</small>
            <button type="submit" className="page-cta" disabled={saving}>
              {saving ? "Enviando..." : "Enviar opinión"}
            </button>
          </div>
        </form>

        {success ? <p className="page-status opinion-success">Gracias. Tu opinión fue enviada correctamente.</p> : null}
        {error ? <p className="page-status page-status-error">{error}</p> : null}
      </article>
    </section>
  );
}
