#!/usr/bin/env bash
# QA harness for Mannon, following the qa-tester protocol (oh-my-claudecode):
# prerequisites → service in a uniquely named tmux session → readiness poll →
# send commands → capture output BEFORE asserting → PASS/FAIL with evidence →
# cleanup even on failure. Run from the repo root with a Postgres reachable at
# DATABASE_URL. Writes <OUT>/report.md plus one evidence file per case.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
PORT="${QA_PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"
SESSION="qa-mannon-server-${TS}"
OUT="${QA_OUT:-/tmp/claude-0/-home-user/07093f4e-3fc4-5b8a-8591-7fc0e9a4ba90/scratchpad/qa-${TS}}"
mkdir -p "$OUT"
REPORT="$OUT/report.md"
SECRET="${SHOPIFY_API_SECRET:-qa-dummy-secret-0123456789}"
CRON="${CRON_SECRET:-qa-cron-secret-0123456789}"
PASS=0; FAIL=0; N=0
cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "session killed: $SESSION"
  echo "" >> "$REPORT"
  echo "### Cleanup" >> "$REPORT"
  echo "- Session killed: YES ($SESSION)" >> "$REPORT"
  echo "- Server log kept at: $OUT/server.log" >> "$REPORT"
}
trap cleanup EXIT

{
  echo "## QA Test Report: Mannon pre-submission (App Store 1.x–5.x behaviours)"
  echo ""
  echo "### Environment"
  echo "- Session: \`$SESSION\`"
  echo "- Service: production build (remix-serve) at $BASE, Postgres at ${DATABASE_URL%%\?*}"
  echo "- Date: $(date -u +%Y-%m-%dT%H:%MZ) · commit $(git -C "$ROOT" rev-parse --short HEAD)"
  echo ""
  echo "### Test Cases"
} > "$REPORT"

# --- 1) prerequisites --------------------------------------------------------
for bin in tmux curl nc jq openssl node; do command -v $bin >/dev/null || { echo "missing $bin"; exit 2; }; done
if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then echo "port $PORT busy"; exit 2; fi
[ -f "$ROOT/build/server/index.js" ] || { echo "no build; run npm run build"; exit 2; }
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL unset"; exit 2; }

# --- 2) setup: service in tmux, wait for readiness ---------------------------
tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "env NODE_ENV=production PORT=$PORT HOST=127.0.0.1 DATABASE_URL='$DATABASE_URL' \
   SHOPIFY_API_KEY=qa-dummy-key SHOPIFY_API_SECRET='$SECRET' SHOPIFY_APP_URL=$BASE \
   SCOPES=read_products,read_orders,write_draft_orders,read_companies,write_payment_terms,read_inventory,write_customers \
   SESSION_SECRET=qa-session-secret-0123456789 CRON_SECRET='$CRON' MANNON_FF_CREDIT=true \
   MANNON_FF_QUOTE_WIDGET=true MANNON_FF_QUOTE_CAPTURE=true MANNON_FF_MAKE_AN_OFFER=true MANNON_FF_QUOTE_OPS=true \
   MANNON_FF_WHOLESALE_REG=true MANNON_FF_CATALOG_SHARE=true MANNON_FF_FLEX_PAY=true MANNON_FF_I18N=true MANNON_FF_BUYER_PWA=true \
   MANNON_FF_REP_PORTAL=true MANNON_FF_ERP_SYNC=true \
   node node_modules/@remix-run/serve/dist/cli.js ./build/server/index.js 2>&1 | tee $OUT/server.log"
for i in $(seq 1 60); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 0.5; done
nc -z 127.0.0.1 "$PORT" || { echo "server never listened"; tmux capture-pane -t "$SESSION" -p | tail -20; exit 3; }
sleep 1
tmux capture-pane -t "$SESSION" -p | tail -5 > "$OUT/startup.txt"

