(function () {
  const custom = window.AppCustomFunctions || {};
  window.AppShared = window.AppShared || {};
  window.AppShared.text = {
    esc: custom.esc,
    normalizeText: custom.normalizeText,
    normalizeNumericText: custom.normalizeNumericText
  };
})();
