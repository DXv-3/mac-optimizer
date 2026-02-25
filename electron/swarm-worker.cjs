// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 5: Swarm-based Storage Scanner Worker Bridge
// Connects the Python `swarm_scanner.py` Hive Mind to the Electron Frontend.
// ═══════════════════════════════════════════════════════════════════════════════

const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Store the path to the swarm Python script
const pythonScriptPath = path.join(__dirname, '..', 'agents', 'swarm_scanner.py');

/**
 * Spawns the Swarm Scanner and streams its stdout/stderr back to the UI.
 */
function startSwarmScan() {
    parentPort.postMessage({
        type: 'log',
        level: 'info',
        message: 'Initializing Storage Swarm Manager...'
    });

    const pythonProcess = spawn('python3', [pythonScriptPath, 'scan']);

    const rl = readline.createInterface({
        input: pythonProcess.stdout,
        crlfDelay: Infinity
    });

    // Pipe JSON lines back to the main thread
    rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
            const data = JSON.parse(line);

            // Re-map Python event names to what the UI expects, or pass through new ones
            if (data.event === 'progress') {
                parentPort.postMessage({ type: 'progress', data });
            } else if (data.event === 'item') {
                parentPort.postMessage({ type: 'file', data });
            } else if (data.event === 'batch') {
                // Swarm scanner emits batches of items for performance
                data.items.forEach(item => {
                    parentPort.postMessage({ type: 'file', data: item });
                });
            } else if (data.event === 'complete') {
                parentPort.postMessage({ type: 'complete', data });
            } else if (data.event === 'agent_status') {
                // NEW: Stream live visual status updates from the swarm
                parentPort.postMessage({ type: 'agent_status', data });
            } else if (data.event === 'insight') {
                // NEW: Stream deep analysis insights (stale projects, duplicates)
                parentPort.postMessage({ type: 'insight', data });
            } else if (data.event === 'swarm_init' || data.event === 'swarm_phase') {
                parentPort.postMessage({ type: 'log', level: 'info', message: data.message });
            } else {
                // Pass through any other event structure just in case
                parentPort.postMessage({ type: data.event, data });
            }
        } catch (err) {
            parentPort.postMessage({
                type: 'log',
                level: 'warn',
                message: `Failed to parse swarm output: ${line.substring(0, 100)}...`
            });
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        parentPort.postMessage({
            type: 'log',
            level: 'error',
            message: `Swarm Worker Error: ${data.toString()}`
        });
    });

    pythonProcess.on('close', (code) => {
        parentPort.postMessage({
            type: 'log',
            level: 'info',
            message: `Swarm Scan finished with code ${code}`
        });
    });

    // Allow graceful termination from main thread
    parentPort.on('message', (msg) => {
        if (msg === 'cancel') {
            pythonProcess.kill('SIGTERM');
            parentPort.postMessage({ type: 'log', level: 'info', message: 'Swarm Scan cancelled.' });
        }
    });
}

// Start immediately when the worker thread is spawned
startSwarmScan();
