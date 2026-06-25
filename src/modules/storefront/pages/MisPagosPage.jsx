import React, { useState } from "react";

const YAPE_PHONE = "940189609";
const PAYMENT_QR_URL = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(YAPE_PHONE)}`;
const WHATSAPP_MESSAGE = `Hola, ya pague por Yape/Plin al ${YAPE_PHONE}. Te mando la captura del pago.`;

const STEPS = [
  {
    title: "Arma tu pedido",
    body: "Elige productos, confirma entrega y envía el resumen por WhatsApp."
  },
  {
    title: "Paga por Yape o Plin",
    body: `Usa el ${YAPE_PHONE} y paga el total exacto del pedido.`
  },
  {
    title: "Manda captura",
    body: "Adjunta la captura del pago para validar y atenderte más rápido."
  }
];

export default function MisPagosPage() {
  const [copied, setCopied] = useState("");

  async function copyText(kind, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? "" : current)), 1800);
    } catch {
      setCopied("");
    }
  }

  return (
    <section className="page-shell pagos-guide-page">
      <header className="page-head pagos-guide-head">
        <div>
          <span className="pagos-guide-kicker">Pago fuera de la app</span>
          <h1>COMO PAGAR TU PEDIDO</h1>
          <p>
            Tu pedido se coordina por WhatsApp. Paga por Yape o Plin y envía la captura
            para validar más rápido.
          </p>
        </div>
      </header>

      <section className="pagos-guide-hero" aria-label="Numero de pago por Yape">
        <div>
          <span>Yape o Plin a este numero</span>
          <div className="pagos-guide-paybox">
            <div className="pagos-guide-number">
              <strong>{YAPE_PHONE}</strong>
              <button type="button" onClick={() => copyText("phone", YAPE_PHONE)}>
                {copied === "phone" ? "Copiado" : "Copiar numero"}
              </button>
            </div>
            <div className="pagos-guide-qr">
              <img src={PAYMENT_QR_URL} alt={`QR de pago para el numero ${YAPE_PHONE}`} loading="lazy" />
            </div>
          </div>
          <p>Después de enviar el pedido, paga y manda la captura del pago para atenderte más rápido.</p>
        </div>
      </section>

      <section className="pagos-guide-steps" aria-label="Como funciona el pago">
        {STEPS.map((step, index) => (
          <article key={step.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="pagos-guide-note">
        <div className="pagos-guide-note-head">
          <h3>Mensaje sugerido para WhatsApp</h3>
          <button type="button" onClick={() => copyText("message", WHATSAPP_MESSAGE)}>
            {copied === "message" ? "Copiado" : "Copiar mensaje"}
          </button>
        </div>
        <p>{WHATSAPP_MESSAGE}</p>
      </section>
    </section>
  );
}
