#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# fix-permissions.sh
# One-shot EPERM recovery for the mac-optimizer project.
#
# Run this ONCE whenever you encounter EPERM errors from npm/node:
#   chmod +x fix-permissions.sh && sudo ./fix-permissions.sh
#
# What it does:
#   1. Resets ownership of node_modules and npm caches to the current user
#   2. Fixes global npm prefix ownership (the #1 cause of future EPERMs)
#   3. Verifies Node.js can now lstat node_modules cleanly
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_USER="${SUDO_USER:-$(whoami)}"
CURRENT_GROUP=$(id -gn "$CURRENT_USER")

echo "🔧  Fixing permissions for user: $CURRENT_USER ($CURRENT_GROUP)"
echo "📁  Project: $APP_DIR"
echo ""

# ── 1. Fix local project directories ─────────────────────────────────────────
for DIR in \
    "$APP_DIR/node_modules" \
    "$APP_DIR/dist" \
    "$APP_DIR/dist-electron" \
    "$APP_DIR/.npm-cache" \
    "$APP_DIR/package-lock.json"; do
    if [ -e "$DIR" ]; then
        echo "  ✅  chown $CURRENT_USER:$CURRENT_GROUP $DIR"
        chown -R "$CURRENT_USER:$CURRENT_GROUP" "$DIR"
    fi
done

# ── 2. Fix user-level npm cache (~/.npm) ──────────────────────────────────────
USER_HOME=$(eval echo "~$CURRENT_USER")
if [ -d "$USER_HOME/.npm" ]; then
    echo "  ✅  chown $CURRENT_USER:$CURRENT_GROUP $USER_HOME/.npm"
    chown -R "$CURRENT_USER:$CURRENT_GROUP" "$USER_HOME/.npm"
fi

# ── 3. Fix npm global prefix (prevents future EPERMs from global installs) ────
NPM_PREFIX=$(su - "$CURRENT_USER" -c 'npm config get prefix' 2>/dev/null || true)
if [ -n "$NPM_PREFIX" ] && [ "$NPM_PREFIX" != "/usr/local" ] && [ "$NPM_PREFIX" != "/usr" ]; then
    echo "  ✅  chown $CURRENT_USER:$CURRENT_GROUP $NPM_PREFIX"
    chown -R "$CURRENT_USER:$CURRENT_GROUP" "$NPM_PREFIX" 2>/dev/null || true
fi

# ── 4. Smoke test ─────────────────────────────────────────────────────────────
echo ""
echo "🧪  Running smoke test (node lstat on node_modules)..."
if su - "$CURRENT_USER" -c "node -e \"require('fs').realpathSync('$APP_DIR/node_modules')\"" 2>/dev/null; then
    echo "  ✅  node_modules is now accessible to $CURRENT_USER"
else
    echo "  ⚠️  node_modules doesn't exist yet — run 'npm install' to create it"
fi

echo ""
echo "🎉  Permissions fixed! You can now run 'npm install && npm run dev' as a normal user."
echo "    You should NEVER need to use 'sudo npm ...' again."
