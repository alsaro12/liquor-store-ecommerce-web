(function () {
  const { esc, money, formatQty } = window.AppCustomFunctions;

  function getProductId(item) {
    return Number(item?.["N\u00B0"] ?? item?.id ?? 0);
  }

  function getProductAlert(item) {
    if (item?.ALERTA_STOCK) {
      const severity = String(item?.ALERTA_SEVERIDAD || "OK").toUpperCase();
      return {
        label: String(item.ALERTA_STOCK),
        className: severity === "OK" ? "is-ok" : "is-warn"
      };
    }

    const stock = Number(item?.STOCK_ACTUAL ?? 0);
    const stockMinimo = Number(item?.STOCK_MINIMO ?? 0);
    if (stockMinimo > 0 && stock < stockMinimo) return { label: "BAJO", className: "is-warn" };
    return { label: "OK", className: "is-ok" };
  }

  function normalizeProductImageItem(item) {
    if (item && typeof item === "object") {
      const originalWebp = String(item.original_webp_url || item.originalWebpUrl || "").trim();
      const thumbWebp = String(item.thumb_webp_url || item.thumbWebpUrl || "").trim();
      const original = String(item.original_image_url || item.originalImageUrl || item.original || item.url || item.src || "").trim();
      const filtered = String(item.filtered_image_url || item.filteredImageUrl || item.filtered || item.url || item.src || "").trim();
      if (!original && !filtered && !originalWebp && !thumbWebp) return null;
      return {
        original_image_url: original || originalWebp || filtered || thumbWebp,
        filtered_image_url: filtered || thumbWebp || originalWebp || original,
        original_webp_url: originalWebp || original || filtered || thumbWebp,
        thumb_webp_url: thumbWebp || filtered || originalWebp || original
      };
    }
    const src = String(item || "").trim();
    if (!src) return null;
    return {
      original_image_url: src,
      filtered_image_url: src,
      original_webp_url: src,
      thumb_webp_url: src
    };
  }

  function getProductCoverSrc(item) {
    const source = Array.isArray(item?.IMAGENES) ? item.IMAGENES : [];
    const cover = source.map(normalizeProductImageItem).filter(Boolean)[0];
    return cover?.thumb_webp_url || cover?.filtered_image_url || cover?.original_webp_url || cover?.original_image_url || "";
  }

  function getDescriptionMeta(item) {
    const description = String(item?.DESCRIPCION || item?.DESCRIPCIÓN || "").trim();
    if (!description) {
      return {
        className: "is-empty",
        icon: "○",
        label: "Sin descripción",
        preview: "Vacío"
      };
    }
    const compact = description.replace(/\s+/g, " ").trim();
    return {
      className: "is-filled",
      icon: "≡",
      label: "Con descripción",
      preview: compact.length > 88 ? `${compact.slice(0, 88)}...` : compact
    };
  }

  function renderProductRows(rows) {
    return rows
      .map((item) => {
        const productId = getProductId(item);
        const alert = getProductAlert(item);
        const status = String(item?.ESTADO || "ACTIVO");
        const coverSrc = getProductCoverSrc(item);
        const descriptionMeta = getDescriptionMeta(item);
        return `
      <tr>
        <td class="product-table-code-cell">${productId || "-"}</td>
        <td>${esc(item.NOMBRE)}</td>
        <td>
          ${
            coverSrc
              ? `<div class="product-table-cover"><img src="${coverSrc}" alt="Portada de ${esc(item.NOMBRE)}" /></div>`
              : '<div class="product-table-cover is-empty" aria-label="Sin portada">+</div>'
          }
        </td>
        <td>
          <div class="product-table-description ${descriptionMeta.className}">
            <span class="product-table-description-badge ${descriptionMeta.className}">
              <span class="product-table-description-icon" aria-hidden="true">${descriptionMeta.icon}</span>
              <span>${esc(descriptionMeta.label)}</span>
            </span>
            <span class="product-table-description-text">${esc(descriptionMeta.preview)}</span>
          </div>
        </td>
        <td>${esc(item.CATEGORIA || "OTROS")}</td>
        <td>${money(item.PRECIO)}</td>
        <td>${formatQty(item.STOCK_ACTUAL)}</td>
        <td>${formatQty(item.STOCK_MAXIMO ?? item.PEDIDO ?? 0)}</td>
        <td><span class="tag ${alert.className}">${esc(alert.label)}</span></td>
        <td><span class="tag ${status === "INACTIVO" ? "is-warn" : "is-ok"}">${esc(status)}</span></td>
        <td>
          <button class="action-btn ingreso" data-action="ingreso" data-id="${productId}" type="button">Ingreso</button>
          <button class="action-btn edit" data-action="edit" data-id="${productId}" type="button">Editar</button>
          <button class="action-btn delete" data-action="delete" data-id="${productId}" type="button">Inactivar</button>
        </td>
      </tr>
    `;
      })
      .join("");
  }

  window.ProductTableComponent = { renderProductRows, getProductAlert, getProductId };
})();
