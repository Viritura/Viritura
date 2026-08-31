#!/usr/bin/env sh
# The dev image already bakes a complete, hoisted node_modules, and Docker seeds
# the per-worktree volume from it on first `up`, so there is nothing to install
# here — just start the dev server. When dependencies change on the host, run
# `infra/dev/worktree.ps1 rebuild` to rebuild the image and re-seed the volume.
set -e

echo "[viritura-dev] starting: $*"
exec "$@"
