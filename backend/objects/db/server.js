function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createDbObjectServer(deps) {
  const { sendText, sendJson, getDbStatus, getDbAccessHostStatus, getRuntimeStatus, logInfo, requireStaff } = deps;

  return async function handleDbObjectRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/runtime")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const status = await getRuntimeStatus();
      sendJson(res, 200, status);
      return true;
    }

    if (matchesPath(pathname, "/api/db/status")) {
      await requireStaff(req);
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const status = await getDbStatus();
      sendJson(res, 200, status);
      return true;
    }

    if (matchesPath(pathname, "/api/db/access-host")) {
      await requireStaff(req);
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const info = await getDbAccessHostStatus();
      logInfo("Access host detectado", {
        host: info.host,
        source: info.source,
        publicHost: info.publicHost,
        dbDeniedHost: info.dbDeniedHost
      });
      sendJson(res, 200, info);
      return true;
    }

    return false;
  };
}

module.exports = {
  createDbObjectServer
};
