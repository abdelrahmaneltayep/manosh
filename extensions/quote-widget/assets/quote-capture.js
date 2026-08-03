/* F24.3 — Mannon Add-to-Quote drawer + Convert-Cart-to-Quote (storefront).
   Async; never blocks the page. Buyers collect products across product/collection
   pages into a drawer (localStorage), then submit ONE multi-line quote. On the
   cart page, one click turns the cart into a quote. Posts to the shared public
   quote-request API on the CAPTURE channel. */
(function () {
  var roots = document.querySelectorAll("[data-mannon-capture]");
  if (!roots.length || window.__mannonCaptureInit) return;
  window.__mannonCaptureInit = true;

  var base = roots[0];
  var shop = base.getAttribute("data-shop");
  var appUrl = (base.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var KEY = "mannon_quote_" + shop;
  var renderedAt = Date.now();

  function esc(s) { return String(s == null ? "" : s); }
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {} paint(); }

  function addItem(it) {
    if (!it.variantId) return;
    var items = load();
    var found = null;
    for (var i = 0; i < items.length; i++) if (items[i].variantId === it.variantId) found = items[i];
    if (found) found.quantity += it.quantity || 1;
    else items.push({ variantId: it.variantId, sku: it.sku || null, title: it.title || null, quantity: it.quantity || 1 });
    save(items);
    openDrawer();
  }

  // --- drawer ---------------------------------------------------------------
  var drawer;
  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement("div");
    drawer.className = "mannon-cap-drawer";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML =
      '<div class="mannon-cap-panel" role="dialog" aria-modal="true" aria-label="Your quote">' +
        '<button class="mannon-cap-x" aria-label="Close">&times;</button>' +
        '<h2>Your quote</h2>' +
        '<div class="mannon-cap-items"></div>' +
        '<form class="mannon-cap-form">' +
          '<label class="mannon-cap-l">Email<input type="email" name="email" required></label>' +
          '<label class="mannon-cap-l">Note (optional)<textarea name="note" rows="2"></textarea></label>' +
          '<input class="mannon-cap-hp" tabindex="-1" autocomplete="off" name="company_url_confirm" aria-hidden="true">' +
          '<button type="submit" class="mannon-cap-btn">Request quote</button>' +
          '<p class="mannon-cap-msg" role="status"></p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(drawer);
    drawer.querySelector(".mannon-cap-x").addEventListener("click", closeDrawer);
    drawer.addEventListener("click", function (e) { if (e.target === drawer) closeDrawer(); });
    drawer.querySelector("form").addEventListener("submit", submitDrawer);
    return drawer;
  }
  function openDrawer() { ensureDrawer(); paint(); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); }
  function closeDrawer() { if (drawer) { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); } }

  function paint() {
    // The floating launcher shows a live count.
    var count = load().reduce(function (n, it) { return n + (it.quantity || 0); }, 0);
    if (launcher) { launcher.textContent = "Quote (" + count + ")"; launcher.hidden = count === 0 && !alwaysShowLauncher; }
    if (!drawer) return;
    var wrap = drawer.querySelector(".mannon-cap-items");
    var items = load();
    if (!items.length) { wrap.innerHTML = '<p class="mannon-cap-empty">No items yet.</p>'; return; }
    wrap.innerHTML = items.map(function (it, i) {
      return '<div class="mannon-cap-row">' +
        '<span class="mannon-cap-title">' + esc(it.title || it.sku || it.variantId) + "</span>" +
        '<input type="number" min="1" value="' + esc(it.quantity) + '" data-i="' + i + '" class="mannon-cap-qty">' +
        '<button type="button" class="mannon-cap-rm" data-i="' + i + '" aria-label="Remove">&times;</button>' +
      "</div>";
    }).join("");
    wrap.querySelectorAll(".mannon-cap-qty").forEach(function (el) {
      el.addEventListener("change", function () {
        var items = load(); items[+el.getAttribute("data-i")].quantity = Math.max(1, parseInt(el.value, 10) || 1); save(items);
      });
    });
    wrap.querySelectorAll(".mannon-cap-rm").forEach(function (el) {
      el.addEventListener("click", function () { var items = load(); items.splice(+el.getAttribute("data-i"), 1); save(items); });
    });
  }

  function submitDrawer(e) {
    e.preventDefault();
    var f = e.target;
    var items = load();
    var msg = f.querySelector(".mannon-cap-msg");
    if (!items.length) { msg.textContent = "Add a product first."; return; }
    msg.textContent = "Sending…";
    post(items, f.email.value, f.note.value, f.company_url_confirm.value, "WIDGET", function (ok, err) {
      if (ok) { msg.textContent = "Thanks — we got your quote and will reply with pricing."; save([]); f.reset(); }
      else { msg.textContent = err || "Something went wrong. Please try again."; }
    });
  }

  function post(items, email, note, honeypot, source, cb) {
    fetch(appUrl + "/api/quote-request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop: shop, source: source, channel: "CAPTURE",
        email: email, note: note, company_url_confirm: honeypot || "",
        elapsedMs: Date.now() - renderedAt,
        lines: items.map(function (it) { return { variantId: it.variantId, sku: it.sku, title: it.title, quantity: it.quantity }; })
      })
    }).then(function (r) { return r.json(); })
      .then(function (res) { cb(res && res.ok, res && res.error); })
      .catch(function () { cb(false); });
  }

  // --- launcher (floating "Quote (n)") --------------------------------------
  var launcher, alwaysShowLauncher = false;
  function ensureLauncher() {
    if (launcher) return;
    launcher = document.createElement("button");
    launcher.className = "mannon-cap-launcher";
    launcher.type = "button";
    launcher.hidden = true;
    launcher.addEventListener("click", openDrawer);
    document.body.appendChild(launcher);
  }

  // --- cart → quote ---------------------------------------------------------
  function cartToQuote(btn) {
    btn.disabled = true;
    fetch("/cart.js").then(function (r) { return r.json(); }).then(function (cart) {
      var items = (cart.items || []).map(function (ci) {
        return { variantId: "gid://shopify/ProductVariant/" + ci.variant_id, sku: ci.sku || null, title: ci.product_title || ci.title || null, quantity: ci.quantity || 1 };
      });
      btn.disabled = false;
      if (!items.length) { flash(btn, "Your cart is empty."); return; }
      save(items); // drop the cart into the drawer so the buyer adds their email
      openDrawer();
    }).catch(function () { btn.disabled = false; flash(btn, "Couldn’t read your cart."); });
  }
  function flash(btn, text) { var p = btn.parentNode.querySelector(".mannon-cap-flash") || (function () { var el = document.createElement("p"); el.className = "mannon-cap-flash"; btn.parentNode.appendChild(el); return el; })(); p.textContent = text; }

  // --- init -----------------------------------------------------------------
  fetch(appUrl + "/api/quote-capture-config?shop=" + encodeURIComponent(shop))
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return; // off / not a paid plan → buttons stay hidden
      ensureLauncher();
      alwaysShowLauncher = load().length > 0;
      paint();

      document.querySelectorAll("[data-mannon-atq-add]").forEach(function (btn) {
        btn.hidden = false;
        var host = btn.closest("[data-mannon-capture]") || base;
        btn.addEventListener("click", function () {
          addItem({
            variantId: host.getAttribute("data-variant-id"),
            sku: host.getAttribute("data-sku"),
            title: host.getAttribute("data-title"),
            quantity: 1
          });
        });
      });
      document.querySelectorAll("[data-mannon-c2q-btn]").forEach(function (btn) {
        btn.hidden = false;
        btn.addEventListener("click", function () { cartToQuote(btn); });
      });
    })
    .catch(function () { /* fail closed: no buttons, no storefront impact */ });
})();
