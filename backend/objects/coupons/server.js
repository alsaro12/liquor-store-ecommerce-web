function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createCouponsObjectServer(deps) {
  const {
    sendText,
    sendJson,
    parseJsonBody,
    listCouponsAll,
    saveCoupon,
    deleteCoupon,
    validateCouponForDelivery,
    requireStaff
  } = deps;

  return async function handleCouponsRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/coupons")) {
      if (req.method === "GET") {
        await requireStaff(req);
        sendJson(res, 200, await listCouponsAll());
        return true;
      }
      if (req.method === "POST") {
        await requireStaff(req);
        const payload = await parseJsonBody(req);
        sendJson(res, 201, await saveCoupon("", payload));
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    if (matchesPath(pathname, "/api/coupons/validate")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }
      const payload = await parseJsonBody(req);
      sendJson(res, 200, await validateCouponForDelivery(payload?.code || payload?.codigo, {
        shipping: payload?.shipping ?? payload?.delivery ?? payload?.deliveryPrice
      }));
      return true;
    }

    const idMatch = pathname.match(/^\/api\/coupons\/([^/]+)\/?$/);
    if (idMatch) {
      await requireStaff(req);
      const id = decodeURIComponent(idMatch[1]);
      if (req.method === "PUT") {
        const payload = await parseJsonBody(req);
        sendJson(res, 200, await saveCoupon(id, payload));
        return true;
      }
      if (req.method === "DELETE") {
        sendJson(res, 200, await deleteCoupon(id));
        return true;
      }
      sendText(res, 405, "Metodo no permitido.");
      return true;
    }

    return false;
  };
}

module.exports = {
  createCouponsObjectServer
};
