function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createMetodosPagoObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listMetodosPagoByUser,
    createMetodoPago,
    deleteMetodoPago,
    setMetodoPagoPrincipal
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

  return async function handleMetodosPagoRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/metodos-pago")) {
      if (req.method === "GET") {
        await withAuth(req, res, async (user) => {
          const items = await listMetodosPagoByUser(user.id);
          sendJson(res, 200, items);
        });
        return true;
      }
      if (req.method === "POST") {
        const payload = await parseJsonBody(req);
        await withAuth(req, res, async (user) => {
          const item = await createMetodoPago(user.id, payload);
          sendJson(res, 201, item);
        });
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    const principalMatch = pathname.match(/^\/api\/metodos-pago\/(\d+)\/principal\/?$/);
    if (principalMatch) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const item = await setMetodoPagoPrincipal(user.id, Number(principalMatch[1]));
        sendJson(res, 200, item);
      });
      return true;
    }

    const idMatch = pathname.match(/^\/api\/metodos-pago\/(\d+)\/?$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (req.method === "DELETE") {
        await withAuth(req, res, async (user) => {
          await deleteMetodoPago(user.id, id);
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
  createMetodosPagoObjectServer
};
