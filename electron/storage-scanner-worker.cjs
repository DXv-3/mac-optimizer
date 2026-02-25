// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 5: Enterprise-Grade File Scanner Worker Thread
// Non-blocking file system traversal using Node.js worker_threads
// ═══════════════════════════════════════════════════════════════════════════════

const { parentPort, workerData } = require('worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Configuration
const MAX_DEPTH = 10;
const BATCH_SIZE = 100;

// Directories to scan on macOS
const SCAN_DIRECTORIES = [
    os.homedir(),
    '/Library/Caches',
    path.join(os.homedir(), 'Library/Caches'),
    path.join(os.homedir(), 'Library/Application Support'),
];

// Categories for file classification
const CATEGORIES = {
    cache: ['cache', 'Cache', 'CACHE'],
    logs: ['logs', 'Logs', 'LOG', '.log'],
    temp: ['temp', 'tmp', 'Temp', 'TMP'],
    downloads: ['Downloads'],
    appSupport: ['Application Support']
};

let totalFiles = 0;
let totalSize = 0;
let scannedPaths = new Set();

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

function categorizeFile(filePath) {
    const name = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();

    // Check category by path segments
    for (const [category, keywords] of Object.entries(CATEGORIES)) {
        for (const keyword of keywords) {
            if (filePath.toLowerCase().includes(keyword.toLowerCase())) {
                return category;
            }
        }
    }

    // Check by extension
    if (['.log', '.txt'].includes(ext)) return 'logs';
    if (['.tmp', '.temp'].includes(ext)) return 'temp';

    return 'other';
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function shouldSkipPath(filePath) {
    // Skip system directories and hidden files
    const skipPatterns = [
        '/.Trash',
        '/.git',
        '/node_modules',
        '/Library/Mail',
        '/Library/Safari'
    ];

    for (const pattern of skipPatterns) {
        if (filePath.includes(pattern)) return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recursive File Scanner (runs in worker thread - non-blocking)
// ═══════════════════════════════════════════════════════════════════════════════

async function scanDirectory(dirPath, depth = 0) {
    if (depth > MAX_DEPTH) return;
    if (shouldSkipPath(dirPath)) return;

    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            // Skip if already scanned
            if (scannedPaths.has(fullPath)) continue;
            scannedPaths.add(fullPath);

            try {
                if (entry.isDirectory()) {
                    // Send progress update
                    parentPort.postMessage({
                        type: 'progress',
                        data: { currentPath: fullPath, filesFound: totalFiles }
                    });

                    // Recurse into subdirectory
                    await scanDirectory(fullPath, depth + 1);
                } else if (entry.isFile()) {
                    const stats = await fs.promises.stat(fullPath);

                    totalFiles++;
                    totalSize += stats.size;

                    // Send file to main thread
                    parentPort.postMessage({
                        type: 'file',
                        data: {
                            path: fullPath,
                            name: entry.name,
                            size: stats.size,
                            sizeFormatted: formatSize(stats.size),
                            category: categorizeFile(fullPath),
                            modified: stats.mtime.toISOString()
                        }
                    });
                }
            } catch (err) {
                // Skip inaccessible files
            }
        }
    } catch (err) {
        // Skip inaccessible directories
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Scan Execution
// ═══════════════════════════════════════════════════════════════════════════════

async function startScan() {
    try {
        parentPort.postMessage({
            type: 'progress',
            data: { currentPath: 'Initializing scan...', filesFound: 0 }
        });

        // Scan all configured directories
        for (const dir of SCAN_DIRECTORIES) {
            if (fs.existsSync(dir)) {
                await scanDirectory(dir);
            }
        }

        // Send completion message
        parentPort.postMessage({
            type: 'complete',
            data: {
                totalFiles,
                totalSize,
                totalFormatted: formatSize(totalSize)
            }
        });

    } catch (err) {
        parentPort.postMessage({
            type: 'error',
            error: err.message
        });
    }
}

// Start the scan
startScan();
