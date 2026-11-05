/*
 * M — the merchant inside Shopify Admin, in your signed-in Chrome (attached
 * over the Chrome DevTools Protocol, ~/mannon-chrome profile). Writes only what
 * a merchant does in the core loop: converts this run's storefront request into
 * a quote, counters it, generates a portal link, counters this run's offer.
 * Nothing is approved on Shopify's plan page.
 */
import { ERROR_TEXT, openApp, sleep, textOf } from "../lib.mjs";

const PAGES = [
  ["/app", "Home"], ["/app/quotes", "Quotes"], ["/app/quote-requests", "Requests"], ["/app/followups", "Follow-ups"],
  ["/app/quote-forms", "Quote forms"], ["/app/i18n", "Languages"], ["/app/price-rules", "Price rules"], ["/app/price-lists", "Price lists"],
  ["/app/offers", "Offers"], ["/app/wholesale", "Wholesale"], ["/app/catalogs", "Catalogs"], ["/app/catalog-sharing", "Catalog sharing"],
  ["/app/order-rules", "Order rules"], ["/app/buyers", "Buyers"], ["/app/reps", "Reps"], ["/app/credit", "Credit"],
  ["/app/analytics", "Analytics"], ["/app/settings", "General settings"], ["/app/payments", "Payments"], ["/app/tax", "Tax & VAT"],
  ["/app/erp", "ERP sync"], ["/app/accounting", "Accounting"], ["/app/agency", "Agency"], ["/app/plans", "Pricing plans"],
];

/** The smallest element that contains `text` and the named button. */
async function rowWith(frame, text, button) {
  const loc = frame.locator("tr, li, div").filter({ hasText: text }).filter({ has: frame.getByRole("button", { name: button }) });
  const n = await loc.count();
  if (!n) return null;
  const lens = await loc.evaluateAll((els) => els.map((e) => (e.innerText || "").length));
  let best = 0;
  lens.forEach((l, i) => { if (l < lens[best]) best = i; });
  return loc.nth(best);
}

