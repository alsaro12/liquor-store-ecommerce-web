function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createPromosObjectServer(deps) {
  const { sendText, sendJson, parseJsonBody, listPromosActivas, getPromoDestacada, validarPromoCodigo } = deps;

  return async function handlePromosRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/promos")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const items = await listPromosActivas();
      sendJson(res, 200, Array.isArray(items) ? items : []);
      return true;
    }

    if (matchesPath(pathname, "/api/promos/destacada")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const item = await getPromoDestacada();
      sendJson(res, 200, item || null);
      return true;
    }

    if (matchesPath(pathname, "/api/promos/validar")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      const codigo = String(payload?.codigo || "").trim();
      if (!codigo) {
        sendText(res, 400, "Falta el código.");
        return true;
      }
      const promo = await validarPromoCodigo(codigo);
      if (!promo) {
        sendText(res, 404, "Código no válido o expirado.");
        return true;
      }
      sendJson(res, 200, promo);
      return true;
    }

    return false;
  };
}

module.exports = {
  createPromosObjectServer
};
