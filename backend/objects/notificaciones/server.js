function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createNotificacionesObjectServer(deps) {
  const {
    sendText,
    sendJson,
    requireCustomer,
    listNotificacionesByUser,
    countUnreadNotificaciones,
    markNotificacionLeida,
    markAllNotificacionesLeidas
  } = deps;

  async function withAuth(req, res, handler) {
    let user;
    try {
      user = await requireCustomer(req);
    } catch (error) {
      sendText(res, error?.status || 401, error?.message || "Sesión requerida.");
      return;
    }
    try {
      await handler(user);
    } catch (error) {
      sendText(res, error?.status || 500, error?.message || "Error interno.");
    }
  }

  return async function handleNotificacionesRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/notificaciones")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const soloNoLeidas = query?.get("soloNoLeidas") === "1";
      const tipo = query?.get("tipo") || "";
      await withAuth(req, res, async (user) => {
        const items = await listNotificacionesByUser(user.id, { soloNoLeidas, tipo });
        sendJson(res, 200, items);
      });
      return true;
    }

    if (matchesPath(pathname, "/api/notificaciones/no-leidas")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const total = await countUnreadNotificaciones(user.id);
        sendJson(res, 200, { total });
      });
      return true;
    }

    if (matchesPath(pathname, "/api/notificaciones/leer-todas")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const updated = await markAllNotificacionesLeidas(user.id);
        sendJson(res, 200, { updated });
      });
      return true;
    }

    const leerMatch = pathname.match(/^\/api\/notificaciones\/(\d+)\/leer\/?$/);
    if (leerMatch) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        await markNotificacionLeida(user.id, Number(leerMatch[1]));
        sendJson(res, 200, { ok: true });
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createNotificacionesObjectServer
};
