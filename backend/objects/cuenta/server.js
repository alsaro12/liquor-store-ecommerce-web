function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function publicErrorMessage(error, fallback) {
  const status = Number(error?.status || 500);
  if (status >= 500) return fallback;
  return error?.message || fallback;
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
        const status = Number(error?.status || 500);
        sendText(res, status, publicErrorMessage(error, "No se pudo cargar el resumen de cuenta."));
      }
      return true;
    }
    return false;
  };
}

module.exports = {
  createCuentaObjectServer
};
