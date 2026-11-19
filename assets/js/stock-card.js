// Stock pages: photo popup, copy part numbers, catalog search, mobile buy bar.
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

  // Photos open in a popup over the page instead of a new page.
  var lightbox = null;
  function openLightbox(link) {
    if (typeof HTMLDialogElement !== "function") return false;
    if (!lightbox) {
      lightbox = document.createElement("dialog");
      lightbox.className = "stock-lightbox";
      lightbox.innerHTML = '<button type="button" class="stock-lightbox-close" aria-label="Закрити">×</button><figure style="margin:0"><img alt=""><figcaption></figcaption></figure>';
      document.body.appendChild(lightbox);
      lightbox.addEventListener("click", function (event) {
        // Close on the close button or a click on the dark backdrop.
        if (event.target === lightbox || event.target.closest(".stock-lightbox-close")) lightbox.close();
      });
    }
    var source = link.querySelector("img");
    var img = lightbox.querySelector("img");
    img.src = link.getAttribute("href");
    img.alt = source ? source.alt : "";
    lightbox.querySelector("figcaption").textContent = link.getAttribute("data-caption") || "";
    lightbox.showModal();
    return true;
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[data-lightbox]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (openLightbox(link)) event.preventDefault();
  });

  // Catalog search by name or part number.
  var search = document.querySelector("[data-stock-search]");
  if (search) {
    var normalize = function (value) { return String(value).toLowerCase().replace(/[\s\-]+/g, ""); };
    search.addEventListener("input", function () {
      var query = normalize(search.value);
      var shown = 0;
      document.querySelectorAll(".stock-card").forEach(function (card) {
        var match = !query || normalize(card.getAttribute("data-search")).indexOf(query) !== -1;
        card.hidden = !match;
        if (match) shown += 1;
      });
      document.querySelectorAll(".stock-group").forEach(function (group) {
        group.hidden = !group.querySelector(".stock-card:not([hidden])");
      });
      var empty = document.querySelector("[data-stock-empty]");
      if (empty) empty.hidden = shown > 0;
    });
  }

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
})();
