# syntax=docker/dockerfile:1
#
# Shared tool image for building a worktree's ignored WASM artifacts. Source,
# output, and Cargo target/cache volumes are mounted by Compose at runtime.
FROM node:22-bookworm-slim AS node

FROM rust:1.93.1-bookworm

COPY --from=node /usr/local/ /usr/local/

ARG TARGETARCH
ARG WASM_PACK_VERSION=0.14.0

RUN rustup target add wasm32-unknown-unknown \
    && case "$TARGETARCH" in \
        amd64) \
          target="x86_64-unknown-linux-musl"; \
          sha256="278a8d668085821f4d1a637bd864f1713f872b0ae3a118c77562a308c0abfe8d" \
          ;; \
        arm64) \
          target="aarch64-unknown-linux-musl"; \
          sha256="5941c7b05060440ff37ee50fe9009a408e63fa5ba607a3b0736f5a887ec5f2ca" \
          ;; \
        *) echo "Unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
      esac \
    && archive="wasm-pack-v${WASM_PACK_VERSION}-${target}.tar.gz" \
    && url="https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/${archive}" \
    && curl --fail --location --silent --show-error "$url" --output "/tmp/$archive" \
    && echo "$sha256  /tmp/$archive" | sha256sum --check - \
    && tar --extract --gzip --file "/tmp/$archive" --directory /tmp \
    && install -m 0755 "/tmp/wasm-pack-v${WASM_PACK_VERSION}-${target}/wasm-pack" /usr/local/bin/wasm-pack \
    && rm -rf "/tmp/$archive" "/tmp/wasm-pack-v${WASM_PACK_VERSION}-${target}"

WORKDIR /workspace

CMD ["node", "--experimental-strip-types", "scripts/build-wasm.ts"]
