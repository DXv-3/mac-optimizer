#!/bin/bash
# launch.sh — start Vite + Electron without npm (bypasses node_modules EPERM)

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

export VITE_DEV_SERVER_URL="http://localhost:5173"
export PYTHONUNBUFFERED=1
unset ELECTRON_RUN_AS_NODE

# Kill leftovers
pkill -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null
pkill -f "vite/bin/vite.js" 2>/dev/null
sleep 0.5

echo "▶ Starting Vite..."
# cd INTO the vite package so Node's realpathSync never has to lstat node_modules from above
cd "$APP_DIR/node_modules/vite" && node bin/vite.js --root "$APP_DIR" --host 127.0.0.1 &
VITE_PID=$!
cd "$APP_DIR"

# Wait for port 5173
echo "⏳ Waiting for Vite..."
for i in $(seq 1 40); do
    nc -z 127.0.0.1 5173 2>/dev/null && break
    sleep 0.5
done

echo "▶ Launching Electron..."
"$ELECTRON" "$APP_DIR"

# Cleanup
kill $VITE_PID 2>/dev/null
