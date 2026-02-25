const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const { exec } = require('node:child_process');
const util = require('node:util');

const execAsync = util.promisify(exec);

process.env.APP_ROOT = path.join(__dirname, '..');

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win;

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 1: Native macOS Compositor - Glass Window with Vibrancy
// ═══════════════════════════════════════════════════════════════════════════════

function createWindow() {
    win = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        // Standard frame for stability, styled with vibrancy in CSS
        frame: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            sandbox: false,
            contextIsolation: true
        },
    });

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(RENDERER_DIST, 'index.html'));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Window Controls IPC
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('window-minimize', () => {
    if (win) win.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (win) {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    }
});

ipcMain.handle('window-close', () => {
    if (win) win.close();
});

ipcMain.handle('window-is-maximized', () => {
    return win ? win.isMaximized() : false;
});

// ═══════════════════════════════════════════════════════════════════════════════
// App Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.whenReady().then(createWindow);

// ═══════════════════════════════════════════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('scan-system-junk', async (event, args) => {
    try {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'sys_purge_inquisitor.py');
        const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
            timeout: 120000,
            maxBuffer: 50 * 1024 * 1024
        });
        if (stderr && !stderr.includes('Error')) {
            console.warn("Python Stderr:", stderr);
        }
        return JSON.parse(stdout);
    } catch (error) {
        console.error("Agent Execution Error:", error);
        return { status: "error", message: error.message };
    }
});

ipcMain.handle('scan-app-telemetry', async (event, args) => {
    try {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'app_telemetry_auditor.py');
        const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
            timeout: 120000,
            maxBuffer: 100 * 1024 * 1024
        });
        if (stderr && !stderr.includes('Error')) {
            console.warn("Python Stderr:", stderr);
        }
        return JSON.parse(stdout);
    } catch (error) {
        console.error("App Telemetry Error:", error);
        return { status: "error", message: error.message };
    }
});

