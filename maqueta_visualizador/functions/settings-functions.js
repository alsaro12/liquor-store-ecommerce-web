(function () {
  function renderApiSettings(refs, getApiBaseUrl) {
    const apiBase = getApiBaseUrl();
    refs.apiBaseUrlCurrent.textContent = apiBase;
    if (document.activeElement !== refs.apiBaseUrlInput) {
      refs.apiBaseUrlInput.value = apiBase;
    }
  }

  function renderDbStatus(refs, state, formatDateTime) {
    const status = state.dbStatus;
    let dotClass = "is-idle";
    let text = "Sin verificar";
    let meta = 'Pulsa "Reintentar" para validar conexión.';

    if (status?.checked) {
      if (!status.configured) {
        dotClass = "is-warn";
        text = "DB no configurada";
        meta = status.message || "Revisa variables DB_* en .env.";
      } else if (status.connected) {
        const usingMysql = status.method === "mysql2";
        dotClass = usingMysql ? "is-ok" : "is-warn";
        text = usingMysql ? "DB conectada" : "Respaldo local activo";
        const methodLabel = usingMysql ? "MySQL OK" : "Modo local CSV";
        meta = `${status.host}:${status.port}/${status.database} · ${methodLabel}`;
        if (status.message) {
          meta = `${meta} · ${status.message}`;
        }
      } else {
        dotClass = "is-error";
        text = "DB sin conexión";
        meta = status.error || status.message || "No se pudo conectar.";
      }
    }

    refs.dbStatusDot.classList.remove("is-idle", "is-ok", "is-warn", "is-error");
    refs.dbStatusDot.classList.add(dotClass);
    refs.dbStatusText.textContent = text;
    refs.dbStatusMeta.textContent = meta;
    refs.dbStatusLastCheck.textContent = `Última verificación: ${
      status?.checkedAt ? formatDateTime(status.checkedAt) : "-"
    }`;
  }

  function renderAccessHost(refs, accessHostState, formatDateTime) {
    const info = accessHostState && typeof accessHostState === "object" ? accessHostState : null;
    let hostValue = "-";
    let meta = 'Pulsa "Detectar host" para obtener el Access Host.';
    let canCopy = false;

    if (info?.host) {
      hostValue = String(info.host);
      canCopy = true;
      const parts = [];
      if (info.sourceLabel) {
        parts.push(String(info.sourceLabel));
      }
      if (info.checkedAt) {
        parts.push(`Última verificación: ${formatDateTime(info.checkedAt)}`);
      }
      if (info.fallbackHost) {
        parts.push(`IP pública detectada: ${info.fallbackHost}`);
      }
      if (info.message) {
        parts.push(String(info.message));
      }
      meta = parts.filter(Boolean).join(" · ") || meta;
    } else if (info?.message) {
      meta = info.error ? `${info.message} ${info.error}` : String(info.message);
    }

    refs.accessHostValue.value = hostValue;
    refs.copyAccessHostBtn.disabled = !canCopy;
    refs.accessHostMeta.textContent = meta;
  }

  function createController(deps) {
    const {
      state,
      refs,
      apiRequest,
      normalizeApiBaseUrl,
      buildApiUrlWithBase,
      getApiBaseUrl,
      saveApiBaseUrlPreference,
      renderApiSettingsBound,
      renderDbStatusBound,
      renderAccessHostBound,
      setSettingsMessage,
      setAppMessage,
      setCpanelProbeResult,
      tryParseJsonText,
      extractMysqlDeniedHost,
      detectBrowserPublicIpv4,
      copyTextToClipboard,
      getRuntimeOrigin
    } = deps;

    function buildAccessHostRenderState() {
      const fallback = state.accessHost && typeof state.accessHost === "object" ? { ...state.accessHost } : {};
      const deniedHost = extractMysqlDeniedHost(state.dbStatus?.error || "");
      if (!deniedHost) return fallback;

      return {
        ...fallback,
        host: deniedHost,
        source: "mysql_access_denied",
        sourceLabel: "Detectado desde rechazo MySQL (más preciso)",
        checkedAt: state.dbStatus?.checkedAt || fallback.checkedAt || new Date().toISOString(),
        message: "Usa este host para autorizar acceso remoto en cPanel.",
        fallbackHost: fallback.host && fallback.host !== deniedHost ? fallback.host : ""
      };
    }

    async function refreshDbStatus() {
      let success = false;
      try {
        const result = await apiRequest("/api/db/status");
        if (!(result && Object.prototype.hasOwnProperty.call(result, "checked"))) {
          throw new Error(`La URL API actual (${getApiBaseUrl()}) no expone /api/db/status.`);
        }
        state.dbStatus = result;
        success = true;
      } catch (error) {
        state.dbStatus = {
          checked: true,
          checkedAt: new Date().toISOString(),
          configured: false,
          connected: false,
          method: "none",
          host: null,
          port: null,
          database: null,
          user: null,
          charset: "utf8mb4",
          missingKeys: [],
          probeMs: 0,
          message: "No se pudo consultar estado de DB.",
          error: String(error?.message || "Error de conexión con API.")
        };
      }
      renderDbStatusBound();
      renderAccessHostBound();
      return success;
    }

    async function refreshAccessHost() {
      let success = false;
      try {
        const result = await apiRequest("/api/db/access-host");
        if (!(result && Object.prototype.hasOwnProperty.call(result, "host"))) {
          throw new Error(`La URL API actual (${getApiBaseUrl()}) no expone /api/db/access-host.`);
        }
        state.accessHost = result;
        success = true;
      } catch (error) {
        const deniedHost = extractMysqlDeniedHost(state.dbStatus?.error || "");
        if (deniedHost) {
          state.accessHost = {
            checkedAt: new Date().toISOString(),
            host: deniedHost,
            source: "mysql_access_denied",
            sourceLabel: "Detectado desde rechazo MySQL",
            publicHost: null,
            dbDeniedHost: deniedHost,
            localHost: null,
            canWhitelist: true,
            message: "Host detectado desde Access denied de MySQL. Úsalo en cPanel > Remote MySQL.",
            error: String(error?.message || "No se pudo usar endpoint backend.")
          };
          success = true;
        } else {
          const browserFallback = await detectBrowserPublicIpv4();
          if (browserFallback?.ip) {
            state.accessHost = {
              checkedAt: new Date().toISOString(),
              host: browserFallback.ip,
              source: "browser_public_ipv4",
              sourceLabel: `IP pública detectada desde navegador (${browserFallback.source})`,
              publicHost: browserFallback.ip,
              dbDeniedHost: null,
              localHost: null,
              canWhitelist: true,
              message:
                "Fallback sin API backend. Usa este host en cPanel si el backend corre en este mismo equipo.",
              error: String(error?.message || "No se pudo usar endpoint backend.")
            };
            success = true;
          } else {
            state.accessHost = {
              checkedAt: new Date().toISOString(),
              host: null,
              source: "error",
              sourceLabel: "No disponible",
              message:
                "No se pudo detectar automáticamente. Verifica la URL API o detecta la IP pública manualmente.",
              error: String(error?.message || "Error de conexión con API.")
            };
          }
        }
      }
      renderAccessHostBound();
      return success;
    }

    async function tryConnectWithCurrentApiBase(refreshAll) {
      await refreshAll({ keepMessages: true });
    }

    async function handleApiBaseSave(event, refreshAll) {
      event.preventDefault();

      try {
        const normalized = normalizeApiBaseUrl(refs.apiBaseUrlInput.value);
        if (!normalized) {
          throw new Error("Ingresa una URL de servidor.");
        }

        state.apiBaseUrl = normalized;
        saveApiBaseUrlPreference(normalized);
        renderApiSettingsBound();
        setSettingsMessage(`Servidor guardado: ${normalized}`, "is-success");
        setAppMessage(`Servidor API activo: ${normalized}`, "is-success");

        await tryConnectWithCurrentApiBase(refreshAll);
        setSettingsMessage(`Conexión OK con ${normalized}`, "is-success", { autoClearMs: 2500 });
      } catch (error) {
        state.apiConnected = false;
        setSettingsMessage(error.message, "is-error");
        setAppMessage(error.message, "is-error");
      }
    }

    async function handleApiBaseTest() {
      try {
        const draft = normalizeApiBaseUrl(refs.apiBaseUrlInput.value);
        if (!draft) {
          throw new Error("Ingresa una URL para probar.");
        }

        const testUrl = buildApiUrlWithBase("/api/db/status", draft);
        let response;
        try {
          response = await fetch(testUrl);
        } catch {
          throw new Error(`No se pudo conectar con ${draft}.`);
        }

        if (!response.ok) {
          throw new Error(`Servidor respondió ${response.status} al probar ${draft}.`);
        }

        const raw = await response.text();
        const data = raw ? JSON.parse(raw) : {};

        if (typeof data?.connected === "boolean") {
          if (!data.connected) {
            throw new Error(`DB sin conexión: ${data.error || "sin detalle"}`);
          }
          setSettingsMessage(`Conexión OK con ${draft} (DB conectada).`, "is-success", { autoClearMs: 3000 });
          return;
        }

        if (typeof data?.checked === "boolean" && typeof data?.connected === "boolean") {
          if (!data.connected) {
            throw new Error(`DB sin conexión: ${data.error || data.message || "sin detalle"}`);
          }
          setSettingsMessage(`Conexión OK con ${draft} (DB conectada).`, "is-success", { autoClearMs: 3000 });
          return;
        }

        setSettingsMessage(`Conexión HTTP OK con ${draft}.`, "is-success", { autoClearMs: 3000 });
      } catch (error) {
        setSettingsMessage(error.message, "is-error");
      }
    }

    async function handleCpanelDbStatusTest() {
      const previousText = refs.testCpanelDbBtn.textContent;
      refs.testCpanelDbBtn.disabled = true;
      refs.testCpanelDbBtn.textContent = "Probando...";

      try {
        const draft = normalizeApiBaseUrl(refs.apiBaseUrlInput.value);
        if (!draft) {
          throw new Error("Ingresa una URL para probar.");
        }

        const testUrl = buildApiUrlWithBase("/api/db/status", draft);
        setCpanelProbeResult({ state: "loading", url: testUrl });
        let response;
        try {
          response = await fetch(testUrl, { cache: "no-store" });
        } catch {
          throw new Error(`No se pudo conectar con ${draft}.`);
        }

        const rawBody = await response.text();
        const jsonBody = tryParseJsonText(rawBody);
        const payload = jsonBody ?? rawBody;

        if (!response.ok) {
          setCpanelProbeResult({
            state: "error",
            url: testUrl,
            httpStatus: response.status,
            payload,
            error: `Servidor respondió ${response.status} al consultar /api/db/status.`
          });
          throw new Error(`Servidor respondió ${response.status} al consultar /api/db/status.`);
        }

        if (!jsonBody || typeof jsonBody.connected !== "boolean") {
          setCpanelProbeResult({
            state: "error",
            url: testUrl,
            httpStatus: response.status,
            payload,
            error: "El endpoint /api/db/status no devolvió el campo booleano 'connected'."
          });
          throw new Error("El endpoint /api/db/status no devolvió el campo booleano 'connected'.");
        }

        if (jsonBody.connected) {
          setCpanelProbeResult({
            state: "ok",
            url: testUrl,
            httpStatus: response.status,
            payload: jsonBody
          });
          setSettingsMessage(`DB cPanel conectada en ${draft}.`, "is-success", { autoClearMs: 3000 });
        } else {
          setCpanelProbeResult({
            state: "error",
            url: testUrl,
            httpStatus: response.status,
            payload: jsonBody,
            error: `DB cPanel sin conexión: ${jsonBody.error || "sin detalle"}`
          });
          throw new Error(`DB cPanel sin conexión: ${jsonBody.error || "sin detalle"}`);
        }
      } catch (error) {
        const text = String(error?.message || "Error de prueba.");
        if (refs.cpanelProbeBadge?.classList.contains("is-loading")) {
          setCpanelProbeResult({
            state: "error",
            payload: null,
            error: text
          });
        }
        setSettingsMessage(error.message, "is-error");
      } finally {
        refs.testCpanelDbBtn.disabled = false;
        refs.testCpanelDbBtn.textContent = previousText;
      }
    }

    function handleUseCurrentOrigin() {
      const origin = getRuntimeOrigin();
      if (!origin) {
        setSettingsMessage(
          "Esta pestaña no tiene origen http/https. Abre la app desde un servidor web.",
          "is-error"
        );
        return;
      }
      refs.apiBaseUrlInput.value = origin;
      setSettingsMessage(`URL cargada desde la pestaña: ${origin}`, "is-success", {
        autoClearMs: 2200
      });
    }

    async function handleCopyAccessHost() {
      const host = String(refs.accessHostValue.value || "").trim();
      if (!host || host === "-") {
        setSettingsMessage("Primero detecta un Access Host válido.", "is-error", { autoClearMs: 2600 });
        return;
      }
      try {
        await copyTextToClipboard(host);
        setSettingsMessage(`Access Host copiado: ${host}`, "is-success", { autoClearMs: 2400 });
      } catch (error) {
        setSettingsMessage(`No se pudo copiar: ${error.message}`, "is-error");
      }
    }

    async function handleRefreshAccessHostClick() {
      refs.refreshAccessHostBtn.disabled = true;
      try {
        await refreshDbStatus();
        const ok = await refreshAccessHost();
        const effectiveHost = String(buildAccessHostRenderState()?.host || "").trim();
        if (ok && effectiveHost) {
          setSettingsMessage("Access Host actualizado.", "is-success", { autoClearMs: 2200 });
        } else if (ok) {
          setSettingsMessage("No se detectó Access Host con la API actual.", "is-error");
        } else {
          setSettingsMessage("No se pudo consultar Access Host con la URL API actual.", "is-error");
        }
      } finally {
        refs.refreshAccessHostBtn.disabled = false;
      }
    }

    async function handleRefreshDbStatusClick() {
      refs.dbStatusRefreshBtn.disabled = true;
      try {
        const ok = await refreshDbStatus();
        if (ok) {
          setSettingsMessage("Estado de DB actualizado.", "is-success", { autoClearMs: 1800 });
        } else {
          setSettingsMessage("No se pudo verificar la DB con la URL API actual.", "is-error");
        }
      } finally {
        refs.dbStatusRefreshBtn.disabled = false;
      }
    }

    return {
      buildAccessHostRenderState,
      refreshDbStatus,
      refreshAccessHost,
      handleApiBaseSave,
      handleApiBaseTest,
      handleCpanelDbStatusTest,
      handleUseCurrentOrigin,
      handleCopyAccessHost,
      handleRefreshAccessHostClick,
      handleRefreshDbStatusClick
    };
  }

  window.SettingsFunctions = {
    renderApiSettings,
    renderDbStatus,
    renderAccessHost,
    createController
  };
})();



