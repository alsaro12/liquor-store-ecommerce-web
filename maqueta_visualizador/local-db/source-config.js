const legacyStore = require("./legacy-store");

module.exports = {
  getSourceInfo: legacyStore.getSourceInfo,
  setDefaultSource: legacyStore.setDefaultSource,
  setSourceFromUpload: legacyStore.setSourceFromUpload
};
