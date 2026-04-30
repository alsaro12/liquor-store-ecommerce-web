const legacyStore = require("./legacy-store");

module.exports = {
  listSales: legacyStore.listSales,
  readSales: legacyStore.readSales,
  registerSale: legacyStore.registerSale,
  registerSaleBatch: legacyStore.registerSaleBatch,
  updateSale: legacyStore.updateSale,
  deleteSale: legacyStore.deleteSale
};