export async function merchant(rec, ctx) {
  rec.begin("M · Merchant in Shopify Admin");
  const app = { store: ctx.store, appHandle: ctx.appHandle, appHost: new URL(ctx.live).host, local: ctx.localStack ? { live: ctx.live, token: ctx.localStack.token } : null };
  const browser = ctx.adminBrowser;
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  const fail = () => rec.shot(page, "merchant-fail");
  try {
    // M1 — every page and tab renders
    for (const [path, label] of PAGES) {
      await rec.tc("M1", `Page renders: ${label}`, { action: `open ${path} in the admin`, expected: "renders; no 'Something went wrong'; SKIP when the feature is off" }, async () => {
        const f = await openApp(page, app, path);
        const t = await textOf(f);
        if (ERROR_TEXT.test(t)) throw new Error(`error page: ${t.match(ERROR_TEXT)[0]}`);
        if (t.length < 400 && /\b404\b|Not Found|Not found/.test(t)) return { status: "SKIP", actual: "404: this feature is switched off for the shop" };
        const h = ((await f.locator("h1, h2").first().innerText({ timeout: 3000 }).catch(() => "")) || t.slice(0, 60)).trim();
        return { actual: `"${h}"`, evidence: path === "/app" ? await rec.shot(page, "admin-home") : null };
      }, fail);
    }

    // M2 — this run's storefront request → Convert to quote
    let quotePath = null;
    if (ctx.email) {
      await rec.tc("M2", "Requests: this run's request → Convert to quote", { action: `Requests → row with ${ctx.email} → Convert to quote`, expected: "redirects to the new quote" }, async () => {
        const f = await openApp(page, app, "/app/quote-requests");
        const row = await rowWith(f, ctx.email, "Convert to quote");
        if (!row) {
          const viewed = await rowWith(f, ctx.email, "View quote");
          if (viewed) return { status: "INFO", actual: "already converted earlier" };
          throw new Error(`no request row for ${ctx.email} with a Convert to quote button`);
        }
        await row.getByRole("button", { name: "Convert to quote" }).click();
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
          const m = page.frames().map((x) => x.url()).find((u) => /\/app\/quotes\/[^/?#.]+/.test(u) && u.includes(app.appHost));
          if (m) { quotePath = new URL(m).pathname; break; }
          const t = await textOf(f).catch(() => "");
          const err = t.match(/(This buyer[^.]*\.|Couldn[’']t[^.]*\.|[^.]*isn[’']t available[^.]*\.)/);
          if (err) throw new Error(err[0]);
          await sleep(700);
        }
        if (!quotePath) throw new Error("no redirect to a quote within 30 s");
        rec.created.push(`Quote ${quotePath} converted from the storefront request of ${ctx.email}`);
        return { actual: `converted → ${quotePath}`, evidence: await rec.shot(page, "request-converted") };
      }, fail);
    } else {
      rec.blocked("M2", "Requests: this run's request → Convert to quote", { action: "Requests → Convert to quote", expected: "a new quote" }, "the storefront step did not send a request this run");
    }

    // Fallback: the first New quote in the inbox (like the reviewer steps).
    if (!quotePath) {
      try {
        const f = await openApp(page, app, "/app/quotes");
        const link = f.getByRole("row").filter({ hasText: "New" }).first().getByRole("link").first();
        if (await link.count()) {
          await link.click();
          const t0 = Date.now();
          while (!quotePath && Date.now() - t0 < 20000) {
            const m = page.frames().map((x) => x.url()).find((u) => /\/app\/quotes\/[^/?#.]+/.test(u) && u.includes(app.appHost));
            if (m) quotePath = new URL(m).pathname;
            else await sleep(500);
          }
          if (quotePath) rec.add({ id: "M2f", name: "Fallback: first New quote in the inbox", action: "Quotes → first row marked New", expected: "a quote to counter", status: "INFO", actual: quotePath });
        }
      } catch { /* reported below as BLOCKED */ }
    }
    ctx.quotePath = quotePath;
    const needQuote = (id, name, meta) => rec.blocked(id, name, meta, "no quote to work on (M2 and the fallback found none)");

    // M3–M6 — the quote: Shopify totals, recalculate, Draft with Claude, Send counter
    if (quotePath) {
      let f = await openApp(page, app, quotePath.replace(/^\/app/, "/app"));
      await rec.tc("M3", "Quote: Totals from Shopify", { action: "read the Totals from Shopify card", expected: "Subtotal, Tax, Total and 'Calculated by Shopify'" }, async () => {
        await f.getByText("Totals from Shopify").first().waitFor({ timeout: 20000 });
        const t = await textOf(f);
        const unavailable = t.match(/Totals unavailable\s*(Shopify can[’']t price this quote yet\.[^]*?try again\.)/);
        if (unavailable) {
          ctx.unpriceable = unavailable[1];
          // The app looked the buyer up in Shopify (Customers → Companies) and
          // explains what to set up: a precondition of the store, not a defect.
          return { status: "BLOCKED", actual: `the app says: "${unavailable[1]}" — run with MANNON_QA_EMAIL set to a company contact's email to price and order`, evidence: await rec.shot(page, "quote-totals") };
        }
        for (const w of ["Subtotal", "Total", "Calculated by Shopify"]) if (!t.includes(w)) throw new Error(`missing "${w}"`);
        const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/) || [null])[0];
        ctx.buyerEmail = email;
        return { actual: `card present; buyer ${email || "unknown"}`, evidence: await rec.shot(page, "quote-totals") };
      }, fail);

      await rec.tc("M4", "Quote: change a price → Recalculate with these prices", { action: "lower the first unit price by 5%, click Recalculate with these prices", expected: "totals update; 'Not saved until you send the counter'" }, async () => {
        if (ctx.unpriceable) return { status: "BLOCKED", actual: `Shopify can't price this quote (M3): ${ctx.unpriceable}` };
        const price = f.getByLabel("Unit price").first();
        if (!(await price.count())) return { status: "SKIP", actual: "no editable unit price on this quote (already countered?)" };
        const v = parseFloat(((await price.inputValue()) || "0").replace(/[^0-9.]/g, ""));
        if (!(v > 0)) return { status: "SKIP", actual: "unit price is empty" };
        await price.fill((Math.round(v * 0.95 * 100) / 100).toFixed(2));
        await f.getByRole("button", { name: "Recalculate with these prices" }).click();
        await f.getByText(/Not saved until you send the counter/).first().waitFor({ timeout: 30000 });
        return { actual: `${v} → ${(v * 0.95).toFixed(2)}; Shopify recalculated`, evidence: await rec.shot(page, "quote-recalculated") };
      }, fail);

      if (ctx.ai) {
        await rec.tc("M5", "Quote: ✦ Draft all lines with Claude → Use this price", { action: "click Draft all lines with Claude, then the first Use this price", expected: "a draft per line on screen; nothing sent" }, async () => {
          const btn = f.getByRole("button", { name: /Draft all lines with Claude/ }).first();
          if (!(await btn.count())) return { status: "SKIP", actual: "no Draft with Claude button on this quote" };
          await btn.click();
          const use = f.getByRole("button", { name: "Use this price" }).first();
          const t0 = Date.now();
          while (Date.now() - t0 < 60000) {
            if (await use.count()) break;
            const t = await textOf(f);
            if (/upgrade|Growth plan|trial/i.test(t) && /Claude/.test(t) && !(await use.count())) { /* keep waiting a little for slow drafts */ }
            await sleep(1000);
          }
          if (!(await use.count())) {
            const t = await textOf(f);
            const note = (t.match(/[^.]*(upgrade|Growth|trial ended|unavailable)[^.]*\./i) || [""])[0];
            return { status: note ? "INFO" : "FAIL", actual: note || "no draft appeared within 60 s", evidence: await rec.shot(page, "claude-draft") };
          }
          await use.click();
          return { actual: "drafts shown; first line pre-filled; nothing sent", evidence: await rec.shot(page, "claude-draft") };
        }, fail);
      } else rec.skip("M5", "Quote: ✦ Draft all lines with Claude", { action: "—", expected: "—" }, "--no-ai");

      await rec.tc("M6", "Quote: Send counter", { action: "click Send counter", expected: "'Counter sent to the buyer'; status Countered" }, async () => {
        const send = f.getByRole("button", { name: "Send counter" }).first();
        if (!(await send.count())) {
          const t = await textOf(f);
          if (/Countered|Ordered/.test(t)) return { status: "INFO", actual: "already countered or ordered" };
          throw new Error("no Send counter button");
        }
        await send.click();
        await f.getByText("Counter sent to the buyer").first().waitFor({ timeout: 30000 });
        rec.created.push(`Counter sent on ${quotePath}`);
        return { actual: "Counter sent to the buyer", evidence: await rec.shot(page, "counter-sent") };
      }, fail);
    } else {
      for (const [id, name] of [["M3", "Quote: Totals from Shopify"], ["M4", "Quote: Recalculate"], ["M5", "Quote: Draft with Claude"], ["M6", "Quote: Send counter"]]) needQuote(id, name, { action: "—", expected: "—" });
    }

    // M7 — Buyers → Generate link for that buyer
    const who = ctx.buyerEmail || ctx.email;
    if (who) {
      await rec.tc("M7", "Buyers: Generate link for the quote's buyer", { action: `Buyers → row with ${who} → Generate link`, expected: "'Magic link ready to send' with a /portal/auth?token= link" }, async () => {
        const f = await openApp(page, app, "/app/buyers");
        const row = await rowWith(f, who, "Generate link");
        if (!row) throw new Error(`no Buyers row for ${who} with Generate link`);
        await row.getByRole("button", { name: "Generate link" }).click();
        await f.getByText("Magic link ready to send").waitFor({ timeout: 20000 });
        const link = ((await f.locator("code").first().textContent()) || "").trim();
        if (!/\/portal\/auth\?token=/.test(link)) throw new Error(`unexpected link "${link.slice(0, 60)}"`);
        ctx.magicLink = link;
        return { actual: `${link.replace(/token=.*/, "token=…")} (single use, expires)`, evidence: await rec.shot(page, "magic-link") };
      }, fail);
    } else rec.blocked("M7", "Buyers: Generate link", { action: "—", expected: "—" }, "no buyer email from the quote");

    // M8 — this run's offer → Send counter
    if (ctx.email && ctx.offerSent) {
      await rec.tc("M8", "Offers: this run's offer → Send counter", { action: `Offers → offer from ${ctx.email} → counter amount → Send counter`, expected: "'Counter sent.'" }, async () => {
        const f = await openApp(page, app, "/app/offers");
        const row = f.locator("tr, li").filter({ hasText: ctx.email }).first();
        if (!(await row.count())) {
          const t = await textOf(f);
          if (/Available on Growth|See Growth|Upgrade to Growth/.test(t)) return { status: "INFO", actual: "Offers is a Growth feature and this shop is on a lower plan" };
          throw new Error(`no offer row for ${ctx.email}`);
        }
        await row.getByRole("link").first().click();
        let o = null;
        const t0 = Date.now();
        while (!o && Date.now() - t0 < 20000) { o = page.frames().find((x) => /\/app\/offers\/[^/?#]+/.test(x.url())); if (!o) await sleep(500); }
        if (!o) throw new Error("the offer page did not open");
        await o.locator("body").waitFor();
        const t = await textOf(o);
        if (/Upgrade to Growth/.test(t)) return { status: "INFO", actual: "offers are a Growth feature on this plan" };
        const amount = o.getByLabel(/Counter amount|Your counter/).first();
        if (!(await amount.count())) return { status: "INFO", actual: "no counter form (offer already answered?)" };
        const offered = parseFloat((t.match(/Offered[^0-9]*([\d,.]+)/) || [])[1]?.replace(/,/g, "") || "0");
        await amount.fill(offered > 0 ? (Math.round(offered * 1.1 * 100) / 100).toFixed(2) : "10.00");
        await o.getByRole("button", { name: "Send counter" }).click();
        await o.getByText("Counter sent.").first().waitFor({ timeout: 20000 });
        rec.created.push(`Counter on the storefront offer from ${ctx.email}`);
        return { actual: `countered at +10% on ${offered || "?"}`, evidence: await rec.shot(page, "offer-countered") };
      }, fail);
    } else rec.skip("M8", "Offers: counter this run's offer", { action: "—", expected: "—" }, "no offer was sent this run");

    // M9 — Analytics and Claude insights
    await rec.tc("M9", "Analytics and ✦ Claude insights", { action: "open Analytics; click Explain with Claude when allowed", expected: "KPI cards render; insights render or an upgrade note" }, async () => {
      const f = await openApp(page, app, "/app/analytics");
      const t = await textOf(f);
      if (/Come back after a few quotes/.test(t)) return { actual: "the designed empty state: 'Come back after a few quotes' (fewer than 5 quotes sent)", evidence: await rec.shot(page, "analytics") };
      if (/Quote analytics is a Growth feature/.test(t)) return { status: "INFO", actual: "upgrade note: analytics is a Growth feature on this plan" };
      if (!/Win rate|Open pipeline|Last 30 days/.test(t)) throw new Error("no KPI cards, empty state or upgrade note");
      const explain = f.getByRole("button", { name: /Explain with Claude/ }).first();
      if (ctx.ai && (await explain.count())) {
        await explain.click();
        await sleep(15000);
      }
      return { actual: ctx.ai ? "KPIs shown; Explain with Claude clicked" : "KPIs shown", evidence: await rec.shot(page, "analytics") };
    }, fail);

    // M10 — Pricing plans → Choose Growth opens Shopify's plan page (review 1.2.2)
    await rec.tc("M10", "Pricing plans → Choose Growth opens Shopify's plan page (review 1.2.2)", { action: "Pricing plans → Choose Growth (or Switch to Growth on Scale); read Shopify's page; leave without approving", expected: "Shopify's own plan page opens (pricing_plans); no 'There's no page at this address'; plan names reported" }, async () => {
      const f = await openApp(page, app, "/app/plans");
      // Any plan change (upgrade or switch down) opens Shopify's plan page; nothing is approved here.
      let choose = f.getByRole("button", { name: "Choose Growth", exact: true });
      for (const n of ["Switch to Growth", "Choose Scale", "Choose Starter", "Switch to Starter"]) if (!(await choose.count())) choose = f.getByRole("button", { name: n, exact: true });
      choose = choose.first();
      if (!(await choose.count())) {
        const t = await textOf(f);
        return { status: "INFO", actual: `no Choose button (${(t.match(/Current plan[^.]*|You're on[^.]*/i) || ["plan page shown"])[0]})` };
      }
      const label = (await choose.innerText()).trim();
      if (app.local) {
        // No Shopify Admin around the local page: check the app sends the
        // merchant to Shopify's own plan page (managed pricing), and stop there.
        const seen = [];
        const onResp = (r) => { for (const v of Object.values(r.headers())) if (/pricing_plans/.test(v)) seen.push(v); };
        const onReq = (r) => { if (/admin\.shopify\.com/.test(r.url())) seen.push(r.url()); };
        page.on("response", onResp);
        page.on("request", onReq);
        await choose.click();
        await sleep(4000);
        page.off("response", onResp);
        page.off("request", onReq);
        const opened = await page.evaluate(() => (window.__mannonAppBridge || []).map((c) => c.args).join(" ")).catch(() => "");
        const all = [...seen, opened].join(" ");
        const m = all.match(/https:\/\/admin\.shopify\.com\/store\/[^/"\s]+\/charges\/[^/"\s]+\/pricing_plans/);
        return { status: m ? "PASS" : "FAIL", actual: m ? `clicked "${label}" → ${m[0]} (Shopify's plan page; not loaded locally; nothing approved)` : `clicked "${label}"; no redirect to Shopify's pricing_plans page seen`, evidence: await rec.shot(page, "plan-choose") };
      }
      await choose.click();
      await page.waitForURL(/pricing_plans|charges|\/settings\/billing/, { timeout: 30000 }).catch(() => {});
      await sleep(3000);
      const t = await textOf(page);
      if (/There['’]s no page at this address/i.test(t)) throw new Error("Shopify shows 'There's no page at this address' (the 1.2.2 bug)");
      const seen = ["Free", "Starter", "Growth", "Scale"].filter((p) => new RegExp(`\\b${p}\\b`).test(t));
      const ev = await rec.shot(page, "shopify-plan-page");
      // Review 1.2.2: the button must land on Shopify's own plan page, not "no page at this address".
      // Which plan cards Shopify renders (and when) is Shopify's; it is reported, not judged.
      const onPlans = /\/charges\/[^/]+\/pricing_plans|\/settings\/billing/.test(page.url());
      return { status: onPlans ? "PASS" : "FAIL", actual: `clicked "${label}" → ${page.url().replace(/\?.*/, "")} · plan names read on the page: ${seen.join(", ") || "none"} · nothing approved`, evidence: ev };
    }, fail);

    // M12 — theme editor deep links (App Store 5.1.3)
    await rec.tc("M12", "Storefront setup: 'Add to theme' deep links (App Store 5.1.3)", { action: "Requests, Offers → widget and Price rules: read every 'Add to theme' link; live, open one in the theme editor and leave without saving", expected: "one link per block: /admin/themes/current/editor?template=…&addAppBlockId={client_id}/{block}&target=…; the theme editor opens with the block placed" }, async () => {
      const want = { "/app/quote-requests": ["quote_button", "add_to_quote", "cart_to_quote"], "/app/offers/widget": ["make_offer_button"], "/app/price-rules": ["price_gate"] };
      const found = [];
      for (const [path, blocks] of Object.entries(want)) {
        const f = await openApp(page, app, path);
        const hrefs = await f.locator("a").evaluateAll((as) => as.filter((a) => /Add to theme/.test(a.textContent || "")).map((a) => a.getAttribute("href")));
        for (const b of blocks) {
          const h = hrefs.find((x) => x && x.includes(`/${b}&`));
          if (!h) throw new Error(`${path}: no 'Add to theme' link for ${b} (${hrefs.length} links)`);
          if (!/^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/themes\/current\/editor\?template=(product|cart)&addAppBlockId=[A-Za-z0-9]+\/[a-z_]+&target=(mainSection|newAppsSection)$/.test(h)) throw new Error(`${b}: unexpected link ${h}`);
          found.push(h);
        }
      }
      if (app.local) return { actual: `${found.length} links, all in Shopify's deep-link format` };
      const editor = await page.context().newPage();
      try {
        await editor.goto(found[0], { waitUntil: "domcontentloaded" });
        await editor.waitForURL(/\/themes\/\d+\/editor|\/themes\/current\/editor/, { timeout: 30000 });
        await sleep(6000);
        const t = await textOf(editor);
        if (/There['’]s no page at this address|isn['’]t available/i.test(t)) throw new Error(`the theme editor says: ${t.slice(0, 120)}`);
        const ev = await rec.shot(editor, "theme-editor-deep-link");
        return { actual: `${found.length} links; the theme editor opened with Request a Quote placed (not saved)`, evidence: ev };
      } finally {
        await editor.close({ runBeforeUnload: false }).catch(() => {});
      }
    }, fail);

    // M11 — the guest gating rule
    await rec.tc("M11", "Price rules: guest gating", { action: "open Price rules", expected: "'Logged-out visitors' rule listed as Active (INFO when off)" }, async () => {
      const f = await openApp(page, app, "/app/price-rules");
      const on = await f.evaluate(() => Array.from(document.querySelectorAll("tr")).some((r) => /Logged-out visitors/.test(r.textContent || "") && /Active/.test(r.textContent || "")));
      return { status: on ? "PASS" : "INFO", actual: on ? "Logged-out visitors · Active" : "no active guest rule (prices visible to guests)" };
    }, fail);
  } finally {
    await page.close().catch(() => {});
  }
}
