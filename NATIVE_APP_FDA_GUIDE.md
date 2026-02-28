# Native macOS App - Full Disk Access Guide

## For Native macOS Apps (Electron)

Unlike web apps, native macOS apps require **code signing** and **entitlements** for Full Disk Access (FDA).

---

## Quick Fix for Development

### Option 1: Grant FDA to Electron Binary (Fastest)
1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click the **+** button
3. Navigate to:
   ```
   /Users/vinnygilberti/Desktop/home indexing/mac-optimizer/node_modules/electron/dist/Electron.app
   ```
4. Click **Open**
5. Toggle it **ON**
6. **Restart** `npm run dev`

### Option 2: Grant FDA to VS Code Terminal (If running from VS Code)
If you're launching the app from VS Code's integrated terminal:
1. Add **Visual Studio Code.app** to Full Disk Access
2. Or use the standalone Terminal app instead

---

## Building a Signed Native App

### Prerequisites
- Apple Developer Account ($99/year)
- Xcode Command Line Tools: `xcode-select --install`
- Code signing certificates installed

### 1. Configure Signing
Create `build/entitlements.mac.plist` (already done):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.app-sandbox</key>
    <false/>
</dict>
</plist>
```

### 2. Build the App
```bash
# Build everything
./build-mac-app.sh

# Or manually:
npm run build
npx electron-builder --mac
```

### 3. Notarization (Required for distribution)
```bash
# Set up notarization credentials
export APPLE_ID="your-email@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"

# Build with notarization
npx electron-builder --mac --publish=always
```

---

## How FDA Works in Native Apps

### First Launch
1. App attempts to scan a TCC-protected path (e.g., `~/Library/Safari/History.db`)
2. macOS blocks access and **silently** records the attempt
3. App detects no FDA via `checkFdaStatus()`
4. App shows FDA Gate Modal
5. User clicks "Open System Settings"
6. User manually adds app to FDA list
7. User returns to app - FDA detection updates automatically

### Code Signing Requirement
- **Unsigned apps**: FDA prompt may not appear; user must manually add in Settings
- **Signed apps**: macOS shows native permission dialog on first access attempt
- **App Store**: FDA not allowed for App Store apps (use Sandbox-friendly APIs instead)

---

## Troubleshooting

### "The application cannot be opened" or Gatekeeper blocks
```bash
# Remove quarantine attribute
xattr -rd com.apple.quarantine /path/to/Mac\ Optimizer.app

# Or allow in System Settings → Privacy & Security → Security
```

### FDA not detected after granting
1. **Fully quit** the app (Cmd+Q, not just close window)
2. Reopen the app
3. FDA status is checked on app launch

### Rust binary lacks permissions
The Rust binary (`bin/mac-optimizer-core`) runs as a child process and inherits the parent's FDA status. No separate entitlements needed.

### Console errors about TCC
These are normal for development:
```
Warning: Could not access /Users/.../Library/Safari/History.db
```
The app gracefully handles permission errors.

---

## Testing FDA Flow

### Test 1: Fresh Install Simulation
```bash
# Reset FDA for your app
tccutil reset All com.yourcompany.mac-optimizer

# Reset app state
rm -rf ~/Library/Application\ Support/mac-optimizer

# Relaunch app
npm run dev
```

### Test 2: Check FDA Status
In DevTools console:
```javascript
await window.electronAPI.checkFdaStatus()
// { granted: false, probePath: '...', confidence: 'high' }
```

### Test 3: Trigger Native Prompt
```javascript
await window.electronAPI.requestFdaNative()
// Should show system permission dialog (if app is signed)
```

---

## Distribution Checklist

- [ ] Code signed with Developer ID
- [ ] Notarized by Apple
- [ ] Entitlements properly configured
- [ ] FDA instructions in README
- [ ] Tested on clean macOS install

---

## References

- [Apple TCC Documentation](https://developer.apple.com/documentation/tcc)
- [Electron macOS Code Signing](https://www.electron.build/code-signing)
- [Electron Notarization Guide](https://github.com/electron/notarize)
