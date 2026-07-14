# /docs/ai-spec.md — Mannon AI spec

## Guiding rule

**AI never acts autonomously.** Every AI output lands on a confirm screen; nothing is written to a
cart or draft order until the user explicitly confirms. Every id the model returns is validated
server-side against the live catalog — hallucinated ids are dropped, never trusted.

Model: **Claude Haiku 4.5** (`claude-haiku-4-5`). Temperature **0**. Tool-use (forced) + prompt
caching.

---

## AI-1 — Magic Order Pad

**Goal:** the flagship "wow". A buyer pastes a PO, an email, or a spreadsheet blob into a box on the
quick-order pad (F3/S10). Claude Haiku resolves the free text into catalog lines. A confirm screen
shows matched + unmatched lines. On explicit confirm, the deterministic S10 resolver builds the cart.

### Flow

```
paste blob
   │
   ▼
Haiku (catalog as CACHED system prefix, temp 0, forced tool: submit_parsed_order)
   │  returns { lines: [{ variant_id, sku, quantity, raw_text }], unmatched: [string] }
   ▼
server-side validation: for each line, look up variant_id in LIVE catalog
   │  drop any variant_id that doesn't exist -> move its raw_text into unmatched
   ▼
confirm screen: matched lines (editable qty) + unmatched list (buyer resolves manually via pad)
   │
   ▼  (explicit confirm only)
S10 resolver builds cart / draft
   │
   ▼
append Event AI_PARSE_ACCEPTED  (log accepted-as-is rate)
```

### Prompt construction

- **System prefix = the merchant catalog** (SKU, title, variant GID, price), sent as a **cached**
  block so repeated pastes for the same shop reuse the cache. Cache key ties to the shop + catalog
  version.
- **User message** = the pasted blob, verbatim.
- **Forced tool call**: `submit_parsed_order`. The model must return via the tool, not prose.
- **Temperature 0** for determinism.

### Tool schema — `submit_parsed_order`

```json
{
  "name": "submit_parsed_order",
  "description": "Return the parsed order as catalog line items plus anything that could not be matched.",
  "input_schema": {
    "type": "object",
    "properties": {
      "lines": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "variant_id": { "type": "string", "description": "gid://shopify/ProductVariant/... from the provided catalog ONLY" },
            "sku":        { "type": "string" },
            "quantity":   { "type": "integer", "minimum": 1 },
            "raw_text":   { "type": "string", "description": "the source line this was parsed from" }
          },
          "required": ["variant_id", "quantity", "raw_text"]
        }
      },
      "unmatched": {
        "type": "array",
        "items": { "type": "string" },
        "description": "source lines that could not be confidently matched to a catalog variant"
      }
    },
    "required": ["lines", "unmatched"]
  }
}
```

### Hard server-side rules

1. **Validate every `variant_id`** against the live catalog for this shop. Unknown → drop the line,
   push its `raw_text` into `unmatched`. Never trust a model-returned id.
2. **Never auto-build.** The cart/draft is created only after the buyer clicks confirm on the review
   screen.
3. **Quantities** are clamped to ≥1 integers server-side.
4. **No PII to the model** beyond the pasted blob itself (which the buyer supplied).

### Confirm screen

- **Matched lines**: variant title, SKU, resolved qty (editable), unit price from catalog.
- **Unmatched list**: raw text lines the buyer can hand-resolve via the S10 pad.
- Primary action **Confirm & build cart**; secondary **Cancel**. Nothing writes before Confirm.

### Evals (ship as tests)

Add the eval fixtures below as test cases. Each fixture is `(paste_blob, expected_matched_skus,
expected_unmatched)`. Assert:

- 100% of returned `variant_id`s exist in the catalog **after** validation (no hallucinations
  survive).
- Known-good blobs resolve to the expected SKUs.
- Ambiguous / typo / unknown-SKU lines land in `unmatched`, not silently dropped or mis-matched.
- Log and assert an **accepted-as-is rate** metric per run.

Fixture categories to cover:
- Clean PO with exact SKUs.
- Email prose ("hey can I get 12 of the blue ones, part# ABC-2…").
- Spreadsheet paste (tab/CSV rows).
- Typos and near-miss SKUs (should go unmatched, not wrong-matched).
- A completely unknown SKU (must appear in `unmatched`).
- Mixed valid + invalid in one blob.

### Growth-tier AI hooks (S17 gating)

Quote Copilot and Reorder Radar are **Growth-only**. Their AI calls follow the same rules (confirm
screen, validated ids, temp 0) and are gated behind `requireBilling()`.
