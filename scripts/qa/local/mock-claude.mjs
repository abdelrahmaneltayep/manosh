/*
 * A deterministic stand-in for the Claude Messages API, for the local QA run.
 * It answers the forced tool the app asks for:
 * - submit_parsed_order: matches each pasted line to a mock-catalog SKU; a line
 *   that says "made-up" comes back with an invented variant id, so the run can
 *   check the server drops ids that are not in the live catalog (guardrail 4).
 * - suggest_counter_offer: 5% under the list price in the prompt.
 * - any other tool: a schema-shaped placeholder marked as a local mock.
 * Every request is recorded (GET /__calls) so the run can check temperature 0.
 */
import http from "node:http";
import { MOCK_CATALOG } from "./mock-shopify.mjs";

const SKUS = MOCK_CATALOG.flatMap((p) => p.variants);
const textOf = (content) => (typeof content === "string" ? content : (content || []).map((c) => c.text || "").join("\n"));

function placeholder(schema, key = "") {
  if (!schema || typeof schema !== "object") return "Local mock draft";
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) out[k] = placeholder(v, k);
      return out;
    }
    case "array": return [placeholder(schema.items, key)];
    case "number": case "integer": return schema.minimum ?? 1;
    case "boolean": return false;
    default: return `Local mock ${key || "text"} (QA run, not Claude)`;
  }
}

function answer(tool, body) {
  const user = (body.messages || []).filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
  if (tool.name === "submit_parsed_order") {
    const lines = [];
    const unmatched = [];
    for (const raw of user.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      const qty = Number((raw.match(/(\d+)\s*(?:x|pcs|units|cases)?\s*$/i) || raw.match(/\b(\d+)\b/) || [])[1] || 1);
      if (/made-up/i.test(raw)) { lines.push({ variant_id: "gid://shopify/ProductVariant/999999", sku: "MADE-UP", quantity: qty, raw_text: raw }); continue; }
      const v = SKUS.find((s) => s.sku && raw.toLowerCase().includes(s.sku.toLowerCase()));
      if (v) lines.push({ variant_id: v.id, sku: v.sku, quantity: qty, raw_text: raw });
      else unmatched.push(raw);
    }
    return { lines, unmatched };
  }
  if (tool.name === "suggest_counter_offer") {
    const list = Number((user.match(/list unit price: [A-Z]{3} ([\d.]+)/i) || [])[1] || 10);
    const floor = Number((user.match(/Floor price \(do not go below\): [A-Z]{3} ([\d.]+)/) || [])[1] || 0);
    const price = Math.max(Math.round(list * 0.95 * 100) / 100, floor);
    return { suggested_unit_price: price, rationale: "Local mock: 5% under list for the volume, above the floor.", draft_message: "Thanks for the order. We can do this price for the quantity you asked for." };
  }
  return placeholder(tool.input_schema);
}

export function createMockClaude() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && req.url === "/__calls") return send(200, { calls });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { return send(400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } }); }
      const name = body.tool_choice?.name;
      const tool = (body.tools || []).find((t) => t.name === name);
      calls.push({ at: new Date().toISOString(), path: req.url, model: body.model, temperature: body.temperature, tool: name || null });
      const content = tool
        ? [{ type: "tool_use", id: `toolu_mock_${calls.length}`, name: tool.name, input: answer(tool, body) }]
        : [{ type: "text", text: "Local mock reply (QA run, not Claude)." }];
      send(200, { id: `msg_mock_${calls.length}`, type: "message", role: "assistant", model: body.model, content, stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
    });
  });
  return { server, calls };
}
