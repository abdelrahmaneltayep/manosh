/*
 * Pure helpers for scripts/storefront/add-theme-blocks.mjs: add Mannon's app
 * blocks to a theme's JSON templates without touching anything else.
 * No I/O here, so it can be tested on fixture templates.
 */

/** JSON templates may start with a generated comment block; keep it. */
export function splitTemplate(text) {
  const m = text.match(/^\s*\/\*[\s\S]*?\*\/\s*/);
  const head = m ? m[0] : "";
  return { head, json: JSON.parse(text.slice(head.length)) };
}
export function joinTemplate(head, json) {
  return head + JSON.stringify(json, null, 2) + "\n";
}

const MANNON_RE = /^shopify:\/\/apps\/[^/]+\/blocks\/(add_to_quote|quote_button|make_offer_button|price_gate|cart_to_quote)\/[^/]+$/;

/** Walk every { blocks, block_order } container in a template. */
function* containers(node, path = []) {
  if (!node || typeof node !== "object") return;
  if (node.blocks && typeof node.blocks === "object" && !Array.isArray(node.blocks)) yield { node, path };
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") yield* containers(v, path.concat(k));
  }
}

/** Every Mannon block in a template: { container, key, handle, type }. */
export function mannonBlocks(json) {
  const out = [];
  for (const { node, path } of containers(json)) {
    for (const [key, b] of Object.entries(node.blocks)) {
      const m = b && typeof b.type === "string" ? b.type.match(MANNON_RE) : null;
      if (m) out.push({ container: node, path, key, handle: m[1], type: b.type });
    }
  }
  return out;
}

/** Turn one Mannon block type into another block of the same app/extension. */
export function typeFor(existingType, handle) {
  return existingType.replace(/\/blocks\/[^/]+\//, `/blocks/${handle}/`);
}

function uniqueKey(blocks, base) {
  let k = base;
  let i = 2;
  while (blocks[k]) k = `${base}_${i++}`;
  return k;
}

function insertBlock(container, key, block, afterKey) {
  container.blocks[key] = block;
  const order = Array.isArray(container.block_order) ? container.block_order : (container.block_order = Object.keys(container.blocks).filter((k) => k !== key));
  const at = afterKey ? order.indexOf(afterKey) : -1;
  if (at >= 0) order.splice(at + 1, 0, key);
  else order.push(key);
}

/**
 * Product template: add `price_gate` next to the existing Mannon blocks.
 * Returns a note, or throws when there is no Mannon block to copy from.
 */
export function addProductBlocks(json) {
  const found = mannonBlocks(json);
  if (!found.length) throw new Error("no Mannon block on the product template to copy the app reference from — add any Mannon block once in the theme editor first");
  if (found.some((b) => b.handle === "price_gate")) return { changed: false, note: "Price / ATC gate is already on the product template" };
  const anchor = found[found.length - 1];
  const key = uniqueKey(anchor.container.blocks, "mannon_price_gate");
  insertBlock(anchor.container, key, { type: typeFor(anchor.type, "price_gate"), settings: {} }, anchor.key);
  return { changed: true, note: `added Price / ATC gate after ${anchor.key} in ${anchor.path.join(" › ") || "the template"}`, referenceType: anchor.type };
}

/** Does a section's {% schema %} accept app blocks? */
export function acceptsAppBlocks(liquid) {
  const m = liquid && liquid.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  if (!m) return false;
  try {
    const schema = JSON.parse(m[1]);
    return Array.isArray(schema.blocks) && schema.blocks.some((b) => b && b.type === "@app");
  } catch {
    return /"type"\s*:\s*"@app"/.test(m[1]);
  }
}

/**
 * Cart template: add `cart_to_quote`. Prefer a cart section whose schema
 * accepts app blocks; otherwise add an "Apps" section if the theme has one.
 * `sectionLiquid(type)` returns the section file's text or null.
 */
export function addCartBlock(json, referenceType, sectionLiquid) {
  if (mannonBlocks(json).some((b) => b.handle === "cart_to_quote")) return { changed: false, note: "Convert Cart to Quote is already on the cart template" };
  const type = typeFor(referenceType, "cart_to_quote");
  const sections = json.sections || {};
  const order = Array.isArray(json.order) ? json.order : Object.keys(sections);
  const rank = (t) => (/footer|summary|subtotal|totals/.test(t) ? 0 : /main|cart/.test(t) ? 1 : 2);
  const candidates = order
    .filter((id) => sections[id] && !sections[id].disabled && acceptsAppBlocks(sectionLiquid(sections[id].type)))
    .sort((a, b) => rank(sections[a].type) - rank(sections[b].type));
  if (candidates.length) {
    const id = candidates[0];
    const s = sections[id];
    if (!s.blocks) s.blocks = {};
    const key = uniqueKey(s.blocks, "mannon_cart_to_quote");
    insertBlock(s, key, { type, settings: {} }, null);
    return { changed: true, note: `added Convert Cart to Quote to the "${s.type}" section (${id})` };
  }
  if (sectionLiquid("apps") !== null) {
    const id = uniqueKey(sections, "mannon_apps");
    sections[id] = { type: "apps", blocks: { mannon_cart_to_quote: { type, settings: {} } }, block_order: ["mannon_cart_to_quote"], settings: { include_margins: true } };
    json.sections = sections;
    const mainIdx = order.findIndex((k) => /main|cart/.test(sections[k]?.type || ""));
    if (Array.isArray(json.order)) json.order.splice(mainIdx >= 0 ? mainIdx + 1 : json.order.length, 0, id);
    return { changed: true, note: `added an Apps section (${id}) with Convert Cart to Quote below the cart` };
  }
  throw new Error("no cart section accepts app blocks and the theme has no Apps section — add Convert Cart to Quote in the theme editor instead");
}
