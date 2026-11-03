#!/usr/bin/env bash
# Mannon walkthrough, narrated by Menna: everything from the terminal.
#
#   scripts/video/menna-video.sh download     fetch the 16 chosen takes from ElevenLabs
#   scripts/video/menna-video.sh normalise    -16 LUFS wavs next to them
#   scripts/video/menna-video.sh record [N…]  record the scenes (all, or the ones given)
#   scripts/video/menna-video.sh record --from-chrome [N…]
#                                             same, after copying your signed-in Chrome profile
#   scripts/video/menna-video.sh record --cdp [N…]
#                                             start a normal Chrome you sign in to (Google works),
#                                             then film through it; best when Google sign-in is needed
#   scripts/video/menna-video.sh profiles     list the Chrome profiles on this Mac
#   scripts/video/menna-video.sh assemble     trim, captions, voice, concat → mp4
#   scripts/video/menna-video.sh all          the four in order
#
# Needs: node 18+, ffmpeg, jq, curl, Google Chrome. ELEVENLABS_API_KEY for download.
set -euo pipefail
cd "$(dirname "$0")/../.."

VO=docs/video/menna/vo
RAW=docs/video/menna/raw
CUT=docs/video/menna/cut
OUT=docs/video/menna/mannon-walkthrough-menna.mp4
SCENES=scripts/video/scenes.json

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

