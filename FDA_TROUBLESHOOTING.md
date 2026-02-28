# Full Disk Access (FDA) Troubleshooting Guide

## Problem: App Scans Without Showing FDA Gate Modal

### Root Cause (Fixed)
The `StorageAnalyzer` component was using a local `startScan` function that directly sent IPC messages, bypassing the store's FDA-checking logic.

**Fix Applied:**
- `startScan` now calls `startStorageScan()` from the store which properly checks FDA status
- Local state syncs with global `storageState` to show/hide the FDA Gate Modal

---

## How FDA Flow Should Work

### 1. First Time User Clicks "Start Scan"
```
User clicks Start Scan
    ↓
startScan() calls startStorageScan() from store
    ↓
Store checks fdaStatus
    ↓
If FDA not checked before → runs checkFdaStatus() probe
    ↓
If FDA denied AND not dismissed → sets storageState = 'fda_gate'
    ↓
FDAGateModal appears (condition: storageState === 'fda_gate')
```

### 2. User Options in FDA Gate Modal
- **"Open System Settings"** → Opens Privacy & Security → Full Disk Access
  - App polls every 2s for permission change
  - Auto-starts scan when FDA granted
  - Times out after 12s with "Check Again" button
  
- **"Scan Without Full Access"** → Proceeds with limited scan
  - Skips protected folders (Mail, Safari, etc.)
  - Shows amber warning banner in UI

---

## Manual FDA Grant (If Modal Doesn't Appear)

### Method 1: Via System Settings
1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click the **+** button
3. Navigate to your app (e.g., `mac-optimizer.app` or Electron dev build)
4. Toggle it ON
5. Restart the app

### Method 2: Via Terminal (Advanced)
```bash
# For Electron dev builds, you may need to grant FDA to the Electron binary
# This is NOT recommended for production

# Check current FDA status for an app
tccutil reset All com.yourcompany.mac-optimizer

# Reset all FDA permissions (use with caution!)
tccutil reset All
```

### Method 3: Debug Mode
In development mode, a **"Reset FDA"** button appears in the header:
1. Click **"Reset FDA"** to reset the FDA state
2. Click **"Start Scan"** again
3. The FDA Gate Modal should appear

---

## Testing FDA Detection

### Check FDA Status via Console
Open DevTools in the Electron app (Cmd+Option+I) and run:
```javascript
// Check current FDA status
await window.electronAPI.checkFdaStatus()
// Returns: { granted: true/false, probePath: '...', confidence: 'high/low' }

// Reset FDA state for testing
useStore.setState({ fdaStatus: null, fdaDismissed: false, storageState: 'idle' })
```

### Test Without FDA
```javascript
// Simulate FDA denied
useStore.setState({ fdaStatus: 'denied', storageState: 'fda_gate' })
```

---

## Common Issues

### Issue: "Warning: Could not access" messages in terminal
**This is NORMAL!** These are expected when FDA is not granted. The Rust scanner gracefully handles permission errors and continues scanning accessible paths.

### Issue: FDA Gate Modal doesn't appear
**Check:**
1. Is `storageState === 'fda_gate'`? Check via DevTools console
2. Is `fdaStatus` null or 'denied'?
3. Is `fdaDismissed` false?

**Fix:**
```javascript
// Force FDA gate to show
useStore.setState({ 
    fdaStatus: 'denied', 
    fdaDismissed: false, 
    storageState: 'fda_gate' 
})
```

### Issue: Scan starts but shows no/few items
The scan may be working but only accessing files without FDA protection. Check:
- Are you scanning from `/` (root) or just your home directory?
- The "Limited scan" warning banner should appear if FDA is missing

### Issue: Memory error (OOM) during scan
The previous scan encountered:
```
ERROR:electron/shell/common/node_bindings.cc:185] OOM error in V8: 
Ineffective mark-compacts near heap limit Allocation failed 
```

**Fix:** The scan accumulates too many items in memory. Consider:
1. Scanning a smaller directory first (e.g., `/Users/$USER` instead of `/`)
2. Implementing pagination in the item list
3. Increasing Node.js memory limit:
   ```bash
   export NODE_OPTIONS="--max-old-space-size=8192"
   npm run dev
   ```

---

## Expected Behavior Summary

| FDA Status | User Action | Result |
|------------|-------------|--------|
| Not checked | Click "Start Scan" | FDA Gate Modal appears |
| Denied | Click "Open System Settings" | Opens System Settings, polls for change |
| Denied | Click "Scan Without Full Access" | Limited scan with warning banner |
| Granted | Click "Start Scan" | Full scan of entire filesystem |
| Granted | Scan in progress | All accessible files indexed |

---

## Quick Commands

```bash
# Restart the app with fresh state
npm run dev

# Build for testing
npm run build

# Run CLI scan (bypasses FDA check in terminal)
./bin/mac-optimizer-core scan /Users/$USER
```
