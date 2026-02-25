import { create } from 'zustand';

// Byte formatter — single source of truth for all size display math
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

const checkIpc = (set) => {
    if (!window.ipcRenderer) {
        set({ error: "Electron IPC missing. Please run the app via Electron, not a web browser (e.g. run 'npm run dev')." });
        return false;
    }
    return true;
};

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

    // ── Full Disk Access (FDA) Permission State ──────────────────────────────
    // fdaStatus: null = not yet checked, 'granted', 'denied', 'unknown'
    fdaStatus: null,
    fdaChecking: false,
    fdaDismissed: false, // user clicked "Scan Without Full Access"

    // Computed errors
    error: null,
    setError: (error) => set({ error }),

    // ── FDA Actions ───────────────────────────────────────────────────────────
    checkFdaStatus: async () => {
        if (!window.electronAPI?.checkFdaStatus) return { granted: true, confidence: 'low' };
        set({ fdaChecking: true });
        try {
            const result = await window.electronAPI.checkFdaStatus();
            set({
                fdaStatus: result.granted ? 'granted' : 'denied',
                fdaChecking: false,
            });
            return result;
        } catch (err) {
            set({ fdaStatus: 'unknown', fdaChecking: false });
            return { granted: true, confidence: 'low' };
        }
    },

    openFdaSettings: async () => {
        if (!window.electronAPI?.openFdaSettings) return;
        try {
            await window.electronAPI.openFdaSettings();
        } catch (err) {
            console.error('[FDA] Failed to open System Settings:', err);
        }
    },

    dismissFdaWarning: () => set({ fdaDismissed: true }),

    resetFda: () => set({ fdaStatus: null, fdaChecking: false, fdaDismissed: false }),

    // Orchestrated Smart Scan
    runSmartScan: async () => {
        if (!checkIpc(set)) return;
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
        if (!checkIpc(set)) return;
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
        if (!checkIpc(set)) return;
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
        if (!checkIpc(set)) return;
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
    storageSwarmStatus: {},
    storageSwarmInsights: [],
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

    startStorageScan: async () => {
        if (!checkIpc(set)) return;

        // ── FDA Gate ──────────────────────────────────────────────────────────
        // Check FDA status before launching the Python scanner.
        // If denied and the user hasn't dismissed the warning, set a pending
        // state that FDAGateModal will detect and display. Scan does NOT start
        // until user resolves the modal.
        const { fdaStatus, fdaDismissed } = get();
        const needsCheck = !fdaStatus || fdaStatus === null;
        if (needsCheck || fdaStatus === 'denied') {
            if (needsCheck) {
                // Run probe now (first time, or after reset)
                set({ fdaChecking: true });
                try {
                    const result = window.electronAPI?.checkFdaStatus
                        ? await window.electronAPI.checkFdaStatus()
                        : { granted: true, confidence: 'low' };
                    set({
                        fdaStatus: result.granted ? 'granted' : 'denied',
                        fdaChecking: false,
                    });
                    // If denied and user hasn't dismissed, abort — let modal handle it
                    if (!result.granted && !fdaDismissed) {
                        // storageState stays 'idle' — FDAGateModal is shown by StorageAnalyzer
                        set({ storageState: 'fda_gate' });
                        return;
                    }
                } catch (_) {
                    set({ fdaStatus: 'unknown', fdaChecking: false });
                }
            } else if (fdaStatus === 'denied' && !fdaDismissed) {
                // Already know it's denied and user hasn't dismissed
                set({ storageState: 'fda_gate' });
                return;
            }
        }

        // Reset all state
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
            storageSwarmStatus: {},
            storageSwarmInsights: [],
            storageTimeline: [],
            storagePrediction: null,
            storageSkippedItems: [],
            storageReconciliation: null,
            storageScanLog: [],
            storageSelectedPaths: new Set(),
            error: null,
        });

        if (!checkIpc(set)) {
            set({ storageState: 'idle' });
            return;
        }

        // Clean up any previous listener
        const prevCleanup = get()._storageListenerCleanup;
        if (prevCleanup) prevCleanup();

        // Track current scanId to discard stale events from cancelled scans
        let activeScanId = null;

        const handler = (_event, snapshot) => {
            // ── Snapshot format (new) ──────────────────────────────────────
            if (snapshot && snapshot.type === 'snapshot') {
                const { scanId, status, progress, addedItems, totals, complete, warnings, error, agentStatusUpdates, newInsights } = snapshot;

                // Bind scanId on first event
                if (!activeScanId) activeScanId = scanId;
                // Discard events from a different (stale) scan
                if (scanId !== activeScanId) return;

                // Build one Zustand update object — ONE re-render per tick
                const update = {};

                if (progress) {
                    update.storageScanProgress = {
                        phase: progress.phase,
                        currentPath: progress.dir,
                        filesProcessed: progress.files || 0,
                        bytesScanned: progress.bytes || 0,
                        scanRateMbps: progress.rate_mbps || 0,
                        etaSeconds: progress.eta_seconds ?? -1,
                        elapsed: progress.elapsed || 0,
                    };
                }

                // Append items in O(items) — not O(total) — with single spread
                if (addedItems && addedItems.length > 0) {
                    const normalized = addedItems.map(item => {
                        const bytes = item.sizeBytes || item.size || 0;
                        return {
                            id: item.id || item.path,
                            name: item.name,
                            path: item.path,
                            category: item.category,
                            description: item.description,
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
                    const currentItems = get().storageItems;
                    update.storageItems = [...currentItems, ...normalized];
                    // Update category list without O(n) rebuild every tick
                    const catSet = new Set(get().storageCategories);
                    normalized.forEach(i => i.category && catSet.add(i.category));
                    update.storageCategories = Array.from(catSet);
                }

                // Totals come from backend — never recompute in frontend
                if (totals) {
                    if (totals.disk_total != null) update.storageDiskTotal = totals.disk_total;
                    if (totals.disk_used != null) update.storageDiskUsed = totals.disk_used;
                    if (totals.disk_free != null) update.storageDiskFree = totals.disk_free;
                }

                // Cap warnings and log at 100 entries (FIFO)
                if (warnings && warnings.length > 0) {
                    const prev = get().storageWarnings;
                    update.storageWarnings = [...prev, ...warnings].slice(-100);
                }

                if (agentStatusUpdates && agentStatusUpdates.length > 0) {
                    const prevStatus = get().storageSwarmStatus || {};
                    const newStatus = { ...prevStatus };
                    for (const agent of agentStatusUpdates) {
                        newStatus[agent.agent_id] = {
                            id: agent.agent_id,
                            status: agent.status,
                            type: agent.type
                        };
                    }
                    update.storageSwarmStatus = newStatus;
                }

                if (newInsights && newInsights.length > 0) {
                    const prevInsights = get().storageSwarmInsights || [];
                    update.storageSwarmInsights = [...prevInsights, ...newInsights];
                }

                if (status === 'done' && complete) {
                    const rawItems = complete.items || get().storageItems;
                    const normalizedAll = rawItems.map(item => {
                        const bytes = item.sizeBytes || item.size || 0;
                        return {
                            id: item.id || item.path, name: item.name, path: item.path,
                            category: item.category, description: item.description,
                            size: bytes, sizeBytes: bytes,
                            sizeFormatted: item.sizeFormatted || item.size_formatted || formatBytes(bytes),
                            fileCount: item.fileCount || item.file_count || 0,
                            lastUsed: item.lastUsed || item.last_used || item.last_accessed || 'Unknown',
                            daysSinceUsed: item.daysSinceUsed || item.days_since_used || 99999,
                            risk: item.risk || 'caution',
                            confidence: item.confidence,
                            recoveryNote: item.recoveryNote || item.recovery_note,
                        };
                    });
                    update.storageState = 'complete';
                    update.storageItems = normalizedAll;
                    update.storageTree = buildStorageTree(normalizedAll);
                    update.storageCategories = [...new Set(normalizedAll.map(i => i.category))];
                    update.storageFullTree = complete.full_tree || null;
                    update.storageDiskMap = complete.disk_map || null;
                    update.storageDiskTotal = complete.disk_total || totals?.disk_total || 0;
                    update.storageDiskUsed = complete.disk_used || totals?.disk_used || 0;
                    update.storageDiskFree = complete.disk_free || totals?.disk_free || 0;
                    update.storageMetrics = complete.metrics || null;
                    update.storageAttestation = complete.attestation || null;
                    update.storageRecommendations = complete.recommendations || [];
                    update.storageStaleProjects = complete.stale_projects || [];
                    update.storageTimeline = complete.timeline || [];
                    update.storagePrediction = complete.prediction || null;
                    update.storageSkippedItems = complete.skipped_items || [];
                    update.storageReconciliation = complete.reconciliation || null;
                    update.storageScanProgress = null;
                    activeScanId = null;
                }

                if (status === 'error' && error) {
                    update.error = error.message;
                    update.storageState = 'idle';
                    activeScanId = null;
                }

                if (status === 'cancelled') {
                    update.storageState = 'idle';
                    update.storageScanProgress = null;
                    activeScanId = null;
                }

                // ── ONE set() call = ONE React re-render ──────────────────
                set(update);
                return;
            }

            // ── Legacy passthrough format (fallback) ──────────────────────
            const state = get();
            const eventType = snapshot.type || snapshot.event;

            switch (eventType) {
                case 'progress':
                    set({
                        storageScanProgress: {
                            phase: snapshot.phase, currentPath: snapshot.current_path,
                            filesProcessed: snapshot.files_processed, bytesScanned: snapshot.bytes_scanned,
                            scanRateMbps: snapshot.scan_rate_mbps, etaSeconds: snapshot.eta_seconds,
                            elapsed: snapshot.elapsed || 0,
                        }
                    });
                    break;
                case 'batch':
                    if (Array.isArray(snapshot.items)) {
                        set({ storageItems: [...state.storageItems, ...snapshot.items] });
                    }
                    break;
                case 'item':
                    set({ storageItems: [...state.storageItems, snapshot] });
                    break;
                case 'error':
                    set({ error: snapshot.message, storageState: 'idle' });
                    break;
            }
        };

        window.ipcRenderer.on('storage-scan-event', handler);
        set({
            _storageListenerCleanup: () => {
                window.ipcRenderer.off('storage-scan-event', handler);
            }
        });

        window.ipcRenderer.send('start-storage-scan');
    },

    cancelStorageScan: () => {
        if (!window.ipcRenderer) return;
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
        if (!checkIpc(set)) return;
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
        if (!checkIpc(set)) return;
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
    closeDeleteProgressModal: () => {
        set({
            storageDeleteProgress: null,
            storageDeleteLog: []
        });
    }
}));

export default useStore;
