function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createFavoritosObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    requireCustomer,
    listFavoritosByUser,
    listFavoritoIdsByUser,
    addFavorito,
    removeFavoritoById,
    removeFavoritoByRef
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

  return async function handleFavoritosRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/favoritos/ids")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      await withAuth(req, res, async (user) => {
        const result = await listFavoritoIdsByUser(user.id);
        sendJson(res, 200, result);
      });
      return true;
    }

    if (matchesPath(pathname, "/api/favoritos")) {
      if (req.method === "GET") {
        await withAuth(req, res, async (user) => {
          const items = await listFavoritosByUser(user.id);
          sendJson(res, 200, items);
        });
        return true;
      }
      if (req.method === "POST") {
        const payload = await parseJsonBody(req);
        await withAuth(req, res, async (user) => {
          const fav = await addFavorito(user.id, payload);
          sendJson(res, 201, fav);
        });
        return true;
      }
      if (req.method === "DELETE") {
        const tipo = String(query?.get("tipo") || "").toLowerCase();
        const ref = String(query?.get("referencia_id") || "").trim();
        if (!tipo || !ref) {
          sendText(res, 400, "Falta tipo o referencia_id.");
          return true;
        }
        await withAuth(req, res, async (user) => {
          await removeFavoritoByRef(user.id, tipo, ref);
          sendJson(res, 200, { ok: true });
        });
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    const idMatch = pathname.match(/^\/api\/favoritos\/(\d+)\/?$/);
    if (idMatch) {
      if (req.method !== "DELETE") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const id = Number(idMatch[1]);
      await withAuth(req, res, async (user) => {
        await removeFavoritoById(user.id, id);
        sendJson(res, 200, { ok: true });
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  createFavoritosObjectServer
};