download() {
  need curl; need jq
  : "${ELEVENLABS_API_KEY:?set ELEVENLABS_API_KEY to the key of the workspace that holds the Menna clone}"
  mkdir -p "$VO"
  local pairs="01:puSmsPr2EZC1FJQ2UjAT 02:N8lc5YP3ob0wN4m9jXDu 03:sgDT1srfQPswJByH6R5a 04:2IUoe5Op0UWOLylVbtFV 05:4nGc9PsAgLIgYQ5xZvft 06:dZ39FXET5rg7zimIw35G 07:09TWTjCIcUuzOvyOEOSu 08:QV8xfGGPLJ4Nmg8Ji5x3 09:YerN1pW8sXIao1B4JKjh 10:O5KGXmXsAzFyQS4WsDe5 11:XazFlXYLNUty4HJASJCG 12:10rXqCTUMZwnjTvNqohD 13:0r5Tz0mGdvw6ezgMBSRO 14:o59yqMTmHZeLFfmpfqTv 15:00DWG1ts5Xsp6gLGdqzA 16:yhO55Z6QDu1GjswBDt3N"
  for pair in $pairs; do
    n=${pair%%:*}; id=${pair##*:}
    curl -sS -o "$VO/$n.mp3" -H "xi-api-key: $ELEVENLABS_API_KEY" "https://api.elevenlabs.io/v1/history/$id/audio"
    size=$(stat -f%z "$VO/$n.mp3" 2>/dev/null || stat -c%s "$VO/$n.mp3")
    if [ "$size" -lt 20000 ]; then
      echo "scene $n: download failed, ElevenLabs said:" >&2; cat "$VO/$n.mp3" >&2; echo >&2
      rm -f "$VO/$n.mp3"; exit 1
    fi
    echo "scene $n: $size bytes"
  done
}

normalise() {
  need ffmpeg
  for f in "$VO"/*.mp3; do
    ffmpeg -v error -y -i "$f" -af loudnorm=I=-16:TP=-1:LRA=3 -ar 48000 "${f%.mp3}.wav"
    echo "normalised $(basename "$f")"
  done
}

CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"
PROFILE_DIR="$HOME/mannon-chrome"

# List the profiles in the Mac's own Chrome, with the name shown in Chrome's menu.
profiles() {
  need jq
  [ -f "$CHROME_DIR/Local State" ] || { echo "no Google Chrome profiles found in $CHROME_DIR" >&2; exit 1; }
  jq -r '.profile.info_cache | to_entries[] | "\(.key)\t\(.value.name)\t\(.value.user_name // "")"' "$CHROME_DIR/Local State" | column -t -s $'\t'
}

# Copy a signed-in Chrome profile into the recorder's own profile folder, so the
# Shopify sign-in comes along. Caches are skipped; nothing in Chrome is changed.
import_profile() {
  need rsync; need jq
  local prof="${MANNON_VIDEO_CHROME_PROFILE:-}"
  if [ -z "$prof" ]; then
    prof=$(jq -r '.profile.last_used // "Default"' "$CHROME_DIR/Local State")
  fi
  [ -d "$CHROME_DIR/$prof" ] || { echo "no Chrome profile folder '$prof'. Profiles here:" >&2; profiles >&2; exit 1; }
  echo "importing Chrome profile '$prof' ($(jq -r --arg p "$prof" '.profile.info_cache[$p].name // "?"' "$CHROME_DIR/Local State")) into $PROFILE_DIR"
  mkdir -p "$PROFILE_DIR/Default"
  cp "$CHROME_DIR/Local State" "$PROFILE_DIR/Local State"
  rsync -a --delete \
    --exclude 'Cache' --exclude 'Code Cache' --exclude 'GPUCache' --exclude 'DawnCache' --exclude 'DawnGraphiteCache' --exclude 'DawnWebGPUCache' \
    --exclude 'Service Worker' --exclude 'Session Storage' --exclude 'Sessions' --exclude 'Singleton*' --exclude 'LOCK' --exclude 'lockfile' \
    "$CHROME_DIR/$prof/" "$PROFILE_DIR/Default/"
  rm -f "$PROFILE_DIR"/Singleton* "$PROFILE_DIR/Default/LOCK"
  echo "done. If macOS asks whether Chrome may use 'Chrome Safe Storage' from the keychain, click Always Allow: that is what decrypts the sign-in cookies."
}

# Start a normal (non-automated) Chrome on the recorder profile with remote
# debugging on, so a person can sign in with Google there, then attach to it.
start_cdp_chrome() {
  if curl -sS -m 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    echo "Chrome is already listening on port 9222"; return
  fi
  mkdir -p "$PROFILE_DIR"
  echo "starting Google Chrome on $PROFILE_DIR with remote debugging (port 9222)…"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --user-data-dir="$PROFILE_DIR" --remote-debugging-port=9222 --no-first-run --no-default-browser-check \
    --window-size=1920,1180 "https://admin.shopify.com/store/$(jq -r .store "$SCENES")/apps/$(jq -r .appHandle "$SCENES")/app" \
    >/dev/null 2>&1 &
  for _ in $(seq 1 60); do
    curl -sS -m 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break
    sleep 1
  done
  echo "Sign in to Shopify in that Chrome window (Google sign-in works there). The recorder waits for it."
}

record() {
  need node
  if [ "${1:-}" = "--from-chrome" ]; then shift; import_profile; fi
  if [ "${1:-}" = "--cdp" ]; then
    shift; start_cdp_chrome
    export MANNON_VIDEO_CDP=http://127.0.0.1:9222
  fi
  [ -d node_modules/playwright ] || npm install --no-audit --no-fund
  ls "$HOME/Library/Caches/ms-playwright" 2>/dev/null | grep -q '^ffmpeg' || npx playwright install ffmpeg
  node scripts/video/record.mjs "$@"
}

assemble() {
  need ffmpeg; need jq; need node
  mkdir -p "$CUT"
  node scripts/video/captions.mjs
  rm -f "$RAW"/page@*.webm
  : > "$CUT/list.txt"
  local count; count=$(jq '.scenes | length' "$SCENES")
  for ((i = 0; i < count; i++)); do
    local n slot nn raw vo capa capb
    n=$(jq -r ".scenes[$i].n" "$SCENES"); slot=$(jq -r ".scenes[$i].slot" "$SCENES")
    nn=$(printf "%02d" "$n")
    raw=$(ls "$RAW/$nn".* 2>/dev/null | head -1)
    vo="$VO/$nn.wav"; capa="$CUT/cap-$nn-a.png"; capb="$CUT/cap-$nn-b.png"
    [ -n "$raw" ] || { echo "scene $n: no clip in $RAW" >&2; exit 1; }
    [ -f "$vo" ] || { echo "scene $n: no voice in $VO (run normalise)" >&2; exit 1; }
    local swap; swap=$(awk "BEGIN{printf \"%.2f\", $slot*0.52}")
    # Captions are PNG pills overlaid at the bottom (60 px up), A until 52 % of the slot, then B.
    # The screencast only emits frames when the page changes, so a raw clip can
    # be shorter than its slot: tpad freezes its last frame to fill the slot,
    # apad fills the voice with silence, and -t cuts both at the slot exactly.
    ffmpeg -v error -y -i "$raw" -i "$vo" -i "$capa" -i "$capb" -t "$slot" \
      -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=$slot[base];[base][2:v]overlay=0:H-h-60:enable='lt(t,$swap)'[v1];[v1][3:v]overlay=0:H-h-60:enable='gte(t,$swap)'[v];[1:a]apad[a]" \
      -map "[v]" -map "[a]" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k "$CUT/$nn.mp4"
    echo "file '$nn.mp4'" >> "$CUT/list.txt"
    echo "scene $n: cut to ${slot}s"
  done
  ffmpeg -v error -y -f concat -safe 0 -i "$CUT/list.txt" -c:v copy -c:a aac -b:a 128k -movflags +faststart "$OUT"
  echo "wrote $OUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s)"
}

case "${1:-all}" in
  download) download ;;
  normalise|normalize) normalise ;;
  record) shift; record "$@" ;;
  profiles) profiles ;;
  import-profile) import_profile ;;
  assemble) assemble ;;
  all) download; normalise; record; assemble ;;
  *) echo "usage: $0 {download|normalise|record [--from-chrome] [N…]|profiles|import-profile|assemble|all}" >&2; exit 2 ;;
esac
