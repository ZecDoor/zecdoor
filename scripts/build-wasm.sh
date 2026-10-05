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

# Reproducible output: no absolute path of this machine (checkout, cargo registry, toolchain) ends up in
# the binary, so anyone building the same commit gets the same .wasm (README, "Verify the build").
CARGO_DIR="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$CARGO_DIR=/cargo --remap-path-prefix=$RUSTUP_DIR=/rustup --remap-path-prefix=$ROOT=/zecdoor"
export CFLAGS_wasm32_unknown_unknown="${CFLAGS_wasm32_unknown_unknown:-} -ffile-prefix-map=$CARGO_DIR=/cargo -ffile-prefix-map=$ROOT=/zecdoor -ffile-prefix-map=$HOME=/home"

cd "$CRATE"
npx -y wasm-pack@0.13.1 build --release --target web --out-dir pkg --out-name zecdoor_wasm
WASM="$CRATE/pkg/zecdoor_wasm_bg.wasm"
echo "Built $WASM: $(wc -c <"$WASM") bytes raw, $(gzip -9c "$WASM" | wc -c) bytes gzip"
