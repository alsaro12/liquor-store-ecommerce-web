function matchesPath(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function createAiObjectServer(deps) {
  const { sendText, sendJson, analyzeReceiptImage } = deps;

  return async function handleAiObjectRoute(req, res, pathname) {
    if (matchesPath(pathname, "/api/ai/receipt/analyze")) {
      if (req.method !== "POST") {
        sendText(res, 405, "Metodo no permitido.");
        return true;
      }

      const result = await analyzeReceiptImage(req);
      sendJson(res, 200, result);
      return true;
    }

    return false;
  };
}

module.exports = {
  createAiObjectServer
};