ipcMain.handle('execute-cleanup', async (event, targetPaths) => {
    try {
        if (!Array.isArray(targetPaths)) {
            return { status: "error", message: "targetPaths must be an array" };
        }
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'safe_purge_executor.py');
        const child = require('child_process').spawn('python3', [scriptPath]);
        let outputData = '';
        child.stdout.on('data', (data) => { outputData += data.toString(); });
        child.stdin.write(JSON.stringify({ target_paths: targetPaths }));
        child.stdin.end();
        await new Promise((resolve) => { child.on('close', resolve); });
        const pythonResult = JSON.parse(outputData);

        if (pythonResult.status === "success" && pythonResult.script_path) {
            const { response } = await dialog.showMessageBox(win, {
                type: 'warning',
                buttons: ['Cancel', 'Confirm Deletion'],
                defaultId: 1,
                cancelId: 0,
                title: 'Confirm System Purge',
                message: `Delete ${pythonResult.paths_to_delete} items?`
            });
            if (response === 1) {
                const expectedDir = path.join(os.homedir(), '.mac_optimizer_purge_');
                if (!pythonResult.script_path.startsWith(expectedDir)) {
                    throw new Error('Invalid script path');
                }
                await execAsync(`bash "${pythonResult.script_path}"`);
                return { status: "success" };
            }
            return { status: "cancelled" };
        }
        return pythonResult;
    } catch (error) {
        return { status: "error", message: error.message };
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 5: Storage Scanner with IPC Batching
// ═══════════════════════════════════════════════════════════════════════════════// ─── Storage Analyzer: Snapshot-based Streaming IPC ──────────────────────────
//
// Architecture:
//   Python scanner → line-delimited JSON on stdout
//   main.cjs readline → internal snapshot buffer (150ms tick)
//   snapshot tick → ONE 'storage-scan-event' per tick to renderer
//
// Each emitted snapshot carries a scanId so the renderer can discard
// stale events from a previous (cancelled) scan.

let _scanProcess = null;
let _scanId = null;
let _snapInterval = null;

// Snapshot accumulator — reset at scan start, flushed every 150ms
const _snap = {
    progress: null,
    addedItems: [],       // items accumulated since last flush
    totalItems: 0,
    totalBytes: 0,
    warnings: [],
    agentStatusUpdates: [],
    newInsights: [],
    complete: null,
    error: null,
};

function _resetSnap() {
    _snap.progress = null;
    _snap.addedItems = [];
    _snap.totalItems = 0;
    _snap.totalBytes = 0;
    _snap.warnings = [];
    _snap.agentStatusUpdates = [];
    _snap.newInsights = [];
    _snap.complete = null;
    _snap.error = null;
}

function _flushSnapshot(status) {
    if (!win || win.isDestroyed()) return;

    const snapshot = {
        type: 'snapshot',
        scanId: _scanId,
        ts: Date.now(),
        status: status || 'scanning',
        totals: {
            itemsFound: _snap.totalItems,
            bytesFound: Math.min(_snap.totalBytes, Number.MAX_SAFE_INTEGER),
        },
    };

    if (_snap.progress) snapshot.progress = _snap.progress;
    if (_snap.addedItems.length > 0) {
        snapshot.addedItems = _snap.addedItems.splice(0); // drain
    }
    if (_snap.warnings.length > 0) {
        snapshot.warnings = _snap.warnings.splice(0);
    }
    if (_snap.agentStatusUpdates.length > 0) {
        snapshot.agentStatusUpdates = _snap.agentStatusUpdates.splice(0);
    }
    if (_snap.newInsights.length > 0) {
        snapshot.newInsights = _snap.newInsights.splice(0);
    }
    if (_snap.complete) {
        snapshot.complete = _snap.complete;
        // Merge disk totals into top-level totals
        snapshot.totals.disk_total = _snap.complete.disk_total || 0;
        snapshot.totals.disk_used = _snap.complete.disk_used || 0;
        snapshot.totals.disk_free = _snap.complete.disk_free || 0;
    }
    if (_snap.error) snapshot.error = _snap.error;

    win.webContents.send('storage-scan-event', snapshot);
}

function _stopScan(reason) {
    if (_snapInterval) { clearInterval(_snapInterval); _snapInterval = null; }
    if (_scanProcess) { try { _scanProcess.kill(); } catch (_) { } _scanProcess = null; }

    if (reason === 'cancelled' || reason === 'error' || reason === 'done') {
        _flushSnapshot(reason);
    }
    _scanId = null;
    _resetSnap();
}

ipcMain.on('start-storage-scan', (event) => {
    // Kill any existing scan first
    _stopScan(null); // silent stop, no flush

    // Fresh scanId — renderer ignores events from old scanId
    _scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    _resetSnap();

    const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'swarm_scanner.py');
    const child = spawn('python3', [scriptPath, 'scan'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    _scanProcess = child;

    // Send initial snapshot so renderer shows scanning state immediately
    _flushSnapshot('scanning');

    // 150ms snapshot tick — renderer receives ≤7 updates/sec
    _snapInterval = setInterval(() => _flushSnapshot('scanning'), 150);

    // Parse line-delimited JSON from Python
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
        if (!line) return;
        let data;
        try { data = JSON.parse(line); } catch (_) { return; } // skip malformed

        const evt = data.event || data.type;

        if (evt === 'batch') {
            // Python-side item batch — accumulate all items
            const items = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                _snap.addedItems.push(item);
                _snap.totalItems++;
                _snap.totalBytes += (item.sizeBytes || item.size || 0);
            }
        } else if (evt === 'item') {
            // Single item (fallback if Python sends unbatched)
            _snap.addedItems.push(data);
            _snap.totalItems++;
            _snap.totalBytes += (data.sizeBytes || data.size || 0);
        } else if (evt === 'progress') {
            _snap.progress = {
                phase: data.phase || data.dir || '',
                dir: data.dir || data.current_path || '',
                files: data.files || data.files_processed || 0,
                bytes: data.bytes || data.bytes_scanned || 0,
                rate_mbps: data.rate_mbps || data.scan_rate_mbps || 0,
                eta_seconds: data.eta_seconds ?? -1,
                elapsed: data.elapsed || 0,
            };
        } else if (evt === 'warning') {
            _snap.warnings.push(data.message || String(data));
        } else if (evt === 'agent_status') {
            _snap.agentStatusUpdates.push({
                agent_id: data.agent_id,
                status: data.status,
                type: data.type
            });
        } else if (evt === 'insight') {
            _snap.newInsights.push(data);
        } else if (evt === 'complete') {
            _snap.complete = data;
            // Patch disk totals into snapshot totals on final flush
            _snap.totalItems = (data.items || []).length || _snap.totalItems;
            _snap.totalBytes = data.disk_used || _snap.totalBytes;
        } else if (evt === 'error') {
            _snap.error = { message: data.message || 'Unknown error' };
        }
    });

    child.stderr.on('data', (chunk) => {
        const msg = chunk.toString();
        if (msg.includes('Error') || msg.includes('Traceback')) {
            console.error('[storage_scanner stderr]', msg.slice(0, 400));
        }
    });

    child.on('close', (code) => {
        _scanProcess = null;
        if (_snapInterval) { clearInterval(_snapInterval); _snapInterval = null; }
        if (code !== 0 && !_snap.complete) {
            _snap.error = { message: `Scanner exited with code ${code}` };
            _flushSnapshot('error');
        } else {
            _flushSnapshot('done');
        }
        _scanId = null;
        _resetSnap();
    });

    child.on('error', (err) => {
        _scanProcess = null;
        _snap.error = { message: err.message };
        _stopScan('error');
    });
});

