/* F21 (PR-4) — Mannon Make-an-Offer widget (storefront). Loads async; never
   blocks the page. Fetches config, renders a button + modal, posts to the public
   API. Anti-spam: a hidden honeypot field + a render→submit elapsed timer. On
   Scale the buyer can get an instant answer; on Growth it's reviewed by email. */
(function () {
  var root = document.querySelector("[data-mannon-mao]");
  if (!root) return;

  var shop = root.getAttribute("data-shop");
  var appUrl = (root.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var source = root.getAttribute("data-source") || "PRODUCT";
  var renderedAt = Date.now();

  fetch(appUrl + "/api/offer-config?shop=" + encodeURIComponent(shop))
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return; // dark-launched off / gated below Growth
      if (!cfg.surfaces || !cfg.surfaces.button) return;
      var btn = root.querySelector("[data-mannon-mao-open]");
      btn.textContent = cfg.label || "Make an offer";
      btn.hidden = false;
      btn.addEventListener("click", function () { openModal(cfg); });
    })
    .catch(function () { /* fail closed: no button, no storefront impact */ });

  function esc(s) { return String(s == null ? "" : s); }
  function num(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; }

  function openModal(cfg) {
    var unitList = num(root.getAttribute("data-list-price"));
    var overlay = document.createElement("div");
    overlay.className = "mannon-mao-overlay";
    overlay.innerHTML =
      '<div class="mannon-mao-modal" role="dialog" aria-modal="true" aria-label="Make an offer">' +
        '<button class="mannon-mao-x" aria-label="Close">&times;</button>' +
        '<h2>' + esc(cfg.label || "Make an offer") + '</h2>' +
        (unitList > 0 ? '<p class="mannon-mao-list">List price: ' + unitList.toFixed(2) + ' each</p>' : "") +
        '<form class="mannon-mao-form">' +
          '<label class="mannon-mao-l">Email<input type="email" name="email" required value="' + esc(root.getAttribute("data-customer-email")) + '"></label>' +
          '<label class="mannon-mao-l">Quantity<input type="number" name="quantity" min="1" value="1"></label>' +
          '<label class="mannon-mao-l">Your offer (per unit)<input type="number" name="offer" min="0" step="0.01" required></label>' +
          '<label class="mannon-mao-l">Note (optional)<textarea name="note" rows="2"></textarea></label>' +
          // Honeypot — visually hidden; a bot fills it, a human never sees it.
          '<input class="mannon-mao-hp" tabindex="-1" autocomplete="off" name="company_url_confirm" aria-hidden="true">' +
          '<button type="submit" class="mannon-mao-btn">Send offer</button>' +
          '<p class="mannon-mao-msg" role="status"></p>' +
        '</form>' +
      '</div>';

    document.body.appendChild(overlay);
    var close = function () { overlay.remove(); };
    overlay.querySelector(".mannon-mao-x").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    overlay.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var qty = parseInt(f.quantity.value, 10) || 1;
      var unitOffer = num(f.offer.value);
      var msg = f.querySelector(".mannon-mao-msg");
      if (!(unitOffer > 0)) { msg.textContent = "Enter your offer."; return; }

      var payload = {
        shop: shop,
        source: source,
        email: f.email.value,
        offeredTotal: unitOffer * qty,
        company_url_confirm: f.company_url_confirm.value,
        elapsedMs: Date.now() - renderedAt,
        note: f.note.value,
        lines: [{
          variantId: root.getAttribute("data-variant-id") || null,
          sku: root.getAttribute("data-sku") || null,
          title: root.getAttribute("data-product-title") || null,
          quantity: qty,
          listPrice: unitList
        }]
      };
      msg.textContent = "Sending…";
      fetch(appUrl + "/api/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) { msg.textContent = (res && res.error) || "Something went wrong. Please try again."; return; }
          msg.textContent = outcomeMessage(res.outcome, res.counterTotal, qty);
          if (res.outcome === "accepted" || res.outcome === "declined") f.querySelector(".mannon-mao-btn").disabled = true;
        })
        .catch(function () { msg.textContent = "Something went wrong. Please try again."; });
    });
  }

  function outcomeMessage(outcome, counterTotal, qty) {
    switch (outcome) {
      case "accepted": return "Accepted! We’ll email you to finish the order.";
      case "declined": return "We can’t meet that price this time — thanks for the offer.";
      case "countered":
        var per = counterTotal && qty ? " at " + (counterTotal / qty).toFixed(2) + " each" : "";
        return "We countered" + per + ". Check your email to accept.";
      default: return "Thanks — we got your offer and will reply by email.";
    }
  }
})();
