import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "src/main.jsx")],
  bundle: true,
  format: "esm",
  splitting: true,
  outdir: resolve(dist, "assets"),
  loader: {
    ".png": "file",
    ".svg": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".webp": "file",
    ".css": "css"
  },
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://127.0.0.1:8791")
  },
  minify: false,
  sourcemap: true
});

await writeFile(
  resolve(dist, "index.html"),
  `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>La Licorería AQP</title>
    <link rel="stylesheet" href="/assets/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>
`,
  "utf8"
);
