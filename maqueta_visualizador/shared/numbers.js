(function () {
  window.AppShared = window.AppShared || {};
  window.AppShared.numbers = {
    round2(value) {
      return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    },
    toNumber(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }
  };
})();
