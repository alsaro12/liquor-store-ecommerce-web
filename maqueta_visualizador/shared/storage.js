(function () {
  window.AppShared = window.AppShared || {};
  window.AppShared.storage = {
    get(key, fallback = "") {
      try {
        return window.localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  };
})();
