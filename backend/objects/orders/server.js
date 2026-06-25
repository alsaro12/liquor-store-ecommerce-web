function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createOrdersObjectServer(deps) {
  const {
    sendText,
    sendJson,
    handleOrdersCollection,
    handleOrdersById,
    handleStorefrontMyOrders,
    handleStorefrontMyOrderById,
    handlePublicOrderById,
    handleStorefrontRepeatOrder,
    requireStaff
  } = deps;

  return async function handleOrdersObjectRoute(req, res, pathname, query) {
    if (matchesPath(pathname, "/api/orders")) {
      if (req.method !== "POST") {
        await requireStaff(req);
      }
      await handleOrdersCollection(req, res, query);
      return true;
    }

    if (matchesPath(pathname, "/api/orders/mias")) {
      await handleStorefrontMyOrders(req, res, query);
      return true;
    }

    const repeatMatch = pathname.match(/^\/api\/orders\/mias\/([^/]+)\/repetir\/?$/);
    if (repeatMatch) {
      await handleStorefrontRepeatOrder(req, res, repeatMatch[1]);
      return true;
    }

    const myOrderMatch = pathname.match(/^\/api\/orders\/mias\/([^/]+)\/?$/);
    if (myOrderMatch) {
      await handleStorefrontMyOrderById(req, res, myOrderMatch[1]);
      return true;
    }

    const publicOrderMatch = pathname.match(/^\/api\/orders\/public\/([^/]+)\/?$/);
    if (publicOrderMatch) {
      await handlePublicOrderById(req, res, publicOrderMatch[1]);
      return true;
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)\/?$/);
    if (orderMatch) {
      await requireStaff(req);
      await handleOrdersById(req, res, orderMatch[1], query);
      return true;
    }

    return false;
  };
}

module.exports = {
  createOrdersObjectServer
};
