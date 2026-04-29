(function () {
  const { esc, formatQty } = window.AppCustomFunctions;

  function getProductCode(item) {
    return item["N\u00B0"] ?? item.N ?? item.ID ?? "-";
  }

  function renderKardexRows(rows) {
    return rows
      .map(
        (item) => `
      <tr>
        <td>${esc(item.FECHA_HORA)}</td>
        <td>${esc(getProductCode(item))}</td>
        <td>${esc(item.NOMBRE)}</td>
        <td><span class="tag ${item.TIPO === "INGRESO" ? "is-ok" : "is-warn"}">${esc(item.TIPO)}</span></td>
        <td>${formatQty(item.CANTIDAD)}</td>
        <td>${formatQty(item.STOCK_ANTES)}</td>
        <td>${formatQty(item.STOCK_DESPUES)}</td>
        <td>${esc(item.REFERENCIA || "-")}</td>
        <td>
          <button class="action-btn delete" data-action="delete-kardex" data-id="${item.ID_MOV}" type="button">
            Eliminar
          </button>
        </td>
      </tr>
    `
      )
      .join("");
  }

  window.KardexTableComponent = { renderKardexRows };
})();
