(function () {
  window.AppUi = window.AppUi || {};
  window.AppUi.confirmDialog = {
    open(options) {
      if (typeof window.AppModules?.openConfirmDialog === "function") {
        return window.AppModules.openConfirmDialog(options);
      }
      return Promise.resolve(false);
    }
  };
})();
