import { create } from 'zustand';

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
    }
}));

export default useStore;
