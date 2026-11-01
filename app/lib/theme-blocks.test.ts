import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * App Store review 5.1.2 — "Properly show theme app extension in the storefront":
 * every app block must display, without errors, in the Theme Editor and on the
 * Online Store the moment a merchant adds it. The rejection came from blocks
 * whose primary button was `hidden` until a config call (gated by plan or a
 * default-off toggle) un-hid it — the reviewer added the block and saw nothing.
 *
 * These checks pin the contract at the source level so it can't regress:
 *  - the action blocks render their button visibly (no `hidden` attribute);
 *  - every block carries a theme-editor-only note (`request.design_mode`) so the
 *    merchant always sees something in the editor, even for the price gate,
 *    which is invisible on the live store by design until gating is on;
 *  - the storefront scripts only hide a button on an explicit "off", never in
 *    the editor, and never because of the plan.
 */
const BLOCKS = join(process.cwd(), "extensions/quote-widget/blocks");
const ASSETS = join(process.cwd(), "extensions/quote-widget/assets");
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

const ACTION_BLOCKS: Record<string, string> = {
  "quote_button.liquid": "data-mannon-qw-open",
  "add_to_quote.liquid": "data-mannon-atq-add",
  "cart_to_quote.liquid": "data-mannon-c2q-btn",
  "make_offer_button.liquid": "data-mannon-mao-open",
};

describe("theme app extension blocks (review 5.1.2)", () => {
  it("every block file has a schema with a name and a design-mode note", () => {
    const files = readdirSync(BLOCKS).filter((f) => f.endsWith(".liquid"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = read(BLOCKS, f);
      expect(src, f).toMatch(/\{% schema %\}[\s\S]*"name":\s*"[^"]+"/);
      expect(src, f).toContain("request.design_mode");
      expect(src, f).toContain("data-mannon-editor-note");
    }
  });

  it.each(Object.entries(ACTION_BLOCKS))("%s renders its button visibly, not hidden until config", (file, hook) => {
    const src = read(BLOCKS, file);
    const button = src.match(new RegExp(`<button[^>]*${hook}[^>]*>`))?.[0] ?? src.match(new RegExp(`<button[^>]*>(?=[\\s\\S]*${hook})`))?.[0];
    expect(button, `${file} has a button carrying ${hook}`).toBeTruthy();
    expect(button, `${file} button must not start hidden`).not.toMatch(/\bhidden\b/);
  });

  it("the price gate CTA is hidden on the live store but previewed in the editor", () => {
    const src = read(BLOCKS, "price_gate.liquid");
    expect(src).toMatch(/<button[^>]*\{% unless request\.design_mode %\}hidden\{% endunless %\}[^>]*data-mannon-pg-cta/);
  });

  it("no block depends on an app URL setting to be filled in", () => {
    for (const f of readdirSync(BLOCKS).filter((x) => x.endsWith(".liquid"))) {
      expect(read(BLOCKS, f), f).toMatch(/data-app-url="\{\{ block\.settings\.app_url \| default: 'https:\/\/manosh\.fly\.dev' \}\}"/);
    }
  });

  it("the scripts wire the button before any config call and never gate on plan", () => {
    for (const f of ["quote-widget.js", "quote-capture.js", "make-an-offer.js"]) {
      const src = read(ASSETS, f);
      expect(src, f).toContain("window.Shopify.designMode");
      expect(src, f).not.toMatch(/not a paid plan|gated below Growth/);
      // The only path that hides a button is the explicit off branch.
      expect(src, f).toMatch(/markOff/);
    }
    // Each stylesheet styles the editor note the block renders.
    for (const f of ["quote-widget.css", "quote-capture.css", "make-an-offer.css", "price-gate.css"]) {
      expect(read(ASSETS, f), f).toContain(".mannon-editor-note");
    }
  });
});
