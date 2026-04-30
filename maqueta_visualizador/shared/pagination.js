(function () {
  const custom = window.AppCustomFunctions || {};
  window.AppShared = window.AppShared || {};
  window.AppShared.pagination = {
    paginate: custom.paginate
  };
})();
