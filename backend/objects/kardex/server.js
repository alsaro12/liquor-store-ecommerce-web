function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createKardexObjectServer(deps) {
  const { sendText, sendJson, readKardexAll, handleKardexCollection, handleKardexById } = deps;

  return async function handleKardexObjectRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/kardex")) {
      await handleKardexCollection(req, res, query);
      return true;
    }

    if (matchesPath(pathname, "/api/kardex/all")) {
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
      await handleKardexById(req, res, kardexMatch[1]);
      return true;
    }

    return false;
  };
}

module.exports = {
  createKardexObjectServer
};
