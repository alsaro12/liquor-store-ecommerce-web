function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createReferidosObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    getReferidoInfo,
    listInvitacionesByUser,
    createInvitacionManual
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

  return async function handleReferidosRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/referidos/mi-codigo")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const info = await getReferidoInfo(user.id);
        const baseLink = "https://la-licoreria.test/registro";
        const link = info.codigo ? `${baseLink}?ref=${encodeURIComponent(info.codigo)}` : "";
        const qrUrl = info.codigo
          ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(link)}`
          : "";
        sendJson(res, 200, {
          codigo: info.codigo || "",
          puntos: info.puntos || 0,
          link,
          qrUrl,
          premio_puntos: 300,
          beneficio_amigo: "S/ 10 en su primer pedido"
        });
      });
      return true;
    }

    if (matchesPath(pathname, "/api/referidos/invitaciones")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const items = await listInvitacionesByUser(user.id);
        sendJson(res, 200, items);
      });
      return true;
    }

    if (matchesPath(pathname, "/api/referidos/invitar")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      await withAuth(req, res, async (user) => {
        const item = await createInvitacionManual(user.id, payload);
        sendJson(res, 201, item);
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createReferidosObjectServer
};
