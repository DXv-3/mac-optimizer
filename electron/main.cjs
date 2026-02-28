const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const { exec } = require('node:child_process');
const util = require('node:util');
const agentManager = require('./agent-manager.cjs');

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
        frame: false, // frameless allows custom CSS + Vibrancy to shine
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'followWindow',
        transparent: true,
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
        let pythonResult;
        try {
            pythonResult = JSON.parse(outputData);
        } catch (parseErr) {
            console.error('Failed to parse Python output:', parseErr);
            return { status: "error", message: "Invalid response from cleanup agent" };
        }

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
// PILLAR 5: Rust Core Storage Scanner with 60fps IPC Batching
// ═══════════════════════════════════════════════════════════════════════════════
//
// Architecture:
//   mac-optimizer-core (Rust) → NDJSON on stdout
//   main.cjs readline → buffer array
//   setTimeout(16ms) → flush buffer to renderer via 'scan:batch' (60fps)

let _rustScanProcess = null;
let _scanBuffer = [];
let _flushTimer = null;
let _scanInProgress = false;

const MAX_BATCH_SIZE = 500; // Send max 500 items at a time to avoid IPC overflow

// Track if a flush is currently executing to prevent overlapping intervals
let _isFlushing = false;

function _flushRustBuffer(status = null, error = null) {
    if (!win || win.isDestroyed()) return;

    // Process ONLY ONE batch per flush to avoid flooding the renderer
    // The 60fps loop will handle continuous flushing
    const batchSize = Math.min(_scanBuffer.length, MAX_BATCH_SIZE);
    if (batchSize === 0 && !status && !error) return;

    _isFlushing = true;
    try {
        const batch = _scanBuffer.splice(0, batchSize);

        // Transform Python Swarm event format to frontend-expected format
        const items = batch.map(item => {
            // Note: Our Python script emits items natively mapped quite well already
            // so we don't strictly need to transform the Rust FsItem fields, but we 
            // ensure the 'id', 'name', and 'path' exist for the renderer.
            const itemPath = item.path || '';
            return {
                id: itemPath,
                name: item.name || itemPath.split('/').pop() || itemPath,
                path: itemPath,
                size: item.size || 0,
                sizeBytes: item.sizeBytes || item.size || 0,
                sizeFormatted: item.sizeFormatted || formatBytes(item.size),
                isDirectory: item.isDirectory || false,
                modifiedTime: item.lastUsed || item.last_accessed || '',
                permissions: item.permissions || '',
                isClone: item.isClone || false,
                physicalSize: item.physicalSize || item.size || 0,
                risk: item.risk || 'safe',
                category: item.category || 'unknown',
            };
        });

        const payload = {
            type: 'batch',
            items: items,
            status: status || 'scanning'
        };

        // Only send error if this is the final flush and buffer is empty
        if (_scanBuffer.length === 0 && error) {
            payload.error = error;
        }

        if (items.length > 0 || status || error) {
            win.webContents.send('storage-scan-event', payload);
        }
    } finally {
        _isFlushing = false;
    }
}

// Helper to format bytes consistently
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

function _scheduleFlush() {
    if (!_scanInProgress || _isFlushing) return;

    const bufferBefore = _scanBuffer.length;
    _flushRustBuffer();
    const bufferAfter = _scanBuffer.length;

    // Log if buffer is growing too fast
    if (bufferBefore > 0) {
        console.log(`[Main] Flush: ${bufferBefore}→${bufferAfter} items remaining`);
    }
}

function _stopRustScan() {
    _scanInProgress = false;
    if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
    if (_rustScanProcess) { try { _rustScanProcess.kill(); } catch (_) { } _rustScanProcess = null; }
    _scanBuffer = [];
}

