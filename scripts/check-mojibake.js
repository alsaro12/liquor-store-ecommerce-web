const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js", ".json"]);
const EXCLUDED_DIRS = new Set([".git", "node_modules", "vendor"]);
const EXCLUDED_FILES = new Set(["package-lock.json"]);
const MOJIBAKE_PATTERNS = [
  { label: "latin1-decoded UTF-8 marker C3", pattern: /\u00c3/ },
  { label: "latin1-decoded UTF-8 marker C2", pattern: /\u00c2/ },
  { label: "replacement character", pattern: /\ufffd/ },
  { label: "mojibake replacement sequence", pattern: /\u00ef\u00bf\u00bd/ }
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(fullPath);
  }
  return files;
}

const findings = [];

for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { label, pattern } of MOJIBAKE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file: path.relative(ROOT, file),
          line: index + 1,
          label,
          text: line.trim().slice(0, 160)
        });
      }
      pattern.lastIndex = 0;
    }
  });
}

if (findings.length) {
  console.error("Mojibake detected in source files:");
  findings.slice(0, 50).forEach((finding) => {
    console.error(`${finding.file}:${finding.line} ${finding.label}: ${finding.text}`);
  });
  if (findings.length > 50) {
    console.error(`...and ${findings.length - 50} more finding(s).`);
  }
  process.exit(1);
}

console.log("No mojibake markers found.");
