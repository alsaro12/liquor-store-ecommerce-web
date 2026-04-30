(function () {
  const custom = window.AppCustomFunctions || {};
  window.AppShared = window.AppShared || {};
  window.AppShared.formatters = {
    money: custom.money,
    formatQty: custom.formatQty,
    formatDateTime: custom.formatDateTime
  };
})();
