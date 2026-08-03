/* F17 + F24.1 — Mannon Request-a-Quote widget (storefront). Loads async; never
   blocks the page. Fetches config + the merchant's custom quote form, renders a
   button + modal, posts to the public API. Anti-spam: a hidden honeypot field +
   a render→submit elapsed timer. */
(function () {
  var root = document.querySelector("[data-mannon-qw]");
  if (!root) return;

  var shop = root.getAttribute("data-shop");
  var appUrl = (root.getAttribute("data-app-url") || "").replace(/\/$/, "");
  var source = root.getAttribute("data-source") || "PDP";
  var surface = source === "CART" ? "CART" : "PRODUCT";
  var renderedAt = Date.now();
  var customForm = null; // F24.1: the merchant-built form for this surface (if any)

  // Pull the custom form config alongside the widget config (both async, non-blocking).
  fetch(appUrl + "/api/quote-form?shop=" + encodeURIComponent(shop) + "&surface=" + surface)
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.form) customForm = d.form; })
    .catch(function () { /* no custom form → fall back to built-in fields */ });

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
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }

  // Render one custom-form field as a labelled control by type. Value key is cf_<key>.
  function renderField(f) {
    var name = "cf_" + esc(f.key);
    var req = f.required ? " required" : "";
    var ph = f.placeholder ? ' placeholder="' + attr(f.placeholder) + '"' : "";
    var help = f.help ? '<span class="mannon-qw-help">' + esc(f.help) + "</span>" : "";
    var control;
    switch (f.type) {
      case "checkbox":
        return '<label class="mannon-qw-l mannon-qw-cb"><input type="checkbox" name="' + name + '"' + req + "> " + esc(f.label) + help + "</label>";
      case "dropdown":
        var opts = (f.options || []).map(function (o) { return '<option value="' + attr(o) + '">' + esc(o) + "</option>"; }).join("");
        control = '<select name="' + name + '"' + req + "><option value=\"\">Choose…</option>" + opts + "</select>";
        break;
      case "number": control = '<input type="number" name="' + name + '"' + req + ph + ">"; break;
      case "email": control = '<input type="email" name="' + name + '"' + req + ph + ">"; break;
      case "phone": control = '<input type="tel" name="' + name + '"' + req + ph + ">"; break;
      case "date": control = '<input type="date" name="' + name + '"' + req + ">"; break;
      case "file": control = '<input type="file" name="' + name + '"' + req + ">"; break;
      case "product": control = '<input type="text" name="' + name + '"' + req + ph + ">"; break;
      default: control = '<input type="text" name="' + name + '"' + req + ph + ">";
    }
    return '<label class="mannon-qw-l">' + esc(f.label) + control + help + "</label>";
  }

  function openModal(cfg) {
    var overlay = document.createElement("div");
    overlay.className = "mannon-qw-overlay";

    // F24.1: prefer the merchant's custom form; else the legacy widget fields.
    var usingForm = customForm && customForm.fields && customForm.fields.length;
    var fields = usingForm
      ? customForm.fields.map(renderField).join("")
      : (cfg.customFields || []).map(function (f) {
          return '<label class="mannon-qw-l">' + esc(f.label) + '<input name="cf_' + esc(f.key) + '"></label>';
        }).join("");
    var title = usingForm ? customForm.name : (cfg.label || "Request a Quote");

    overlay.innerHTML =
      '<div class="mannon-qw-modal" role="dialog" aria-modal="true" aria-label="Request a quote">' +
        '<button class="mannon-qw-x" aria-label="Close">&times;</button>' +
        '<h2>' + esc(title || "Request a Quote") + '</h2>' +
        '<form class="mannon-qw-form">' +
          '<label class="mannon-qw-l">Email<input type="email" name="email" required value="' + attr(root.getAttribute("data-customer-email")) + '"></label>' +
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
      var fieldDefs = usingForm ? customForm.fields : (cfg.customFields || []);
      fieldDefs.forEach(function (cf) {
        var el = f.querySelector('[name="cf_' + cf.key + '"]');
        if (!el) return;
        if (el.type === "checkbox") custom[cf.key] = el.checked;
        else if (el.type === "file") { if (el.files && el.files[0]) custom[cf.key] = el.files[0].name; }
        else if (el.value) custom[cf.key] = el.value;
      });
      var payload = {
        shop: shop,
        source: source,
        formId: usingForm ? customForm.formId : null,
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
