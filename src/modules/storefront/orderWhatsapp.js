export const ADMIN_WHATSAPP_NUMBER = "51940189609";
export const YAPE_NUMBER = "940189609";
const ORDER_STORAGE_KEY = "licoreria_order_details_v1";

function publicOrderCode(order) {
  return String(order?.publicCode || order?.customerCode || order?.id || "").trim();
}

export function formatOrderMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

export function getOrderDetailUrl(orderId) {
  if (typeof window === "undefined") return `/pedido/${encodeURIComponent(orderId)}`;
  return `${window.location.origin}/pedido/${encodeURIComponent(orderId)}`;
}

export function saveOrderDetail(order) {
  if (typeof window === "undefined" || !order?.id) return;
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    const code = publicOrderCode(order);
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify({
      ...current,
      [String(order.id)]: order,
      ...(code ? { [code]: order } : {})
    }));
  } catch {}
}

export function loadOrderDetail(orderId) {
  if (typeof window === "undefined" || !orderId) return null;
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    return current?.[String(orderId)] || null;
  } catch {
    return null;
  }
}

export function buildWhatsappOrderMessage(order) {
  const lines = [];
  const customer = order?.customer || {};
  const items = Array.isArray(order?.items) ? order.items : [];
  const delivery = order?.delivery || {};
  const totals = order?.totals || {};
  const code = publicOrderCode(order);
  const detailUrl = order?.detailUrl || getOrderDetailUrl(code || order?.id || "");
  const isDelivery = delivery.mode === "delivery";
  const deliveryTotal = Number(totals.shipping || 0);

  lines.push("Hola, quiero realizar el siguiente pedido:");
  lines.push(`*Pedido #${code || "-"}*`);
  lines.push(`*TOTAL A PAGAR: ${formatOrderMoney(totals.total)}*`);
  lines.push(`*Yapear a: ${YAPE_NUMBER} Grecia Chirinos*`);
  lines.push("En cuanto realice el Yape enviaré la captura para confirmar el pedido.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━");
  lines.push("*PRODUCTOS*");
  lines.push("");
  items.forEach((item) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 1);
    const comboItems = Array.isArray(item.items) ? item.items.filter((line) => line?.name) : [];
    lines.push(`• ${item.quantity || 1} × ${item.name || "Producto"} — ${formatOrderMoney(itemTotal)}`);
    if (comboItems.length) {
      lines.push("  Detalle del combo:");
      comboItems.forEach((line) => {
        lines.push(`  - ${line.quantity || 1} × ${line.name}`);
      });
    }
  });
  lines.push("");
  lines.push(`🧾 Subtotal: ${formatOrderMoney(totals.subtotal)}`);
  lines.push(isDelivery ? `🚚 Delivery: ${formatOrderMoney(deliveryTotal)}` : "🏬 Recojo en tienda");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━");
  lines.push("📍 *DATOS DE ENTREGA*");
  lines.push("");
  lines.push(`👤 ${customer.name || "-"}`);
  lines.push(`📞 ${customer.phone || "-"}`);
  if (isDelivery) {
    const deliveryLine = [
      delivery.location,
      delivery.address,
      delivery.reference,
      delivery.coords ? `Coordenadas: ${delivery.coords}` : ""
    ].filter(Boolean).join(" · ");
    if (deliveryLine) lines.push(`📌 ${deliveryLine}`);
  } else if (delivery.pickupDate) {
    lines.push(`🏬 Recojo en tienda · ${delivery.pickupDate}`);
  }
  lines.push("");
  lines.push("━━━━━━━━━━━━━━");
  lines.push(`📝 *NOTAS* ${order?.notes || "Sin notas adicionales."}`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("🔗 Detalle del pedido:");
  lines.push(detailUrl);

  return lines.join("\n");
}

export function getWhatsappOrderUrl(order) {
  return `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(buildWhatsappOrderMessage(order))}`;
}
