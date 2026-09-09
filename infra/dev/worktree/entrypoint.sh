#!/usr/bin/env sh
# The dev image already bakes a complete node_modules tree, and Docker seeds
# content-addressed shared volumes from it, so there is nothing to install here.
# A dependency-manifest change automatically selects a new image and volume set.
set -e

echo "[viritura-dev] starting: $*"
exec "$@"
