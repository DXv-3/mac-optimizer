# macOS System Optimization Application

A premium macOS-native system optimization application built with React, Electron, and Rust/Native modules.

## Project Overview

This application provides comprehensive macOS system transparency and optimization, including:
- Filesystem scanning and analysis
- Storage management and cleanup
- Cache management
- Real-time system health monitoring

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Desktop Shell**: Electron 40
- **Backend**: Node.js with Python agents
- **Native Modules**: Rust (NAPI bindings)
- **State Management**: Zustand
- **Animation**: Framer Motion
- **Styling**: Tailwind CSS

## Code Style

- Use async/await patterns exclusively - no blocking operations
- Follow macOS Human Interface Guidelines for all UI
- Implement Framer Motion animations with 200-300ms duration
- Use custom Webkit scrollbars per macOS conventions

## Architecture

### Main Process
- Worker threads for CPU-intensive tasks
- IPC batching with 150ms intervals
- Proper context isolation with preload scripts

### Renderer Process
- React components with Framer Motion
- Custom glassmorphism effects using vibrancy
- Proper route transitions with AnimatePresence

## Available Skills

- **glassmorphism**: Electron vibrancy effects and CSS backdrop-filter
- **ipc-batching**: Worker thread architecture and memory management
- **react-framer-routing**: Route animations with proper key management

## Custom Modes

Switch to these modes based on your task:
- **MacUXArchitect**: UI/UX development for macOS-native React apps
- **SystemsEngine**: Electron backend and native module development

## AI Guardrails / Hard Rules

- **NEVER use `sudo npm` or `sudo node`**. Running npm as root corrupts the ownership of `node_modules` and `~/.npm`, causing unrecoverable `EPERM` issues during the build process.
- **EPERM Recovery**: If EPERM issues happen, do not attempt to fix them with `sudo rm`. Instead, run `npm run fix` which will execute the project's native recovery script (`fix-permissions.sh`).

---

## Phase Status

### Phase 5: Animations & Polish ✅ COMPLETE

- Vibrancy & Frameless UI: Electron `BrowserWindow` configured with `vibrancy: 'under-window'`, `visualEffectState: 'followWindow'`, and `titleBarStyle: 'hiddenInset'`
- macOS Native Storage Bar: Beautiful horizontally stacked, animated progress bar mirroring macOS System Settings
- Full Disk Categorization Engine: Maps paths across entire disk to Apple's standard buckets (System Data, Applications, Music & Movies, Documents, Developer, App Data, Photos, Mail & Messages)
- Framer Motion animations at 60fps with proper spring physics

### Phase 6: Terminal Clean TUI & CLI Packaging 🚧 IN PROGRESS

**Completed:**
- CLI wrapper at `cli/bin/cli.js` - Node.js wrapper for Rust binary
- TUI foundation at `cli/tui/index.js` - Ink-based React terminal interface
- Command routing for: scan, clean, brew-clean, npm-clean, tree, dupes, report, tui

**Next Steps:**
- Install Ink dependencies in CLI package
- Implement full TUI screens (Scan view, Clean view, Report view)
- Add real-time scan progress in TUI
- Package CLI as global npm package
- Sign and notarize binaries for distribution

---

## Storage Analyzer Data Pipeline

### IPC Event Flow
```
Rust Core (mac-optimizer-core)
    ↓ NDJSON on stdout
Electron main.cjs (readline)
    ↓ Transform + Batch (60fps)
storage-scan-event IPC
    ↓
StorageAnalyzer.jsx (useEffect listener)
    ↓
Categorization Engine → React State → UI
```

### Key Implementation Details
- **Event Name**: `storage-scan-event` (unified across main.cjs, preload.cjs, and StorageAnalyzer)
- **Data Transform**: Rust `FsItem` → Frontend `{id, name, path, sizeBytes, sizeFormatted, category, risk, ...}`
- **Batching**: 60fps flush loop in main.cjs with 16ms intervals
- **Categorization**: Path-based heuristics mapping to Apple-style storage categories
- **Progress Tracking**: `ScanProgress` component integrated during scan state showing files processed, bytes scanned, scan rate, and action log

---

## Full Disk Access (FDA) Flow

1. User clicks "Start Scan" in StorageAnalyzer
2. `startScan` → `startStorageScan` (from useStore)
3. Store checks `fdaStatus` - if null or 'denied' and not dismissed
4. Store sets `storageState: 'fda_gate'`
5. `FDAGateModal` appears (condition: `storageState === 'fda_gate'`)
6. User can:
   - Click "Open System Settings" → polls for FDA every 2s → auto-starts scan when granted
   - Click "Scan Without Full Access" → proceeds with limited scan
7. If FDA granted, scan proceeds with full filesystem access
8. If FDA denied/dismissed, scan proceeds but skips protected folders (shows amber warning banner)
