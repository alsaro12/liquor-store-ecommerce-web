function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createAuthObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    findCustomerByToken,
    extractBearerToken
  } = deps;

  return async function handleAuthObjectRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/auth/register")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      try {
        const result = await registerCustomer(payload);
        sendJson(res, 201, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error al registrar.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/login")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      try {
        const result = await loginCustomer(payload);
        sendJson(res, 200, result);
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error de login.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/logout")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const token = extractBearerToken(req);
      try {
        await logoutCustomer(token);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendText(res, error?.status || 500, error?.message || "Error de logout.");
      }
      return true;
    }

    if (matchesPath(pathname, "/api/auth/me")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const token = extractBearerToken(req);
      const user = token ? await findCustomerByToken(token) : null;
      if (!user) {
        sendText(res, 401, "No autenticado.");
        return true;
      }
      sendJson(res, 200, { user });
      return true;
    }

    return false;
  };
}

module.exports = {
  createAuthObjectServer
};
