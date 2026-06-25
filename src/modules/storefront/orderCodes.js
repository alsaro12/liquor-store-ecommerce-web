export function getPublicOrderCode(orderOrCode) {
  if (orderOrCode && typeof orderOrCode === "object") {
    return String(orderOrCode.publicCode || orderOrCode.customerCode || orderOrCode.id || "").trim();
  }
  return String(orderOrCode || "").trim();
}

export function displayOrderCode(orderOrCode) {
  const code = getPublicOrderCode(orderOrCode);
  return code || "-";
}
