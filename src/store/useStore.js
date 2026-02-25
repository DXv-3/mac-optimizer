import { create } from 'zustand';

// Byte formatter — single source of truth for all size display math
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

// Build a tree structure for sunburst visualization
function buildStorageTree(items) {
    const root = { name: 'Storage', children: [] };
    const categoryMap = new Map();

    for (const item of items) {
        const cat = item.category || 'Other';
        if (!categoryMap.has(cat)) {
            categoryMap.set(cat, {
                name: cat,
                children: [],
                size: 0,
            });
        }
        const catNode = categoryMap.get(cat);
        catNode.children.push({
            name: item.name,
            size: item.sizeBytes || item.size || 0,
            path: item.path,
            risk: item.risk,
            confidence: item.confidence,
        });
        catNode.size += (item.sizeBytes || item.size || 0);
    }

    // Convert map to array and sort by size
    root.children = Array.from(categoryMap.values())
        .sort((a, b) => b.size - a.size);

    return root;
}

const useStore = create((set, get) => ({
    activeTab: 'smartCare',
    setActiveTab: (tab) => set({ activeTab: tab }),

    // Smart Scan Orchestration
    scanState: 'idle', // 'idle' | 'scanning' | 'complete'
    setScanState: (state) => set({ scanState: state }),

    // Cleanup Module State
    cleanupData: null,
    isScanningCleanup: false,
    isCleaning: false,

    // Apps Module State
    appTelemetryData: null,
    isScanningApps: false,

    // Combined metrics for dashboard
    metrics: {
        totalGb: 0,
        cachesGb: 0,
        appsCount: 0
    },

    // Computed errors
    error: null,
    setError: (error) => set({ error }),

    // Orchestrated Smart Scan
    runSmartScan: async () => {
        set({ scanState: 'scanning', error: null });

        try {
            // Execute both agent scans in parallel
            const [cleanupResult, appsResult] = await Promise.all([
                window.ipcRenderer.invoke('scan-system-junk'),
                window.ipcRenderer.invoke('scan-app-telemetry')
            ]);

            if (cleanupResult.status === 'error') throw new Error(cleanupResult.message);
            if (appsResult.status === 'error') throw new Error(appsResult.message);

            set({
                cleanupData: cleanupResult,
                appTelemetryData: appsResult,
                metrics: {
                    totalGb: Number((cleanupResult.totalBytes / (1024 ** 3)).toFixed(2)),
                    cachesGb: Number((cleanupResult.totalBytes / (1024 ** 3)).toFixed(2)), // simplification for UI
                    appsCount: appsResult.items.filter(a => a.category !== 'Active').length
                },
                scanState: 'complete'
            });
        } catch (err) {
            set({ error: err.message, scanState: 'idle' });
        }
    },

    // Manual Trigger for Cleanup Scan
    scanCleanup: async () => {
        set({ isScanningCleanup: true, error: null });
        try {
            const data = await window.ipcRenderer.invoke('scan-system-junk');
            if (data.status === 'error') throw new Error(data.message);
            set({ cleanupData: data });
        } catch (err) {
            set({ error: err.message });
        } finally {
            set({ isScanningCleanup: false });
        }
    },

    // Manual Trigger for Apps Scan
    scanApps: async () => {
        set({ isScanningApps: true, error: null });
        try {
            const data = await window.ipcRenderer.invoke('scan-app-telemetry');
            if (data.status === 'error') throw new Error(data.message);
            set({ appTelemetryData: data });
        } catch (err) {
            set({ error: err.message });
        } finally {
            set({ isScanningApps: false });
        }
    },

    // Execute Cleanup Shell Script
    executeCleanup: async (targetPaths) => {
        set({ isCleaning: true, error: null });
        try {
            const response = await window.ipcRenderer.invoke('execute-cleanup', targetPaths);
            if (response.status === 'error') throw new Error(response.message);

            // Rescan after cleanup to refresh findings
            if (response.status === 'success') {
                await get().scanCleanup();
            }
        } catch (err) {
            set({ error: err.message });
        } finally {
            set({ isCleaning: false });
        }
    },

    // ─── Storage Analyzer Layer ─────────────────────────────────────────────

    storageState: 'idle', // 'idle' | 'scanning' | 'complete'
    storageScanProgress: null,
    storageItems: [],
    storageTree: null,
    storageFullTree: null,
    storageDiskMap: null,
    storageDiskTotal: 0,
    storageDiskUsed: 0,
    storageDiskFree: 0,
    storageCategories: [],
    storageMetrics: null,
    storageAttestation: null,
    storageWarnings: [],
    storageRecommendations: [],
    storageStaleProjects: [],
    storageTimeline: [],
    storagePrediction: null,
    storageSkippedItems: [],
    storageReconciliation: null,
    storageScanLog: [],
    storageSearchQuery: '',
    storageFilters: { category: 'all', riskLevel: 'all', minSize: 0 },
    storageSortBy: 'size',
    storageSortDir: 'desc',
    storageSelectedPaths: new Set(),
    _storageListenerCleanup: null,

    startStorageScan: () => {
        // Reset state
        set({
            storageState: 'scanning',
            storageScanProgress: null,
            storageItems: [],
            storageTree: null,
            storageFullTree: null,
            storageDiskMap: null,
            storageDiskTotal: 0,
            storageDiskUsed: 0,
            storageDiskFree: 0,
            storageCategories: [],
            storageMetrics: null,
            storageAttestation: null,
            storageWarnings: [],
            storageRecommendations: [],
            storageStaleProjects: [],
            storageTimeline: [],
            storagePrediction: null,
            storageSkippedItems: [],
            storageReconciliation: null,
            storageScanLog: [],
            storageSelectedPaths: new Set(),
            error: null,
        });

        // Set up IPC listener for streaming events
        const cleanup = get()._storageListenerCleanup;
        if (cleanup) cleanup();

        const handler = (_event, data) => {
            const state = get();
            // Handle both 'type' and 'event' fields for compatibility
            const eventType = data.type || data.event;

            switch (eventType) {
                case 'start':
                    // Scan started
                    break;
                case 'progress':
                    set({
                        storageScanProgress: {
                            phase: data.phase,
                            currentPath: data.current_path,
                            filesProcessed: data.files_processed,
                            bytesScanned: data.bytes_scanned,
                            scanRateMbps: data.scan_rate_mbps,
                            etaSeconds: data.eta_seconds,
                            elapsed: data.elapsed || 0,
                            errorCount: data.error_count,
                            errors: data.errors || {},
                            lastError: data.last_error,
                        }
                    });
                    break;
                case 'warning':
                    set({ storageWarnings: [...state.storageWarnings, data] });
                    break;
                case 'item':
                    // Add item with proper field mapping
                    set({
                        storageItems: [...state.storageItems, {
                            id: data.id || data.path,
                            name: data.name,
                            path: data.path,
                            category: data.category,
                            description: data.description,
                            size: data.sizeBytes,
                            sizeBytes: data.sizeBytes,
                            sizeFormatted: data.sizeFormatted || data.size_formatted,
                            fileCount: data.fileCount || data.file_count,
                            lastUsed: data.lastUsed || data.last_used,
                            daysSinceUsed: data.daysSinceUsed || data.days_since_used,
                            risk: data.risk,
                            confidence: data.confidence,
                            recoveryNote: data.recoveryNote || data.recovery_note,
                        }]
                    });
                    break;
                case 'found':
                    set({ storageCategories: [...state.storageCategories, data] });
                    break;
                case 'complete':
                    // Normalize every item: guarantee size, sizeBytes, sizeFormatted all exist
                    const rawItems = data.items || state.storageItems;
                    const normalizedItems = rawItems.map(item => {
                        const bytes = item.sizeBytes || item.size || 0;
                        return {
                            id: item.id || item.path,
                            name: item.name,
                            path: item.path,
                            category: item.category,
                            description: item.description,
                            // Math-critical: always set BOTH size and sizeBytes to the same integer
                            size: bytes,
                            sizeBytes: bytes,
                            sizeFormatted: item.sizeFormatted || item.size_formatted || formatBytes(bytes),
                            fileCount: item.fileCount || item.file_count || 0,
                            lastUsed: item.lastUsed || item.last_used || item.last_accessed || 'Unknown',
                            daysSinceUsed: item.daysSinceUsed || item.days_since_used || 99999,
                            risk: item.risk || 'caution',
                            confidence: item.confidence,
                            recoveryNote: item.recoveryNote || item.recovery_note,
                        };
                    });
                    const tree = buildStorageTree(normalizedItems);
                    const categories = [...new Set(normalizedItems.map(i => i.category))];

                    set({
                        storageState: 'complete',
                        storageTree: tree,
                        storageFullTree: data.full_tree || null,
                        storageDiskMap: data.disk_map || null,
                        storageDiskTotal: data.disk_total || 0,
                        storageDiskUsed: data.disk_used || 0,
                        storageDiskFree: data.disk_free || 0,
                        storageItems: normalizedItems,
                        storageCategories: categories,
                        storageMetrics: data.metrics || null,
                        storageAttestation: data.attestation || null,
                        storageRecommendations: data.recommendations || [],
                        storageStaleProjects: data.stale_projects || [],
                        storageTimeline: data.timeline || [],
                        storagePrediction: data.prediction || null,
                        storageSkippedItems: data.skipped_items || [],
                        storageReconciliation: data.reconciliation || null,
                        storageScanProgress: null,
                    });
                    break;
                case 'error':
                    set({ error: data.message, storageState: 'idle' });
                    break;
            }
        };

        window.ipcRenderer.on('storage-scan-event', handler);
        set({
            _storageListenerCleanup: () => {
                window.ipcRenderer.off('storage-scan-event', handler);
            }
        });

        // Tell main process to start the scan
        window.ipcRenderer.send('start-storage-scan');
    },

    cancelStorageScan: () => {
        window.ipcRenderer.send('cancel-storage-scan');
        const cleanup = get()._storageListenerCleanup;
        if (cleanup) cleanup();
        set({
            storageState: 'idle',
            storageScanProgress: null,
            _storageListenerCleanup: null,
        });
    },

    setStorageSearch: (query) => set({ storageSearchQuery: query }),
    setStorageFilter: (filters) => set({ storageFilters: filters }),
    setStorageSort: (sortBy, sortDir) => set({ storageSortBy: sortBy, storageSortDir: sortDir }),

    toggleStoragePath: (path) => {
        const selected = new Set(get().storageSelectedPaths);
        if (selected.has(path)) selected.delete(path);
        else selected.add(path);
        set({ storageSelectedPaths: selected });
    },

    selectAllStoragePaths: (paths) => {
        set({ storageSelectedPaths: new Set(paths) });
    },

    clearStorageSelection: () => {
        set({ storageSelectedPaths: new Set() });
    },

    storageDeleteProgress: null,
    storageDeleteLog: [],

    deleteSelectedStoragePaths: async () => {
        const paths = Array.from(get().storageSelectedPaths);
        if (paths.length === 0) return;

        set({
            error: null,
            storageDeleteProgress: { completed: 0, total: paths.length },
            storageDeleteLog: [],
        });

        const log = [];
        let completed = 0;

        for (const filePath of paths) {
            try {
                const result = await window.ipcRenderer.invoke('execute-storage-delete', [filePath]);
                completed++;

                if (result.deleted && result.deleted.length > 0) {
                    // Look up size from items
                    const item = get().storageItems.find(i => i.path === filePath);
                    log.push({
                        status: 'success',
                        path: filePath,
                        freedBytes: item?.sizeBytes || 0,
                        message: `Moved to Trash`,
                    });
                } else if (result.failed && result.failed.length > 0) {
                    log.push({
                        status: 'error',
                        path: filePath,
                        freedBytes: 0,
                        message: result.failed[0]?.error || 'Failed',
                    });
                }
            } catch (err) {
                completed++;
                log.push({
                    status: 'error',
                    path: filePath,
                    freedBytes: 0,
                    message: err.message,
                });
            }

            set({
                storageDeleteProgress: { completed, total: paths.length },
                storageDeleteLog: [...log],
            });
        }

        // Remove successfully deleted items from the list
        const deletedSet = new Set(log.filter(e => e.status === 'success').map(e => e.path));
        set({
            storageItems: get().storageItems.filter(i => !deletedSet.has(i.path)),
            storageSelectedPaths: new Set(),
            storageDeleteProgress: { completed: paths.length, total: paths.length },
        });
    },

    exportStorageReport: async () => {
        try {
            const reportData = {
                items: get().storageItems,
                tree: get().storageTree,
                categories: get().storageCategories,
                total_formatted: formatBytes(get().storageItems.reduce((s, i) => s + (i.sizeBytes || 0), 0)),
                scan_date: new Date().toISOString(),
            };
            await window.ipcRenderer.invoke('export-storage-report', reportData);
        } catch (err) {
            set({ error: err.message });
        }
    },
}));

export default useStore;
