function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createCombosObjectServer(deps) {
  const { sendText, sendJson, parseJsonBody, listCombosActivos, createCombo, updateCombo, deleteCombo, getComboBySlug, requireStaff } = deps;

  return async function handleCombosRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/combos")) {
      if (req.method === "GET") {
        const items = await listCombosActivos();
        sendJson(res, 200, Array.isArray(items) ? items : []);
        return true;
      }
      if (req.method === "POST") {
        await requireStaff(req);
        const payload = await parseJsonBody(req);
        const item = await createCombo(payload);
        sendJson(res, 201, item);
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    const slugMatch = pathname.match(/^\/api\/combos\/([^/]+)\/?$/);
    if (slugMatch) {
      const slug = decodeURIComponent(slugMatch[1]);
      if (req.method === "PUT") {
        await requireStaff(req);
        const payload = await parseJsonBody(req);
        const item = await updateCombo(slug, payload);
        sendJson(res, 200, item);
        return true;
      }
      if (req.method === "DELETE") {
        await requireStaff(req);
        const result = await deleteCombo(slug);
        sendJson(res, 200, result);
        return true;
      }
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
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
