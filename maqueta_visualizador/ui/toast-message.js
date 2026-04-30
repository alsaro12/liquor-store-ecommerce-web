(function () {
  window.AppUi = window.AppUi || {};
  window.AppUi.toastMessage = {
    set(element, text, type = "") {
      if (!element) return;
      element.textContent = text || "";
      element.className = `message ${type}`.trim();
    }
  };
})();
