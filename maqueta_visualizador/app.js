(function () {
  if (window.AppBootstrapLoaded) return;
  if (document.readyState === "loading") {
    document.write('<script src="./app/bootstrap.js"><\\/script>');
    return;
  }
  const script = document.createElement("script");
  script.src = "./app/bootstrap.js";
  document.body.appendChild(script);
})();
