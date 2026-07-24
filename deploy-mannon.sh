#!/usr/bin/env bash
#
# deploy-mannon.sh — one-shot guided deploy for the Mannon Shopify app to Fly.io
#
# HOW TO USE (on your Mac):
#   1. Open Terminal
#   2. cd into your manosh repo (the folder that has shopify.app.toml)
#   3. Make sure you're on a branch that has fly.toml + the fixed Dockerfile
#      (this branch does; if you deploy from elsewhere, merge the deploy-prep PR first)
#   4. Run:  bash deploy-mannon.sh
#
# It pauses at the human-only moments (browser logins, picking the app,
# the go-live confirmation). Everything mechanical is automated.
# If any step errors, stop and paste the output to Claude.

set -e  # stop on first error

# ---- pretty helpers -------------------------------------------------------
bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$1"; }
warn() { printf "\033[33m! %s\033[0m\n" "$1"; }
pause(){ printf "\n"; read -r -p "↳ Press Enter when done… "; printf "\n"; }

APP="manosh"
APP_URL="https://${APP}.fly.dev"

# ---- 0. sanity checks -----------------------------------------------------
bold "Step 0 — Checking you're in the right folder + tools are installed"
if [ ! -f "shopify.app.toml" ]; then
  warn "No shopify.app.toml here. cd into your manosh repo first, then re-run."
  exit 1
fi
command -v fly >/dev/null      || { warn "flyctl not found. Run: brew install flyctl"; exit 1; }
command -v shopify >/dev/null  || { warn "Shopify CLI not found. Run: npm i -g @shopify/cli @shopify/app"; exit 1; }
command -v openssl >/dev/null   || { warn "openssl not found (comes with macOS — odd)."; exit 1; }

# This script relies on the committed fly.toml (internal_port 3000 + migration
# release_command) and the fixed Dockerfile. Without them, `fly launch` would
# generate a mis-configured fly.toml and the build would fail.
if [ ! -f "fly.toml" ]; then
  warn "fly.toml is missing. You're probably on a branch without the deploy-prep."
  warn "Merge the deploy-prep PR (or checkout that branch) before deploying, so"
  warn "fly.toml (port 3000 + 'prisma migrate deploy' release_command) is present."
  exit 1
fi
grep -q "release_command" fly.toml || warn "fly.toml has no [deploy] release_command — migrations may not run on deploy."
grep -q "internal_port = 3000" fly.toml || warn "fly.toml internal_port isn't 3000 — check it matches the app's PORT."
ok "Repo + CLIs + fly.toml look good"

# ---- 1. logins ------------------------------------------------------------
bold "Step 1 — Log in to Fly (a browser will open)"
fly auth login
ok "Fly logged in"

# ---- 2. link the Shopify app ---------------------------------------------
bold "Step 2 — Link this repo to your 'Mannon' app (browser opens → pick Mannon)"
shopify app config link
ok "Linked — client_id written into shopify.app.toml"

bold "Step 3 — Reading your API key + secret"
warn "The next command prints your SHOPIFY_API_KEY and SHOPIFY_API_SECRET. Copy both."
shopify app env show
printf "\n"
read -r  -p "Paste SHOPIFY_API_KEY:    " SHOPIFY_API_KEY
read -rs -p "Paste SHOPIFY_API_SECRET: " SHOPIFY_API_SECRET; printf "\n"   # -s: hidden
# scopes come straight from the toml, no typing needed
SCOPES=$(grep -E '^[[:space:]]*scopes[[:space:]]*=' shopify.app.toml | head -1 | sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/')
ok "Scopes read from shopify.app.toml: ${SCOPES:-<none found — check the toml>}"

# ---- 4. Fly config (no deploy yet) ---------------------------------------
bold "Step 4 — Preparing Fly config for the existing '$APP' app (no deploy yet)"
warn "If it asks to overwrite/copy config, KEEP the existing '$APP' app + KEEP the"
warn "existing fly.toml — do NOT let it overwrite the port or release_command."
fly launch --no-deploy --name "$APP"
ok "fly.toml ready (primary_region should read 'fra' — Frankfurt; change if needed)"

# ---- 5. database ----------------------------------------------------------
bold "Step 5 — Create + attach a Postgres database"
warn "Choose a small/dev config when prompted. Note the DB NAME it creates."
warn "If your flyctl says 'fly postgres' is deprecated, use 'fly mpg create' / 'fly mpg attach' instead."
fly postgres create
printf "\n"
read -r -p "Type the Postgres app name it just created: " PG_NAME
fly postgres attach "$PG_NAME" --app "$APP"
ok "Database attached — DATABASE_URL is now wired in automatically"

# ---- 6. secrets (SESSION_SECRET generated for you) -----------------------
bold "Step 6 — Setting secrets (generating SESSION_SECRET for you)"
SESSION_SECRET=$(openssl rand -hex 32)
fly secrets set \
  SHOPIFY_API_KEY="$SHOPIFY_API_KEY" \
  SHOPIFY_API_SECRET="$SHOPIFY_API_SECRET" \
  SCOPES="$SCOPES" \
  SHOPIFY_APP_URL="$APP_URL" \
  SESSION_SECRET="$SESSION_SECRET" \
  --app "$APP"
ok "Secrets set (SESSION_SECRET was generated and never printed)"
warn "Optional secrets (only if you use them): ANTHROPIC_API_KEY (AI Order Pad),"
warn "POSTHOG_API_KEY / POSTHOG_HOST (analytics), SENTRY_DSN (errors)."

# ---- 7. point the Shopify config at the live URL -------------------------
bold "Step 7 — Updating App URL + redirect URLs in shopify.app.toml → $APP_URL"
# BSD/macOS sed in-place. Replaces the placeholder host across application_url
# and the redirect_urls array (all currently point at https://example.com).
sed -i '' "s#https://example\.com#${APP_URL}#g" shopify.app.toml
CURRENT_URL=$(grep -E '^[[:space:]]*application_url' shopify.app.toml | head -1)
ok "shopify.app.toml now has: ${CURRENT_URL}"
warn "If that URL is NOT ${APP_URL}, edit shopify.app.toml by hand before continuing"
warn "(this happens if 'config link' pulled a non-placeholder URL from the dashboard)."
pause

# ---- 8. GO LIVE (confirmation) -------------------------------------------
bold "Step 8 — Deploy to Fly"
warn "This publishes your app live at $APP_URL."
read -r -p "Type 'deploy' to go live: " CONFIRM
if [ "$CONFIRM" != "deploy" ]; then
  warn "Not confirmed — stopping here. Re-run when ready."
  exit 0
fi
fly deploy --app "$APP"
ok "Deployed"

# ---- 9. publish Shopify config + verify ----------------------------------
bold "Step 9 — Publishing Shopify config (App URL, scopes, webhooks)"
warn "This publishes a new app version to Shopify."
read -r -p "Type 'publish' to release the Shopify config: " CONFIRM2
if [ "$CONFIRM2" = "publish" ]; then
  shopify app deploy
  ok "Shopify config published"
else
  warn "Skipped shopify app deploy — run it yourself when ready."
fi

bold "Step 10 — Verifying"
fly status --app "$APP" || true
printf "\nHome page:\n";     curl -I "$APP_URL"          || true
printf "\nPrivacy route:\n"; curl -I "$APP_URL/privacy"  || true

printf "\n"
bold "Done. Next, by hand in the browser:"
echo "  • Install Mannon on your dev store and click through a quote"
echo "  • Submit for review in the Shopify Partner Dashboard"
