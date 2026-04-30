(function () {
  window.AppUi = window.AppUi || {};
  window.AppUi.tableSort = {
    nextDirection(currentDirection) {
      return currentDirection === "asc" ? "desc" : "asc";
    }
  };
})();
