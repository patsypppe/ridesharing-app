#!/usr/bin/env bash
# Stages the Lambda layer and every service under backend/build/ so that
# Terraform's archive_file data sources can zip them. Run this before
# `terraform plan` or `terraform apply`:
#
#   backend/scripts/package.sh
#
# Layout produced (matches what Lambda expects at runtime):
#   build/layer/nodejs/{utils.js,package.json,node_modules}   -> /opt/nodejs/...
#   build/<service>/{handler.js,package.json,node_modules}    -> function root
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"
LAYER_SRC="$ROOT/shared/layers/common"
SERVICES=(user-service driver-service ride-service payment-service notification-service websocket-service)

install_prod_deps() {
  # --omit=dev keeps test tooling out of the deployed package.
  (cd "$1" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
}

rm -rf "$BUILD"
mkdir -p "$BUILD/layer/nodejs"

echo "==> layer"
install_prod_deps "$LAYER_SRC"
cp "$LAYER_SRC/utils.js" "$LAYER_SRC/package.json" "$BUILD/layer/nodejs/"
cp -R "$LAYER_SRC/node_modules" "$BUILD/layer/nodejs/node_modules"

for service in "${SERVICES[@]}"; do
  echo "==> $service"
  src="$ROOT/services/$service"
  dest="$BUILD/$service"
  install_prod_deps "$src"
  mkdir -p "$dest"
  cp "$src/handler.js" "$src/package.json" "$dest/"
  if [ -d "$src/node_modules" ]; then
    cp -R "$src/node_modules" "$dest/node_modules"
    # aws-sdk v2 ships in the layer; never bundle a second copy per function.
    rm -rf "$dest/node_modules/aws-sdk"
  fi
done

echo "==> staged under $BUILD"
du -sh "$BUILD"/* | sed 's#'"$BUILD"'/##'
