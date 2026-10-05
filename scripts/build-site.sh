#!/usr/bin/env bash
# Assembles the one static site the Worker serves: landing at /, app at /app/, legal pages,
# and the security headers. Usage: VITE_DOMAIN=<domain> ./scripts/build-site.sh
# The landing (B6) replaces deploy/first-deploy/public when it is ready.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${VITE_DOMAIN:?Set VITE_DOMAIN to the production domain}"

pnpm --dir "$ROOT" check:allowlist
pnpm --dir "$ROOT/apps/app" exec tsc --noEmit
pnpm --dir "$ROOT/apps/app" exec vite build

OUT="$ROOT/dist/site"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$ROOT/deploy/first-deploy/public/." "$OUT/"
rm -f "$OUT/_headers"
cp "$ROOT/deploy/site/_headers" "$OUT/_headers"
cp -R "$ROOT/apps/app/dist" "$OUT/app"
find "$OUT" -name '*.map' -delete   # source is public anyway; keep the deploy small
sed -i.bak "s/\[DOMAIN\]/$VITE_DOMAIN/g" "$OUT/.well-known/security.txt" && rm -f "$OUT/.well-known/security.txt.bak"
echo "Site in $OUT ($(du -sh "$OUT" | cut -f1))"
