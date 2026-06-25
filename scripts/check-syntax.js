const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXCLUDED_DIRS = new Set([".git", "node_modules", "vendor", "dist", "dist-webpack"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === ".js") {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walk(ROOT);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failures.push({
      file: path.relative(ROOT, file),
      output: `${result.stdout || ""}${result.stderr || ""}`.trim()
    });
  }
}

if (failures.length) {
  console.error("Syntax errors detected:");
  for (const failure of failures) {
    console.error(`\n${failure.file}`);
    console.error(failure.output);
  }
  process.exit(1);
}

console.log(`Syntax OK (${files.length} JS files).`);
