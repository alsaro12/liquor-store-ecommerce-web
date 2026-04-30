(function () {
  window.AppUi = window.AppUi || {};
  window.AppUi.loadingButton = {
    set(button, loading) {
      if (!button) return;
      button.classList.toggle("is-loading", Boolean(loading));
      button.disabled = Boolean(loading);
    }
  };
})();
