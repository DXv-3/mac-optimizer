import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, '..');

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win;

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset', // Mac-native hidden title bar
        vibrancy: 'under-window', // Mac-native blur effect
        visualEffectState: 'active',
        webPreferences: {
            preload: path.join(process.env.APP_ROOT, 'electron', 'preload.cjs'),
            sandbox: false, // Required for deep filesystem access later
            contextIsolation: true
        },
    })

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        // win.loadFile('dist/index.html')
        win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)

import { exec } from 'node:child_process';
import util from 'node:util';

const execAsync = util.promisify(exec);

// IPC Handlers for future System Tasks
ipcMain.handle('scan-system-junk', async (event, args) => {
    try {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'sys_purge_inquisitor.py');

        // Execute with timeout protection (30 seconds)
        const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
            timeout: 30000,
            maxBuffer: 50 * 1024 * 1024 // 50MB max buffer
        });

        if (stderr && !stderr.includes('Error')) {
            console.warn("Python Stderr:", stderr)
        }

        // Parse the JSON output from the agent
        const result = JSON.parse(stdout);
        return result;
    } catch (error) {
        console.error("Agent Execution Error:", error);
        // Return structured error for frontend handling
        return {
            status: "error",
            message: error.message || "Failed to scan system junk",
            code: error.code || "UNKNOWN"
        };
    }
});

// Applications Telemetry IPC Handler
ipcMain.handle('scan-app-telemetry', async (event, args) => {
    try {
        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'app_telemetry_auditor.py');

        // Execute with timeout protection (60 seconds for app scanning)
        const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
            timeout: 60000,
            maxBuffer: 100 * 1024 * 1024 // 100MB max buffer
        });

        if (stderr && !stderr.includes('Error')) {
            console.warn("Python Stderr:", stderr)
        }

        const result = JSON.parse(stdout);
        return result;
    } catch (error) {
        console.error("App Telemetry Error:", error);
        return {
            status: "error",
            message: error.message || "Failed to scan application telemetry",
            code: error.code || "UNKNOWN"
        };
    }
});

// Execute Cleanup IPC Handler
ipcMain.handle('execute-cleanup', async (event, targetPaths) => {
    try {
        // Validate input: targetPaths must be an array
        if (!Array.isArray(targetPaths)) {
            return { status: "error", message: "targetPaths must be an array" };
        }
        if (targetPaths.length > 100) {
            return { status: "error", message: "Too many paths (max 100)" };
        }
        if (!targetPaths.every(p => typeof p === 'string')) {
            return { status: "error", message: "All paths must be strings" };
        }

        const scriptPath = path.join(process.env.APP_ROOT, 'agents', 'safe_purge_executor.py');

        // Pass the paths to python via stdin
        const child = require('child_process').spawn('python3', [scriptPath]);

        let outputData = '';
        child.stdout.on('data', (data) => {
            outputData += data.toString();
        });

        child.stdin.write(JSON.stringify({ target_paths: targetPaths }));
        child.stdin.end();

        // Wait for python process to finish
        await new Promise((resolve) => {
            child.on('close', resolve);
        });

        const pythonResult = JSON.parse(outputData);

        if (pythonResult.status === "success" && pythonResult.script_path) {
            // Ask for User Confirmation visually
            const { response } = await require('electron').dialog.showMessageBox(win, {
                type: 'warning',
                buttons: ['Cancel', 'Confirm Deletion'],
                defaultId: 1,
                cancelId: 0,
                title: 'Confirm System Purge',
                message: `Are you sure you want to permanently delete these ${pythonResult.paths_to_delete} items?`,
                detail: `This action will run the generated script at ${pythonResult.script_path} and cannot be undone.`
            });

            if (response === 1) {
                // Validate script path before execution
                const expectedDir = path.join(os.homedir(), '.mac_optimizer_purge_');
                if (!pythonResult.script_path.startsWith(expectedDir)) {
                    throw new Error('Invalid script path: outside expected directory');
                }
                if (!pythonResult.script_path.endsWith('.sh')) {
                    throw new Error('Invalid script path: must be .sh file');
                }

                // Execute the generated Bash Script
                await execAsync(`bash "${pythonResult.script_path}"`);
                return { status: "success", message: "Cleanup complete." };
            } else {
                return { status: "cancelled", message: "User cancelled." };
            }
        }

        return pythonResult;

    } catch (error) {
        console.error("Cleanup Execution Error:", error);
        return { status: "error", message: error.message };
    }
});
