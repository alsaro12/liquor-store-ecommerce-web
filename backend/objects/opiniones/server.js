function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function publicErrorMessage(error, fallback = "No se pudo procesar la solicitud.") {
  if (error?.status && error.status < 500) return error.message || fallback;
  return fallback;
}

function createOpinionesObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    requireStaff,
    createOpinion,
    listOpiniones,
    updateOpinionStatus
  } = deps;

  async function withCustomer(req, res, handler) {
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
      const status = error?.status && error.status < 500 ? error.status : 500;
      sendText(res, status, publicErrorMessage(error, "No se pudo guardar tu opinión."));
    }
  }

  async function withStaff(req, res, handler) {
    let user;
    try {
      user = await requireStaff(req);
    } catch (error) {
      sendText(res, error?.status || 401, error?.message || "Acceso reservado para administradores.");
      return;
    }
    try {
      await handler(user);
    } catch (error) {
      const status = error?.status && error.status < 500 ? error.status : 500;
      sendText(res, status, publicErrorMessage(error, "No se pudieron gestionar las opiniones."));
    }
  }

  return async function handleOpinionesRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/opiniones")) {
      if (req.method === "POST") {
        const payload = await parseJsonBody(req);
        await withCustomer(req, res, async (user) => {
          const item = await createOpinion(user, payload);
          sendJson(res, 201, { ok: true, item });
        });
        return true;
      }
      if (req.method === "GET") {
        await withStaff(req, res, async () => {
          const items = await listOpiniones({ status: query?.get("status") || "" });
          sendJson(res, 200, items);
        });
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    const idMatch = pathname.match(/^\/api\/opiniones\/([^/]+)\/?$/);
    if (idMatch) {
      if (req.method !== "PATCH") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      await withStaff(req, res, async (user) => {
        const item = await updateOpinionStatus(decodeURIComponent(idMatch[1]), payload, user);
        sendJson(res, 200, item);
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createOpinionesObjectServer
};
