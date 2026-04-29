function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createProductosObjectServer(deps) {
  const {
    sendText,
    sendJson,
    readProductsAll,
    getProductStats,
    handleProductsCollection,
    handleProductsById,
    handleProductStockIngress,
    handleProductMovementsHistory,
    handleProductPurchasePriceHistory
  } = deps;

  return async function handleProductosObjectRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/productos")) {
      await handleProductsCollection(req, res, query);
      return true;
    }

    if (matchesPath(pathname, "/api/productos/all")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const includeImages = query.get("images") === "1" || query.get("includeImages") === "1";
      const items = await readProductsAll({ includeImages });
      sendJson(res, 200, items);
      return true;
    }

    if (matchesPath(pathname, "/api/productos/stats")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const stats = await getProductStats();
      sendJson(res, 200, stats);
      return true;
    }

  const productIngressMatch = pathname.match(/^\/api\/productos\/(\d+)\/ingreso\/?$/);
  if (productIngressMatch) {
    await handleProductStockIngress(req, res, productIngressMatch[1]);
    return true;
  }

  const productMovementsMatch = pathname.match(/^\/api\/productos\/(\d+)\/movimientos\/?$/);
  if (productMovementsMatch) {
    await handleProductMovementsHistory(req, res, productMovementsMatch[1], query);
    return true;
  }

  const productPurchaseHistoryMatch = pathname.match(/^\/api\/productos\/(\d+)\/precios-compra\/?$/);
  if (productPurchaseHistoryMatch) {
    await handleProductPurchasePriceHistory(req, res, productPurchaseHistoryMatch[1], query);
    return true;
  }

    const productMatch = pathname.match(/^\/api\/productos\/(\d+)\/?$/);
    if (productMatch) {
      await handleProductsById(req, res, productMatch[1], query);
      return true;
    }

    return false;
  };
}

module.exports = {
  createProductosObjectServer
};