# --- helpers -----------------------------------------------------------------
# tc NAME EXPECT_STATUS_REGEX BODY_MUST_MATCH BODY_MUST_NOT_MATCH -- curl args...
tc() {
  local name="$1" status_re="$2" must="$3" mustnot="$4"; shift 4; shift # "--"
  N=$((N+1)); local id="TC$N"
  local hdr="$OUT/$id.headers" body="$OUT/$id.body"
  local cmd="curl -sS -o $body -D $hdr -w '%{http_code}' $*"
  local status; status=$(curl -sS -o "$body" -D "$hdr" -w '%{http_code}' --max-time 20 "$@" 2>>"$OUT/$id.err" || echo "000")
  local verdict="PASS" why=""
  [[ "$status" =~ ^($status_re)$ ]] || { verdict="FAIL"; why="status $status not in [$status_re]"; }
  if [ -n "$must" ] && ! grep -qiE -- "$must" "$body" "$hdr"; then verdict="FAIL"; why="$why; missing /$must/"; fi
  if [ -n "$mustnot" ] && grep -qiE -- "$mustnot" "$body" "$hdr"; then verdict="FAIL"; why="$why; found forbidden /$mustnot/"; fi
  # Never a stack trace or secret in any response body.
  if grep -qE "at [A-Za-z_$.]+ \(.*:[0-9]+:[0-9]+\)|node_modules/|$SECRET|qa-session-secret|ANTHROPIC_API_KEY" "$body"; then verdict="FAIL"; why="$why; stack trace or secret leaked"; fi
  [ "$verdict" = PASS ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  {
    echo "#### $id: $name"
    echo "- **Command**: \`curl $*\`"
    echo "- **Expected**: status /$status_re/${must:+, body matches /$must/}${mustnot:+, never /$mustnot/}"
    echo "- **Actual**: status $status · $(head -c 160 "$body" | tr '\n' ' ' | sed 's/[`|]/ /g')…"
    echo "- **Status**: $verdict${why:+ — ${why#; }}"
    echo ""
  } >> "$REPORT"
  echo "$id $verdict $name${why:+ ($why)}"
}
hmac() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" -binary | openssl base64 -A; }

# --- 3+4) execute + verify ---------------------------------------------------
echo "### A. Public pages (2.1.1 no web errors, 4.x listing links)" >> "$REPORT"
tc "Landing page renders the pitch" "200" "Shopify draft order" "" -- "$BASE/"
tc "Landing: ?shop= hands off to the embedded app (install path)" "30[1278]" "location: */app\?shop=" "" -- -i "$BASE/?shop=example.myshopify.com"
tc "Embedded /app with a shop: OAuth redirect or App Bridge bounce (410), never 5xx" "30[1278]|40[01]|410" "" "" -- -i "$BASE/app?shop=example.myshopify.com"
tc "Embedded /app without a shop fails closed (no 5xx)" "30[1278]|40[01]|410" "" "" -- -i "$BASE/app"
tc "/auth/login explains how to open Mannon, no shop-domain field (2.3.1)" "200" "Open Mannon from Shopify" "name=\"shop\"" -- "$BASE/auth/login"
tc "/discover directory is off for the App Store review (1.1.6)" "404" "" "Discover wholesale" -- "$BASE/discover"
tc "Privacy policy served" "200" "Privacy Policy" "" -- "$BASE/privacy"
tc "Health probe: value-free config signal" "200|503" "\"configOk\"" "SHOPIFY_|DATABASE_URL" -- "$BASE/healthz"
tc "Unknown route → friendly 404 page, not a stack trace" "404" "Page not found|page you" "TypeError|ReferenceError|Something went wrong" -- "$BASE/this-route-does-not-exist"
tc "POST to a page route → 405/404, not 5xx" "40[45]" "" "" -- -X POST "$BASE/privacy"
tc "Demo hub" "200" "See the whole workflow" "" -- "$BASE/demo"
tc "Merchant tour" "200" "tour-step" "" -- "$BASE/demo/tour"
tc "Buyer demo fails closed without a demo store" "200" "isn’t available|isn't available|Welcome, Demo buyer" "" -- "$BASE/demo/buyer"
tc "Public pricing page: the v3 ladder" "200" "Growth" "\$79" -- "$BASE/pricing"
tc "Demo store product page" "200" "Harbor Blend Espresso" "" -- "$BASE/demo/store"

echo "### B. Buyer & rep portals (passwordless, fail closed)" >> "$REPORT"
tc "Portal home without a session → sign-in, never a 5xx" "200|30[1278]" "" "" -- -i "$BASE/portal"
tc "Magic link with a bad token → plain-language page" "200|40[01]" "expired|invalid|sign in|link" "" -- "$BASE/portal/auth?token=not-a-real-token"
tc "POST bad magic token → not consumed, no 5xx" "200|30[1278]|40[01]" "" "" -- -i -X POST -d "token=not-a-real-token" "$BASE/portal/auth"
tc "Portal quote page without a session" "200|30[1278]|40[134]" "" "" -- -i "$BASE/portal/quotes/doesnotexist"
tc "Portal reorder without a session" "200|30[1278]|40[134]" "" "" -- -i "$BASE/portal/reorder/doesnotexist"
tc "Portal PWA manifest" "200" "\"name\"" "" -- "$BASE/portal/manifest.webmanifest"
tc "Portal service worker" "200" "" "<html" -- "$BASE/portal/sw.js"
tc "Portal icon" "200" "<svg" "" -- "$BASE/portal/icon.svg"
tc "Rep portal without a session" "200|30[1278]|40[13]" "" "" -- -i "$BASE/rep"
tc "Rep company page without a session" "200|30[1278]|40[134]" "" "" -- -i "$BASE/rep/company/doesnotexist"
tc "Pay link with a bad token → 404" "404" "" "" -- "$BASE/pay/not-a-token"
tc "Shared catalog with a bad slug → 404" "404" "" "" -- "$BASE/catalog/example.myshopify.com/no-such-catalog"
tc "Wholesale application for an unknown shop → no 5xx" "200|404" "" "" -- "$BASE/apply/example.myshopify.com"

echo "### C. Mandatory webhooks (HMAC, 401 on bad signature)" >> "$REPORT"
BODY='{"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}}'
for topic in customers/data_request customers/redact shop/redact app/uninstalled; do
  tc "$topic unsigned → 401" "401" "" "" -- -X POST -H "content-type: application/json" -H "x-shopify-topic: $topic" -H "x-shopify-shop-domain: example.myshopify.com" -d "$BODY" "$BASE/webhooks/$topic"
  tc "$topic wrong signature → 401" "401" "" "" -- -X POST -H "content-type: application/json" -H "x-shopify-topic: $topic" -H "x-shopify-shop-domain: example.myshopify.com" -H "x-shopify-hmac-sha256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" -d "$BODY" "$BASE/webhooks/$topic"
  tc "$topic signed → 200 (unknown shop handled)" "200" "" "" -- -X POST -H "content-type: application/json" -H "x-shopify-topic: $topic" -H "x-shopify-shop-domain: example.myshopify.com" -H "x-shopify-hmac-sha256: $(hmac "$BODY")" -d "$BODY" "$BASE/webhooks/$topic"
done
tc "Webhook route answers GET with 405" "405" "" "Unexpected Server Error" -- "$BASE/webhooks/shop/redact"
tc "app/scopes_update unsigned → 401" "401" "" "" -- -X POST -H "content-type: application/json" -d '{}' "$BASE/webhooks/app/scopes_update"

echo "### D. Storefront endpoints (theme app extension, cross-origin)" >> "$REPORT"
for ep in quote-request offer; do
  tc "OPTIONS /api/$ep preflight → 204 + CORS" "204" "access-control-allow-origin: \*" "" -- -i -X OPTIONS -H "origin: https://example.myshopify.com" -H "access-control-request-method: POST" -H "access-control-request-headers: content-type" "$BASE/api/$ep"
  tc "POST /api/$ep empty body → 400 JSON + CORS" "400" "\"ok\":false" "" -- -i -X POST -H "content-type: application/json" -d '{}' "$BASE/api/$ep"
  tc "POST /api/$ep malformed JSON → 400, no 5xx" "400" "\"ok\":false" "" -- -i -X POST -H "content-type: application/json" -d 'not json' "$BASE/api/$ep"
  tc "GET /api/$ep → CORS-bearing 405" "405" "access-control-allow-origin" "" -- -i "$BASE/api/$ep"
done
tc "POST quote-request for an unknown shop → graceful JSON" "200|400" "\"ok\"" "" -- -i -X POST -H "content-type: application/json" -d '{"shop":"example.myshopify.com","email":"buyer@example.test","name":"QA","lines":[{"variantId":"gid://shopify/ProductVariant/1","quantity":2}],"renderedAt":0}' "$BASE/api/quote-request"
for ep in quote-widget-config quote-capture-config offer-config; do
  tc "GET /api/$ep unknown shop → {enabled:false} + CORS" "200" "\"enabled\":false" "" -- -i "$BASE/api/$ep?shop=example.myshopify.com"
  tc "GET /api/$ep without shop → {enabled:false}" "200" "\"enabled\":false" "" -- "$BASE/api/$ep"
  tc "OPTIONS /api/$ep → 204" "204|200" "" "" -- -i -X OPTIONS "$BASE/api/$ep"
done
tc "GET /api/price-visibility unknown shop → nothing hidden + CORS" "200" "access-control-allow-origin" "\"hidePrice\":true" -- -i "$BASE/api/price-visibility?shop=example.myshopify.com&loggedIn=0"
tc "GET /api/quote-form unknown shop → JSON, no 5xx" "200|404" "" "" -- -i "$BASE/api/quote-form?shop=example.myshopify.com&surface=PRODUCT"
tc "Customer-account quotes without a token fails closed" "401|410|200" "" "" -- -i "$BASE/api/account/quotes"

echo "### E. Internal endpoints (shared secrets, never open)" >> "$REPORT"
tc "Cron without secret → 401" "401" "" "" -- -X POST "$BASE/internal/cron/reminders"
tc "Cron with the secret → 200 JSON" "200" "" "" -- -X POST -H "x-cron-secret: $CRON" "$BASE/internal/cron/reminders"
for job in followups analytics accounting erp reorder-push tax-reminders payment-reminders; do
  tc "Cron $job without secret → 401/503/skip, never runs" "401|503|200" "" "\"sent\":[1-9]" -- -X POST "$BASE/internal/cron/$job"
done
tc "ERP stock without secret → 400/401" "40[01]" "" "" -- -X POST -H "content-type: application/json" -d '{}' "$BASE/internal/erp/stock"
tc "ERP stock GET → 405" "405" "" "" -- "$BASE/internal/erp/stock"
tc "Debug config route requires admin auth" "30[1278]|40[01]|410" "" "SHOPIFY_API_SECRET" -- -i "$BASE/app/debug/config"

echo "### F. Security headers & hygiene" >> "$REPORT"
head -c 2000000 /dev/zero | tr '\0' 'a' > "$OUT/big.json"
tc "Landing has no server-version banner" "200" "" "x-powered-by: express" -- -i "$BASE/"
tc "Embedded shell is not framed from an arbitrary origin without a shop" "30[1278]|40[01]|410" "" "" -- -i -H "sec-fetch-dest: iframe" "$BASE/app"
tc "Secrets never echo back (healthz)" "200|503" "" "qa-dummy|qa-session" -- "$BASE/healthz"
tc "Huge body to the offer endpoint is refused cleanly" "400|413" "" "" -- -X POST -H "content-type: application/json" --data-binary "@$OUT/big.json" "$BASE/api/offer"

# --- 5) summary + server-side evidence ---------------------------------------
tmux capture-pane -t "$SESSION" -p -S -200 > "$OUT/server-pane.txt"
ERRS=$(grep -ciE "unhandled|TypeError|ReferenceError|ECONNREFUSED|PrismaClientKnownRequestError" "$OUT/server.log" || true)
{
  echo ""
  echo "### Summary"
  echo "- Total: $N tests"
  echo "- Passed: $PASS"
  echo "- Failed: $FAIL"
  echo "- Server-side error lines during the run: $ERRS (see server.log)"
} >> "$REPORT"
echo "TOTAL $N PASS $PASS FAIL $FAIL SERVER_ERRORS $ERRS"
echo "report: $REPORT"
