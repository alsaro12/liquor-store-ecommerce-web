function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createProductosObjectServer(deps) {
  const {
    sendText,
    sendJson,
    readProductsAll,
    readProductsStorefront,
    readProductImageByHash,
    getProductCategories,
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

    if (matchesPath(pathname, "/api/productos/categorias")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const categories = await getProductCategories();
      sendJson(res, 200, categories);
      return true;
    }

    if (matchesPath(pathname, "/api/productos/storefront")) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const items = typeof readProductsStorefront === "function"
        ? await readProductsStorefront()
        : [];
      sendJson(res, 200, Array.isArray(items) ? items : []);
      return true;
    }

    const imageHashMatch = pathname.match(/^\/api\/productos\/imagen\/([a-fA-F0-9]{64})\/?$/);
    if (imageHashMatch) {
      if (req.method !== "GET") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const hash = imageHashMatch[1].toLowerCase();
      const record = typeof readProductImageByHash === "function"
        ? await readProductImageByHash(hash)
        : null;
      if (!record || !record.source) {
        sendText(res, 404, "Imagen no encontrada.");
        return true;
      }
      const source = String(record.source);
      let mime = String(record.mime || "image/webp");
      let buffer = null;
      const dataMatch = source.match(/^data:([^;,]+)?(?:;([^,]+))?,(.*)$/s);
      if (dataMatch) {
        if (dataMatch[1]) mime = dataMatch[1].trim() || mime;
        const encoding = (dataMatch[2] || "").trim().toLowerCase();
        const payload = dataMatch[3] || "";
        try {
          buffer = encoding === "base64"
            ? Buffer.from(payload, "base64")
            : Buffer.from(decodeURIComponent(payload), "utf8");
        } catch (_) {
          buffer = null;
        }
      } else if (/^https?:\/\//i.test(source) || source.startsWith("/")) {
        res.writeHead(302, { Location: source, "Cache-Control": "public, max-age=31536000, immutable" });
        res.end();
        return true;
      }
      if (!buffer || !buffer.length) {
        sendText(res, 415, "Formato de imagen no soportado.");
        return true;
      }
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: `"${hash}"`
      });
      res.end(buffer);
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
