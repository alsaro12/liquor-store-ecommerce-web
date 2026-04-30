(function () {
  const { esc, money, formatQty } = window.AppCustomFunctions;
  const OPERATIONAL_DAY_ORDER = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

  function getSaleNumber(item) {
    return item["N\u00B0"] ?? item.N ?? "-";
  }

  function parseSaleDateTime(rawValue) {
    const text = String(rawValue ?? "").trim();
    if (!text) return null;

    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0),
        0
      );
    }

    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      return new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0),
        0
      );
    }

    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function getOperationalDayLabel(item) {
    const fromApi = String(item?.DIA_TURNO || "").trim();
    if (fromApi) return fromApi;

    const saleDateTime = parseSaleDateTime(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
    if (!saleDateTime) return "-";

    const businessDate = new Date(saleDateTime);
    const hour = businessDate.getHours();
    if (hour < 5) {
      businessDate.setDate(businessDate.getDate() - 1);
    }

    const dayName = OPERATIONAL_DAY_ORDER[businessDate.getDay()] || "";
    if (!dayName) return "-";
    return dayName.charAt(0).toUpperCase() + dayName.slice(1);
  }

  function renderSalesRows(rows) {
    return rows
      .map((item) => {
        const status = String(item.ESTADO || "ACTIVA").toUpperCase() === "ANULADA" ? "ANULADA" : "ACTIVA";
        const isCancelled = status === "ANULADA";
        const payment = String(item.TIPO_PAGO_DETALLE || item.TIPO_PAGO || "Efectivo");
        const saleNumber = getSaleNumber(item);
        const paymentParts = payment
          .split(/\s+\+\s+/)
          .map((part) => String(part || "").trim())
          .filter(Boolean);
        const paymentMarkup = (paymentParts.length ? paymentParts : [payment])
          .map((part) => `<span class="sales-payment-badge">${esc(part)}</span>`)
          .join("");

        return `
      <tr>
        <td><span class="sales-cell-date">${esc(getOperationalDayLabel(item))}</span></td>
        <td><span class="sales-cell-date sales-cell-date-strong">${esc(item.FECHA_REFERENCIA || "-")}</span></td>
        <td><span class="sales-id-chip">${esc(saleNumber)}</span></td>
        <td><div class="sales-product-cell"><strong>${esc(item.NOMBRE || "-")}</strong></div></td>
        <td><span class="sales-qty-chip">${formatQty(item.CANTIDAD)}</span></td>
        <td><span class="sales-money-soft">${money(item.PRECIO)}</span></td>
        <td><strong class="sales-money-strong">${money(item.TOTAL)}</strong></td>
        <td><div class="sales-payment-stack">${paymentMarkup}</div></td>
        <td><span class="tag ${isCancelled ? "is-warn" : "is-ok"}">${esc(status)}</span></td>
        <td>
          <div class="sales-row-actions">
            <button class="action-btn edit" data-action="edit-sale" data-sale-id="${item.ID_VENTA}" type="button" ${
              isCancelled ? "disabled" : ""
            }>Editar</button>
            <button class="action-btn delete" data-action="delete-sale" data-sale-id="${item.ID_VENTA}" type="button" ${
              isCancelled ? "disabled" : ""
            }>
              Anular
            </button>
          </div>
        </td>
      </tr>
    `;
      })
      .join("");
  }

  window.SalesTableComponent = { renderSalesRows };
})();
