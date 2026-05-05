(function () {
  const { normalizeText, paginate } = window.AppCustomFunctions;
  const { renderSalesRows } = window.SalesTableComponent;
  const PAYMENT_OPTIONS = ["Efectivo", "Yape", "IZIPAY", "Pedido Ya", "Rappi"];
  const PAYMENT_PARSE_OPTIONS = [...PAYMENT_OPTIONS];
  const EXCLUSIVE_PAYMENT_OPTIONS = ["Pedido Ya", "Rappi"];
  const OPERATIONAL_DAY_ORDER = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

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
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
    return null;
  }

  function normalizeOperationalDayKey(value) {
    const text = normalizeText(value).replace(/[^a-z]/g, "");
    return OPERATIONAL_DAY_ORDER.includes(text) ? text : "";
  }

  function getCurrentOperationalBaseDate(anchor = new Date()) {
    const baseDate = new Date(anchor);
    const hour = baseDate.getHours();
    if (hour < 5) {
      baseDate.setDate(baseDate.getDate() - 1);
    }
    return baseDate;
  }

  function toLocalIsoDate(dateValue) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
    const local = new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function resolveOperationalShiftDate(rawValue) {
    const text = String(rawValue ?? "").trim();
    if (!text) return "";

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?/);
    if (isoMatch) {
      const isoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      const hour = isoMatch[4] !== undefined ? Number.parseInt(isoMatch[4], 10) : null;
      const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
      const baseDate = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
      if (Number.isFinite(hour) && hour < 5) {
        baseDate.setDate(baseDate.getDate() - 1);
      }
      return toLocalIsoDate(baseDate);
    }

    const parsed = parseSaleDateTime(text);
    if (parsed) {
      const base = getCurrentOperationalBaseDate(parsed);
      return toLocalIsoDate(base);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return "";
  }

  function getOperationalWeekStart(anchor = new Date()) {
    const businessDate = getCurrentOperationalBaseDate(anchor);
    const mondayBasedIndex = (businessDate.getDay() + 6) % 7;
    const weekStart = new Date(businessDate);
    weekStart.setDate(weekStart.getDate() - mondayBasedIndex);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  function resolveOperationalDayDate(dayKey, anchor = new Date()) {
    const normalizedDay = normalizeOperationalDayKey(dayKey);
    if (!normalizedDay) return null;
    const businessDate = getCurrentOperationalBaseDate(anchor);
    const currentIndex = (businessDate.getDay() + 6) % 7;
    const calendarIndex = (anchor.getDay() + 6) % 7;
    const targetIndex = OPERATIONAL_DAY_ORDER.indexOf(normalizedDay);
    if (targetIndex < 0) return null;

    if (currentIndex !== calendarIndex && targetIndex === calendarIndex) {
      const calendarDate = new Date(anchor);
      calendarDate.setHours(0, 0, 0, 0);
      return calendarDate;
    }

    let offset = targetIndex - currentIndex;
    if (offset > 0) {
      offset -= 7;
    }

    const resolvedDate = new Date(businessDate);
    resolvedDate.setDate(resolvedDate.getDate() + offset);
    resolvedDate.setHours(0, 0, 0, 0);
    return resolvedDate;
  }

  function buildOperationalRange(fromDay, toDay, anchor = new Date()) {
    const fromIso = String(fromDay || "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(fromDay) : "";
    const toIso = String(toDay || "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(toDay) : "";
    if (fromIso || toIso) {
      const startIso = fromIso || toIso;
      const endIso = toIso || fromIso;
      const [sy, sm, sd] = startIso.split("-").map((part) => Number.parseInt(part, 10));
      const [ey, em, ed] = endIso.split("-").map((part) => Number.parseInt(part, 10));
      const start = new Date(sy, Math.max(0, (sm || 1) - 1), sd || 1, 5, 0, 0, 0);
      const end = new Date(ey, Math.max(0, (em || 1) - 1), ed || 1, 5, 0, 0, 0);
      if (end < start) return null;
      end.setDate(end.getDate() + 1);
      end.setHours(4, 59, 59, 999);
      return { start, end };
    }

    const normalizedFrom = normalizeOperationalDayKey(fromDay);
    const normalizedTo = normalizeOperationalDayKey(toDay);
    if (!normalizedFrom && !normalizedTo) return null;

    const safeFrom = normalizedFrom || normalizedTo;
    const safeTo = normalizedTo || normalizedFrom;
    const start = resolveOperationalDayDate(safeFrom, anchor);
    const endBase = resolveOperationalDayDate(safeTo, anchor);
    if (!start || !endBase) return null;
    start.setHours(5, 0, 0, 0);

    const end = new Date(endBase);
    if (end < start) {
      end.setDate(end.getDate() + 7);
    }
    end.setDate(end.getDate() + 1);
    end.setHours(4, 59, 59, 999);

    return { start, end };
  }

  function isExclusivePaymentType(value) {
    return EXCLUSIVE_PAYMENT_OPTIONS.includes(normalizePaymentType(value || ""));
  }

  function getOperationalDayKey(rawValue) {
    const saleDateTime = parseSaleDateTime(rawValue);
    if (!saleDateTime) return "";

    const businessDate = getCurrentOperationalBaseDate(saleDateTime);
    const jsDay = businessDate.getDay();
    const mondayBasedIndex = (jsDay + 6) % 7;
    return OPERATIONAL_DAY_ORDER[mondayBasedIndex] || "";
  }

  function matchSalesShiftRange(item, fromDay, toDay) {
    const fromIso = String(fromDay || "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(fromDay) : "";
    const toIso = String(toDay || "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(toDay) : "";
    if (fromIso || toIso) {
      const shiftIso = resolveOperationalShiftDate(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
      if (!shiftIso) return false;
      const start = fromIso || toIso;
      const end = toIso || fromIso;
      if (end < start) return false;
      return shiftIso >= start && shiftIso <= end;
    }

    const range = buildOperationalRange(fromDay, toDay);
    if (!range) return true;
    const saleDateTime = parseSaleDateTime(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
    if (!saleDateTime) return false;
    return saleDateTime >= range.start && saleDateTime <= range.end;
  }

  function getProductCode(item) {
    if (!item || typeof item !== "object") return "";
    if (item.N !== undefined) return item.N;
    if (item.id !== undefined) return item.id;
    if (item.ID !== undefined) return item.ID;

    for (const [key, value] of Object.entries(item)) {
      const compactKey = normalizeText(key).replace(/[^a-z0-9]/g, "");
      if (["n", "na", "no", "nro", "numero"].includes(compactKey)) {
        return value;
      }
    }

    return "";
  }

  function matchSale(item, rawTerm) {
    const term = String(rawTerm ?? "").trim();
    if (!term) return true;
    const norm = normalizeText(term);

    return (
      String(getProductCode(item) ?? "").includes(term) ||
      normalizeText(item.DIA_TURNO ?? "").includes(norm) ||
      String(item.FECHA_REFERENCIA ?? "").includes(term) ||
      String(item.FECHA_VENTA ?? "").includes(term) ||
      String(item.FECHA_OPERATIVA ?? "").includes(term) ||
      normalizeText(item.ESTADO ?? "ACTIVA").includes(norm) ||
      String(item.CANTIDAD ?? "").includes(term) ||
      normalizeText(item.TIPO_PAGO ?? "").includes(norm) ||
      normalizeText(item.NOMBRE ?? "").includes(norm)
    );
  }

  function applySalesFilter(state) {
    if (state.serverBackedTables) {
      state.filteredSales = Array.isArray(state.sales) ? [...state.sales] : [];
      state.pagedSales = state.filteredSales;
      return;
    }

    state.filteredSales = state.sales.filter(
      (item) =>
        matchSale(item, state.salesSearch) &&
        matchSalesShiftRange(item, state.salesDateFrom, state.salesDateTo)
    );

    const paged = paginate(state.filteredSales, state.salesPagination.page, state.salesPagination.pageSize);
    state.pagedSales = paged.items;
    state.salesPagination = paged.pagination;
  }

  function renderSalesTable(refs, state) {
    const rows = state.pagedSales || [];
    refs.salesBody.innerHTML = rows.length
      ? renderSalesRows(rows)
      : '<tr><td class="empty" colspan="11">No hay ventas para este filtro.</td></tr>';
  }

  function renderSalesPager(refs, state) {
    const meta = state.salesPagination;
    refs.salesPrevBtn.disabled = !meta.hasPrev;
    refs.salesNextBtn.disabled = !meta.hasNext;
    refs.salesPageSize.value = String(meta.pageSize);
    refs.salesPageInfo.textContent = `Página ${meta.page} de ${meta.totalPages} \u00B7 ${meta.totalItems} resultados`;
  }

  function refreshLocalSales(state, refs, renderKpis) {
    applySalesFilter(state);
    renderSalesTable(refs, state);
    renderKpis();
    renderSalesPager(refs, state);
  }

  function createController(deps) {
    const {
      state,
      refs,
      apiRequest,
      buildCollectionQuery,
      buildApiUrl,
      normalizePaymentType,
      normalizeSaleQuantityValue,
      todayInputValue,
      currentTimeInputValue,
      normalizeTimeValue,
      extractTimeFromDateTime,
      buildSaleDateTimeValue,
      syncSaleProductIdFromLookup,
      getSaleProductsSource,
      setSaleDialogMode,
      showSaleConfirmBox,
      hideSaleConfirmBox,
      setSaleMessage,
      setSaleReviewMessage,
      setAppMessage,
      openConfirmDialog,
      setSaleQuantityValue,
      renderSaleProductOptions,
      updateSaleTotalsPreview,
      closeSaleLookupDropdown,
      formatSaleLookupLabel,
        normalizeDateValue,
        round2,
      money,
      formatQty,
      refreshAll,
      renderSortButtons,
      renderKpis,
      defaultSalesPagination
    } = deps;

    let saleDraftRowSeq = 1;
    let saleConfirmInFlight = false;

    function setButtonLoading(button, isLoading, loadingText = "Procesando...") {
      if (!(button instanceof HTMLElement)) return;
      if (isLoading) {
        if (!button.dataset.originalLabel) {
          button.dataset.originalLabel = button.innerHTML;
        }
        button.disabled = true;
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
        return;
      }

      if (button.dataset.originalLabel) {
        button.innerHTML = button.dataset.originalLabel;
      }
      button.disabled = false;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      delete button.dataset.originalLabel;
    }

    function setSaleConfirmLoading(isLoading) {
      setButtonLoading(refs.saleConfirmSubmitBtn, isLoading, pendingConfirmLabel());
      if (refs.saleConfirmBackBtn) {
        refs.saleConfirmBackBtn.disabled = Boolean(isLoading);
      }
      if (refs.saleReviewCloseBtn) {
        refs.saleReviewCloseBtn.disabled = Boolean(isLoading);
      }
    }

    function pendingConfirmLabel() {
      return state.salePendingConfirm?.isEditing ? "Guardando cambios..." : "Guardando venta...";
    }

    function ensureSaleDraftState() {
      if (!Array.isArray(state.saleDraftItems)) state.saleDraftItems = [];
      if (!Array.isArray(state.salePaymentRows)) state.salePaymentRows = [];
    }

    function getDraftTotal() {
      ensureSaleDraftState();
      return round2(
        state.saleDraftItems.reduce((acc, item) => acc + round2(Number(item.total || 0)), 0)
      );
    }

    function getDraftQty() {
      ensureSaleDraftState();
      return round2(
        state.saleDraftItems.reduce((acc, item) => acc + round2(Number(item.cantidad || 0)), 0)
      );
    }

    function buildPaymentSummary(rows) {
      const cleanRows = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          tipoPago: normalizePaymentType(row?.tipoPago || "Efectivo"),
          monto: round2(Number(row?.monto || 0))
        }))
        .filter((row) => row.monto > 0);
      if (!cleanRows.length) return "Efectivo";
      if (cleanRows.length === 1) return cleanRows[0].tipoPago;
      return cleanRows.map((row) => `${row.tipoPago} S/${row.monto.toFixed(2)}`).join(" + ");
    }

    function formatPaymentRowsForSummary(rows) {
      return (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          tipoPago: normalizePaymentType(row?.tipoPago || "Efectivo"),
          monto: money(round2(Number(row?.monto || 0)))
        }))
        .filter((row) => row.monto !== money(0));
    }

    function parsePaymentSummaryRows(rawValue, totalInput) {
      const total = Math.max(0, round2(Number(totalInput || 0)));
      const rawType = String(rawValue || "").trim();
      if (!rawType) {
        return [{ tipoPago: "Efectivo", monto: total }];
      }

      const normalizedSingle = normalizePaymentType(rawType);
      if (
        PAYMENT_PARSE_OPTIONS.includes(normalizedSingle) &&
        !/[+]/.test(rawType) &&
        !/s\/\s*\d/i.test(rawType)
      ) {
        return [{ tipoPago: normalizedSingle, monto: total }];
      }

      const normalizedRaw = normalizeText(rawType);
        const exactType = PAYMENT_PARSE_OPTIONS.find((type) => normalizeText(type) === normalizedRaw);
      if (exactType) {
        return [{ tipoPago: normalizePaymentType(exactType), monto: total }];
      }

      const detected = [];
      let assigned = 0;
      PAYMENT_PARSE_OPTIONS.forEach((type) => {
        const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`${escaped}\\s*S\\/\\s*(\\d+(?:\\.\\d{1,2})?)`, "i");
        const match = rawType.match(regex);
        if (!match) return;
        const amount = round2(Number.parseFloat(match[1]));
        if (!Number.isFinite(amount) || amount <= 0) return;
        detected.push({ tipoPago: normalizePaymentType(type), monto: amount });
        assigned = round2(assigned + amount);
      });

      if (detected.length) {
        const remainder = round2(total - assigned);
        if (remainder > 0) {
          detected[0].monto = round2(Number(detected[0].monto || 0) + remainder);
        }
        return detected;
      }

      const mentioned = PAYMENT_PARSE_OPTIONS.filter((type) => normalizedRaw.includes(normalizeText(type)));
      if (mentioned.length === 1) {
        return [{ tipoPago: normalizePaymentType(mentioned[0]), monto: total }];
      }

      return [{ tipoPago: "Efectivo", monto: total }];
    }

    function rebalancePaymentRows(sourceRowId) {
      ensureSaleDraftState();
      const total = getDraftTotal();
      if (total <= 0 || state.salePaymentRows.length < 2) return;

      const source = state.salePaymentRows.find((row) => Number(row.id) === Number(sourceRowId));
      const others = state.salePaymentRows.filter((row) => Number(row.id) !== Number(sourceRowId));
      if (!source || !others.length) return;

      if (state.salePaymentRows.length === 2) {
        const autoRow = others[0];
        const sourceAmount = round2(Number(source.monto || 0));
        autoRow.monto = Math.max(0, round2(total - sourceAmount));
        return;
      }

      const autoRow = others.find((row) => round2(Number(row.monto || 0)) <= 0) || others[others.length - 1];
      if (!autoRow) return;

      const fixedAmount = round2(
        others
          .filter((row) => Number(row.id) !== Number(autoRow.id))
          .reduce((acc, row) => acc + round2(Number(row.monto || 0)), 0)
      );
      const sourceAmount = round2(Number(source.monto || 0));
      const remaining = round2(total - sourceAmount - fixedAmount);
      autoRow.monto = Math.max(0, remaining);
    }

    function syncPaymentRowsWithTotal() {
      ensureSaleDraftState();
      const total = getDraftTotal();
      if (total <= 0) return;
      if (!state.salePaymentRows.length) return;

      if (state.salePaymentRows.length === 1) {
        state.salePaymentRows[0].monto = round2(total);
        return;
      }

      const zeroRows = state.salePaymentRows.filter((row) => round2(Number(row.monto || 0)) === 0);
      if (zeroRows.length !== 1) return;
      const target = zeroRows[0];
      const paidExcluding = round2(
        state.salePaymentRows
          .filter((row) => Number(row.id) !== Number(target.id))
          .reduce((acc, row) => acc + round2(Number(row.monto || 0)), 0)
      );
      const remaining = round2(total - paidExcluding);
      if (remaining > 0) {
        target.monto = remaining;
      }
    }

    function getSuggestedPaymentTypeForNewRow() {
      ensureSaleDraftState();
      const usedTypes = new Set(
        state.salePaymentRows
          .map((row) => normalizePaymentType(row?.tipoPago || ""))
          .filter((type) => Boolean(type))
      );

      if (usedTypes.has("Efectivo") && !usedTypes.has("Yape")) {
        return "Yape";
      }
      if (usedTypes.has("Yape") && !usedTypes.has("Efectivo")) {
        return "Efectivo";
      }

      const next = PAYMENT_OPTIONS.find((type) => !usedTypes.has(normalizePaymentType(type)));
      if (next) return normalizePaymentType(next);
      return normalizePaymentType(refs.saleTipoPago?.value || "Efectivo");
    }

    function normalizeUniquePaymentRows() {
      ensureSaleDraftState();
      const normalizedRows = [];
      const seenTypes = new Set();

      state.salePaymentRows.forEach((row) => {
        const normalizedType = normalizePaymentType(row?.tipoPago || "Efectivo");
        if (!PAYMENT_OPTIONS.includes(normalizedType)) return;
        if (seenTypes.has(normalizedType)) return;

        seenTypes.add(normalizedType);
        normalizedRows.push({
          id: row?.id ?? saleDraftRowSeq++,
          tipoPago: normalizedType,
          monto: round2(Number(row?.monto || 0))
        });
      });

      if (!normalizedRows.length) {
        normalizedRows.push({ id: saleDraftRowSeq++, tipoPago: "Efectivo", monto: 0 });
      }

      const exclusiveRow = normalizedRows.find((row) => isExclusivePaymentType(row?.tipoPago));
      if (exclusiveRow) {
        state.salePaymentRows = [
          {
            id: exclusiveRow.id ?? saleDraftRowSeq++,
            tipoPago: normalizePaymentType(exclusiveRow.tipoPago),
            monto: round2(Number(exclusiveRow.monto || 0))
          }
        ];
        return;
      }

      state.salePaymentRows = normalizedRows.slice(0, PAYMENT_OPTIONS.length);
    }

    function enforceExclusivePaymentRows(preferredType = "") {
      ensureSaleDraftState();
      const normalizedPreferred = normalizePaymentType(preferredType || "");
      const exclusiveType = isExclusivePaymentType(normalizedPreferred)
        ? normalizedPreferred
        : normalizePaymentType(state.salePaymentRows.find((row) => isExclusivePaymentType(row?.tipoPago))?.tipoPago || "");
      if (!isExclusivePaymentType(exclusiveType)) return;
      state.salePaymentRows = [
        {
          id: state.salePaymentRows[0]?.id ?? saleDraftRowSeq++,
          tipoPago: exclusiveType,
          monto: getDraftTotal()
        }
      ];
      if (refs.saleTipoPago) {
        refs.saleTipoPago.value = exclusiveType;
      }
    }

    function enforceTwoPaymentTypes(preferredRowId = null) {
      ensureSaleDraftState();
      if (state.salePaymentRows.length !== 2) return;
      const first = state.salePaymentRows[0];
      const second = state.salePaymentRows[1];
      if (!first || !second) return;

      const firstType = normalizePaymentType(first.tipoPago || "");
      const secondType = normalizePaymentType(second.tipoPago || "");
      if (firstType !== secondType) return;

      const preferredIsFirst = Number(preferredRowId) === Number(first.id);
      const preferredIsSecond = Number(preferredRowId) === Number(second.id);

      if (firstType === "Efectivo") {
        if (preferredIsFirst) second.tipoPago = "Yape";
        else first.tipoPago = "Yape";
        return;
      }

      if (firstType === "Yape") {
        if (preferredIsFirst) second.tipoPago = "Efectivo";
        else first.tipoPago = "Efectivo";
        return;
      }

      if (preferredIsSecond) first.tipoPago = "Yape";
      else second.tipoPago = "Yape";
    }

    function setSaleTotalPreview(value) {
      if (!refs.saleTotalPreview) return;
      const safeValue = String(value || "-");
      refs.saleTotalPreview.textContent = safeValue;
      refs.saleTotalPreview.value = safeValue;
    }

    function getSaleTotalPreview() {
      if (!refs.saleTotalPreview) return "-";
      const fromText = String(refs.saleTotalPreview.textContent || "").trim();
      if (fromText) return fromText;
      return String(refs.saleTotalPreview.value || "-").trim() || "-";
    }

    function syncQuickPayButtons(activeTypesInput) {
      if (!Array.isArray(refs.saleQuickPayButtons)) return;
      const rawTypes = Array.isArray(activeTypesInput) ? activeTypesInput : [activeTypesInput];
      const normalizedSet = new Set(
        rawTypes
          .map((type) => normalizePaymentType(type || ""))
          .filter((type) => Boolean(type))
      );
      if (!normalizedSet.size) {
        normalizedSet.add("Efectivo");
      }
      refs.saleQuickPayButtons.forEach((button) => {
        if (!(button instanceof Element)) return;
        const buttonType = normalizePaymentType(button.dataset.saleQuickPay || "");
        button.classList.toggle("is-active", normalizedSet.has(buttonType));
      });
    }

    function syncSaleAsideSummary() {
      ensureSaleDraftState();
      const total = getDraftTotal();
      const qty = Math.max(0, Math.round(getDraftQty()));
      const paid = round2(state.salePaymentRows.reduce((acc, row) => acc + Number(row.monto || 0), 0));
      const receivedRaw = String(refs.saleMontoRecibido?.value ?? "0").replace(",", ".");
      const received = Number.parseFloat(receivedRaw);
      const safeReceived = Number.isFinite(received) ? Math.max(0, round2(received)) : 0;
      const change = Math.max(0, round2(safeReceived - total));

      if (refs.saleAsideItems) {
        refs.saleAsideItems.textContent = String(qty).padStart(2, "0");
      }
      if (refs.salePagadoValue) {
        refs.salePagadoValue.textContent = money(paid);
      }
      if (refs.saleVueltoValue) {
        refs.saleVueltoValue.textContent = money(change);
      }
      if (refs.saleMontoRecibido && refs.saleMontoRecibido.value === "") {
        refs.saleMontoRecibido.value = "0";
      }
      const activePaymentTypes = state.salePaymentRows
        .map((row) => normalizePaymentType(row?.tipoPago || ""))
        .filter((type) => Boolean(type));
      if (!activePaymentTypes.length) {
        activePaymentTypes.push(normalizePaymentType(refs.saleTipoPago?.value || "Efectivo"));
      }
      syncQuickPayButtons(activePaymentTypes);
    }

    function renderSaleDraftItems() {
      ensureSaleDraftState();
      if (!refs.saleItemsBody || !refs.saleItemsEmpty) return;

      const items = state.saleDraftItems;
      refs.saleItemsBody.innerHTML = items
        .map((item) => {
          const stockText = Number.isFinite(Number(item.stockActual))
            ? formatQty(Number(item.stockActual))
            : "-";
          return `
            <tr>
              <td class="sale-item-product-cell">
                <div class="sale-item-product-main">
                  <strong class="sale-item-product-code">#${item.productCode}</strong>
                  <div class="sale-item-product-name">${item.nombre}</div>
                </div>
              </td>
              <td><span class="sale-item-stock">${stockText}</span></td>
              <td>
                <div class="sale-item-qty-controls">
                  <button type="button" class="sale-item-qty-btn" data-action="sale-item-dec" data-item-id="${item.id}">-</button>
                  <strong class="sale-item-qty-value">${formatQty(item.cantidad)}</strong>
                  <button type="button" class="sale-item-qty-btn" data-action="sale-item-inc" data-item-id="${item.id}">+</button>
                </div>
              </td>
              <td class="sale-item-money">${money(item.precio)}</td>
              <td class="sale-item-money sale-item-money-total">${money(item.total)}</td>
              <td>
                <button
                  type="button"
                  class="sale-item-remove-btn"
                  data-action="sale-item-remove"
                  data-item-id="${item.id}"
                  aria-label="Quitar producto"
                  title="Quitar producto"
                >
                  <span aria-hidden="true">
                    <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                      <path d="M9 4.5h6m-8 3h10m-8 0-.7 10.2a1 1 0 0 0 1 1.1h5.4a1 1 0 0 0 1-1.1L17 7.5m-6 3.2v4.5m4-4.5v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  </span>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      refs.saleItemsEmpty.hidden = items.length > 0;
      refs.saleItemsBody.closest(".sale-items-wrap")?.classList.toggle("is-empty", items.length === 0);
      refs.saleItemsBody.closest(".sale-items-block")?.classList.toggle("is-empty", items.length === 0);
      if (refs.saleItemsCount) {
        refs.saleItemsCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
      }
    }

    function renderPaymentRows() {
      ensureSaleDraftState();
      if (!refs.salePaymentRows) return;

      if (!state.salePaymentRows.length) {
        state.salePaymentRows = [{ id: saleDraftRowSeq++, tipoPago: "Efectivo", monto: 0 }];
      }

      normalizeUniquePaymentRows();
      enforceExclusivePaymentRows();
      enforceTwoPaymentTypes();
      syncPaymentRowsWithTotal();
      if (refs.saleAddPaymentBtn) {
        const hasExclusivePayment = state.salePaymentRows.some((row) => isExclusivePaymentType(row?.tipoPago));
        refs.saleAddPaymentBtn.disabled = hasExclusivePayment || state.salePaymentRows.length >= PAYMENT_OPTIONS.length;
      }

      refs.salePaymentRows.innerHTML = state.salePaymentRows
        .map((row) => {
          const options = PAYMENT_OPTIONS.map(
            (type) =>
              `<option value="${type}" ${row.tipoPago === type ? "selected" : ""}>${type}</option>`
          ).join("");
          return `
            <div class="sale-payment-row" data-row-id="${row.id}">
              <select data-action="payment-type">${options}</select>
              <input data-action="payment-amount" type="number" min="0" step="0.10" value="${row.monto || 0}" placeholder="Monto" />
              <button
                type="button"
                class="btn btn-ghost sale-payment-remove-btn"
                data-action="payment-remove"
                aria-label="Quitar pago"
                title="Quitar pago"
                ${state.salePaymentRows.length <= 1 ? "disabled" : ""}
              ><span aria-hidden="true">
                <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                  <path d="M9 4.5h6m-8 3h10m-8 0-.7 10.2a1 1 0 0 0 1 1.1h5.4a1 1 0 0 0 1-1.1L17 7.5m-6 3.2v4.5m4-4.5v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </span></button>
            </div>
          `;
        })
        .join("");

      if (refs.salePaymentsHint) {
        const total = getDraftTotal();
        const paid = round2(state.salePaymentRows.reduce((acc, row) => acc + Number(row.monto || 0), 0));
        const remaining = round2(total - paid);
        if (remaining === 0) {
          refs.salePaymentsHint.textContent = `Pagos completos: ${money(paid)}.`;
          refs.salePaymentsHint.className = "sale-payments-hint is-ok";
        } else if (remaining > 0) {
          refs.salePaymentsHint.textContent = `Falta asignar ${money(remaining)} en pagos.`;
          refs.salePaymentsHint.className = "sale-payments-hint is-warn";
        } else {
          refs.salePaymentsHint.textContent = `Pagos excedidos por ${money(Math.abs(remaining))}.`;
          refs.salePaymentsHint.className = "sale-payments-hint is-error";
        }
      }

      syncSaleAsideSummary();
    }

    function resetSaleForm() {
      state.saleEditingId = null;
      hideSaleConfirmBox({ clear: true });
      ensureSaleDraftState();
      if (refs.saleProductLookup) {
        refs.saleProductLookup.required = false;
        refs.saleProductLookup.removeAttribute("required");
        refs.saleProductLookup.setCustomValidity("");
      }
      refs.saleProductLookup.value = "";
      refs.saleProductId.value = "";
      state.saleLookupResults = [];
      state.saleLookupOpen = false;
      state.saleLookupHighlight = -1;
      state.saleDraftItems = [];
      state.salePaymentRows = [{ id: saleDraftRowSeq++, tipoPago: "Efectivo", monto: 0 }];
      setSaleQuantityValue(1);
      if (refs.salePrecioPreview) refs.salePrecioPreview.value = "-";
      setSaleTotalPreview("S/ 0.00");
      refs.saleTipoPago.value = "Efectivo";
      if (refs.saleTipoVenta) refs.saleTipoVenta.value = "MANUAL";
      refs.saleNota.value = "";
      refs.saleFecha.value = todayInputValue();
      if (refs.saleHora) refs.saleHora.value = currentTimeInputValue();
      if (refs.saleMontoRecibido) refs.saleMontoRecibido.value = "0";
      setSaleDialogMode("create");
      renderSaleProductOptions();
      renderSaleDraftItems();
      renderPaymentRows();
      updateSaleTotalsPreview();
    }

    function openSaleDialog() {
      if (!state.apiConnected) {
        setSaleMessage("No hay conexión con el servidor.", "is-error");
        return;
      }
      if (!getSaleProductsSource().length) {
        setSaleMessage("No hay productos disponibles para registrar ventas.", "is-error");
        return;
      }
      if (refs.saleDialog.open) return;
      resetSaleForm();
      if (refs.saleForm) {
        refs.saleForm.noValidate = true;
      }
      refs.saleDialog.showModal();
      refs.saleProductLookup.focus();
    }

    function openEditSaleDialog(saleIdInput) {
      const saleId = Number.parseInt(String(saleIdInput ?? ""), 10);
      if (!saleId) return;
      if (!state.apiConnected) {
        setSaleMessage("No hay conexión con el servidor.", "is-error");
        return;
      }
      const sale = state.sales.find((item) => Number(item.ID_VENTA) === saleId);
      if (!sale) {
        setSaleMessage(`No se encontró la venta #${saleId}.`, "is-error");
        return;
      }
      if (String(sale.ESTADO || "ACTIVA").toUpperCase() === "ANULADA") {
        setSaleMessage(`La venta #${saleId} está ANULADA y no se puede editar.`, "is-error");
        return;
      }
      const products = getSaleProductsSource();
      if (!products.length) {
        setSaleMessage("No hay productos disponibles para editar la venta.", "is-error");
        return;
      }

      resetSaleForm();
      state.saleEditingId = saleId;
      setSaleDialogMode("edit");
      refs.saleFecha.value = normalizeDateValue(sale.FECHA_OPERATIVA || sale.FECHA_VENTA) || todayInputValue();
      if (refs.saleHora) refs.saleHora.value = extractTimeFromDateTime(sale.FECHA_OPERATIVA || sale.FECHA_VENTA);
      setSaleQuantityValue(sale.CANTIDAD, { fallback: 1 });
      const initialPaymentRows = parsePaymentSummaryRows(sale.TIPO_PAGO, sale.TOTAL);
      refs.saleTipoPago.value = normalizePaymentType(initialPaymentRows[0]?.tipoPago || sale.TIPO_PAGO || "Efectivo");
      refs.saleNota.value = "";
      renderSaleProductOptions();

      const saleProductId = Number.parseInt(String(getProductCode(sale) ?? ""), 10);
      const saleProduct = products.find((item) => Number(getProductCode(item)) === saleProductId);
      if (saleProduct) {
        refs.saleProductLookup.value = formatSaleLookupLabel(saleProduct);
        refs.saleProductId.value = String(getProductCode(saleProduct));
        state.saleDraftItems = [
          {
            id: saleDraftRowSeq++,
            productId: Number(getProductCode(saleProduct)),
            productCode: String(getProductCode(saleProduct)),
            nombre: saleProduct.NOMBRE || sale.NOMBRE || "",
            precio: round2(Number(sale.PRECIO || saleProduct.PRECIO || 0)),
            stockActual: round2(Number(saleProduct.STOCK_ACTUAL || 0)),
            cantidad: round2(Number(sale.CANTIDAD || 0)),
            total: round2(Number(sale.TOTAL || 0))
          }
        ];
      } else {
        state.saleDraftItems = [];
      }
      state.salePaymentRows = initialPaymentRows.map((row) => ({
        id: saleDraftRowSeq++,
        tipoPago: normalizePaymentType(row?.tipoPago || "Efectivo"),
        monto: round2(Number(row?.monto || 0))
      }));
      renderSaleDraftItems();
      renderPaymentRows();
      if (!saleProduct) {
        setSaleMessage(
          "El producto original de esta venta ya no existe. Selecciona otro para corregirla.",
          "is-error"
        );
      }

      if (!refs.saleDialog.open) {
        refs.saleDialog.showModal();
      }
      setSaleMessage(`Editando venta #${saleId}.`);
      updateSaleTotalsPreview();
    }

    function closeSaleDialog() {
      if (!refs.saleDialog.open) return;
      refs.saleDialog.close();
      hideSaleConfirmBox({ clear: true });
      closeSaleLookupDropdown();
    }

    async function loadSales() {
      const query = buildCollectionQuery({
        q: state.salesSearch,
        from: state.salesDateFrom,
        to: state.salesDateTo,
        page: state.salesPagination.page,
        pageSize: state.salesPagination.pageSize,
        sortBy: state.salesSort.key,
        sortDir: state.salesSort.dir
      });
      const response = await apiRequest(`/api/ventas?${query}`);
      const items = Array.isArray(response?.items) ? response.items : [];
      state.sales = items;
      state.filteredSales = items;
      state.pagedSales = items;
      state.salesPagination = response?.pagination || defaultSalesPagination();
    }

    async function loadSalesAllForKpi() {
      try {
        const items = await apiRequest("/api/ventas/all");
        state.salesAll = Array.isArray(items) ? items : [];
      } catch {
        state.salesAll = Array.isArray(state.sales) ? [...state.sales] : [];
      }
    }

    async function refreshLocalSales() {
      try {
        await loadSales();
        state.apiConnected = true;
        renderSalesTable(refs, state);
        renderSalesPager(refs, state);
        renderKpis();
        renderSortButtons();
      } catch (error) {
        state.apiConnected = false;
        setSaleMessage(error.message, "is-error");
      }
    }

    function addCurrentProductToDraft(productOverride = null) {
      ensureSaleDraftState();
      const selectedProduct = productOverride || syncSaleProductIdFromLookup();
      if (!selectedProduct) {
        throw new Error("Selecciona un producto antes de agregarlo.");
      }
      const productId = Number(getProductCode(selectedProduct));
      if (!productId) {
        throw new Error("No se pudo identificar el código del producto seleccionado.");
      }

      const qty = normalizeSaleQuantityValue(refs.saleCantidad.value, { fallback: 1 });
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("La cantidad debe ser mayor a 0.");
      }

      const price = round2(Number(selectedProduct.PRECIO || 0));
      const stockActual = round2(Number(selectedProduct.STOCK_ACTUAL || 0));
      const existing = state.saleDraftItems.find((item) => Number(item.productId) === productId);
      if (existing) {
        existing.cantidad = round2(Number(existing.cantidad || 0) + qty);
        existing.total = round2(existing.cantidad * existing.precio);
        existing.stockActual = stockActual;
      } else {
        state.saleDraftItems.push({
          id: saleDraftRowSeq++,
          productId,
          productCode: String(getProductCode(selectedProduct)),
          nombre: selectedProduct.NOMBRE || "",
          precio: price,
          stockActual,
          cantidad: qty,
          total: round2(price * qty)
        });
      }
      renderSaleDraftItems();
      updateSaleTotalsPreview();
      renderPaymentRows();
    }

    function handleAddSaleItemFromForm(productOverride = null) {
      try {
        addCurrentProductToDraft(productOverride);
        setSaleMessage("Producto agregado a la venta.");
      } catch (error) {
        setSaleMessage(error.message || "No se pudo agregar el producto.", "is-error");
      }
    }

    function handleSaleItemsClick(event) {
      const target = event?.target?.closest?.("[data-action][data-item-id]");
      if (!target) return;
      ensureSaleDraftState();
      const itemId = Number.parseInt(String(target.dataset.itemId || ""), 10);
      if (!itemId) return;
      const item = state.saleDraftItems.find((entry) => Number(entry.id) === itemId);
      if (!item) return;

      const action = String(target.dataset.action || "");
      if (action === "sale-item-inc") {
        item.cantidad = round2(Number(item.cantidad || 0) + 1);
      } else if (action === "sale-item-dec") {
        item.cantidad = Math.max(1, round2(Number(item.cantidad || 0) - 1));
      } else if (action === "sale-item-remove") {
        state.saleDraftItems = state.saleDraftItems.filter((entry) => Number(entry.id) !== itemId);
      }
      if (action !== "sale-item-remove") {
        item.total = round2(Number(item.cantidad || 0) * Number(item.precio || 0));
      }
      renderSaleDraftItems();
      renderPaymentRows();
      updateSaleTotalsPreview();
    }

    function handleAddPaymentRow() {
      ensureSaleDraftState();
      normalizeUniquePaymentRows();
      enforceExclusivePaymentRows();
      if (state.salePaymentRows.some((row) => isExclusivePaymentType(row?.tipoPago))) {
        renderPaymentRows();
        return;
      }
      if (state.salePaymentRows.length >= PAYMENT_OPTIONS.length) {
        renderPaymentRows();
        return;
      }
      const total = getDraftTotal();
      const paid = round2(state.salePaymentRows.reduce((acc, row) => acc + round2(Number(row.monto || 0)), 0));
      const remaining = round2(total - paid);
      const newRow = {
        id: saleDraftRowSeq++,
        tipoPago: getSuggestedPaymentTypeForNewRow(),
        monto: remaining > 0 ? remaining : 0
      };
      state.salePaymentRows.push(newRow);
      enforceTwoPaymentTypes(newRow.id);
      if (newRow) {
        rebalancePaymentRows(newRow.id);
      }
      renderPaymentRows();
    }

    function handleSalePaymentRowsInput(event) {
      const rowNode = event?.target?.closest?.(".sale-payment-row[data-row-id]");
      if (!rowNode) return;
      const rowId = Number.parseInt(String(rowNode.dataset.rowId || ""), 10);
      const row = state.salePaymentRows.find((item) => Number(item.id) === rowId);
      if (!row) return;

      const action = String(event.target.dataset.action || "");
      if (action === "payment-type") {
        row.tipoPago = normalizePaymentType(event.target.value);
        normalizeUniquePaymentRows();
        enforceExclusivePaymentRows(row.tipoPago);
        enforceTwoPaymentTypes(rowId);
        if (state.salePaymentRows[0] && Number(state.salePaymentRows[0].id) === rowId && refs.saleTipoPago) {
          refs.saleTipoPago.value = normalizePaymentType(state.salePaymentRows[0].tipoPago || row.tipoPago);
        }
        const currentRow = state.salePaymentRows.find((item) => Number(item.id) === rowId) || state.salePaymentRows[0];
        if (currentRow && round2(Number(currentRow.monto || 0)) <= 0) {
          const total = getDraftTotal();
          const paidExcluding = round2(
            state.salePaymentRows
              .filter((item) => Number(item.id) !== Number(currentRow.id))
              .reduce((acc, item) => acc + round2(Number(item.monto || 0)), 0)
          );
          const remaining = round2(total - paidExcluding);
          if (remaining > 0) {
            currentRow.monto = remaining;
          }
        }
      }
      if (action === "payment-amount") {
        const amount = Number(String(event.target.value || "0").replace(",", "."));
        row.monto = Number.isFinite(amount) ? Math.max(0, round2(amount)) : 0;
        rebalancePaymentRows(rowId);
      }
      renderPaymentRows();
    }

    function handleSalePaymentRowsClick(event) {
      const button = event?.target?.closest?.("[data-action='payment-remove']");
      if (!button) return;
      const rowNode = button.closest(".sale-payment-row[data-row-id]");
      if (!rowNode) return;
      const rowId = Number.parseInt(String(rowNode.dataset.rowId || ""), 10);
      if (!rowId) return;
      if (state.salePaymentRows.length <= 1) return;
      state.salePaymentRows = state.salePaymentRows.filter((row) => Number(row.id) !== rowId);
      renderPaymentRows();
    }

    function handleSaleQuickPaySelect(paymentTypeInput) {
      const paymentType = normalizePaymentType(paymentTypeInput || "Efectivo");
      ensureSaleDraftState();
      if (isExclusivePaymentType(paymentType)) {
        state.salePaymentRows = [{ id: saleDraftRowSeq++, tipoPago: paymentType, monto: getDraftTotal() }];
      } else {
        if (!state.salePaymentRows.length) {
          state.salePaymentRows = [{ id: saleDraftRowSeq++, tipoPago: paymentType, monto: getDraftTotal() }];
        } else {
          state.salePaymentRows[0].tipoPago = paymentType;
        }
      }
      if (refs.saleTipoPago) {
        refs.saleTipoPago.value = paymentType;
      }
      syncQuickPayButtons(paymentType);
      renderPaymentRows();
    }

    function handleSaleMontoRecibidoInput() {
      syncSaleAsideSummary();
    }

    async function handleSaleSubmit(event) {
      event.preventDefault();
      if (!state.apiConnected) {
        setSaleMessage("No hay conexión con el servidor.", "is-error");
        return;
      }

      try {
        if (refs.saleProductLookup) {
          refs.saleProductLookup.setCustomValidity("");
        }
        syncSaleProductIdFromLookup();
        const isEditing = Number.isInteger(state.saleEditingId) && state.saleEditingId > 0;
        if (!isEditing && refs.saleHora) {
          refs.saleHora.value = currentTimeInputValue();
        }
        const tipoPago = normalizePaymentType(refs.saleTipoPago.value);
        const cantidad = normalizeSaleQuantityValue(refs.saleCantidad.value);
        const fechaVenta = buildSaleDateTimeValue(refs.saleFecha?.value, refs.saleHora?.value);
        if (!Number.isInteger(cantidad) || cantidad < 1) {
          throw new Error("La cantidad debe ser un numero entero mayor o igual a 1.");
        }
        let payload;
        let confirmSummary;

        if (isEditing) {
          payload = {
            productId: Number.parseInt(refs.saleProductId.value, 10),
            cantidad,
            fecha_venta: fechaVenta,
            tipoPago,
            nota: refs.saleNota.value.trim()
          };
          if (!payload.productId) {
            throw new Error("Selecciona un producto para la venta.");
          }
          const selectedProduct = getSaleProductsSource().find(
            (item) => Number(getProductCode(item)) === payload.productId
          );
          const label = selectedProduct
            ? `${getProductCode(selectedProduct)} - ${selectedProduct.NOMBRE}`
            : `N° ${payload.productId}`;
          const computedTotal = selectedProduct
            ? money(round2(Number(selectedProduct.PRECIO || 0) * payload.cantidad))
            : getSaleTotalPreview();
          const itemPrice = selectedProduct ? round2(Number(selectedProduct.PRECIO || 0)) : 0;
          const computedTotalValue = selectedProduct
            ? round2(Number(selectedProduct.PRECIO || 0) * payload.cantidad)
            : round2(Number(state.saleDraftItems?.[0]?.total || 0));
          let paymentRows = state.salePaymentRows
            .map((row) => ({
              tipoPago: normalizePaymentType(row?.tipoPago || "Efectivo"),
              monto: round2(Number(row?.monto || 0))
            }))
            .filter((row) => row.monto > 0);
          if (!paymentRows.length && computedTotalValue > 0) {
            paymentRows = [{ tipoPago: tipoPago || "Efectivo", monto: computedTotalValue }];
          }
          const exclusivePayment = paymentRows.find((row) => isExclusivePaymentType(row?.tipoPago));
          if (exclusivePayment && paymentRows.length > 1) {
            throw new Error(`${exclusivePayment.tipoPago} debe registrarse como único método de pago.`);
          }
          const paidAmount = round2(paymentRows.reduce((acc, row) => acc + row.monto, 0));
          if (round2(paidAmount) !== round2(computedTotalValue)) {
            throw new Error(
              `El total de pagos (${money(paidAmount)}) debe ser igual al total de la venta (${money(computedTotalValue)}).`
            );
          }
          const paymentSummary = buildPaymentSummary(paymentRows);
          payload.tipoPago = paymentRows[0]?.tipoPago || tipoPago || "Efectivo";
          payload.tipoPagoDetalle = paymentSummary;
          payload.paymentSplit = paymentRows;
          confirmSummary = {
            product: label,
            cantidad: formatQty(payload.cantidad),
            fecha: normalizeDateValue(payload.fecha_venta),
            hora: normalizeTimeValue(payload.fecha_venta),
            tipoPago: paymentSummary,
            total: computedTotal,
            nota: payload.nota || "-",
            items: [
              {
                codigo: selectedProduct ? String(getProductCode(selectedProduct)) : `N° ${payload.productId}`,
                nombre: selectedProduct?.NOMBRE || label,
                cantidad: formatQty(payload.cantidad),
                unitario: money(itemPrice),
                subtotal: computedTotal
              }
            ],
            payments: formatPaymentRowsForSummary(paymentRows)
          };
          setSaleDialogMode("edit");
        } else {
          ensureSaleDraftState();
          if (!state.saleDraftItems.length) {
            addCurrentProductToDraft();
          }
          const draftItems = state.saleDraftItems.map((item) => ({
            productId: Number(item.productId),
            "N°": Number(item.productId),
            cantidad: round2(Number(item.cantidad || 0))
          }));
          if (!draftItems.length) {
            throw new Error("Agrega al menos un producto a la venta.");
          }

          const total = getDraftTotal();
          let paymentRows = state.salePaymentRows
            .map((row) => ({
              tipoPago: normalizePaymentType(row.tipoPago || "Efectivo"),
              monto: round2(Number(row.monto || 0))
            }))
            .filter((row) => row.monto > 0);
          if (!paymentRows.length && total > 0) {
            paymentRows = [{ tipoPago: tipoPago || "Efectivo", monto: total }];
          }
          const exclusivePayment = paymentRows.find((row) => isExclusivePaymentType(row?.tipoPago));
          if (exclusivePayment && paymentRows.length > 1) {
            throw new Error(`${exclusivePayment.tipoPago} debe registrarse como único método de pago.`);
          }
          const paidAmount = round2(paymentRows.reduce((acc, row) => acc + row.monto, 0));
          if (round2(paidAmount) !== round2(total)) {
            throw new Error(`El total de pagos (${money(paidAmount)}) debe ser igual al total de la venta (${money(total)}).`);
          }

          payload = {
            items: draftItems,
            fecha_venta: fechaVenta,
            tipoVenta: refs.saleTipoVenta?.value || "MANUAL",
            tipoPago: paymentRows[0]?.tipoPago || tipoPago || "Efectivo",
            tipoPagoDetalle: buildPaymentSummary(paymentRows),
            paymentSplit: paymentRows,
            nota: refs.saleNota.value.trim()
          };
          confirmSummary = {
            product: `${draftItems.length} producto(s)`,
            cantidad: formatQty(getDraftQty()),
            fecha: normalizeDateValue(payload.fecha_venta),
            hora: normalizeTimeValue(payload.fecha_venta),
            tipoPago: payload.tipoPago,
            total: money(total),
            nota: payload.nota || "-",
            items: state.saleDraftItems.map((item) => ({
              codigo: String(item.productCode || item.productId || ""),
              nombre: item.nombre || "-",
              cantidad: formatQty(item.cantidad),
              unitario: money(round2(Number(item.precio || 0))),
              subtotal: money(round2(Number(item.total || 0)))
            })),
            payments: formatPaymentRowsForSummary(paymentRows)
          };
          setSaleDialogMode("create");
        }

        showSaleConfirmBox(
          confirmSummary,
          payload,
          {
            isEditing,
            saleId: state.saleEditingId
          }
        );
        setSaleMessage(
          isEditing
            ? "Revisa el resumen y confirma para actualizar la venta."
            : "Revisa el resumen y confirma para guardar la venta."
        );
      } catch (error) {
        const rawMessage = String(error?.message || "");
        if (/No se pudo conectar al servidor configurado/i.test(rawMessage)) {
          state.apiConnected = false;
        }
        setSaleMessage(rawMessage || "No se pudo preparar la venta.", "is-error");
      }
    }

    function handleSaleConfirmBack() {
      if (saleConfirmInFlight) return;
      hideSaleConfirmBox({ clear: true });
      setSaleReviewMessage("");
      setSaleMessage("Ajusta los campos y vuelve a confirmar.");
    }

    async function handleSaleConfirmSubmit() {
      if (saleConfirmInFlight) return;
      const pending = state.salePendingConfirm;
      if (!pending?.payload) return;
      saleConfirmInFlight = true;
      setSaleConfirmLoading(true);
      setSaleReviewMessage("");
      if (!pending.isEditing && refs.saleHora) {
        refs.saleHora.value = currentTimeInputValue();
      }
      if (!pending.isEditing && refs.saleReviewHora) {
        refs.saleReviewHora.value = refs.saleHora?.value || currentTimeInputValue();
      }
      pending.payload.fecha_venta = buildSaleDateTimeValue(refs.saleReviewFecha?.value || refs.saleFecha?.value, refs.saleReviewHora?.value || refs.saleHora?.value);

      try {
        const requestConfig = {
          timeoutMs: 25000
        };
        let result;
        if (pending.isEditing && pending.saleId) {
          result = await apiRequest(`/api/ventas/${pending.saleId}`, {
            ...requestConfig,
            method: "PUT",
            body: JSON.stringify(pending.payload)
          });
          setSaleMessage(
            `Venta #${result.sale.ID_VENTA} actualizada: N° ${getProductCode(result.sale)}, cantidad ${formatQty(result.sale.CANTIDAD)}, pago ${result.sale.TIPO_PAGO || "Efectivo"}.`,
            "is-success"
          );
        } else {
          result = await apiRequest("/api/ventas", {
            ...requestConfig,
            method: "POST",
            body: JSON.stringify(pending.payload)
          });
          if (Array.isArray(result?.sales) && result.sales.length) {
            const total = round2(result.sales.reduce((acc, item) => acc + Number(item.TOTAL || 0), 0));
            setSaleMessage(
              `Venta registrada: ${result.sales.length} item(s), total ${money(total)}, pago ${result.tipoPago || "Efectivo"}.`,
              "is-success"
            );
          } else {
            setSaleMessage(
              `Venta registrada: N° ${getProductCode(result.sale)}, cantidad ${formatQty(result.sale.CANTIDAD)}, pago ${result.sale.TIPO_PAGO || "Efectivo"}.`,
              "is-success"
            );
          }
        }

        setSaleReviewMessage("");
        try {
          closeSaleDialog();
        } catch (closeError) {
          setAppMessage(
            `La venta se guardó, pero falló el cierre del modal: ${String(closeError?.message || closeError || "Error desconocido.")}`,
            "is-error"
          );
        }
        try {
          resetSaleForm();
        } catch (cleanupError) {
          setAppMessage(
            `La venta se guardó, pero falló la limpieza del formulario: ${String(cleanupError?.message || cleanupError || "Error desconocido.")}`,
            "is-error"
          );
        }
        refreshAll({ keepMessages: true }).catch((refreshError) => {
          const refreshMessage = String(refreshError?.message || "");
          if (/No se pudo conectar al servidor configurado/i.test(refreshMessage)) {
            state.apiConnected = false;
          }
          setAppMessage(
            refreshMessage
              ? `La venta se guardó, pero no se pudo refrescar la vista: ${refreshMessage}`
              : "La venta se guardó, pero no se pudo refrescar la vista.",
            "is-error"
          );
        });
      } catch (error) {
        const rawMessage = String(error?.message || "");
        if (/No se pudo conectar al servidor configurado/i.test(rawMessage)) {
          state.apiConnected = false;
        }
        const staleServerHint =
          pending.isEditing && /No encontrado\.?|Error 404/i.test(rawMessage)
            ? `${rawMessage} Si acabas de actualizar código, reinicia el servidor para habilitar edición de ventas.`
            : rawMessage;
        setSaleReviewMessage(staleServerHint || "No se pudo guardar la venta.", "is-error");
        setSaleMessage(staleServerHint || "No se pudo guardar la venta.", "is-error");
      } finally {
        saleConfirmInFlight = false;
        setSaleConfirmLoading(false);
      }
    }

    async function handleDeleteSale(saleIdInput) {
      const saleId = Number.parseInt(String(saleIdInput ?? ""), 10);
      if (!saleId) return;

      const source = state.salesAll.length ? state.salesAll : state.sales;
      const sale = source.find((item) => Number(item.ID_VENTA) === saleId) || null;
      if (sale && String(sale.ESTADO || "ACTIVA").toUpperCase() === "ANULADA") {
        setSaleMessage(`La venta #${saleId} ya está ANULADA.`, "is-error");
        return;
      }
      const productLabel = sale
        ? `N° ${getProductCode(sale)}${sale.NOMBRE ? ` - ${sale.NOMBRE}` : ""}`
        : `venta #${saleId}`;
      const ok = await openConfirmDialog({
        title: "Anular venta",
        message: `Deseas anular la venta #${saleId} (${productLabel})?\nSe revertirá el stock y quedará trazabilidad en kardex.`,
        confirmText: "Anular venta"
      });
      if (!ok) return;

      try {
        const result = await apiRequest(`/api/ventas/${saleId}`, { method: "DELETE" });
        if (state.saleEditingId === saleId) {
          closeSaleDialog();
          resetSaleForm();
        }
        const restoredStock = result?.product?.STOCK_ACTUAL;
        const stockMessage =
          Number.isFinite(Number(restoredStock))
            ? ` Stock actual N° ${getProductCode(result.product)}: ${formatQty(restoredStock)}.`
            : "";
        setSaleMessage(`Venta #${saleId} anulada.${stockMessage}`, "is-success");
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setSaleMessage(error.message || "No se pudo anular la venta.", "is-error");
      }
    }

    function extractFilenameFromContentDisposition(headerValue) {
      const header = String(headerValue || "");
      if (!header) return "";

      const utfMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
      if (utfMatch?.[1]) {
        try {
          return decodeURIComponent(utfMatch[1]).trim();
        } catch {
          return utfMatch[1].trim();
        }
      }

      const basicMatch = header.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
      return basicMatch?.[1] ? basicMatch[1].trim() : "";
    }

    async function handleExportSalesCsv() {
      if (!state.apiConnected) {
        setSaleMessage("No hay conexión con el servidor.", "is-error");
        return;
      }

      let from = state.salesDateFrom || "";
      let to = state.salesDateTo || "";
      if (!from || !to) {
        const source = state.filteredSales.length ? state.filteredSales : state.sales;
        const dates = source
          .map((item) => normalizeDateValue(item.FECHA_OPERATIVA || item.FECHA_VENTA))
          .filter((value) => Boolean(value))
          .sort((a, b) => a.localeCompare(b));
        if (!from) from = dates[0] || todayInputValue();
        if (!to) to = dates[dates.length - 1] || from;
      }
      if (from && to && from > to) {
        setSaleMessage("Rango inválido: la fecha Desde no puede ser mayor que Hasta.", "is-error");
        return;
      }

      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      params.set("format", "xlsx");
      const search = String(state.salesSearch || "").trim();
      if (search) params.set("q", search);

      const defaultFileName = `ventas_diarias_resumen_${from}_a_${to}.xlsx`;
      const previousText = refs.exportSalesCsvBtn.textContent;
      refs.exportSalesCsvBtn.disabled = true;
      refs.exportSalesCsvBtn.textContent = "Exportando Excel...";

      try {
        const response = await fetch(buildApiUrl(`/api/ventas/export/csv?${params.toString()}`));
        if (!response.ok) {
          let message = `Error ${response.status}`;
          try {
            const raw = await response.text();
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                message = parsed?.error || raw;
              } catch {
                message = raw;
              }
            }
          } catch {
            // Ignora fallos de lectura.
          }
          throw new Error(message);
        }

        const blob = await response.blob();
        const disposition = response.headers.get("content-disposition");
        const fileName = extractFilenameFromContentDisposition(disposition) || defaultFileName;

        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 600);

        setSaleMessage(`Reporte exportado (${from} a ${to}).`, "is-success");
      } catch (error) {
        const rawMessage = String(error?.message || "No se pudo exportar reporte.");
        if (/No se pudo conectar|Failed to fetch|NetworkError/i.test(rawMessage)) {
          state.apiConnected = false;
        }
        setSaleMessage(rawMessage, "is-error");
      } finally {
        refs.exportSalesCsvBtn.disabled = false;
        refs.exportSalesCsvBtn.textContent = previousText;
      }
    }

    return {
      resetSaleForm,
      openSaleDialog,
      openEditSaleDialog,
      closeSaleDialog,
      loadSales,
      loadSalesAllForKpi,
      refreshLocalSales,
      handleAddSaleItemFromForm,
      handleSaleItemsClick,
      handleAddPaymentRow,
      handleSalePaymentRowsInput,
      handleSalePaymentRowsClick,
      handleSaleQuickPaySelect,
      handleSaleMontoRecibidoInput,
      handleSaleSubmit,
      handleSaleConfirmBack,
      handleSaleConfirmSubmit,
      handleDeleteSale,
      handleExportSalesCsv
    };
  }

  window.SalesFunctions = {
    matchSale,
    applySalesFilter,
    renderSalesTable,
    renderSalesPager,
    refreshLocalSales,
    createController
  };
})();

