import { mkdir, writeFile } from "node:fs/promises";

await mkdir("dist-webpack", { recursive: true });
await writeFile(
  "dist-webpack/index.html",
  `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>La Licorería AQP</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/assets/main.js"></script>
  </body>
</html>
`,
  "utf8"
);
