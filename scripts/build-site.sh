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

pnpm --dir "$ROOT" check:allowlist
pnpm --dir "$ROOT/apps/app" exec tsc --noEmit
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
mkdir -p "$OUT/.well-known"
cp "$ROOT/deploy/first-deploy/public/.well-known/security.txt" "$OUT/.well-known/security.txt"
cp "$ROOT/deploy/site/_headers" "$OUT/_headers"
cp "$ROOT/deploy/site/_redirects" "$OUT/_redirects"
cp -R "$ROOT/apps/app/dist" "$OUT/app"
cp -R "$ROOT/apps/docs/out" "$OUT/docs"
find "$OUT" -name '*.map' -delete   # the source is public anyway; keep the deploy small
sed -i.bak "s/\[DOMAIN\]/$VITE_DOMAIN/g" "$OUT/.well-known/security.txt" && rm -f "$OUT/.well-known/security.txt.bak"
echo "Site in $OUT ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files)"
