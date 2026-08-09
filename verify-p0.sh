#!/usr/bin/env bash
#
# verify-p0.sh — deploy Mannon and drive the P0-1 / P0-2 re-submission checks.
#
# What this AUTOMATES:
#   1. fly deploy (runs the Prisma migration as the release_command)
#   2. polls /healthz until the new version is live
#   3. probes the public routes for any 5xx (a hard server error is a P0 by itself)
#   4. reports the MANNON_FF_PLAN_V3 flag so the billing ladder is what you expect
#
# What this CANNOT do (you must do these two in the dev-store admin — they only
# mean anything as the logged-in merchant inside the embedded iframe):
#   • P0-2 — click every nav tab, confirm none shows "Something went wrong"
#   • P0-1 — approve a plan, confirm you land back in embedded Settings, plan active
# The script prints these as an interactive checklist at the end.
#
# Usage:
#   ./verify-p0.sh                 # deploy, then verify
#   ./verify-p0.sh --no-deploy     # skip fly deploy, just verify a running app
#   APP_HOST=manosh.fly.dev ./verify-p0.sh   # override the host (default below)
#
set -euo pipefail

APP_HOST="${APP_HOST:-manosh.fly.dev}"
BASE="https://${APP_HOST}"
BRANCH="claude/mannon-feature-slices-w3epbf"
DEPLOY=1
[ "${1:-}" = "--no-deploy" ] && DEPLOY=0

# --- pretty output -----------------------------------------------------------
if [ -t 1 ]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; X=$'\e[0m'
else
  R=""; G=""; Y=""; B=""; X=""
fi
ok()   { printf "%s✓%s %s\n" "$G" "$X" "$1"; }
warn() { printf "%s!%s %s\n" "$Y" "$X" "$1"; }
fail() { printf "%s✗%s %s\n" "$R" "$X" "$1"; }
step() { printf "\n%s== %s ==%s\n" "$B" "$1" "$X"; }

code() { curl -sS -m 15 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"; }

FAILED=0

# --- 0. sanity ---------------------------------------------------------------
step "0. Preflight"
if ! command -v fly >/dev/null 2>&1; then
  warn "flyctl not found — install it (https://fly.io/docs/flyctl/install) or run with --no-deploy"
  [ "$DEPLOY" = "1" ] && { fail "cannot deploy without flyctl"; exit 1; }
else
  ok "flyctl present: $(fly version 2>/dev/null | head -1)"
fi
BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$BR" = "$BRANCH" ]; then ok "on branch $BRANCH"; else warn "on branch '$BR' (expected $BRANCH)"; fi

# --- 1. deploy ---------------------------------------------------------------
if [ "$DEPLOY" = "1" ]; then
  step "1. Deploy (fly deploy — migration runs as release_command)"
  git pull origin "$BRANCH" --ff-only || warn "git pull skipped/failed — deploying local tree"
  if fly deploy; then
    ok "fly deploy finished"
  else
    fail "fly deploy failed. If it stalled on release_command (Fly transient: 'machine not found' / 408):"
    echo "    fly agent restart && fly deploy"
    echo "  Last resort — comment out release_command in fly.toml, deploy, then:"
    echo "    fly ssh console -C \"npx prisma migrate deploy\"   (restore fly.toml after)"
    exit 1
  fi
else
  step "1. Deploy — SKIPPED (--no-deploy)"
fi

# --- 2. health ---------------------------------------------------------------
step "2. Health check — poll ${BASE}/healthz"
HEALTHY=0
for i in $(seq 1 30); do
  c="$(code "${BASE}/healthz")"
  if [ "$c" = "200" ]; then ok "/healthz → 200 (attempt $i)"; HEALTHY=1; break; fi
  printf "  waiting… /healthz → %s (attempt %s/30)\r" "$c" "$i"
  sleep 4
done
echo
if [ "$HEALTHY" = "0" ]; then
  fail "/healthz never returned 200 — the app is not up. Check: fly logs"
  FAILED=1
fi

# --- 3. no 5xx on public routes ---------------------------------------------
# Unauthenticated hits to embedded routes legitimately 3xx/401/410 (they bounce
# to Shopify auth). A 5xx means a server crash — that IS a P0 ("Something went
# wrong"). So we ONLY fail on 5xx; anything else is "served".
step "3. Public-route probe (only a 5xx is a failure)"
for path in / /healthz /app /app/settings /app/quotes; do
  c="$(code "${BASE}${path}")"
  case "$c" in
    5??) fail "${path} → ${c}  (server error — investigate: fly logs)"; FAILED=1 ;;
    000) warn "${path} → no response (network/proxy) — can't judge from here" ;;
    *)   ok   "${path} → ${c}  (served; auth redirect is expected)" ;;
  esac
done

# --- 4. billing ladder flag --------------------------------------------------
step "4. Billing ladder flag (MANNON_FF_PLAN_V3)"
if [ "$DEPLOY" = "1" ] || command -v fly >/dev/null 2>&1; then
  if fly secrets list 2>/dev/null | grep -qi "MANNON_FF_PLAN_V3"; then
    ok "MANNON_FF_PLAN_V3 is set as a secret — confirm it's 'true' so prices are \$0/\$9/\$29/\$69"
    echo "    (fly stores secret values hidden; set/confirm with: fly secrets set MANNON_FF_PLAN_V3=true)"
  else
    warn "MANNON_FF_PLAN_V3 not found in 'fly secrets list' — it may be a build/env var, or unset."
    echo "    If unset, the code falls back to the legacy Starter/Growth ladder — confirm that matches your listing."
  fi
else
  warn "flyctl unavailable — check MANNON_FF_PLAN_V3 in the Fly dashboard manually"
fi

# --- 5. manual checklist -----------------------------------------------------
step "5. Manual dev-store checks (only YOU can do these — in the embedded admin)"
cat <<'EOF'

  Open the app in your Shopify dev store, then:

  [ ] P0-2 — Click EVERY nav tab, top to bottom.
        PASS  every tab loads a page.
        FAIL  any tab shows the App Bridge "Something went wrong" page.

  [ ] P0-1 — Settings → choose a plan → approve on Shopify's screen.
        PASS  you return to embedded Settings with the plan ACTIVE.
        FAIL  you land on the OAuth "enter your store" page, or plan not applied.

  Do NOT re-submit to the App Store until BOTH pass.
  On any failure, capture the screen/URL — P0-1 fix lives in
  app/routes/app.settings.tsx; P0-2 in app/routes/app.tsx + app/lib/nav.ts.
EOF

# --- verdict -----------------------------------------------------------------
step "Automated result"
if [ "$FAILED" = "0" ]; then
  ok "Automated checks passed (deploy + health + no 5xx). Now run the 2 manual checks above."
  exit 0
else
  fail "Automated checks found a problem — see ✗ lines above. Fix before the manual checks."
  exit 1
fi
