import { apiFetch } from "./httpClient.js";

const READ_KEY = "licoreria_notificaciones_leidas";

const LOCAL_NOTIFICATIONS = [
  {
    id: "local-pago",
    tipo: "pedido",
    titulo: "Pago por Yape o Plin",
    mensaje: "Cuando cierres tu pedido, yapea o plinea al 987227110 y escribe por WhatsApp: ya pague.",
    link: "/pagos",
    created_at: new Date().toISOString()
  },
  {
    id: "local-pedido",
    tipo: "pedido",
    titulo: "Seguimiento de pedido",
    mensaje: "Tu pedido se confirma por WhatsApp despues de validar el pago.",
    link: "/pedidos",
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: "local-club",
    tipo: "club",
    titulo: "Club La Licoreria",
    mensaje: "Completa metas, suma boletos y revisa tu sorteo mensual desde Mi Club.",
    link: "/club",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString()
  }
];

function readIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeIds(ids) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    // Local persistence is best effort only.
  }
}

function localList({ tipo = "", soloNoLeidas = false } = {}) {
  const read = readIds();
  return LOCAL_NOTIFICATIONS
    .map((item) => ({ ...item, leida: read.has(String(item.id)) }))
    .filter((item) => (!tipo || item.tipo === tipo) && (!soloNoLeidas || !item.leida));
}

export async function listNotificaciones({ tipo = "", soloNoLeidas = false } = {}) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  if (soloNoLeidas) params.set("soloNoLeidas", "1");
  const qs = params.toString();
  try {
    return await apiFetch(`/api/notificaciones${qs ? `?${qs}` : ""}`);
  } catch {
    return localList({ tipo, soloNoLeidas });
  }
}

export async function countNoLeidas() {
  try {
    return await apiFetch("/api/notificaciones/no-leidas");
  } catch {
    return { total: localList({ soloNoLeidas: true }).length };
  }
}

export async function leerNotificacion(id) {
  try {
    return await apiFetch(`/api/notificaciones/${id}/leer`, { method: "POST", body: {} });
  } catch {
    const ids = readIds();
    ids.add(String(id));
    writeIds(ids);
    return { ok: true };
  }
}

export async function leerTodasNotificaciones() {
  try {
    return await apiFetch("/api/notificaciones/leer-todas", { method: "POST", body: {} });
  } catch {
    writeIds(new Set(LOCAL_NOTIFICATIONS.map((item) => String(item.id))));
    return { ok: true };
  }
}
