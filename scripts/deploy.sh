#!/usr/bin/env bash
# Deploys dist/site with the Worker, refusing a build that does not belong where it is going:
#   ./scripts/deploy.sh production   # zecdoor.0xo.in: must be a non-preview build, from a clean commit
#   ./scripts/deploy.sh preview      # the private preview Worker: must be a PREVIEW=1 build
# Moves stay closed unless the build opened them AND OPEN_MOVES=yes is given here as well.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?production or preview}"
B="$ROOT/dist/site/build.json"
[[ -f "$B" ]] || { echo "No $B: run scripts/build-site.sh first." >&2; exit 1; }
field() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$B','utf8'))['$1']))"; }
PREVIEW="$(field preview)"; MOVES="$(field moves)"; DIRTY="$(field dirty)"; COMMIT="$(field commit)"
echo "Build: commit $COMMIT, dirty=$DIRTY, preview=$PREVIEW, moves=$MOVES"
case "$TARGET" in
  production)
    [[ "$PREVIEW" == "false" ]] || { echo "Refusing: this is a preview build (noindex). Rebuild without PREVIEW." >&2; exit 1; }
    [[ "$DIRTY" == "false" ]] || { echo "Refusing: built from uncommitted changes; build.json would not match a public commit." >&2; exit 1; }
    if [[ "$MOVES" == "open" && "${OPEN_MOVES:-}" != "yes" ]]; then echo "Refusing: moves are open in this build; set OPEN_MOVES=yes only after B1/B7 passed and it was agreed." >&2; exit 1; fi
    git -C "$ROOT" merge-base --is-ancestor "$COMMIT" origin/main 2>/dev/null || { echo "Refusing: commit $COMMIT is not on origin/main (push it first)." >&2; exit 1; }
    (cd "$ROOT/apps/server" && npx -y wrangler@4.147.0 deploy) ;;
  preview)
    [[ "$PREVIEW" == "true" ]] || { echo "Refusing: not a preview build. Rebuild with PREVIEW=1." >&2; exit 1; }
    (cd "$ROOT/apps/server" && npx -y wrangler@4.147.0 deploy --env preview) ;;
  *) echo "production or preview" >&2; exit 1 ;;
esac
