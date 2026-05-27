function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createCombosObjectServer(deps) {
  const { sendText, sendJson, listCombosActivos, getComboBySlug } = deps;

  return async function handleCombosRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/combos")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const items = await listCombosActivos();
      sendJson(res, 200, Array.isArray(items) ? items : []);
      return true;
    }

    const slugMatch = pathname.match(/^\/api\/combos\/([^/]+)\/?$/);
    if (slugMatch) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const slug = decodeURIComponent(slugMatch[1]);
      const combo = await getComboBySlug(slug);
      if (!combo) {
        sendText(res, 404, "Combo no encontrado.");
        return true;
      }
      sendJson(res, 200, combo);
      return true;
    }

    return false;
  };
}

module.exports = {
  createCombosObjectServer
};
