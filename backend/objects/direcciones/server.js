function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createDireccionesObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listDireccionesByUser,
    createDireccion,
    updateDireccion,
    deleteDireccion,
    setDireccionPrincipal,
    getDireccionById
  } = deps;

  function publicErrorMessage(error, fallback = "No se pudo procesar la solicitud.") {
    if (error?.status && error.status < 500) {
      return error.message || fallback;
    }
    return fallback;
  }

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
      const status = error?.status && error.status < 500 ? error.status : 500;
      sendText(res, status, publicErrorMessage(error, "No se pudieron gestionar tus direcciones."));
    }
  }

  return async function handleDireccionesRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/direcciones")) {
      if (req.method === "GET") {
        await withAuth(req, res, async (user) => {
          const items = await listDireccionesByUser(user.id);
          sendJson(res, 200, items);
        });
        return true;
      }
      if (req.method === "POST") {
        const payload = await parseJsonBody(req);
        await withAuth(req, res, async (user) => {
          const dir = await createDireccion(user.id, payload);
          sendJson(res, 201, dir);
        });
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    const principalMatch = pathname.match(/^\/api\/direcciones\/(\d+)\/principal\/?$/);
    if (principalMatch) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const id = Number(principalMatch[1]);
      await withAuth(req, res, async (user) => {
        const dir = await setDireccionPrincipal(user.id, id);
        sendJson(res, 200, dir);
      });
      return true;
    }

    const idMatch = pathname.match(/^\/api\/direcciones\/(\d+)\/?$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (req.method === "GET") {
        await withAuth(req, res, async (user) => {
          const dir = await getDireccionById(user.id, id);
          if (!dir) {
            sendText(res, 404, "Dirección no encontrada.");
            return;
          }
          sendJson(res, 200, dir);
        });
        return true;
      }
      if (req.method === "PUT") {
        const payload = await parseJsonBody(req);
        await withAuth(req, res, async (user) => {
          const dir = await updateDireccion(user.id, id, payload);
          sendJson(res, 200, dir);
        });
        return true;
      }
      if (req.method === "DELETE") {
        await withAuth(req, res, async (user) => {
          await deleteDireccion(user.id, id);
          sendJson(res, 200, { ok: true });
        });
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    return false;
  };
}

module.exports = {
  createDireccionesObjectServer
};
