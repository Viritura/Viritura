# syntax=docker/dockerfile:1
#
# Development image for parallel Git-worktree runs. It is NOT a production
# artifact: it only bakes a warm `node_modules` so a worktree's Vite dev server
# starts quickly. At runtime the worktree source is bind-mounted over /workspace
# and a named volume (seeded from this layer on first `up`) shadows the ROOT
# /workspace/node_modules — see ../worktree/docker-compose.yml.
#
# The install uses pnpm's default (isolated) linker, exactly like the host. That
# is deliberate: at runtime the bind mount still exposes the host's per-package
# packages/*/node_modules, whose symlinks are RELATIVE and point back into the
# root node_modules/.pnpm virtual store. Because this image installs from the
# same pnpm version, lockfile and .npmrc as the host, the virtual-store
# directory names are identical, so those host symlinks resolve cleanly into the
# seeded volume. --ignore-scripts skips the git-hook `prepare` step and any
# postinstall; Vite 8 (Rolldown/Oxc) and esbuild ship platform binaries via
# optional deps, so nothing native is lost. This mirrors server/Dockerfile.
#
# The root ignore file retains all workspace manifests while excluding source
# trees not needed for dependency installation. Runtime source, generated WASM,
# and engine files arrive through the bind mount.
FROM node:22-bookworm-slim AS dev

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/editor/package.json ./apps/editor/package.json
COPY apps/server-ui/package.json ./apps/server-ui/package.json
COPY apps/vscode-mnx-viewer/package.json ./apps/vscode-mnx-viewer/package.json
COPY apps/website/package.json ./apps/website/package.json
COPY examples/score-viewer-react-minimal/package.json ./examples/score-viewer-react-minimal/package.json
COPY packages/audio/package.json ./packages/audio/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/crdt/package.json ./packages/crdt/package.json
COPY packages/format/package.json ./packages/format/package.json
COPY packages/instrument-profiles/package.json ./packages/instrument-profiles/package.json
COPY packages/midi/package.json ./packages/midi/package.json
COPY packages/musicxml/package.json ./packages/musicxml/package.json
COPY packages/piano-roll/package.json ./packages/piano-roll/package.json
COPY packages/playback/package.json ./packages/playback/package.json
COPY packages/renderer/package.json ./packages/renderer/package.json
COPY packages/score-engine/package.json ./packages/score-engine/package.json
COPY packages/score-viewer-react/package.json ./packages/score-viewer-react/package.json
COPY packages/sound-profiles/package.json ./packages/sound-profiles/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/video-sync/package.json ./packages/video-sync/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

# Vite and Storybook servers. Never published to the host; Traefik reaches them
# over the shared proxy network.
EXPOSE 5173 5180 6005 6006 6007
