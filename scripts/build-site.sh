#!/usr/bin/env bash
# Assembles the one static site the Worker serves:
#   /        landing (private repo, built separately; LANDING_DIR points at its checkout)
#   /app/    the app (this repo)
#   /docs/   the docs (this repo)
# plus security headers and redirects. Usage:
#   VITE_DOMAIN=<domain> [LANDING_DIR=../zecdoor-landing] ./scripts/build-site.sh
# Without a landing build, the first-deploy static page is used at /.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${VITE_DOMAIN:?Set VITE_DOMAIN to the production domain}"
LANDING_DIR="${LANDING_DIR:-$ROOT/../zecdoor-landing}"
# The public repository (e.g. https://github.com/ZecDoor/zecdoor). Leave unset until the GitHub
# organisation exists: every source and contact link then reads "Code goes public under the MIT
# licence at launch" instead of pointing at a page that does not exist, and no security.txt is
# served (its contacts live on GitHub).
SOURCE_URL="${SOURCE_URL:-}"
export NEXT_PUBLIC_SOURCE_URL="$SOURCE_URL" VITE_SOURCE_URL="$SOURCE_URL"

pnpm --dir "$ROOT" check:allowlist
LANDING_DIR="$LANDING_DIR" pnpm --dir "$ROOT" check:copy   # text and images (OCR), landing included
pnpm --dir "$ROOT/apps/app" exec tsc --noEmit
# Moves and buys stay closed (no transaction can be signed) unless VITE_MOVES_OPEN=1 is set on
# purpose, after the mainnet test runs (B1, B7) have passed. See apps/app/src/config.ts.
if [[ "${VITE_MOVES_OPEN:-}" == "1" ]]; then echo ">>> Moves and buys: OPEN in this build"; else echo ">>> Moves and buys: closed (opening soon)"; fi
pnpm --dir "$ROOT/apps/app" exec vite build
pnpm --dir "$ROOT/apps/docs" build

OUT="$ROOT/dist/site"
rm -rf "$OUT"
mkdir -p "$OUT"
if [[ -d "$LANDING_DIR" ]]; then
  (cd "$LANDING_DIR" && pnpm build)
  cp -R "$LANDING_DIR/out/." "$OUT/"
else
  echo "No landing at $LANDING_DIR; using the first-deploy page."
  cp -R "$ROOT/deploy/first-deploy/public/." "$OUT/"
  rm -f "$OUT/terms.html" "$OUT/privacy.html"
fi
if [[ -n "$SOURCE_URL" ]]; then
  mkdir -p "$OUT/.well-known"
  sed "s#https://github.com/ZecDoor/zecdoor#$SOURCE_URL#g" "$ROOT/deploy/first-deploy/public/.well-known/security.txt" > "$OUT/.well-known/security.txt"
fi
cp "$ROOT/deploy/site/_headers" "$OUT/_headers"
cp "$ROOT/deploy/site/_redirects" "$OUT/_redirects"
cp "$ROOT/deploy/site/robots.txt" "$OUT/robots.txt"
cp -R "$ROOT/apps/app/dist" "$OUT/app"
cp -R "$ROOT/apps/docs/out" "$OUT/docs"
find "$OUT" -name '*.map' -delete   # the source is public anyway; keep the deploy small
if [[ "${PREVIEW:-}" == "1" ]]; then
  printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
  # Preview builds must not be indexed by search engines.
  python3 - "$OUT/_headers" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("/*\n", "/*\n  X-Robots-Tag: noindex, nofollow\n", 1)
open(p, "w").write(s)
PY
fi
if [[ -f "$OUT/.well-known/security.txt" ]]; then
  sed -i.bak "s/\[DOMAIN\]/$VITE_DOMAIN/g" "$OUT/.well-known/security.txt" && rm -f "$OUT/.well-known/security.txt.bak"
fi
echo "Source links: $([[ -n "$SOURCE_URL" ]] && echo "$SOURCE_URL" || echo 'pending (Code goes public under the MIT licence at launch)')"
echo "Moves and buys: $([[ "${VITE_MOVES_OPEN:-}" == "1" ]] && echo OPEN || echo closed)"
echo "Site in $OUT ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files)"
