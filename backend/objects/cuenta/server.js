function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createCuentaObjectServer(deps) {
  const { sendText, sendJson, requireCustomer, buildCuentaResumen } = deps;

  return async function handleCuentaRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/cuenta/resumen")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      let user;
      try {
        user = await requireCustomer(req);
      } catch (error) {
        sendText(res, error?.status || 401, error?.message || "Sesión requerida.");
        return true;
      }
      try {
        const data = await buildCuentaResumen(user);
        sendJson(res, 200, data);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error interno.");
      }
      return true;
    }
    return false;
  };
}

module.exports = {
  createCuentaObjectServer
};
