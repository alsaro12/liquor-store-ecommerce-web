const legacyStore = require("./legacy-store");

module.exports = {
  listProducts: legacyStore.listProducts,
  readProducts: legacyStore.readProducts,
  getProductStats: legacyStore.getProductStats,
  createProduct: legacyStore.createProduct,
  updateProduct: legacyStore.updateProduct,
  deleteProduct: legacyStore.deleteProduct,
  registerStockIngress: legacyStore.registerStockIngress
};
