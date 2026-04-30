const legacyStore = require("./legacy-store");

module.exports = {
  ensureProductsCsv: legacyStore.ensureProductsCsv,
  ensureInventoryData: legacyStore.ensureInventoryData,
  readRawActiveCsv: legacyStore.readRawActiveCsv
};
