import { apiFetch } from "./httpClient.js";

const ADMIN_ORDERS_KEY = "licoreria_admin_orders_board";

function normalizeStatus(status) {
  return {
    pendiente: "PENDIENTE",
    validado: "VALIDADO",
    camino: "EN_CAMINO",
    entregado: "ENTREGADO",
    rechazado: "RECHAZADO",
    cancelado: "CANCELADO"
  }[String(status || "").toLowerCase()] || String(status || "PENDIENTE").toUpperCase();
}

function localOrders() {
  try {
    const items = JSON.parse(localStorage.getItem(ADMIN_ORDERS_KEY) || "[]");
    return Array.isArray(items) ? items.map((order) => ({
      id: order.id,
      publicCode: order.publicCode || order.customerCode || "",
      status: normalizeStatus(order.status),
      statusReason: order.reason || "",
      customer: { name: order.customer, phone: order.phone },
      delivery: {
        address: order.address,
        location: order.address,
        mode: "delivery",
        latitud: order.latitud ?? order.customer?.latitud ?? null,
        longitud: order.longitud ?? order.customer?.longitud ?? null,
        distrito: order.distrito ?? order.customer?.distrito ?? "",
        ciudad: order.ciudad ?? order.customer?.ciudad ?? ""
      },
      createdAt: order.createdAt,
      total: order.total,
      totals: { total: order.total },
      payment: order.payment,
      items: (order.items || []).map((entry, index) => {
        if (entry && typeof entry === "object") {
          return {
            ...entry,
            productId: entry.productId || entry.id || `${order.id}-${index}`,
            name: entry.name || entry.nombre || `Producto ${index + 1}`,
            quantity: Number(entry.quantity || entry.cantidad || 1),
            price: Number(entry.price || entry.precio || 0),
            items: Array.isArray(entry.items) ? entry.items : []
          };
        }
        return {
          productId: `${order.id}-${index}`,
          name: entry,
          quantity: 1,
          price: 0,
          items: []
        };
      })
    })) : [];
  } catch {
    return [];
  }
}

function filterLocalOrders(items, filtro) {
  const key = String(filtro || "todos");
  if (key === "todos") return items;
  const groups = {
    pendientes: ["PENDIENTE", "VALIDADO"],
    en_camino: ["EN_CAMINO"],
    entregados: ["ENTREGADO"],
    cancelados: ["CANCELADO", "RECHAZADO"]
  };
  return items.filter((order) => (groups[key] || []).includes(order.status));
}

export async function fetchMyOrders(filtro = "todos") {
  try {
    return await apiFetch(`/api/orders/mias?estado=${encodeURIComponent(filtro)}`);
  } catch {
    return filterLocalOrders(localOrders(), filtro);
  }
}

export async function fetchMyOrderById(codigo) {
  try {
    return await apiFetch(`/api/orders/mias/${encodeURIComponent(codigo)}`);
  } catch {
    try {
      return await apiFetch(`/api/orders/public/${encodeURIComponent(codigo)}`, { auth: false });
    } catch {
      return localOrders().find((order) => (
        String(order.publicCode || "") === String(codigo) ||
        String(order.id) === String(codigo)
      )) || null;
    }
  }
}

export async function repeatMyOrder(codigo) {
  return apiFetch(`/api/orders/mias/${encodeURIComponent(codigo)}/repetir`, { method: "POST", body: {} });
}
