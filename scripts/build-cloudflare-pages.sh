#!/usr/bin/env bash
set -euo pipefail

readonly target="${1:?usage: build-cloudflare-pages.sh {editor|website}}"

case "$target" in
  editor | website) ;;
  *)
    echo "Unknown Cloudflare Pages target: $target" >&2
    exit 2
    ;;
esac

: "${VITE_VIRITURA_ASSET_BASE_URL:?Set VITE_VIRITURA_ASSET_BASE_URL to the R2 custom domain}"
: "${VITE_VIRITURA_API_BASE_URL:?Set VITE_VIRITURA_API_BASE_URL to the public API origin}"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack --version 0.14.0 --locked
fi

export VIRITURA_EXTERNAL_SOUNDFONT=true
pnpm wasm:build

if [[ "$target" == editor ]]; then
  pnpm --filter @viritura/editor build
else
  pnpm build:site
fi
