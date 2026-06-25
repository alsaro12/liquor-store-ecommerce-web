function nowIso() {
  return new Date().toISOString();
}

function trimValue(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

module.exports = {
  nowIso,
  trimValue,
  toNumber,
  toInt,
  round2,
  safeStringify
};
