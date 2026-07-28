/* F17 — Mannon Request-a-Quote widget (storefront). Loads async; never blocks
   the page. Fetches config, renders a button + modal, posts to the public API.
   Anti-spam: a hidden honeypot field + a render→submit elapsed timer. */
(function () {
  var root = document.querySelector("[data-mannon-qw]");
  if (!root) return;

  var shop = root.getAttribute("data-shop");
  var appUrl = (root.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var source = root.getAttribute("data-source") || "PDP";
  var renderedAt = Date.now();

  fetch(appUrl + "/api/quote-widget-config?shop=" + encodeURIComponent(shop))
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return; // dark-launched off / gated
      if (source === "CART" && !cfg.cartEnabled) return;
      var btn = root.querySelector("[data-mannon-qw-open]");
      btn.textContent = cfg.label || "Request a Quote";
      btn.hidden = false;
      btn.addEventListener("click", function () { openModal(cfg); });
    })
    .catch(function () { /* fail closed: no button, no storefront impact */ });

  function esc(s) { return String(s == null ? "" : s); }

  function openModal(cfg) {
    var overlay = document.createElement("div");
    overlay.className = "mannon-qw-overlay";
    var fields = (cfg.customFields || []).map(function (f) {
      return '<label class="mannon-qw-l">' + esc(f.label) + '<input name="cf_' + esc(f.key) + '"></label>';
    }).join("");

    overlay.innerHTML =
      '<div class="mannon-qw-modal" role="dialog" aria-modal="true" aria-label="Request a quote">' +
        '<button class="mannon-qw-x" aria-label="Close">&times;</button>' +
        '<h2>' + esc(cfg.label || "Request a Quote") + '</h2>' +
        '<form class="mannon-qw-form">' +
          '<label class="mannon-qw-l">Email<input type="email" name="email" required value="' + esc(root.getAttribute("data-customer-email")) + '"></label>' +
          '<label class="mannon-qw-l">Company (optional)<input name="companyName"></label>' +
          '<label class="mannon-qw-l">Quantity<input type="number" name="quantity" min="1" value="1"></label>' +
          fields +
          '<label class="mannon-qw-l">Note (optional)<textarea name="note" rows="2"></textarea></label>' +
          // Honeypot — visually hidden; a bot fills it, a human never sees it.
          '<input class="mannon-qw-hp" tabindex="-1" autocomplete="off" name="company_url_confirm" aria-hidden="true">' +
          '<button type="submit" class="mannon-qw-btn">Send request</button>' +
          '<p class="mannon-qw-msg" role="status"></p>' +
        '</form>' +
      '</div>';

    document.body.appendChild(overlay);
    var close = function () { overlay.remove(); };
    overlay.querySelector(".mannon-qw-x").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    overlay.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var custom = {};
      (cfg.customFields || []).forEach(function (cf) {
        var el = f.querySelector('[name="cf_' + cf.key + '"]');
        if (el && el.value) custom[cf.key] = el.value;
      });
      var payload = {
        shop: shop,
        source: source,
        email: f.email.value,
        companyName: f.companyName.value,
        note: f.note.value,
        company_url_confirm: f.company_url_confirm.value,
        elapsedMs: Date.now() - renderedAt,
        customFields: custom,
        lines: [{
          variantId: root.getAttribute("data-variant-id") || null,
          sku: root.getAttribute("data-sku") || null,
          title: root.getAttribute("data-product-title") || null,
          quantity: parseInt(f.quantity.value, 10) || 1
        }]
      };
      var msg = f.querySelector(".mannon-qw-msg");
      msg.textContent = "Sending…";
      fetch(appUrl + "/api/quote-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) { msg.textContent = "Thanks — we got your request and will reply with pricing."; f.reset(); }
          else { msg.textContent = (res && res.error) || "Something went wrong. Please try again."; }
        })
        .catch(function () { msg.textContent = "Something went wrong. Please try again."; });
    });
  }
})();
