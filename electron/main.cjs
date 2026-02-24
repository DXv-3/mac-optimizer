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

function createWindow() {
    win = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
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

// ─── Storage Analyzer: Streaming Scan ──────────────────────────────────────

let storageScanProcess = null;

ipcMain.on('start-storage-scan', (event) => {
    // Kill any existing scan
    if (storageScanProcess) {
        try { storageScanProcess.kill(); } catch (e) { }
        storageScanProcess = null;
    }

    const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'storage_scanner.py');
    const child = spawn('python3', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    storageScanProcess = child;

    // Read stdout line-by-line and forward each JSON event to the renderer
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        try {
            const data = JSON.parse(line);
            if (win && !win.isDestroyed()) {
                win.webContents.send('storage-scan-event', data);
            }
        } catch (e) {
            // Skip non-JSON lines (e.g., Python warnings)
        }
    });

    child.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('Traceback')) {
            console.error('Storage Scanner Error:', msg);
            if (win && !win.isDestroyed()) {
                win.webContents.send('storage-scan-event', {
                    event: 'error',
                    message: msg.trim()
                });
            }
        }
    });

    child.on('close', (code) => {
        storageScanProcess = null;
        if (code !== 0 && win && !win.isDestroyed()) {
            win.webContents.send('storage-scan-event', {
                event: 'error',
                message: `Scanner exited with code ${code}`
            });
        }
    });

    child.on('error', (err) => {
        storageScanProcess = null;
        if (win && !win.isDestroyed()) {
            win.webContents.send('storage-scan-event', {
                event: 'error',
                message: err.message
            });
        }
    });
});

ipcMain.on('cancel-storage-scan', () => {
    if (storageScanProcess) {
        try { storageScanProcess.kill(); } catch (e) { }
        storageScanProcess = null;
    }
});

// ─── Storage Analyzer: Delete Items ────────────────────────────────────────

ipcMain.handle('execute-storage-delete', async (event, paths) => {
    if (!Array.isArray(paths) || paths.length === 0) {
        return { status: 'error', message: 'No paths provided' };
    }

    const results = { deleted: [], failed: [], totalFreed: 0 };

    for (const filePath of paths) {
        try {
            // Use macOS Trash via shell.trashItem (Electron built-in, recoverable)
            await shell.trashItem(filePath);
            results.deleted.push(filePath);
        } catch (err) {
            results.failed.push({ path: filePath, error: err.message });
        }
    }

    return { status: 'success', ...results };
});

// ─── Storage Analyzer: Open in Finder ──────────────────────────────────────

ipcMain.handle('open-in-finder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { status: 'success' };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

// ─── Storage Analyzer: Export Report ───────────────────────────────────────

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