ipcMain.on('cancel-storage-scan', () => {
    _stopScan('cancelled');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Analyzer: Delete Items
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('execute-storage-delete', async (event, paths) => {
    if (!Array.isArray(paths) || paths.length === 0) {
        return { status: 'error', message: 'No paths provided' };
    }

    const results = { deleted: [], failed: [], totalFreed: 0 };

    for (const filePath of paths) {
        try {
            await shell.trashItem(filePath);
            results.deleted.push(filePath);
        } catch (err) {
            results.failed.push({ path: filePath, error: err.message });
        }
    }

    return { status: 'success', ...results };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Analyzer: Open in Finder
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('open-in-finder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { status: 'success' };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

ipcMain.handle('open-system-prefs', async (event, url) => {
    try {
        const { exec: execCb } = require('child_process');
        execCb(`open "${url}"`);
        return { status: 'success' };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

ipcMain.handle('quick-look-file', async (event, filePath) => {
    try {
        const { spawn: spawnLook } = require('child_process');
        const ql = spawnLook('qlmanage', ['-p', filePath], { detached: true, stdio: 'ignore' });
        ql.unref();
        return { status: 'success' };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full Disk Access (FDA) Permission Detection
// ═══════════════════════════════════════════════════════════════════════════════
//
// Strategy: probe a path that is always behind TCC Full Disk Access on every Mac.
// We use fs.accessSync (synchronous) so this completes in <1ms with no subprocess.
//
// Probe paths tried in order:
//   1. ~/Library/Safari/History.db   — exists on all Macs, always FDA-protected
//   2. ~/Library/Messages/chat.db    — fallback if Safari not installed
//   3. ~/Library/Mail                — final fallback (directory, not file)
//
// Result confidence:
//   'high'    — probe path exists AND was readable/blocked (definitive result)
//   'low'     — no probe path found on this Mac (fresh install / non-standard)
//               in this case we assume 'granted' to avoid blocking the user

const FDA_PROBE_PATHS = [
    path.join(os.homedir(), 'Library', 'Safari', 'History.db'),
    path.join(os.homedir(), 'Library', 'Messages', 'chat.db'),
    path.join(os.homedir(), 'Library', 'Mail'),
];

function checkFdaGranted() {
    for (const probePath of FDA_PROBE_PATHS) {
        // Check if the path exists first (stat with no read attempt)
        try {
            fs.statSync(probePath);
        } catch (statErr) {
            // Path doesn't exist — try next fallback
            continue;
        }
        // Path exists — now check if we can read it
        try {
            fs.accessSync(probePath, fs.constants.R_OK);
            // Success: FDA is granted
            return { granted: true, probePath, confidence: 'high' };
        } catch (accessErr) {
            if (accessErr.code === 'EACCES' || accessErr.code === 'EPERM') {
                // Definitive permission denial
                return { granted: false, probePath, confidence: 'high' };
            }
            // Some other error (ENOENT race, etc.) — try next fallback
        }
    }
    // No probe path found on this Mac — assume granted (don't block the user)
    return { granted: true, probePath: null, confidence: 'low' };
}

ipcMain.handle('check-fda-status', () => {
    try {
        return checkFdaGranted();
    } catch (err) {
        // Defensive catch — should never reach here but never block the scan
        console.error('[FDA probe] Unexpected error:', err.message);
        return { granted: true, probePath: null, confidence: 'low' };
    }
});

// Deep-link URL for the Full Disk Access pane in System Settings (macOS 13+)
// Falls back gracefully on older macOS (Ventura+ uses x-apple.systempreferences)
const FDA_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

ipcMain.handle('open-fda-settings', async () => {
    try {
        await shell.openExternal(FDA_SETTINGS_URL);
        return { status: 'success' };
    } catch (err) {
        // Fallback: open the top-level Privacy & Security pane
        try {
            await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
            return { status: 'success', fallback: true };
        } catch (fallbackErr) {
            return { status: 'error', message: fallbackErr.message };
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Analyzer: Export Report
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('export-storage-report', async (event, reportData) => {
    try {
        const { filePath, canceled } = await dialog.showSaveDialog(win, {
            defaultPath: `storage-report-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [
                { name: 'JSON', extensions: ['json'] },
                { name: 'HTML', extensions: ['html'] },
            ]
        });

        if (canceled || !filePath) {
            return { status: 'cancelled' };
        }

        if (filePath.endsWith('.html')) {
            const html = generateHtmlReport(reportData);
            fs.writeFileSync(filePath, html, 'utf-8');
        } else {
            fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2), 'utf-8');
        }

        return { status: 'success', path: filePath };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

function generateHtmlReport(data) {
    const items = data.items || [];
    const totalFormatted = data.total_formatted || '0 B';
    const rows = items.map(i =>
        `<tr>
            <td style="padding:8px;border-bottom:1px solid #21262d">${i.name}</td>
            <td style="padding:8px;border-bottom:1px solid #21262d;font-family:monospace;font-size:12px;color:#8b949e">${i.path}</td>
            <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;font-weight:bold">${i.size_formatted}</td>
            <td style="padding:8px;border-bottom:1px solid #21262d">
                <span style="padding:2px 8px;border-radius:12px;font-size:11px;background:${i.risk === 'safe' ? '#0d3b1e' : i.risk === 'caution' ? '#3b2e0d' : '#3b0d17'};color:${i.risk === 'safe' ? '#3fb950' : i.risk === 'caution' ? '#d29922' : '#f85149'}">${i.risk}</span>
            </td>
        </tr>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><title>Storage Analysis Report</title>
    <style>body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;max-width:1200px;margin:0 auto}
    h1{color:#58a6ff;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin-top:24px}th{text-align:left;padding:12px 8px;border-bottom:2px solid #30363d;color:#8b949e;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em}</style>
</head>
<body>
    <h1>🗂 Storage Analysis Report</h1>
    <p style="color:#8b949e">Generated ${new Date().toLocaleString()} — Total: <strong style="color:#58a6ff">${totalFormatted}</strong></p>
    <table><thead><tr><th>Name</th><th>Path</th><th style="text-align:right">Size</th><th>Risk</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
