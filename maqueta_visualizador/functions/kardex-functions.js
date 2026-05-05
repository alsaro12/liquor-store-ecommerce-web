(function () {
  const { normalizeText } = window.AppCustomFunctions;
  const { renderKardexRows } = window.KardexTableComponent;

  function matchKardex(item, rawTerm, typeFilter) {
    const typeOk = !typeFilter || typeFilter === "TODOS" || item.TIPO === typeFilter;
    if (!typeOk) return false;

    const term = String(rawTerm ?? "").trim();
    if (!term) return true;

    const norm = normalizeText(term);
    return (
      String(item["N°"] ?? "").includes(term) ||
      String(item.FECHA_HORA ?? "").includes(term) ||
      normalizeText(item.NOMBRE ?? "").includes(norm) ||
      normalizeText(item.REFERENCIA ?? "").includes(norm) ||
      normalizeText(item.NOTA ?? "").includes(norm)
    );
  }

  function applyKardexFilter(state) {
    if (state.serverBackedTables) {
      state.filteredKardex = Array.isArray(state.kardex) ? [...state.kardex] : [];
      return;
    }

    state.filteredKardex = state.kardex.filter((item) =>
      matchKardex(item, state.kardexSearch, state.kardexType)
    );
  }

  function renderKardexTable(refs, state) {
    const rows = state.filteredKardex || [];
    refs.kardexBody.innerHTML = rows.length
      ? renderKardexRows(rows)
      : '<tr><td class="empty" colspan="9">No hay movimientos para este filtro.</td></tr>';
  }

  function refreshLocalKardex(state, refs) {
    applyKardexFilter(state);
    renderKardexTable(refs, state);
  }

  function createController(deps) {
    const {
      state,
      refs,
      apiRequest,
      buildCollectionQuery,
      setAppMessage,
      openConfirmDialog,
      refreshAll,
      renderSortButtons,
      renderKpis
    } = deps;

    async function loadKardex() {
      const query = buildCollectionQuery({
        q: state.kardexSearch,
        tipo: state.kardexType,
        page: 1,
        pageSize: 5000,
        sortBy: state.kardexSort.key,
        sortDir: state.kardexSort.dir
      });
      const response = await apiRequest(`/api/kardex?${query}`);
      const items = Array.isArray(response?.items) ? response.items : [];
      state.kardex = items;
      state.filteredKardex = items;
    }

    async function loadKardexAllForKpi() {
      try {
        const items = await apiRequest("/api/kardex/all");
        state.kardexAll = Array.isArray(items) ? items : [];
      } catch {
        state.kardexAll = Array.isArray(state.kardex) ? [...state.kardex] : [];
      }
    }

    async function refreshLocalKardexController() {
      try {
        await loadKardex();
        state.apiConnected = true;
        renderKardexTable(refs, state);
        renderSortButtons();
        renderKpis();
      } catch (error) {
        state.apiConnected = false;
        setAppMessage(error.message, "is-error");
      }
    }

    async function handleDeleteKardex(id) {
      const source = state.kardexAll.length ? state.kardexAll : state.kardex;
      const item = source.find((row) => Number(row.ID_MOV) === Number(id));
      const productLabel = item
        ? `N° ${item["N°"]}${item.NOMBRE ? ` - ${item.NOMBRE}` : ""}`
        : `ID ${id}`;

      const ok = await openConfirmDialog({
        title: "Eliminar movimiento kardex",
        message: `Deseas eliminar el movimiento #${id} (${productLabel})?\nEsta accion no se puede deshacer.`,
        confirmText: "Eliminar movimiento"
      });
      if (!ok) return;

      try {
        await apiRequest(`/api/kardex/${id}`, { method: "DELETE" });
        setAppMessage(`Movimiento kardex #${id} eliminado.`, "is-success");
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setAppMessage(error.message, "is-error");
      }
    }

    async function handleDeleteAllKardex() {
      const totalKnown = state.kardexAll.length || state.kardex.length || 0;
      const suffix = totalKnown > 0 ? `\nMovimientos detectados ahora: ${totalKnown}.` : "";
      const ok = await openConfirmDialog({
        title: "Eliminar todo el kardex",
        message:
          `Deseas eliminar TODOS los movimientos del kardex?\nEsta accion no se puede deshacer.${suffix}`,
        confirmText: "Eliminar todo"
      });
      if (!ok) return;

      const previousText = refs.kardexDeleteAllBtn?.textContent || "Eliminar todo kardex";
      if (refs.kardexDeleteAllBtn) {
        refs.kardexDeleteAllBtn.disabled = true;
        refs.kardexDeleteAllBtn.textContent = "Eliminando...";
      }

      try {
        const result = await apiRequest("/api/kardex", { method: "DELETE" });
        const deletedCount = Number(result?.deletedCount || 0);
        if (deletedCount > 0) {
          setAppMessage(`Kardex reiniciado. Movimientos eliminados: ${deletedCount}.`, "is-success");
        } else {
          setAppMessage("Kardex reiniciado. No había movimientos para eliminar.", "is-success");
        }
        await refreshAll({ keepMessages: true });
      } catch (error) {
        state.apiConnected = false;
        setAppMessage(error.message, "is-error");
      } finally {
        if (refs.kardexDeleteAllBtn) {
          refs.kardexDeleteAllBtn.disabled = false;
          refs.kardexDeleteAllBtn.textContent = previousText;
        }
      }
    }

    return {
      loadKardex,
      loadKardexAllForKpi,
      refreshLocalKardex: refreshLocalKardexController,
      handleDeleteKardex,
      handleDeleteAllKardex
    };
  }

  window.KardexFunctions = {
    matchKardex,
    applyKardexFilter,
    renderKardexTable,
    refreshLocalKardex,
    createController
  };
})();