ipcMain.on('start-storage-scan', (event, scanPath) => {
    console.log('[Main] Start storage scan requested');
    // 1. Kill any existing scan
    _stopRustScan();

    // 2. Resolve paths
    const targetPath = scanPath || os.homedir(); // Default to home folder for reasonable scan times
    const pythonScriptPath = path.join(process.env.APP_ROOT, 'agents', 'swarm_scanner.py');

    // Check if there is an isolated .venv_builder python, else fallback to system python3
    const venvPythonPath = path.join(process.env.APP_ROOT, '.venv_builder', 'bin', 'python3');
    const pythonExe = fs.existsSync(venvPythonPath) ? venvPythonPath : 'python3';

    console.log('[Main] Target path:', targetPath);
    console.log('[Main] Python execution config:', { pythonExe, pythonScriptPath });

    if (!fs.existsSync(pythonScriptPath)) {
        win.webContents.send('storage-scan-event', { status: 'error', error: 'Python swarm agent script not found.' });
        return;
    }

    _scanInProgress = true;
    _flushRustBuffer('scanning'); // Initial state

    // 3. Spawn the Python Swarm Scanner
    console.log('[Main] Spawning Python Swarm Scanner...');
    _rustScanProcess = spawn(pythonExe, [pythonScriptPath, 'scan', targetPath], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log('[Main] Rust binary spawned, PID:', _rustScanProcess.pid);

    // 4. Start the 60fps flush loop
    _flushTimer = setInterval(_scheduleFlush, 16);

    // 5. Read stdout
    const rl = readline.createInterface({ input: _rustScanProcess.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
        if (!line) return;
        try {
            const parsed = JSON.parse(line);

            // The Python Swarm script emits events like:
            // {"event": "item", "path": "...", "size": ...}
            // {"event": "progress", "bytes_scanned": ...}
            // {"event": "complete", "metrics": {...}}
            // {"event": "swarm_phase", "phase": "..."}

            if (parsed.event === 'item' || parsed.event === 'batch') {
                if (parsed.items) { // Batch of items
                    _scanBuffer.push(...parsed.items);
                } else if (parsed.path) { // Single item
                    _scanBuffer.push(parsed);
                }
            } else if (parsed.event === 'progress' || parsed.event === 'swarm_phase' || parsed.event === 'agent_status') {
                // Instantly proxy progress/status events to the UI thread (bypassing the flush loop)
                win.webContents.send('storage-scan-progress', parsed);
            } else if (parsed.event === 'complete') {
                // Push the final items and wait for the loop to complete natively
                if (parsed.items) {
                    _scanBuffer.push(...parsed.items);
                }
                win.webContents.send('storage-scan-complete', parsed.metrics);
            }

            if (_scanBuffer.length > 0 && _scanBuffer.length % 100 === 0) {
                console.log(`[Main Process] Buffer has ${_scanBuffer.length} items`);
            }
        } catch (err) {
            console.log('[Main Process] Parse error:', err.message, 'Line:', line.substring(0, 50));
        }
    });

    _rustScanProcess.stderr.on('data', (chunk) => {
        console.warn('[Rust Scanner stderr]:', chunk.toString().trim());
    });

    _rustScanProcess.on('close', (code) => {
        _scanInProgress = false;
        if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }

        // Final flush
        _flushRustBuffer(code === 0 ? 'complete' : 'error');
        _rustScanProcess = null;
    });

    _rustScanProcess.on('error', (err) => {
        _scanInProgress = false;
        if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }

        _flushRustBuffer('error', err.message);
        _rustScanProcess = null;
    });
});

ipcMain.on('cancel-storage-scan', () => {
    _stopRustScan();
    _flushRustBuffer('cancelled');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Performance Optimization: Resource Monitor & System Tweaks
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.on('start-resource-monitor', (event) => {
    const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'resource_monitor.py');
    const child = agentManager.spawnAgent('resource_monitor', scriptPath, [], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
        if (!line) return;
        try {
            const data = JSON.parse(line);
            if (data.event === 'resource_tick') {
                event.sender.send('resource-monitor-tick', data);
            }
        } catch (_) { }
    });
});

ipcMain.on('stop-resource-monitor', () => {
    agentManager.killAgent('resource_monitor');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Anomaly Hunter AI
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.on('start-anomaly-hunter', (event) => {
    const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'anomaly_hunter.py');
    const child = agentManager.spawnAgent('anomaly_hunter', scriptPath, [], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
        if (!line) return;
        try {
            const data = JSON.parse(line);
            if (data.event === 'anomaly_insights' && data.insights.length > 0) {
                event.sender.send('anomaly-hunter-insights', data.insights);
            }
        } catch (_) { }
    });
});

