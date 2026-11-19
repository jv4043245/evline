// Product card helpers: copy part numbers, mobile buy bar.
(function () {
  "use strict";

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-copy]");
    if (!button) return;
    var value = button.getAttribute("data-copy");
    var done = function () {
      button.classList.add("is-copied");
      button.setAttribute("title", "Скопійовано");
      setTimeout(function () {
        button.classList.remove("is-copied");
        button.setAttribute("title", "Скопіювати");
      }, 1600);
    };
    try {
      navigator.clipboard.writeText(value).then(done, function () {});
    } catch (_) {}
  });

  var bar = document.querySelector(".stock-sticky");
  var order = document.querySelector(".stock-order");
  if (!bar || !order) return;

  bar.addEventListener("click", function (event) {
    if (!event.target.closest("[data-open-checkout]")) return;
    event.preventDefault();
    var checkout = order.querySelector(".stock-checkout");
    if (checkout) checkout.open = true;
    order.scrollIntoView({ behavior: "smooth", block: "start" });
    var field = checkout && checkout.querySelector("input[name=name]");
    if (field) setTimeout(function () { field.focus({ preventScroll: true }); }, 400);
  });

  if (!("IntersectionObserver" in window)) return;
  var seen = false;
  new IntersectionObserver(function (entries) {
    var entry = entries[0];
    if (entry.isIntersecting) seen = true;
    // Show the bar only after the buy box has scrolled out of view above.
    bar.hidden = entry.isIntersecting || !seen || entry.boundingClientRect.top > 0;
  }).observe(order);
})();
