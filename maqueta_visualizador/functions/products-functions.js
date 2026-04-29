(function () {
  const { normalizeText, normalizeNumericText, paginate } = window.AppCustomFunctions;
  const { renderProductRows, getProductId, getProductAlert } = window.ProductTableComponent;

  function productIdText(product) {
    return String(getProductId(product) || "");
  }

  function matchProduct(product, rawTerm) {
    const term = String(rawTerm ?? "").trim();
    if (!term) return true;

    const termNorm = normalizeText(term);
    const termNum = normalizeNumericText(term);
    const alert = getProductAlert(product);
    const idText = productIdText(product);
    const nameText = normalizeText(product.NOMBRE ?? "");
    const categoryText = normalizeText(product.CATEGORIA ?? "");
    const statusText = normalizeText(product.ESTADO ?? "ACTIVO");
    const stockMaximoText = String(product.STOCK_MAXIMO ?? product.PEDIDO ?? "");
    const pedidoSugeridoText = String(product.PEDIDO_SUGERIDO ?? "");
    const stockText = String(product.STOCK_ACTUAL ?? "");
    const stockMinText = String(product.STOCK_MINIMO ?? "");
    const alertText = normalizeText(alert.label);

    const price = Number(product.PRECIO ?? 0);
    const purchasePrice = Number(product.PRECIO_COMPRA ?? 0);
    const priceRaw = String(product.PRECIO ?? "");
    const purchasePriceRaw = String(product.PRECIO_COMPRA ?? "");
    const priceShort = String(price);
    const priceFixed = Number.isFinite(price) ? price.toFixed(2) : "";
    const priceComma = priceFixed.replace(".", ",");
    const purchasePriceFixed = Number.isFinite(purchasePrice) ? purchasePrice.toFixed(2) : "";
    const purchasePriceComma = purchasePriceFixed.replace(".", ",");
    const priceCandidates = [priceRaw, priceShort, priceFixed, priceComma, purchasePriceRaw, purchasePriceFixed, purchasePriceComma];

    const matchesText =
      idText.includes(term) ||
      stockMaximoText.includes(term) ||
      pedidoSugeridoText.includes(term) ||
      stockText.includes(term) ||
      stockMinText.includes(term) ||
      categoryText.includes(termNorm) ||
      statusText.includes(termNorm) ||
      alertText.includes(termNorm) ||
      nameText.includes(termNorm);

    if (matchesText) return true;

    return priceCandidates.some((candidate) => {
      const candidateText = String(candidate);
      return candidateText.includes(term) || normalizeNumericText(candidateText).includes(termNum);
    });
  }

  function applyProductFilterAndPagination(state) {
    if (state.serverBackedTables) {
      state.filteredProducts = Array.isArray(state.products) ? [...state.products] : [];
      state.pagedProducts = state.filteredProducts;
      return;
    }

    const term = state.crudSearch;
    state.filteredProducts = state.products.filter((item) => matchProduct(item, term));

    const paged = paginate(state.filteredProducts, state.pagination.page, state.pagination.pageSize);
    state.pagedProducts = paged.items;
    state.pagination = paged.pagination;
  }

  function renderCrudTable(refs, state) {
    const rows = state.pagedProducts || [];
    refs.crudBody.innerHTML = rows.length
      ? renderProductRows(rows)
      : '<tr><td class="empty" colspan="11">No hay productos para este filtro.</td></tr>';
  }

  function renderPager(refs, state) {
    const meta = state.pagination;
    refs.crudPrevBtn.disabled = !meta.hasPrev;
    refs.crudNextBtn.disabled = !meta.hasNext;
    refs.crudPageSize.value = String(meta.pageSize);
    refs.crudPageInfo.textContent = `Página ${meta.page} de ${meta.totalPages} - ${meta.totalItems} resultados`;
  }

  function refreshLocalProducts(state, refs) {
    applyProductFilterAndPagination(state);
    renderCrudTable(refs, state);
    renderPager(refs, state);
  }

  function createController(deps) {
    const {
      state,
      refs,
      apiRequest,
      parseNumberInput,
      parseIntegerInput,
      formatQty,
      getApiBaseUrl,
      setCrudMessage,
      setIngressMessage,
      openConfirmDialog,
      refreshAll,
      renderSortButtons,
      buildCollectionQuery,
      matchOperationalDayRange,
      getCurrentOperationalDayKey,
      getCurrentOperationalBaseDate,
      toLocalIsoDate,
      formatOperationalDateLabel,
      defaultPagination
    } = deps;
    let currentProductImages = [];
    let pendingImageReplacement = null;
    let historyRowsCache = [];
    let historyDateFrom = "";
    let historyDateTo = "";
    const defaultProductCategories = [
      "AGUA",
      "CERVEZA",
      "CIGARRO",
      "COCTEL",
      "ENERGIZANTE",
      "ESPUMANTE",
      "GASEOSA",
      "GIN",
      "HIELO",
      "JUGO",
      "LICOR",
      "PISCO",
      "RON",
      "SNACK",
      "TEQUILA",
      "VINO",
      "VODKA",
      "WHISKY",
      "ACCESORIO",
      "OTRO"
    ];
    const productCategorySet = new Set(defaultProductCategories);
    const productCategoryAliases = new Map([
      ["AGUAS", "AGUA"],
      ["BEBIDA", "GASEOSA"],
      ["BEBIDAS", "GASEOSA"],
      ["CERVEZAS", "CERVEZA"],
      ["CHAMPAGNE", "ESPUMANTE"],
      ["CIGARROS", "CIGARRO"],
      ["COCTELES", "COCTEL"],
      ["ENERGIZANTES", "ENERGIZANTE"],
      ["ESPUMANTES", "ESPUMANTE"],
      ["GASEOSAS", "GASEOSA"],
      ["GINS", "GIN"],
      ["HIELOS", "HIELO"],
      ["JUGOS", "JUGO"],
      ["LICORES", "LICOR"],
      ["PISCOS", "PISCO"],
      ["REFRESCO", "GASEOSA"],
      ["REFRESCOS", "GASEOSA"],
      ["RONES", "RON"],
      ["SNACKS", "SNACK"],
      ["TEQUILAS", "TEQUILA"],
      ["VINO", "VINO"],
      ["VINOS", "VINO"],
      ["VODKAS", "VODKA"],
      ["WHISKEY", "WHISKY"],
      ["WHISKIES", "WHISKY"],
      ["ACCESORIOS", "ACCESORIO"],
      ["OTROS", "OTRO"]
    ]);

    function normalizeProductCategory(value) {
      const raw = String(value || "").trim().toUpperCase();
      if (!raw) return "OTRO";
      const clean = raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!clean) return "OTRO";
      const normalized = productCategoryAliases.get(clean) || clean;
      return productCategorySet.has(normalized) ? normalized : "OTRO";
    }

    function getKnownProductCategories() {
      return [...productCategorySet].sort((a, b) => a.localeCompare(b, "es"));
    }

    function renderProductCategoryOptions() {
      if (!refs.crudCategoria) return;
      const current = normalizeProductCategory(refs.crudCategoria.value || "OTRO");
      const categories = getKnownProductCategories();
      refs.crudCategoria.innerHTML = categories
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((category) => `<option value="${category}">${category}</option>`)
        .join("");
      refs.crudCategoria.value = current;
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
          thumb_webp_url: thumbWebp || filtered || originalWebp || original,
          mime: String(item.mime || "image/webp").trim() || "image/webp",
          width: Number(item.width || 0) || 0,
          height: Number(item.height || 0) || 0,
          status: String(item.status || (filtered || originalWebp || thumbWebp ? "completed" : "pending")).trim() || "pending",
          error: String(item.error || "").trim()
        };
      }
      const src = String(item || "").trim();
      if (!src) return null;
      return {
        original_image_url: src,
        filtered_image_url: src,
        original_webp_url: src,
        thumb_webp_url: src,
        mime: "image/webp",
        width: 0,
        height: 0,
        status: "pending",
        error: ""
      };
    }

    function getFilteredProductImageSrc(item) {
      const image = normalizeProductImageItem(item);
      return image?.thumb_webp_url || image?.filtered_image_url || image?.original_webp_url || image?.original_image_url || "";
    }

    function getOriginalProductImageSrc(item) {
      const image = normalizeProductImageItem(item);
      return image?.original_webp_url || image?.original_image_url || image?.filtered_image_url || image?.thumb_webp_url || "";
    }

    function formatHistoryAmount(value, currency = false) {
      const num = Number(value ?? 0);
      if (!Number.isFinite(num)) return "-";
      return currency ? `S/ ${num.toFixed(2)}` : formatQty(num);
    }

    function toggleHistoryActions(isEdit) {
      if (!refs.productHistoryActions) return;
      refs.productHistoryActions.hidden = !isEdit;
      if (refs.crudMovementHistoryBtn) refs.crudMovementHistoryBtn.disabled = !isEdit;
      if (refs.crudPurchasePriceHistoryBtn) refs.crudPurchasePriceHistoryBtn.disabled = !isEdit;
    }

    function closeHistoryDialog() {
      if (refs.productHistoryDialog?.open) refs.productHistoryDialog.close();
    }

    function normalizeHistoryDayKey(value) {
      const normalized = normalizeText(value || "");
      if (normalized.startsWith("mier")) return "miércoles";
      if (normalized.startsWith("sab")) return "sábado";
      return normalized;
    }

    function syncHistoryFilterControls() {
      if (refs.productHistoryDateFrom) refs.productHistoryDateFrom.value = historyDateFrom;
      if (refs.productHistoryDateTo) refs.productHistoryDateTo.value = historyDateTo;
      if (refs.productHistoryDateFromHint) {
        const fromLabel = formatOperationalDateLabel(historyDateFrom || "");
        refs.productHistoryDateFromHint.textContent = fromLabel ? `Turno ${fromLabel}` : "Turno -";
      }
      if (refs.productHistoryDateToHint) {
        const toLabel = formatOperationalDateLabel(historyDateTo || "");
        refs.productHistoryDateToHint.textContent = toLabel ? `Turno ${toLabel}` : "Turno -";
      }
    }

    function getFilteredHistoryRows() {
      return historyRowsCache.filter((row) =>
        matchOperationalDayRange(row.rawDate || row.fecha || row.FECHA_HORA || "", historyDateFrom, historyDateTo)
      );
    }

    function renderHistoryRows(rows) {
      if (!refs.productHistoryTableBody || !refs.productHistoryEmpty) return;
      if (!Array.isArray(rows) || rows.length === 0) {
        refs.productHistoryTableBody.innerHTML = "";
        refs.productHistoryEmpty.hidden = false;
        return;
      }
      refs.productHistoryEmpty.hidden = true;
      refs.productHistoryTableBody.innerHTML = rows
        .map((row) => {
          const date = String(row.fecha || row.FECHA_HORA || "-");
          const type = String(row.tipo || row.TIPO || "-");
          const detail = String(row.detalle || row.NOTA || row.REFERENCIA || "-");
          const amount = String(row.monto || row.CANTIDAD || row.PRECIO_COMPRA || "-");
          return `
            <tr>
              <td>${date}</td>
              <td>${type}</td>
              <td>${detail}</td>
              <td>${amount}</td>
            </tr>
          `;
        })
        .join("");
    }

    function renderCurrentHistoryRows() {
      renderHistoryRows(getFilteredHistoryRows());
    }

    function resetHistoryFilters() {
      const currentDay = toLocalIsoDate(getCurrentOperationalBaseDate(new Date()));
      historyDateFrom = currentDay;
      historyDateTo = currentDay;
      syncHistoryFilterControls();
    }

    function openHistoryDialogWithRows(title, rows) {
      if (refs.productHistoryDialogTitle) refs.productHistoryDialogTitle.textContent = title;
      historyRowsCache = Array.isArray(rows) ? rows : [];
      resetHistoryFilters();
      renderCurrentHistoryRows();
      if (refs.productHistoryDialog && !refs.productHistoryDialog.open) refs.productHistoryDialog.showModal();
    }

    function renderProductImagesPreview() {
      if (!refs.crudImagenesPreview) return;
      const maxImages = 4;
      const images = Array.isArray(currentProductImages) ? currentProductImages.slice(0, maxImages) : [];
      if (refs.productPreviewCard) {
        refs.productPreviewCard.querySelector(".product-preview-main-image")?.remove();
        const mainSrc = getFilteredProductImageSrc(images[0]);
        if (mainSrc) {
          refs.productPreviewCard.classList.add("has-image");
          refs.productPreviewCard.insertAdjacentHTML(
            "afterbegin",
            `<img class="product-preview-main-image" src="${mainSrc}" alt="Imagen principal del producto" />`
          );
        } else {
          refs.productPreviewCard.classList.remove("has-image");
        }
      }
      if (refs.productOriginalImagesBtn) {
        refs.productOriginalImagesBtn.hidden = !images.some((item) => getOriginalProductImageSrc(item));
      }

      refs.crudImagenesPreview.innerHTML = Array.from({ length: maxImages })
        .map((_, index) => {
          const image = normalizeProductImageItem(images[index]);
          const src = getFilteredProductImageSrc(image);
          const statusBadge =
            image?.status === "completed"
              ? '<span class="product-image-status is-ready">Filtrada</span>'
              : '<span class="product-image-status">Pendiente</span>';
          const filteredButton = image
            ? `<span class="product-filtered-upload" data-filtered-slot="${index}">Subir filtrada</span>`
            : "";
          const deleteButton = image
            ? `<span class="product-image-delete" data-image-delete="${index}" aria-label="Eliminar imagen ${index + 1}" title="Eliminar imagen">ðŸ—‘</span>`
            : "";
          return src
            ? `<div class="product-image-slot has-image" role="button" tabindex="0" data-image-slot="${index}"><img src="${src}" alt="Imagen ${index + 1}" />${deleteButton}${index === 0 ? '<span class="product-cover-badge">Portada</span>' : ""}${statusBadge}${filteredButton}</div>`
            : `<button type="button" class="product-image-slot" data-image-slot="${index}">+</button>`;
        })
        .join("");
    }

    function loadImagesFromProduct(item) {
      const source = Array.isArray(item?.IMAGENES) ? item.IMAGENES : [];
      currentProductImages = source.map(normalizeProductImageItem).filter(Boolean).slice(0, 4);
      renderProductImagesPreview();
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
        reader.readAsDataURL(file);
      });
    }

    function loadImageFromDataUrl(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("No se pudo preparar la imagen del producto."));
        image.src = dataUrl;
      });
    }

    function canvasToWebpDataUrl(canvas, quality = 0.82) {
      return new Promise((resolve, reject) => {
        if (!canvas?.toBlob) {
          reject(new Error("Tu navegador no pudo convertir la imagen a WebP."));
          return;
        }
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("No se pudo convertir la imagen a WebP."));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("No se pudo leer la imagen WebP."));
            reader.readAsDataURL(blob);
          },
          "image/webp",
          quality
        );
      });
    }

    async function resizeImageToWebp(dataUrl, options = {}) {
      const image = await loadImageFromDataUrl(dataUrl);
      const mode = options.mode === "contain-square" ? "contain-square" : "contain";
      const maxSize = Number(options.maxSize || 1200);
      const quality = Number(options.quality || 0.82);
      const background = options.background || "rgba(0,0,0,0)";
      const naturalWidth = image.naturalWidth || image.width || 1;
      const naturalHeight = image.naturalHeight || image.height || 1;

      if (mode === "contain-square") {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, maxSize, maxSize);
        const scale = Math.min(maxSize * 0.9 / naturalWidth, maxSize * 0.9 / naturalHeight);
        const drawWidth = Math.max(1, Math.round(naturalWidth * scale));
        const drawHeight = Math.max(1, Math.round(naturalHeight * scale));
        const drawX = Math.round((maxSize - drawWidth) / 2);
        const drawY = Math.round((maxSize - drawHeight) / 2);
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        return {
          dataUrl: await canvasToWebpDataUrl(canvas, quality),
          width: maxSize,
          height: maxSize
        };
      }

      const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      return {
        dataUrl: await canvasToWebpDataUrl(canvas, quality),
        width,
        height
      };
    }

    function drawPromoDroplet(ctx, x, y, radius, alpha = 0.36) {
      const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.42, radius * 0.12, x, y, radius);
      gradient.addColorStop(0, `rgba(255,255,255,${Math.min(0.85, alpha + 0.28)})`);
      gradient.addColorStop(0.48, `rgba(187,235,255,${alpha})`);
      gradient.addColorStop(1, "rgba(17,101,138,0.18)");
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 0.72, radius, -0.22, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.shadowColor = "rgba(3, 42, 64, 0.22)";
      ctx.shadowBlur = radius * 0.38;
      ctx.shadowOffsetY = radius * 0.15;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x - radius * 0.24, y - radius * 0.32, Math.max(1.2, radius * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, alpha + 0.35)})`;
      ctx.fill();
      ctx.restore();
    }

    async function decorateProductImage(dataUrl) {
      const image = await loadImageFromDataUrl(dataUrl);
      const size = 960;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      const bg = ctx.createLinearGradient(0, 0, size, size);
      bg.addColorStop(0, "#fff4bf");
      bg.addColorStop(0.34, "#7ee6ff");
      bg.addColorStop(0.68, "#19a8d9");
      bg.addColorStop(1, "#ff7a59");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      const sun = ctx.createRadialGradient(size * 0.2, size * 0.16, 10, size * 0.2, size * 0.16, size * 0.58);
      sun.addColorStop(0, "rgba(255,255,255,0.92)");
      sun.addColorStop(0.28, "rgba(255,235,138,0.55)");
      sun.addColorStop(1, "rgba(255,235,138,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 9; i += 1) {
        const y = 80 + i * 92;
        ctx.beginPath();
        ctx.ellipse(size * 0.5, y, size * 0.7, 22, -0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 16; i += 1) {
        const x = ((i * 131) % 900) + 30;
        const y = ((i * 73) % 780) + 70;
        const r = 18 + ((i * 19) % 48);
        const partyGlow = ctx.createRadialGradient(x, y, 0, x, y, r);
        partyGlow.addColorStop(0, "rgba(255,255,255,0.6)");
        partyGlow.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = partyGlow;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const scale = Math.min(size * 0.86 / image.naturalWidth, size * 0.82 / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const drawX = (size - drawWidth) / 2;
      const drawY = (size - drawHeight) / 2 + size * 0.04;

      ctx.save();
      ctx.shadowColor = "rgba(2, 35, 56, 0.38)";
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 24;
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();

      const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.24, size / 2, size / 2, size * 0.72);
      vignette.addColorStop(0, "rgba(255,255,255,0)");
      vignette.addColorStop(1, "rgba(0,55,85,0.22)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, size, size);

      for (let i = 0; i < 44; i += 1) {
        const x = drawX + ((i * 97) % Math.max(1, drawWidth));
        const y = drawY + ((i * 53) % Math.max(1, drawHeight));
        const r = 5 + ((i * 11) % 12);
        drawPromoDroplet(ctx, x, y, r, 0.26 + (i % 4) * 0.04);
      }

      ctx.save();
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(size * 0.1, size * 0.82);
      ctx.bezierCurveTo(size * 0.32, size * 0.73, size * 0.6, size * 0.91, size * 0.92, size * 0.76);
      ctx.stroke();
      ctx.restore();

      return canvas.toDataURL("image/jpeg", 0.84);
    }

    function normalizeFilesToDataUrls(fileList) {
      const files = Array.from(fileList || []).slice(0, 4);
      return Promise.all(
        files.map(async (file) => {
          const originalDataUrl = await fileToDataUrl(file);
          const originalWebp = await resizeImageToWebp(originalDataUrl, {
            maxSize: 1200,
            quality: 0.82
          });
          const thumbWebp = await resizeImageToWebp(originalDataUrl, {
            maxSize: 160,
            quality: 0.78,
            mode: "contain-square",
            background: "#f3f8fc"
          });
          return {
            original_image_url: originalWebp.dataUrl,
            filtered_image_url: thumbWebp.dataUrl,
            original_webp_url: originalWebp.dataUrl,
            thumb_webp_url: thumbWebp.dataUrl,
            mime: "image/webp",
            width: originalWebp.width,
            height: originalWebp.height,
            status: "completed",
            error: ""
          };
        })
      );
    }

    function clearCrudForm() {
      state.editingId = null;
      refs.crudEditId.value = "";
      refs.crudId.value = "";
      refs.crudId.disabled = false;
      refs.crudNombre.value = "";
      if (refs.crudCategoria) refs.crudCategoria.value = "OTRO";
      refs.crudDescripcion.value = "";
      refs.crudPrecio.value = "";
      refs.crudPrecioCompra.value = "0";
      refs.crudPedido.value = "0";
      refs.crudStockActual.value = "0";
      refs.crudStockActual.disabled = false;
      refs.crudStockMinimo.value = "0";
      refs.crudStockAjuste.value = "0";
      refs.crudStockAjuste.disabled = true;
      refs.crudEstado.value = "ACTIVO";
      refs.crudNota.value = "";
      currentProductImages = [];
      pendingImageReplacement = null;
      renderProductImagesPreview();
      if (refs.productOriginalImagesDialog?.open) refs.productOriginalImagesDialog.close();
      if (refs.productOriginalImagesPreview) refs.productOriginalImagesPreview.innerHTML = "";
      if (refs.crudImagenes) refs.crudImagenes.value = "";
      refs.crudSaveBtn.textContent = "Guardar producto";
      if (refs.crudHardDeleteBtn) refs.crudHardDeleteBtn.hidden = true;
      refs.productDialogTitle.textContent = "Crear producto";
      toggleHistoryActions(false);
    }

    function openDialog() {
      if (!refs.productDialog.open) refs.productDialog.showModal();
    }

    function closeDialog() {
      if (refs.productDialog.open) refs.productDialog.close();
    }

    function openOriginalImagesPreview() {
      if (!refs.productOriginalImagesDialog || !refs.productOriginalImagesPreview) return;
      const images = (Array.isArray(currentProductImages) ? currentProductImages : [])
        .map(normalizeProductImageItem)
        .filter(Boolean);
      refs.productOriginalImagesPreview.innerHTML = images.length
        ? images
            .map((item, index) => {
              const original = getOriginalProductImageSrc(item);
              const filtered = getFilteredProductImageSrc(item);
              const stateText =
                item.status === "completed"
                  ? "Foto filtrada cargada"
                  : "Pendiente de filtro manual";
              return `
                <article class="product-original-pair">
                  <header>
                    <strong>Imagen ${index + 1}${index === 0 ? " · Portada" : ""}</strong>
                    <span>${stateText}</span>
                  </header>
                  <div class="product-original-pair-grid">
                    <figure>
                      <img src="${original}" alt="Foto original ${index + 1}" />
                      <figcaption>Original</figcaption>
                      <button class="product-image-replace-btn" type="button" data-replace-image="original" data-replace-slot="${index}">Cambiar original</button>
                    </figure>
                    <figure>
                      <img src="${filtered || original}" alt="Foto filtrada ${index + 1}" />
                      <figcaption>${filtered ? "Filtrada" : "Pendiente"}</figcaption>
                      <button class="product-image-replace-btn" type="button" data-replace-image="filtered" data-replace-slot="${index}">Cambiar filtrada</button>
                    </figure>
                  </div>
                </article>
              `;
            })
            .join("")
        : '<p class="empty">Aún no hay fotos para comparar.</p>';
      if (!refs.productOriginalImagesDialog.open) refs.productOriginalImagesDialog.showModal();
    }

    function closeOriginalImagesPreview() {
      if (refs.productOriginalImagesDialog?.open) refs.productOriginalImagesDialog.close();
    }

    function openFilteredImagePicker(slotIndex) {
      openImageReplacementPicker(slotIndex, "filtered");
    }

    function openImageReplacementPicker(slotIndex, target) {
      const index = Number(slotIndex);
      if (!Number.isInteger(index) || index < 0 || index >= 4) return;
      if (!currentProductImages[index]) return;
      const normalizedTarget = target === "original" ? "original" : "filtered";
      pendingImageReplacement = { slotIndex: index, target: normalizedTarget };
      refs.crudImagenFiltrada?.click();
    }

    async function handleFilteredImageChange(event) {
      try {
        const file = event?.target?.files?.[0];
        const replacement = pendingImageReplacement;
        pendingImageReplacement = null;
        const index = Number(replacement?.slotIndex);
        const target = replacement?.target === "original" ? "original" : "filtered";
        if (!file || !Number.isInteger(index) || !currentProductImages[index]) return;
        const sourceDataUrl = await fileToDataUrl(file);
        const imageDataUrl =
          target === "original"
            ? await resizeImageToWebp(sourceDataUrl, { maxSize: 1200, quality: 0.82 })
            : await resizeImageToWebp(sourceDataUrl, {
                maxSize: 160,
                quality: 0.78,
                mode: "contain-square",
                background: "#f3f8fc"
              });
        const current = normalizeProductImageItem(currentProductImages[index]);
        if (target === "original") {
          currentProductImages[index] = {
            ...current,
            original_image_url: imageDataUrl.dataUrl,
            original_webp_url: imageDataUrl.dataUrl,
            width: imageDataUrl.width,
            height: imageDataUrl.height,
            mime: "image/webp",
            status: current.filtered_image_url ? "completed" : "pending",
            error: ""
          };
        } else {
          currentProductImages[index] = {
            ...current,
            filtered_image_url: imageDataUrl.dataUrl,
            thumb_webp_url: imageDataUrl.dataUrl,
            mime: "image/webp",
            status: "completed",
            error: ""
          };
        }
        renderProductImagesPreview();
        if (refs.productOriginalImagesDialog?.open) openOriginalImagesPreview();
        setCrudMessage(
          `${target === "original" ? "Foto original" : "Foto filtrada"} actualizada para imagen ${index + 1}.`,
          "is-success"
        );
      } catch (error) {
        setCrudMessage(error.message || "No se pudo cargar la foto.", "is-error");
      } finally {
        if (refs.crudImagenFiltrada) refs.crudImagenFiltrada.value = "";
      }
    }

    function removeProductImage(slotIndex) {
      const index = Number(slotIndex);
      if (!Number.isInteger(index) || index < 0 || index >= currentProductImages.length) return;
      currentProductImages.splice(index, 1);
      currentProductImages = currentProductImages.map(normalizeProductImageItem).filter(Boolean).slice(0, 4);
      pendingImageReplacement = null;
      renderProductImagesPreview();
      if (refs.productOriginalImagesDialog?.open) openOriginalImagesPreview();
      setCrudMessage("Imagen eliminada. La primera imagen disponible queda como portada.", "is-success");
    }

    function resetIngressForm() {
      state.ingressProductId = null;
      refs.ingressProductId.value = "";
      refs.ingressProductLabel.value = "";
      refs.ingressCurrentStock.value = "-";
      refs.ingressCantidad.value = "1";
      refs.ingressNota.value = "Ingreso manual desde gestión";
      refs.ingressSubmitBtn.disabled = false;
      setIngressMessage("");
    }

    function openIngressDialogForProduct(product) {
      if (!product) return;
      const productId = getProductId(product);
      resetIngressForm();
      state.ingressProductId = productId;
      refs.ingressProductId.value = String(productId);
      refs.ingressProductLabel.value = `${productId} - ${product.NOMBRE}`;
      refs.ingressCurrentStock.value = formatQty(product.STOCK_ACTUAL);

      if (!refs.ingressDialog.open) refs.ingressDialog.showModal();
      refs.ingressCantidad.focus();
      refs.ingressCantidad.select();
    }

    function closeIngressDialog() {
      if (refs.ingressDialog.open) refs.ingressDialog.close();
    }

    function openCreateDialog() {
      clearCrudForm();
      renderProductCategoryOptions();
      refs.productDialogTitle.textContent = "Crear producto";
      openDialog();
    }

    async function openEditDialog(id) {
      const fallbackItem =
        state.products.find((row) => getProductId(row) === Number(id)) ||
        state.productCatalog.find((row) => getProductId(row) === Number(id));
      if (!fallbackItem) return;

      let item = fallbackItem;
      try {
        item = await apiRequest(`/api/productos/${Number(id)}`);
      } catch {
        item = fallbackItem;
      }

      const productId = getProductId(item);
      state.editingId = productId;
      refs.crudEditId.value = String(productId);
      refs.crudId.value = String(productId);
      refs.crudId.disabled = false;
      refs.crudNombre.value = String(item.NOMBRE || "");
      if (refs.crudCategoria) refs.crudCategoria.value = normalizeProductCategory(item.CATEGORIA || item.categoria || "OTRO");
      refs.crudDescripcion.value = String(item.DESCRIPCION || item.descripcion || item.description || "");
      refs.crudPrecio.value = String(item.PRECIO || 0);
      refs.crudPrecioCompra.value = String(item.PRECIO_COMPRA || 0);
      refs.crudPedido.value = String(item.STOCK_MAXIMO ?? item.PEDIDO ?? 0);
      refs.crudStockActual.value = String(item.STOCK_ACTUAL || 0);
      refs.crudStockActual.disabled = true;
      refs.crudStockMinimo.value = String(item.STOCK_MINIMO || 0);
      refs.crudStockAjuste.value = "0";
      refs.crudStockAjuste.disabled = false;
      refs.crudEstado.value = String(item.ESTADO || "ACTIVO").toUpperCase() === "INACTIVO" ? "INACTIVO" : "ACTIVO";
      refs.crudNota.value = "";
      loadImagesFromProduct(item);
      renderProductCategoryOptions();
      if (refs.crudImagenes) refs.crudImagenes.value = "";
      refs.crudSaveBtn.textContent = `Actualizar N° ${productId}`;
      if (refs.crudHardDeleteBtn) refs.crudHardDeleteBtn.hidden = false;
      refs.productDialogTitle.textContent = `Editar producto N° ${productId}`;
      setCrudMessage(`Editando producto N° ${productId}.`, "is-success");
      toggleHistoryActions(true);
      openDialog();
    }

    async function loadProducts() {
      const query = buildCollectionQuery({
        q: state.crudSearch,
        page: state.pagination.page,
        pageSize: state.pagination.pageSize,
        sortBy: state.productSort.key,
        sortDir: state.productSort.dir
      });
      const response = await apiRequest(`/api/productos?${query}`);
      const items = Array.isArray(response?.items) ? response.items : [];
      state.products = items;
      state.filteredProducts = items;
      state.pagedProducts = items;
      state.pagination = response?.pagination || defaultPagination();
      renderProductCategoryOptions();
    }

    async function loadProductCatalog() {
      const items = await apiRequest("/api/productos/all");
      state.productCatalog = Array.isArray(items)
        ? [...items].sort((a, b) => getProductId(a) - getProductId(b))
        : [];
      renderProductCategoryOptions();
    }

    async function refreshLocalProducts() {
      try {
        await loadProducts();
        state.apiConnected = true;
        renderCrudTable(refs, state);
        renderPager(refs, state);
        renderSortButtons();
      } catch (error) {
        state.apiConnected = false;
        setCrudMessage(error.message, "is-error");
      }
    }

    async function handleCrudSubmit(event) {
      event.preventDefault();

      try {
        const payload = {
          NOMBRE: refs.crudNombre.value.trim(),
          CATEGORIA: normalizeProductCategory(refs.crudCategoria?.value || "OTRO"),
          DESCRIPCION: refs.crudDescripcion.value.trim(),
          PRECIO: parseNumberInput(refs.crudPrecio.value, { min: 0, label: "PRECIO" }),
          PRECIO_COMPRA: parseNumberInput(refs.crudPrecioCompra.value || "0", { min: 0, label: "PRECIO COMPRA" }),
          STOCK_MAXIMO: parseIntegerInput(refs.crudPedido.value || "0", { min: 0, label: "STOCK MÁXIMO" }),
          STOCK_MINIMO: parseIntegerInput(refs.crudStockMinimo.value || "0", {
            min: 0,
            label: "STOCK MÍNIMO"
          }),
          IMAGENES: Array.isArray(currentProductImages)
            ? currentProductImages.map(normalizeProductImageItem).filter(Boolean).slice(0, 4)
            : [],
          ESTADO: refs.crudEstado.value
        };

        if (!payload.NOMBRE) throw new Error("El campo NOMBRE es obligatorio.");

        if (refs.crudId.value.trim()) {
          payload["N°"] = Number.parseInt(refs.crudId.value.trim(), 10);
        }

        if (state.editingId) {
          payload.stockAjuste = parseIntegerInput(refs.crudStockAjuste.value || "0", {
            label: "AJUSTE STOCK"
          });
          if (refs.crudNota.value.trim()) payload.nota = refs.crudNota.value.trim();

          const updatedId = Number(payload["N°"] || state.editingId);
          try {
            await apiRequest(`/api/productos/${state.editingId}`, {
              method: "PUT",
              body: JSON.stringify(payload)
            });
          } catch (error) {
            const isDuplicateCode = updatedId !== Number(state.editingId) && /Ya existe producto con N°/i.test(error.message || "");
            if (!isDuplicateCode) throw error;

            const targetProduct = state.productCatalog.find((item) => getProductId(item) === updatedId) ||
              state.products.find((item) => getProductId(item) === updatedId);
            const currentProduct = state.productCatalog.find((item) => getProductId(item) === Number(state.editingId)) ||
              state.products.find((item) => getProductId(item) === Number(state.editingId));
            const ok = await openConfirmDialog({
              title: "Intercambiar N° de productos",
              message:
                `El N° ${updatedId} ya pertenece a ${targetProduct?.NOMBRE || "otro producto"}.\n` +
                `¿Deseas intercambiarlo para que ${currentProduct?.NOMBRE || "este producto"} use el N° ${updatedId} ` +
                `y el otro producto pase al N° ${state.editingId}?`,
              cancelText: "No cambiar",
              confirmText: "Intercambiar N°"
            });
            if (!ok) {
              setCrudMessage("No se guardó el cambio de N°. Elige otro número o confirma el intercambio.", "is-error");
              return;
            }

            await apiRequest(`/api/productos/${state.editingId}`, {
              method: "PUT",
              body: JSON.stringify({ ...payload, swapProductCode: true })
            });
          }
          setCrudMessage(`Producto N° ${updatedId} actualizado.`, "is-success");
        } else {
          payload.STOCK_ACTUAL = parseIntegerInput(refs.crudStockActual.value || "0", {
            min: 0,
            label: "STOCK ACTUAL"
          });

          const created = await apiRequest("/api/productos", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          setCrudMessage(`Producto N° ${getProductId(created)} creado.`, "is-success");
        }

        closeDialog();
        clearCrudForm();
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setCrudMessage(error.message, "is-error");
      }
    }

    async function handleDelete(id) {
      const item = state.products.find((row) => getProductId(row) === Number(id));
      const ok = await openConfirmDialog({
        title: "Inactivar producto",
        message: `¿Deseas inactivar el producto N° ${id}${item ? ` - ${item.NOMBRE}` : ""}?\nNo se eliminará de la base de datos.`,
        confirmText: "Inactivar producto"
      });
      if (!ok) return;

      try {
        const updated = await apiRequest(`/api/productos/${id}`, { method: "DELETE" });
        if (state.editingId === Number(id)) {
          closeDialog();
          clearCrudForm();
        }
        if (String(updated?.ESTADO || "").toUpperCase() === "INACTIVO") {
          setCrudMessage(`Producto N° ${id} marcado como INACTIVO.`, "is-success");
        } else {
          setCrudMessage(`Producto N° ${id} actualizado.`, "is-success");
        }
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setCrudMessage(error.message, "is-error");
      }
    }

    async function handleHardDeleteCurrentProduct() {
      const id = Number(state.editingId || refs.crudEditId.value || 0);
      if (!id) return;
      const name = String(refs.crudNombre.value || "").trim();
      const ok = await openConfirmDialog({
        title: "Eliminar producto definitivamente",
        message:
          `Esta acción no se puede deshacer.\n\n` +
          `Se eliminará el producto N° ${id}${name ? ` - ${name}` : ""}, sus imágenes, historial de precios, movimientos kardex y ventas asociadas.\n\n` +
          `¿Deseas eliminarlo definitivamente?`,
        cancelText: "Cancelar",
        confirmText: "Eliminar definitivamente"
      });
      if (!ok) return;

      try {
        await apiRequest(`/api/productos/${id}?hard=1`, { method: "DELETE" });
        closeDialog();
        clearCrudForm();
        setCrudMessage(`Producto N° ${id} eliminado definitivamente.`, "is-success");
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setCrudMessage(error.message, "is-error");
      }
    }

    async function handleStockIngress(id) {
      if (!state.apiConnected) {
        setCrudMessage(
          `No hay conexión con ${getApiBaseUrl()}. Corrige la URL en Configuración o inicia ese servidor.`,
          "is-error"
        );
        return;
      }

      const item = state.products.find((row) => getProductId(row) === Number(id));
      if (!item) {
        setCrudMessage(`No se encontró el producto N° ${id}.`, "is-error");
        return;
      }
      openIngressDialogForProduct(item);
    }

    async function handleIngressSubmit(event) {
      event.preventDefault();

      const productId =
        state.ingressProductId || Number.parseInt(String(refs.ingressProductId.value || ""), 10);
      if (!productId) {
        setIngressMessage("No se encontró el producto para el ingreso.", "is-error");
        return;
      }

      try {
        const quantity = parseNumberInput(refs.ingressCantidad.value, {
          min: 1,
          label: "cantidad de ingreso"
        });
        const payload = {
          cantidad: quantity,
          nota: refs.ingressNota.value.trim(),
          referencia: "INGRESO_MANUAL_UI"
        };

        refs.ingressSubmitBtn.disabled = true;
        const result = await apiRequest(`/api/productos/${productId}/ingreso`, {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const stockAfter = Number(result?.product?.STOCK_ACTUAL ?? 0);
        closeIngressDialog();
        resetIngressForm();
        setCrudMessage(
          `Ingreso aplicado a N° ${productId}: +${formatQty(quantity)}. Stock actual: ${formatQty(stockAfter)}.`,
          "is-success"
        );
        await refreshAll({ keepMessages: true });
      } catch (error) {
        const rawMessage = String(error?.message || "No se pudo registrar el ingreso.");
        if (/No se pudo conectar al servidor configurado/i.test(rawMessage)) {
          state.apiConnected = false;
        }
        refs.ingressSubmitBtn.disabled = false;
        setIngressMessage(rawMessage, "is-error");
      }
    }

    async function handleProductImagesChange(event) {
      try {
        const files = event?.target?.files || [];
        if (!files || files.length === 0) return;
        setCrudMessage("Fotos originales cargadas. Sube la versión filtrada cuando la tengas lista.", "is-success");
        const nextImages = await normalizeFilesToDataUrls(files);
        currentProductImages = [...currentProductImages, ...nextImages].filter(Boolean).slice(0, 4);
        renderProductImagesPreview();
        setCrudMessage("Fotos originales cargadas como pendientes de filtro manual.", "is-success");
        if (refs.crudImagenes) refs.crudImagenes.value = "";
      } catch (error) {
        setCrudMessage(error.message || "No se pudo cargar las imágenes.", "is-error");
      }
    }

    async function openMovementHistory() {
      if (!state.editingId) return;
      try {
        const response = await apiRequest(`/api/productos/${state.editingId}/movimientos?page=1&pageSize=200`);
        const rows = Array.isArray(response?.items) ? response.items : [];
        openHistoryDialogWithRows(
          `Historial de movimientos · N° ${state.editingId}`,
          rows.map((item) => ({
            rawDate: item.FECHA_HORA || "",
            fecha: item.FECHA_HORA || "-",
            tipo: item.TIPO || "-",
            detalle: item.REFERENCIA || item.NOTA || "-",
            monto: formatHistoryAmount(item.CANTIDAD, false)
          }))
        );
        return;
        if (refs.productHistoryDialogTitle) {
          refs.productHistoryDialogTitle.textContent = `Historial de movimientos · N° ${state.editingId}`;
        }
        renderHistoryRows(
          rows.map((item) => ({
            fecha: item.FECHA_HORA || "-",
            tipo: item.TIPO || "-",
            detalle: item.REFERENCIA || item.NOTA || "-",
            monto: formatHistoryAmount(item.CANTIDAD, false)
          }))
        );
        if (refs.productHistoryDialog && !refs.productHistoryDialog.open) refs.productHistoryDialog.showModal();
      } catch (error) {
        setCrudMessage(error.message, "is-error");
      }
    }

    async function openPurchasePriceHistory() {
      if (!state.editingId) return;
      try {
        const response = await apiRequest(`/api/productos/${state.editingId}/precios-compra?page=1&pageSize=200`);
        const rows = Array.isArray(response?.items) ? response.items : [];
        openHistoryDialogWithRows(
          `Historial precio compra · N° ${state.editingId}`,
          rows.map((item) => ({
            rawDate: item.FECHA_HORA || "",
            fecha: item.FECHA_HORA || "-",
            tipo: item.ORIGEN || "PRECIO",
            detalle: item.NOTA || "-",
            monto: formatHistoryAmount(item.PRECIO_COMPRA, true)
          }))
        );
        return;
        if (refs.productHistoryDialogTitle) {
          refs.productHistoryDialogTitle.textContent = `Historial precio compra · N° ${state.editingId}`;
        }
        renderHistoryRows(
          rows.map((item) => ({
            fecha: item.FECHA_HORA || "-",
            tipo: item.ORIGEN || "PRECIO",
            detalle: item.NOTA || "-",
            monto: formatHistoryAmount(item.PRECIO_COMPRA, true)
          }))
        );
        if (refs.productHistoryDialog && !refs.productHistoryDialog.open) refs.productHistoryDialog.showModal();
      } catch (error) {
        setCrudMessage(error.message, "is-error");
      }
    }

    function openImagePicker() {
      refs.crudImagenes?.click();
    }

    if (refs.productHistoryDateFrom) {
      refs.productHistoryDateFrom.addEventListener("change", (event) => {
        historyDateFrom = String(event.target.value || "");
        renderCurrentHistoryRows();
        syncHistoryFilterControls();
      });
    }

    if (refs.productHistoryDateTo) {
      refs.productHistoryDateTo.addEventListener("change", (event) => {
        historyDateTo = String(event.target.value || "");
        renderCurrentHistoryRows();
        syncHistoryFilterControls();
      });
    }

    if (refs.productHistoryTodayBtn) {
      refs.productHistoryTodayBtn.addEventListener("click", () => {
        resetHistoryFilters();
        renderCurrentHistoryRows();
      });
    }

    return {
      clearCrudForm,
      openDialog,
      closeDialog,
      resetIngressForm,
      openIngressDialogForProduct,
      closeIngressDialog,
      openCreateDialog,
      openEditDialog,
      loadProducts,
      loadProductCatalog,
      refreshLocalProducts,
      handleCrudSubmit,
      handleProductImagesChange,
      handleFilteredImageChange,
      openImagePicker,
      openFilteredImagePicker,
      openImageReplacementPicker,
      removeProductImage,
      openOriginalImagesPreview,
      closeOriginalImagesPreview,
      openMovementHistory,
      openPurchasePriceHistory,
      closeHistoryDialog,
      handleDelete,
      handleHardDeleteCurrentProduct,
      handleStockIngress,
      handleIngressSubmit
    };
  }

  window.ProductsFunctions = {
    matchProduct,
    applyProductFilterAndPagination,
    renderCrudTable,
    renderPager,
    refreshLocalProducts,
    createController
  };
})();




