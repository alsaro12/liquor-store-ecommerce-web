function createRouteRegistry(routeHandlers = []) {
  return routeHandlers.filter(Boolean);
}

module.exports = {
  createRouteRegistry
};
