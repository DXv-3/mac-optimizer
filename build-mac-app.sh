#!/bin/bash

# Build script for macOS native app with Full Disk Access support

set -e

echo "🔨 Building Mac Optimizer native app..."

# 1. Build the frontend
echo "📦 Building frontend..."
npm run build

# 2. Build the Rust core
echo "⚙️  Building Rust core..."
./build-rust-core.sh

# 3. Build the Electron app
echo "🖥️  Building Electron app..."
npx electron-builder --mac --publish=never

echo "✅ Build complete!"
echo ""
echo "📍 App location: dist-electron/mac-optimizer-*.dmg"
echo ""
echo "⚠️  IMPORTANT: For Full Disk Access to work properly:"
echo "   1. The app must be code-signed (use your Apple Developer ID)"
echo "   2. User must grant FDA in System Settings after first launch"
echo "   3. For development, you can grant FDA to the Electron binary:"
echo "      System Settings → Privacy & Security → Full Disk Access → +"
echo "      Select: node_modules/electron/dist/Electron.app"
