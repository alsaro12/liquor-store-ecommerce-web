(function () {
  const currentScript = document.currentScript;
  const script = document.createElement("script");
  script.src = "./products/index.js";
  script.defer = false;
  (currentScript && currentScript.parentNode ? currentScript.parentNode : document.body).appendChild(script);
})();