ipcMain.on('stop-anomaly-hunter', () => {
    agentManager.killAgent('anomaly_hunter');
});

ipcMain.handle('invoke-system-optimizer', async (event, commandName, args = {}) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'system_optimizer.py');
        const child = spawn('python3', [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        let outputData = '';

        child.stdout.on('data', (data) => { outputData += data.toString(); });

        child.on('close', () => {
            try {
                const result = JSON.parse(outputData.trim());
                resolve(result);
            } catch (err) {
                resolve({ status: 'error', message: 'Failed to parse optimizer output' });
            }
        });

        // Send command to stdin
        child.stdin.write(JSON.stringify({ action: commandName, ...args }) + '\n');
        child.stdin.end();
    });
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

ipcMain.handle('interrogate-storage-item', async (event, filePath) => {
    try {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'file_interrogator.py');
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        const { stdout } = await execAsync(`python3 "${scriptPath}" "${filePath}"`, {
            timeout: 10000,
            maxBuffer: 1024 * 1024
        });

        return JSON.parse(stdout);
    } catch (err) {
        console.error('Interrogation Error:', err);
        return { status: 'error', message: err.message };
    }
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
    console.log('[FDA Check] Starting FDA detection...');
    for (const probePath of FDA_PROBE_PATHS) {
        // Check if the path exists first (stat with no read attempt)
        try {
            fs.statSync(probePath);
            console.log(`[FDA Check] Probe path exists: ${probePath}`);
        } catch (statErr) {
            // Path doesn't exist — try next fallback
            console.log(`[FDA Check] Probe path does not exist: ${probePath}`);
            continue;
        }
        // Path exists — now check if we can read it
        try {
            fs.accessSync(probePath, fs.constants.R_OK);
            // Success: FDA is granted
            console.log(`[FDA Check] ✅ FDA GRANTED - Can read: ${probePath}`);
            return { granted: true, probePath, confidence: 'high' };
        } catch (accessErr) {
            console.log(`[FDA Check] ❌ FDA DENIED - Cannot read: ${probePath} (${accessErr.code})`);
            if (accessErr.code === 'EACCES' || accessErr.code === 'EPERM') {
                // Definitive permission denial
                return { granted: false, probePath, confidence: 'high' };
            }
            // Some other error (ENOENT race, etc.) — try next fallback
        }
    }
    // No probe path found on this Mac — assume granted (don't block the user)
    console.log('[FDA Check] ⚠️ No probe paths found, assuming granted (low confidence)');
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
        // Show native dialog explaining why we need FDA
        const { response } = await dialog.showMessageBox(win, {
            type: 'info',
            buttons: ['Open System Settings', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Full Disk Access Required',
            message: 'Mac Optimizer needs Full Disk Access to scan system files, caches, and logs.',
            detail: '1. Click "Open System Settings"\n2. Click the lock to make changes\n3. Check "Mac Optimizer" in the list\n4. Return to this app',
        });

        if (response === 0) {
            await shell.openExternal(FDA_SETTINGS_URL);
            return { status: 'success' };
        }
        return { status: 'cancelled' };
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

// Native permission request (macOS 10.14+)
// This triggers the system prompt for FDA if the app is properly signed
ipcMain.handle('request-fda-native', async () => {
    try {
        // For signed apps, accessing a TCC-protected path triggers the system prompt
        // We'll try to access a harmless file that requires FDA
        const testPaths = [
            path.join(os.homedir(), 'Library', 'Safari', 'History.db'),
            path.join(os.homedir(), 'Library', 'Messages', 'chat.db'),
        ];

        for (const testPath of testPaths) {
            try {
                fs.accessSync(testPath, fs.constants.R_OK);
                return { granted: true, path: testPath };
            } catch (err) {
                if (err.code === 'EACCES' || err.code === 'EPERM') {
                    // Permission denied - FDA not granted
                    return { granted: false, path: testPath, error: err.code };
                }
                // Path doesn't exist, try next
            }
        }

        return { granted: false, error: 'No test paths available' };
    } catch (err) {
        return { granted: false, error: err.message };
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
