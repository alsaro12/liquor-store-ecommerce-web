(function () {
  window.AppUi = window.AppUi || {};
  window.AppUi.paginationControls = {
    canGoPrev(pagination) {
      return Boolean(pagination?.hasPrev);
    },
    canGoNext(pagination) {
      return Boolean(pagination?.hasNext);
    }
  };
})();
