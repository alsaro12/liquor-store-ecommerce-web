const legacyStore = require("./legacy-store");

module.exports = {
  ensureInventoryData: legacyStore.ensureInventoryData,
  rebuildProductsCsvFromBase: legacyStore.rebuildProductsCsvFromBase
};
