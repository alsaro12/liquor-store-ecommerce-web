const path = require("path");

function createStaticPathResolver(staticRoot) {
  return function staticPathFromRequestPath(requestPath) {
    const pathname = requestPath === "/" ? "/index.html" : requestPath;
    const safePath = path.normalize(path.join(staticRoot, pathname));
    if (!safePath.startsWith(staticRoot)) return null;
    return safePath;
  };
}

module.exports = {
  createStaticPathResolver
};
