/* F24.2 — Mannon price / Add-to-Cart gate (storefront). Async; never blocks the
   page. Asks the app whether to hide price / ATC for this visitor and, if so,
   hides the theme's price/ATC elements and shows a "Request a Quote" CTA. This
   script never handles or renders a price — only the hide decision. */
(function () {
  var root = document.querySelector("[data-mannon-pg]");
  if (!root) return;

  var shop = root.getAttribute("data-shop");
  var appUrl = (root.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var params =
    "shop=" + encodeURIComponent(shop) +
    "&loggedIn=" + encodeURIComponent(root.getAttribute("data-logged-in") || "0") +
    "&tags=" + encodeURIComponent(root.getAttribute("data-tags") || "") +
    "&productId=" + encodeURIComponent(root.getAttribute("data-product-id") || "") +
    "&collectionIds=" + encodeURIComponent(root.getAttribute("data-collection-ids") || "");

  function hideAll(selector) {
    if (!selector) return;
    selector.split(",").forEach(function (sel) {
      sel = sel.trim();
      if (!sel) return;
      try {
        var nodes = document.querySelectorAll(sel);
        for (var i = 0; i < nodes.length; i++) nodes[i].style.setProperty("display", "none", "important");
      } catch (e) { /* invalid selector — ignore */ }
    });
  }

  fetch(appUrl + "/api/price-visibility?" + params)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || (!d.hidePrice && !d.hideAtc)) return; // nothing to hide → theme unchanged
      if (d.hidePrice) hideAll(root.getAttribute("data-price-selector"));
      if (d.hideAtc) hideAll(root.getAttribute("data-atc-selector"));

      var cta = root.querySelector("[data-mannon-pg-cta]");
      if (d.ctaLabel) cta.textContent = d.ctaLabel;
      cta.hidden = false;
      cta.addEventListener("click", function () {
        var url = root.getAttribute("data-quote-url");
        // Prefer opening the on-page quote widget if present; else navigate.
        var qw = document.querySelector("[data-mannon-qw-open]");
        if (qw) { qw.click(); return; }
        if (url) window.location.href = url;
      });
    })
    .catch(function () { /* fail open: leave the theme untouched, no storefront impact */ });
})();
