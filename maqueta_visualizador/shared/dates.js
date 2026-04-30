(function () {
  const custom = window.AppCustomFunctions || {};
  window.AppShared = window.AppShared || {};
  window.AppShared.dates = {
    normalizeDateValue: custom.normalizeDateValue,
    matchDateRange: custom.matchDateRange
  };
})();
