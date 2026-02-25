const { contextBridge, ipcRenderer } = require('electron')

// ═══════════════════════════════════════════════════════════════════════════════
// Expose APIs to the Renderer process
// ═══════════════════════════════════════════════════════════════════════════════

contextBridge.exposeInMainWorld('ipcRenderer', {
    on(...args) {
        const [channel, listener] = args
        return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
    },
    off(...args) {
        const [channel, ...omit] = args
        return ipcRenderer.off(channel, ...omit)
    },
    send(...args) {
        const [channel, ...omit] = args
        return ipcRenderer.send(channel, ...omit)
    },
    invoke(...args) {
        const [channel, ...omit] = args
        return ipcRenderer.invoke(channel, ...omit)
    }
})

// Expose window control APIs
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    windowMinimize: () => ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => ipcRenderer.invoke('window-maximize'),
    windowClose: () => ipcRenderer.invoke('window-close'),
    windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

    // Storage scan
    startStorageScan: () => ipcRenderer.send('start-storage-scan'),
    cancelStorageScan: () => ipcRenderer.send('cancel-storage-scan'),
    onStorageScanEvent: (callback) => {
        ipcRenderer.on('storage-scan-event', (event, data) => callback(data))
    },

    // Full Disk Access
    checkFdaStatus: () => ipcRenderer.invoke('check-fda-status'),
    openFdaSettings: () => ipcRenderer.invoke('open-fda-settings'),
})
