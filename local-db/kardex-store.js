const legacyStore = require("./legacy-store");

module.exports = {
  listKardex: legacyStore.listKardex,
  readKardex: legacyStore.readKardex,
  deleteKardexMovement: legacyStore.deleteKardexMovement,
  deleteAllKardexMovements: legacyStore.deleteAllKardexMovements
};
