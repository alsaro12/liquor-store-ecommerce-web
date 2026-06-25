function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createKardexObjectServer(deps) {
  const { sendText, sendJson, readKardexAll, handleKardexCollection, handleKardexById, requireStaff } = deps;

  return async function handleKardexObjectRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/kardex")) {
      await requireStaff(req);
      await handleKardexCollection(req, res, query);
      return true;
    }

    if (matchesPath(pathname, "/api/kardex/all")) {
      await requireStaff(req);
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const items = await readKardexAll();
      sendJson(res, 200, items);
      return true;
    }

    const kardexMatch = pathname.match(/^\/api\/kardex\/(\d+)\/?$/);
    if (kardexMatch) {
      await requireStaff(req);
      await handleKardexById(req, res, kardexMatch[1]);
      return true;
    }

    return false;
  };
}

module.exports = {
  createKardexObjectServer
};
