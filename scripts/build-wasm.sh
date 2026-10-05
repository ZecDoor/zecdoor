#!/usr/bin/env bash
# Builds crates/zecdoor-wasm for the browser (wasm-pack, target web).
#
# One C dependency (secp256k1-sys, pulled in through zcash_client_backend) needs a
# clang that can target wasm32. Apple's clang cannot, so on macOS this script uses
# wasi-sdk's clang (downloaded once into ~/.cache/zecdoor). On Linux, the system
# clang works. Override with CC_wasm32_unknown_unknown / AR_wasm32_unknown_unknown.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/crates/zecdoor-wasm"
WASI_VERSION="34.0"

if [[ -z "${CC_wasm32_unknown_unknown:-}" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    ARCH="$(uname -m)"; [[ "$ARCH" == "aarch64" ]] && ARCH="arm64"
    SDK="$HOME/.cache/zecdoor/wasi-sdk-${WASI_VERSION}-${ARCH}-macos"
    if [[ ! -x "$SDK/bin/clang" ]]; then
      mkdir -p "$HOME/.cache/zecdoor"
      URL="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_VERSION%%.*}/wasi-sdk-${WASI_VERSION}-${ARCH}-macos.tar.gz"
      echo "Downloading wasi-sdk ${WASI_VERSION} from $URL"
      curl -fsSL "$URL" | tar -xz -C "$HOME/.cache/zecdoor"
    fi
    export CC_wasm32_unknown_unknown="$SDK/bin/clang"
    export AR_wasm32_unknown_unknown="$SDK/bin/llvm-ar"
  else
    export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
    export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-llvm-ar}"
  fi
fi

cd "$CRATE"
npx -y wasm-pack@0.13.1 build --release --target web --out-dir pkg --out-name zecdoor_wasm
WASM="$CRATE/pkg/zecdoor_wasm_bg.wasm"
echo "Built $WASM: $(wc -c <"$WASM") bytes raw, $(gzip -9c "$WASM" | wc -c) bytes gzip"
