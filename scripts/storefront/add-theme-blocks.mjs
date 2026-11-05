#!/usr/bin/env node
/*
 * Add Mannon's missing storefront blocks to the store's LIVE theme, from your
 * own machine, with the Shopify CLI you already use for `shopify app deploy`.
 *
 *   npm run theme:add-blocks                 pull, add, show what changed, push (the CLI asks to confirm)
 *   npm run theme:add-blocks -- --dry-run    pull and edit locally, push nothing
 *
 * What it does:
 *   1. pulls templates/product.json, templates/cart.json and the section files
 *      from the live theme into qa-storefront/theme-<stamp>/ (git-ignored)
 *   2. keeps an untouched copy in .../backup/
 *   3. product template: adds "Price / ATC gate" next to the Mannon blocks
 *      already there (the app reference is copied from them, never guessed)
 *   4. cart template: adds "Convert Cart to Quote" to a cart section that
 *      accepts app blocks (or an Apps section if none does)
 *   5. pushes ONLY those two template files to the live theme, --nodelete;
 *      the Shopify CLI asks you to confirm before it touches the live theme
 * Undo: the script prints the command that pushes the backup back.
 *
 * Env: MANNON_STORE (default mannon-9iu9ewku.myshopify.com)
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addCartBlock, addProductBlocks, joinTemplate, splitTemplate } from "./theme-blocks.mjs";

const DRY = process.argv.includes("--dry-run");
const STORE = (process.env.MANNON_STORE || "mannon-9iu9ewku.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const DIR = join(process.cwd(), "qa-storefront", `theme-${stamp}`);
const BACKUP = join(DIR, "backup");
const FILES = ["templates/product.json", "templates/cart.json"];

// MANNON_SHOPIFY_BIN lets the test run swap in a stand-in CLI.
function cli(args) {
  console.log(`\n$ shopify ${args.join(" ")}`);
  const bin = process.env.MANNON_SHOPIFY_BIN;
  const r = bin ? spawnSync(bin, args, { stdio: "inherit" }) : spawnSync("npx", ["shopify", ...args], { stdio: "inherit" });
  return r.status === 0;
}

mkdirSync(DIR, { recursive: true });
console.log(`Store ${STORE} · working copy ${DIR}`);

const pulled = cli(["theme", "pull", "--store", STORE, "--live", "--path", DIR, "--only", "templates/product.json", "--only", "templates/cart.json", "--only", "sections/*.liquid"]);
if (!pulled || !existsSync(join(DIR, "templates/product.json"))) {
  console.error("\nCould not pull the live theme. If the CLI asked you to log in, finish that and run this again.");
  process.exit(1);
}
mkdirSync(join(BACKUP, "templates"), { recursive: true });
for (const f of FILES) if (existsSync(join(DIR, f))) cpSync(join(DIR, f), join(BACKUP, f));

const sectionLiquid = (type) => {
  const p = join(DIR, "sections", `${type}.liquid`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const changed = [];
let referenceType = null;
try {
  const prod = splitTemplate(readFileSync(join(DIR, "templates/product.json"), "utf8"));
  const r = addProductBlocks(prod.json);
  referenceType = r.referenceType || null;
  if (!referenceType) {
    const m = readFileSync(join(DIR, "templates/product.json"), "utf8").match(/shopify:\/\/apps\/[^"]+\/blocks\/(add_to_quote|quote_button|make_offer_button|price_gate)\/[^"]+/);
    referenceType = m ? m[0] : null;
  }
  console.log(`\nProduct template: ${r.note}`);
  if (r.changed) { writeFileSync(join(DIR, "templates/product.json"), joinTemplate(prod.head, prod.json)); changed.push("templates/product.json"); }
} catch (e) {
  console.error(`\nProduct template: ${e.message}`);
  process.exit(1);
}

if (existsSync(join(DIR, "templates/cart.json"))) {
  try {
    const cart = splitTemplate(readFileSync(join(DIR, "templates/cart.json"), "utf8"));
    const r = addCartBlock(cart.json, referenceType, sectionLiquid);
    console.log(`Cart template: ${r.note}`);
    if (r.changed) { writeFileSync(join(DIR, "templates/cart.json"), joinTemplate(cart.head, cart.json)); changed.push("templates/cart.json"); }
  } catch (e) {
    console.error(`Cart template: ${e.message}`);
  }
} else console.log("Cart template: this theme has no templates/cart.json (Liquid cart) — add Convert Cart to Quote in the theme editor");

if (!changed.length) { console.log("\nNothing to push: both blocks are already on the theme."); process.exit(0); }
if (DRY) { console.log(`\nDry run: edited ${changed.join(", ")} in ${DIR}; nothing pushed.`); process.exit(0); }

const pushArgs = ["theme", "push", "--store", STORE, "--live", "--nodelete", "--path", DIR];
for (const f of changed) pushArgs.push("--only", f);
const pushed = cli(pushArgs);
console.log(pushed ? `\nPushed ${changed.join(", ")} to the live theme.` : "\nPush did not complete; the live theme is unchanged.");
const undo = ["npx shopify theme push", "--store", STORE, "--live", "--nodelete", "--path", BACKUP, ...changed.flatMap((f) => ["--only", f])].join(" ");
console.log(`\nTo undo, push the backup back:\n${undo}`);
process.exit(pushed ? 0 : 1);
