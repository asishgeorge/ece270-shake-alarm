#!/bin/bash
# One-time setup of a permanent Node-RED for demos and class (macOS or Linux, using nvm).
#   - Node.js LTS (major version below), installed through nvm WITHOUT changing your default Node
#   - Node-RED and Dashboard 2.0 at the versions this project was tested with
#   - Node-RED data in ~/.node-red, editor and dashboards on THIS computer only (127.0.0.1)
# Safe to run again. Then: local/node-red.sh start, and: cd tools && npm run deploy-demo
set -euo pipefail

NODE_MAJOR=26                  # current LTS ("Lithium") on 2026-11-04
NODE_RED_VERSION=5.0.9
DASHBOARD_VERSION=1.35.0
USER_DIR="$HOME/.node-red"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found. Install it from https://github.com/nvm-sh/nvm, or install Node.js $NODE_MAJOR LTS from nodejs.org and follow the README instead."
  exit 1
fi
. "$NVM_DIR/nvm.sh"

echo "== Node.js $NODE_MAJOR (LTS)"
PREV_DEFAULT="$(nvm version default 2>/dev/null || true)"
nvm install "$NODE_MAJOR" >/dev/null 2>&1 || { echo "nvm could not install Node $NODE_MAJOR"; exit 1; }
# If the default alias was "node" (= newest installed), installing would silently change it: put it back.
if [ -n "$PREV_DEFAULT" ] && [ "$PREV_DEFAULT" != "N/A" ] && [ "$(nvm version default)" != "$PREV_DEFAULT" ]; then
  nvm alias default "$PREV_DEFAULT" >/dev/null
fi
nvm use "$NODE_MAJOR" >/dev/null
echo "   Node-RED will use $(node -v); your default Node stays $(nvm version default)"

echo "== Node-RED $NODE_RED_VERSION"
if [ "$(node-red --version 2>/dev/null | grep -o 'v[0-9.]*' | head -1)" != "v$NODE_RED_VERSION" ]; then
  npm install -g --no-fund --no-audit "node-red@$NODE_RED_VERSION" >/dev/null
fi
NR_DIR="$(npm root -g)/node-red"
echo "   installed at $NR_DIR"

echo "== Node-RED data folder $USER_DIR"
mkdir -p "$USER_DIR"
if [ ! -f "$USER_DIR/package.json" ]; then
  printf '{\n  "name": "node-red-project",\n  "description": "A Node-RED Project",\n  "version": "0.0.1",\n  "private": true,\n  "dependencies": {}\n}\n' > "$USER_DIR/package.json"
fi

echo "== Dashboard 2.0 $DASHBOARD_VERSION"
(cd "$USER_DIR" && npm install --no-fund --no-audit "@flowfuse/node-red-dashboard@$DASHBOARD_VERSION" >/dev/null)

echo "== Settings: editor and dashboards only reachable from this computer"
# By default Node-RED listens on every network interface, so anyone on the same Wi-Fi could open
# the editor and run code on this laptop. uiHost 127.0.0.1 keeps it local.
if [ ! -f "$USER_DIR/settings.js" ]; then
  cp "$NR_DIR/settings.js" "$USER_DIR/settings.js"
fi
if grep -q '^\s*uiHost:' "$USER_DIR/settings.js"; then
  echo "   uiHost already set"
else
  perl -0pi -e 's#//\s*uiHost:\s*"127\.0\.0\.1",#uiHost: "127.0.0.1",#' "$USER_DIR/settings.js"
  grep -q '^\s*uiHost: "127.0.0.1",' "$USER_DIR/settings.js" && echo "   uiHost set to 127.0.0.1" || echo "   WARNING: could not set uiHost; edit $USER_DIR/settings.js by hand"
fi

echo
echo "Done. Next:"
echo "  local/node-red.sh start          # runs Node-RED in the background"
echo "  cd tools && npm run deploy-demo  # loads the student solution + class console with the passwords from .env.local"
