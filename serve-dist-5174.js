const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = 5174;
const BACKEND_ORIGIN = "http://127.0.0.1:8787";
const DIST_ROOT = path.join(__dirname, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    ...headers
  });
  res.end(body);
}

function proxy(req, res) {
  const target = new URL(req.url, BACKEND_ORIGIN);
  const proxyReq = http.request(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host
      }
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    send(res, 502, `Backend no disponible: ${error.message}`, {
      "Content-Type": "text/plain; charset=utf-8"
    });
  });

  req.pipe(proxyReq);
}

function staticFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const fileName = cleanPath === "/" ? "index.react.html" : cleanPath.replace(/^\/+/, "");
  const resolved = path.resolve(DIST_ROOT, fileName);
  if (!resolved.startsWith(DIST_ROOT)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/uploads/")) {
    proxy(req, res);
    return;
  }

  const filePath = staticFilePath(req.url);
  if (!filePath) {
    send(res, 403, "Acceso denegado.", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "No encontrado.", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, content, { "Content-Type": type });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Storefront listo en http://127.0.0.1:${PORT}/`);
});
