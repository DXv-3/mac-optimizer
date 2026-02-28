import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Shield, HardDrive, Cpu, Battery, Wifi, Usb, Zap, AlertTriangle, XCircle, CheckCircle, Trash2, X, MessageSquare, Info, FileText, ChevronRight, RefreshCw, Play, ExternalLink, ShieldCheck, Download, FolderOpen } from 'lucide-react';
import useStore from '../../store/useStore';
import SunburstChart from './SunburstChart';
import TreemapChart from './TreemapChart';
import ScanProgress from './ScanProgress';
import ItemList from './ItemList';
import SearchBar from './SearchBar';
import DeleteConfirmModal from './DeleteConfirmModal';
import SkippedItemsPanel from './SkippedItemsPanel';
import DeleteProgress from './DeleteProgress';
import FDAGateModal from './FDAGateModal';

const CATEGORY_LABELS = {
    'System Data': { name: 'System Data', color: 'indigo' },
    'Applications': { name: 'Applications', color: 'pink' },
    'Music & Movies': { name: 'Music & Movies', color: 'amber' },
    'Documents': { name: 'Documents', color: 'teal' },
    'App Data': { name: 'App Data', color: 'cyan' },
    'Developer': { name: 'Developer', color: 'violet' },
    'Photos': { name: 'Photos', color: 'pink' },
    'Mail & Messages': { name: 'Mail & Messages', color: 'indigo' },
    'Cleanable Junk': { name: 'Cleanable Junk', color: 'cyan' },
    'System & Hidden': { name: 'System & Hidden', color: 'indigo' },
    'Other': { name: 'Other', color: 'amber' },
};

const COLOR_MAP = {
    cyan: 'from-cyan-500 to-cyan-600',
    violet: 'from-violet-500 to-violet-600',
    pink: 'from-pink-500 to-pink-600',
    amber: 'from-amber-500 to-amber-600',
    teal: 'from-teal-500 to-teal-600',
    indigo: 'from-indigo-500 to-indigo-600',
};

const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
};

export default function StorageAnalyzer() {
    const {
        storageState: globalStorageState,
        storageSearchQuery, storageFilters,
        storageSortBy, storageSortDir, storageSelectedPaths,
        storageInterrogating,
        storageInterrogationResult,
        interrogateStorageItem,
        resetInterrogation,
        storageRecommendations, storageStaleProjects, storagePrediction,
        storageDeleteProgress, storageDeleteLog,
        setStorageSearch,
        setStorageFilter, setStorageSort, toggleStoragePath,
        selectAllStoragePaths, clearStorageSelection,
        deleteSelectedStoragePaths, exportStorageReport,
        fdaStatus, fdaDismissed, openFdaSettings,
        storageSwarmStatus, storageSwarmInsights,
        startStorageScan, dismissFdaWarning
    } = useStore();

    // Scan State Machine: 'idle', 'scanning', 'analyzing', 'complete', 'error'
    const [scanState, setScanState] = useState('idle');
    const [scanProgress, setScanProgress] = useState(null);
    const [scanError, setScanError] = useState(null);
    const [scanLog, setScanLog] = useState([]);
    const [scanStats, setScanStats] = useState({ filesProcessed: 0, bytesScanned: 0 });
    const [scanStartTime, setScanStartTime] = useState(null);

    // High-performance data accumulation refs
    const itemsRef = useRef([]);
    const categoryMapRef = useRef(new Map());

    // Render-triggered states
    const [renderTrigger, setRenderTrigger] = useState(0);
    const [storageItems, setStorageItems] = useState([]);
    const [storageTree, setStorageTree] = useState(null);
    const [storageCategories, setStorageCategories] = useState([]);

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [activeAgent, setActiveAgent] = useState(null);
    const [sunburstZoomPath, setSunburstZoomPath] = useState(null);
    const [vizMode, setVizMode] = useState('sunburst'); // default to sunburst
    const [sunburstView, setSunburstView] = useState('full');
    const [contextMenu, setContextMenu] = useState(null);

    // 15fps Render Loop
    useEffect(() => {
        if (scanState !== 'scanning' && scanState !== 'analyzing') return;

        const interval = setInterval(() => {
            // DO NOT copy itemsRef.current here. V8 Memory Leak for millions of items!
            setStorageCategories(Array.from(categoryMapRef.current.keys()));
            setRenderTrigger(t => t + 1);
        }, 66);

        return () => clearInterval(interval);
    }, [scanState]);

    const startScan = useCallback(async () => {
        // Use the store's FDA-checking start function
        await startStorageScan();
        // Sync local state with global state
        setScanState('scanning');
        setScanProgress(null);
        setScanError(null);
        setScanLog([]);
        setScanStats({ filesProcessed: 0, bytesScanned: 0 });
        setScanStartTime(Date.now());
    }, [startStorageScan]);

    const cancelScan = useCallback(() => {
        if (window.ipcRenderer) {
            window.ipcRenderer.send('cancel-storage-scan');
        }
        setScanState('idle');
        setScanStartTime(null);
    }, []);

    // IPC Listener for storage-scan-event
    useEffect(() => {
        if (!window.ipcRenderer) return;

        const handleBatch = (event, payload) => {
            if (payload.status === 'scanning') setScanState('scanning');
            if (payload.status === 'error') {
                setScanState('error');
                setScanError(payload.error || 'Unknown error');
                // Add error to log
                setScanLog(prev => [...prev, {
                    status: 'error',
                    path: 'System',
                    message: payload.error || 'Unknown error',
                    timestamp: Date.now()
                }]);
                return;
            }

            if (payload.items && payload.items.length > 0) {
                // Determine phase roughly based on volume
                if (itemsRef.current.length > 50000 && scanState !== 'analyzing') {
                    setScanState('analyzing');
                }

                let batchBytes = 0;
                let batchCount = payload.items.length;

                payload.items.forEach(item => {
                    const bytes = item.sizeBytes || item.size || 0;
                    batchBytes += bytes;

                    // Comprehensive macOS classification
                    let cat = 'Other';
                    const p = item.path.toLowerCase();

                    if (p.includes('/applications/') || p.endsWith('.app')) cat = 'Applications';
                    else if (p.includes('/library/developer/') || p.includes('/node_modules/') || p.includes('/.rustup') || p.includes('/.cargo')) cat = 'Developer';
                    else if (p.includes('/library/caches/') || p.includes('/library/logs/') || p.includes('/.npm')) cat = 'Cleanable Junk';
                    else if (p.includes('/library/containers/com.apple.mail') || p.includes('/library/messages')) cat = 'Mail & Messages';
                    else if (p.includes('/pictures/')) cat = 'Photos';
                    else if (p.includes('/music/') || p.includes('/movies/') || p.endsWith('.mp3') || p.endsWith('.mp4') || p.endsWith('.mov')) cat = 'Music & Movies';
                    else if (p.includes('/documents/') || p.includes('/desktop/') || p.includes('/downloads/')) cat = 'Documents';
                    else if (p.includes('/library/') || p.includes('/system/') || p.includes('/private/') || p.includes('/usr/')) cat = 'System Data';
                    else if (p.startsWith('/.') || p.includes('/hidden')) cat = 'System & Hidden';

                    if (!categoryMapRef.current.has(cat)) categoryMapRef.current.set(cat, 0);
                    categoryMapRef.current.set(cat, categoryMapRef.current.get(cat) + bytes);

                    itemsRef.current.push({
                        ...item,
                        id: item.path,
                        category: cat,
                        sizeBytes: bytes,
                        sizeFormatted: item.sizeFormatted || formatSize(bytes),
                        risk: item.path.includes('/Library/') ? 'caution' : 'safe'
                    });
                });

                setScanStats(prev => ({
                    filesProcessed: prev.filesProcessed + batchCount,
                    bytesScanned: prev.bytesScanned + batchBytes
                }));

                // Add info log entry for batch
                setScanLog(prev => [...prev, {
                    status: 'info',
                    path: `Batch: ${payload.items[0]?.path?.substring(0, 50) || 'Unknown'}...`,
                    message: `Processed ${payload.items.length} items`,
                    timestamp: Date.now()
                }].slice(-100));
            }

            if (payload.status === 'complete' || payload.status === 'cancelled') {
                setScanState(payload.status === 'cancelled' ? 'idle' : 'complete');
                setStorageItems([...itemsRef.current]);
                setStorageCategories(Array.from(categoryMapRef.current.keys()));

                // Build Tree
                const root = { name: 'Storage', children: [] };
                for (const [cat, size] of categoryMapRef.current.entries()) {
                    root.children.push({ name: cat, size, children: [] });
                }
                setStorageTree(root);

                // Add completion log entry
                setScanLog(prev => [...prev, {
                    status: 'success',
                    path: 'System',
                    message: payload.status === 'cancelled' ? 'Scan cancelled' : 'Scan complete',
                    timestamp: Date.now()
                }]);
            }
        };

        window.ipcRenderer.on('storage-scan-event', handleBatch);
        return () => window.ipcRenderer.off('storage-scan-event', handleBatch);
    }, [scanState]); // removed scanStats dependency to prevent hook tearing

    // Filter and sort items
    const filteredItems = useMemo(() => {
        let filtered = [...storageItems];

        if (storageSearchQuery) {
            try {
                const regex = new RegExp(storageSearchQuery, 'i');
                filtered = filtered.filter(item => regex.test(item.name) || regex.test(item.path));
            } catch {
                const q = storageSearchQuery.toLowerCase();
                filtered = filtered.filter(item => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q));
            }
        }

        if (storageFilters.category !== 'all') {
            filtered = filtered.filter(item => item.category === storageFilters.category);
        }
        if (storageFilters.riskLevel !== 'all') {
            filtered = filtered.filter(item => item.risk === storageFilters.riskLevel);
        }
        if (storageFilters.minSize > 0) {
            filtered = filtered.filter(item => (item.sizeBytes || 0) >= storageFilters.minSize);
        }

        filtered.sort((a, b) => {
            let cmp = 0;
            switch (storageSortBy) {
                case 'size': cmp = (a.sizeBytes || 0) - (b.sizeBytes || 0); break;
                case 'name': cmp = a.name.localeCompare(b.name); break;
                case 'risk': {
                    const riskOrder = { safe: 0, caution: 1, critical: 2 };
                    cmp = (riskOrder[a.risk] || 0) - (riskOrder[b.risk] || 0);
                    break;
                }
                case 'date': cmp = (a.lastUsed || '').localeCompare(b.lastUsed || ''); break;
                default: cmp = (a.sizeBytes || 0) - (b.sizeBytes || 0);
            }
            return storageSortDir === 'desc' ? -cmp : cmp;
        });

        return filtered;
    }, [storageItems, storageSearchQuery, storageFilters, storageSortBy, storageSortDir]);

    const totalBytes = scanStats.bytesScanned || 0;

    const selectedItems = useMemo(() =>
        storageItems.filter(item => storageSelectedPaths.has(item.path)), [storageItems, storageSelectedPaths]);

    const selectedTotalSize = useMemo(() =>
        selectedItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0), [selectedItems]);

    const safeItems = useMemo(() =>
        storageItems.filter(item => item.risk === 'safe'), [storageItems]);

    const safeTotalBytes = useMemo(() =>
        safeItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0), [safeItems]);

    // Category breakdown for the strip
    const categoryBreakdown = useMemo(() => {
        const cats = {};
        let total = 0;
        categoryMapRef.current.forEach((bytes, cat) => {
            cats[cat] = { bytes };
            total += bytes;
        });

        const effectiveTotal = total > 0 ? total : 1;
        return Object.entries(cats)
            .map(([id, data]) => ({
                id,
                ...data,
                pct: Math.min(100, (data.bytes / effectiveTotal) * 100)
            }))
            .sort((a, b) => b.bytes - a.bytes);
    }, [renderTrigger, scanState, storageCategories]);

    const handleContextMenu = useCallback((e, item) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    }, []);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.metaKey && e.key === 'a') {
                e.preventDefault();
                selectAllStoragePaths(filteredItems.map(i => i.path));
            }
            if (e.key === 'Escape') {
                clearStorageSelection();
                setContextMenu(null);
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (storageSelectedPaths.size > 0) {
                    setShowDeleteModal(true);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [filteredItems, storageSelectedPaths, selectAllStoragePaths, clearStorageSelection]);

    const handleSelectAllSafe = useCallback(() => {
        selectAllStoragePaths(safeItems.map(i => i.path));
    }, [safeItems, selectAllStoragePaths]);

    return (
        <div className="flex flex-col max-w-[1400px] mx-auto pb-32 relative">
            {/* FDA Gate Modal — absolute overlay, shown when storageState === 'fda_gate' */}
            <FDAGateModal onScanReady={startScan} />

            {/* Header - Sticky for fluid layout */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="sticky top-0 z-40 bg-[#0d0600]/80 backdrop-blur-xl flex justify-between items-center py-6 mb-2 border-b border-white/[0.05] shadow-xl"
            >
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">
                        Storage Analyzer
                    </h2>
                    <p className="text-zinc-400 mt-1 text-sm">
                        Explore your disk space through an interactive map of every byte.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* FDA Debug Button - remove in production */}
                    {process.env.NODE_ENV === 'development' && (
                        <motion.button
                            onClick={() => {
                                useStore.setState({ fdaStatus: null, fdaDismissed: false, storageState: 'idle' });
                                setScanState('idle');
                            }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                            title="Reset FDA state for testing"
                        >
                            Reset FDA
                        </motion.button>
                    )}
                    {scanState === 'scanning' || scanState === 'analyzing' ? (
                        <motion.button
                            onClick={cancelScan}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-5 py-2.5 rounded-xl font-medium transition-colors backdrop-blur-md flex items-center gap-2"
                        >
                            <XCircle size={14} /> Cancel
                        </motion.button>
                    ) : (
                        <motion.button
                            onClick={startScan}
                            whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(88, 166, 255, 0.2)' }}
                            whileTap={{ scale: 0.95 }}
                            className="btn-animated-gradient text-white px-6 py-2.5 rounded-xl font-bold border-none transition-colors flex items-center gap-2"
                        >
                            {scanState === 'complete' ? <RefreshCw size={16} /> : <Play size={16} />}
                            {scanState === 'complete' ? 'Rescan' : 'Start Scan'}
                        </motion.button>
                    )}
                </div>
            </motion.div>

            {/* Degraded Mode Banner */}
            <AnimatePresence>
                {fdaStatus === 'denied' && fdaDismissed && storageState !== 'idle' && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginBottom: '12px' }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.3 }}
                        className="shrink-0 overflow-hidden"
                    >
                        <div
                            className="flex items-center justify-between px-4 py-2.5 rounded-2xl"
                            style={{
                                background: 'rgba(245,158,11,0.07)',
                                border: '1px solid rgba(245,158,11,0.18)',
                            }}
                        >
                            <div className="flex items-center gap-2.5">
                                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                                <span className="text-xs text-amber-300/80">
                                    <span className="font-semibold text-amber-300">Limited scan</span>
                                    {' '}— protected folders like Mail and Safari were skipped.
                                </span>
                            </div>
                            <button
                                onClick={openFdaSettings}
                                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors ml-4 shrink-0"
                            >
                                <ExternalLink size={11} /> Grant Access
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {/* Idle / Welcome State */}
                {(scanState === 'idle' || scanState === 'fda_gate') && (
                    <motion.div
                        key="idle"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="flex-1 flex flex-col items-center justify-center text-center py-20"
                    >
                        <div className="relative mb-8">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                                className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-amber-500/20 rounded-full blur-3xl"
                            />
                            <div className="relative bg-white/5 p-8 rounded-[40px] border border-white/10 shadow-2xl backdrop-blur-xl">
                                <HardDrive size={80} className="text-orange-400 drop-shadow-lg" />
                            </div>
                        </div>
                        <h3 className="text-3xl font-extrabold tracking-tight text-white mb-4">
                            Deep Disk Visualization
                        </h3>
                        <p className="text-zinc-400 text-lg max-w-lg mx-auto leading-relaxed mb-8">
                            Map every byte of your disk to find hidden bloat, stale dev caches, and old building folder.
                        </p>
                    </motion.div>
                )}

                {/* Scanning / Swarm State */}
                {(scanState === 'scanning' || scanState === 'analyzing') && (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col gap-6 py-4"
                    >
                        {/* Swarm Status Panel */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-[32px] p-6 backdrop-blur-md shadow-2xl">
                            <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2 mb-4">
                                <Zap size={16} /> Swarm Intelligence Network Active
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {storageSwarmStatus && Object.values(storageSwarmStatus).map(agent => (
                                    <motion.button
                                        key={agent.id}
                                        whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.08)' }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setActiveAgent(agent)}
                                        className="bg-white/[0.05] border border-white/[0.05] rounded-2xl p-4 flex flex-col gap-2 text-left transition-all"
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className={`text-[10px] uppercase tracking-widest font-black ${agent.type === 'explorer' ? 'text-blue-400' : 'text-purple-400'}`}>
                                                {agent.id}
                                            </span>
                                            {agent.status.includes('Finished') || agent.status === 'Idle' ? (
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                                            ) : (
                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_#06b6d4]" />
                                            )}
                                        </div>
                                        <div className="text-[10px] text-zinc-400 line-clamp-1 opacity-70 font-mono" title={agent.status}>
                                            {agent.status}
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                        </div>

                        {/* macOS Style Interactive Storage Bar */}
                        <div className="mt-8 px-6 pb-2">
                            <div className="flex justify-between items-end mb-3">
                                <h2 className="text-xl font-medium text-white flex items-center gap-2">
                                    <HardDrive size={20} className="text-orange-400" />
                                    Macintosh HD
                                </h2>
                                <span className="font-mono text-zinc-400 text-sm">
                                    {scanStats.filesProcessed.toLocaleString()} items indexed
                                </span>
                            </div>

                            {/* The Bar */}
                            <div className="h-6 w-full bg-white/5 rounded-full overflow-hidden flex shadow-inner border border-white/5">
                                <AnimatePresence>
                                    {categoryBreakdown.map((cat, idx) => (
                                        <motion.div
                                            key={cat.id}
                                            initial={{ width: 0, opacity: 0 }}
                                            animate={{ width: `${cat.pct}%`, opacity: 1 }}
                                            exit={{ width: 0, opacity: 0 }}
                                            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                                            className={`h-full ${COLOR_MAP[CATEGORY_LABELS[cat.id]?.color || 'indigo']} border-r border-black/20`}
                                            title={`${CATEGORY_LABELS[cat.id]?.name || cat.id}: ${formatSize(cat.bytes)}`}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>

                            {/* Legend */}
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 px-1">
                                <AnimatePresence>
                                    {categoryBreakdown.map((cat) => (
                                        <motion.div
                                            key={`legend-${cat.id}`}
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.9 }}
                                            className="flex items-center gap-2 text-xs"
                                        >
                                            <span className={`w-2 h-2 rounded-full ${COLOR_MAP[CATEGORY_LABELS[cat.id]?.color || 'indigo'].split(' ')[0].replace('from-', 'bg-')}`} />
                                            <span className="text-zinc-300 font-medium">{CATEGORY_LABELS[cat.id]?.name || cat.id}</span>
                                            <span className="text-zinc-500 font-mono">{formatSize(cat.bytes)}</span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>

                            {/* Scanning pulse indicator */}
                            {scanState === 'scanning' && (
                                <div className="mt-12 flex items-center justify-center gap-3 opacity-60">
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                        className="w-5 h-5 rounded-full border-2 border-orange-500/30 border-t-orange-500"
                                    />
                                    <span className="text-sm font-medium text-orange-400 animate-pulse tracking-wide uppercase">
                                        Analyzing File System...
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Scan Progress Detail Panel */}
                        <div className="h-[400px]">
                            <ScanProgress
                                progress={{
                                    phase: scanState === 'analyzing' ? 'deep' : 'fast',
                                    currentPath: storageItems.length > 0 ? storageItems[storageItems.length - 1]?.path?.substring(0, 60) + '...' : 'Scanning...',
                                    filesProcessed: scanStats.filesProcessed,
                                    bytesScanned: scanStats.bytesScanned,
                                    scanRateMbps: scanStats.bytesScanned / ((Date.now() - scanStartTime) / 1000 + 1) / (1024 * 1024),
                                    elapsed: Math.floor((Date.now() - scanStartTime) / 1000),
                                    errorCount: scanLog.filter(l => l.status === 'error').length
                                }}
                                items={storageItems}
                                categories={storageCategories}
                                log={scanLog}
                            />
                        </div>
                    </motion.div>
                )}

                {/* Complete State */}
                {scanState === 'complete' && (
                    <motion.div
                        key="complete"
                        initial={{ opacity: 0, y: 20, scale: 0.95, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -20, scale: 0.95, filter: 'blur(8px)' }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="flex-1 flex flex-col space-y-8 py-4"
                    >
                        {/* Summary Bar */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-cyan-500/[0.07] border border-cyan-500/15 text-cyan-400 p-6 rounded-[32px] backdrop-blur-xl shadow-lg"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center">
                                    <HardDrive className="mr-3 h-6 w-6 text-cyan-400" />
                                    <span className="text-base">
                                        Found <strong>{storageItems.length}</strong> items totaling{' '}
                                        <strong className="text-2xl ml-1">{formatSize(totalBytes)}</strong>
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    {safeItems.length > 0 && (
                                        <motion.button
                                            onClick={handleSelectAllSafe}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                                        >
                                            <ShieldCheck size={14} /> Select Safe ({formatSize(safeTotalBytes)})
                                        </motion.button>
                                    )}
                                    <motion.button
                                        onClick={() => exportStorageReport()}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        className="bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5"
                                    >
                                        <Download size={14} /> Export
                                    </motion.button>
                                </div>
                            </div>

                            <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.04] mb-4">
                                {categoryBreakdown.map((cat, idx) => {
                                    const meta = CATEGORY_LABELS[cat.id] || { color: 'indigo' };
                                    return (
                                        <motion.div
                                            key={cat.id}
                                            initial={{ width: 0 }}
                                            animate={{ width: `${cat.pct}%` }}
                                            transition={{ duration: 0.8, delay: idx * 0.08 }}
                                            className={`h-full bg-gradient-to-r ${COLOR_MAP[meta.color] || COLOR_MAP.indigo}`}
                                        />
                                    );
                                })}
                            </div>

                            <div className="flex flex-wrap gap-x-5 gap-y-2">
                                {categoryBreakdown.map(cat => {
                                    const meta = CATEGORY_LABELS[cat.id] || { name: cat.id, color: 'indigo' };
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => setStorageFilter({ ...storageFilters, category: storageFilters.category === cat.id ? 'all' : cat.id })}
                                            className={`flex items-center gap-2 text-[11px] transition-all cursor-pointer ${storageFilters.category === cat.id ? 'text-white font-bold' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <span className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${COLOR_MAP[meta.color]}`} />
                                            {meta.name} <span className="font-mono opacity-60 ml-1">{formatSize(cat.bytes)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </motion.div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.1 }}
                                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] rounded-[32px] p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] flex flex-col h-[650px] lg:sticky lg:top-[120px]"
                            >
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xs uppercase font-bold text-zinc-500 tracking-widest">Visual Map</h3>
                                    <div className="flex bg-white/5 rounded-[14px] p-1 text-[11px] font-medium tracking-wide">
                                        {['sunburst', 'treemap'].map((mode) => (
                                            <button
                                                key={mode}
                                                onClick={() => setVizMode(mode)}
                                                className={`relative px-4 py-1.5 rounded-[10px] transition-colors ${vizMode === mode ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                            >
                                                {vizMode === mode && (
                                                    <motion.div
                                                        layoutId="viz-mode-bg"
                                                        className="absolute inset-0 bg-white/10 rounded-[10px] border border-white/10"
                                                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                                    />
                                                )}
                                                <span className="relative z-10 capitalize">{mode}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex-1 min-h-0 bg-black/10 rounded-2xl overflow-hidden">
                                    {vizMode === 'treemap' ? (
                                        <TreemapChart
                                            data={storageFullTree || storageTree}
                                            onItemClick={(item) => item.path && toggleStoragePath(item.path)}
                                            onContextMenu={(e, item) => setContextMenu({ x: e.clientX, y: e.clientY, item })}
                                        />
                                    ) : (
                                        <SunburstChart
                                            data={sunburstView === 'full' && storageFullTree ? storageFullTree : storageTree}
                                            zoomPath={sunburstZoomPath}
                                            onZoom={setSunburstZoomPath}
                                            onItemClick={(item) => item.path && toggleStoragePath(item.path)}
                                        />
                                    )}
                                </div>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.2 }}
                                className="flex flex-col space-y-4"
                            >
                                <div className="bg-white/[0.03] border border-white/10 rounded-[32px] p-6 backdrop-blur-md">
                                    <SearchBar
                                        query={storageSearchQuery}
                                        onQueryChange={setStorageSearch}
                                        filters={storageFilters}
                                        onFilterChange={setStorageFilter}
                                        categories={storageCategories}
                                    />
                                </div>
                                <div className="bg-white/[0.03] border border-white/10 rounded-[32px] overflow-hidden p-2">
                                    <ItemList
                                        items={filteredItems}
                                        selectedPaths={storageSelectedPaths}
                                        onTogglePath={toggleStoragePath}
                                        onContextMenu={handleContextMenu}
                                        sortBy={storageSortBy}
                                        sortDir={storageSortDir}
                                        onSort={setStorageSort}
                                    />
                                </div>
                            </motion.div>
                        </div>

                        {/* Agent Insights Panel */}
                        {(storageRecommendations.length > 0 || storagePrediction || storageStaleProjects.length > 0) && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-white/[0.02] border border-white/[0.06] rounded-[32px] p-8"
                            >
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-black mb-6 flex items-center gap-2">
                                    <Zap size={14} className="text-amber-400" />
                                    Swarm Intelligence Insights
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {storagePrediction && (
                                        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10">
                                            <div className="text-[10px] text-red-400 uppercase font-black mb-1">Space Alert</div>
                                            <div className="text-sm text-zinc-300">
                                                Disk full in <span className="text-white font-bold">{storagePrediction.days_until_full} days</span> at current growth.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Float Action Bar */}
            <AnimatePresence>
                {storageSelectedPaths.size > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[50] flex items-center gap-6 px-8 py-5 rounded-[40px] bg-[#1a1a1a]/95 border border-white/10 shadow-2xl backdrop-blur-2xl"
                    >
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Selected</span>
                            <span className="text-base font-black text-white">
                                {storageSelectedPaths.size} items <span className="text-zinc-500 ml-1 font-normal opacity-60">({formatSize(selectedTotalSize)})</span>
                            </span>
                        </div>
                        <div className="h-8 w-px bg-white/10" />
                        <div className="flex items-center gap-3">
                            <button
                                onClick={clearStorageSelection}
                                className="px-5 py-2.5 rounded-2xl text-xs font-bold text-zinc-400 hover:text-white transition-colors"
                            >
                                Deselect
                            </button>
                            <motion.button
                                onClick={() => setShowDeleteModal(true)}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="btn-animated-gradient px-8 py-3 rounded-2xl text-sm font-black text-white shadow-lg flex items-center gap-2"
                            >
                                <Trash2 size={18} /> Delete Selected
                            </motion.button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Agent Brain Modal */}
            <AnimatePresence>
                {activeAgent && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setActiveAgent(null)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
                        >
                            <div className="p-6 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
                                <div className="flex items-center gap-4">
                                    <div className={`p-4 rounded-2xl ${activeAgent.type === 'explorer' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                                        <Zap size={32} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                            {activeAgent.id}
                                            <span className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-zinc-500 uppercase tracking-widest font-bold">
                                                {activeAgent.type}
                                            </span>
                                        </h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`w-2 h-2 rounded-full ${activeAgent.status.includes('Finished') ? 'bg-emerald-500' : 'bg-cyan-500 animate-pulse'}`} />
                                            <span className="text-xs text-zinc-400">{activeAgent.status}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setActiveAgent(null)}
                                    className="p-2 text-zinc-500 hover:text-white transition-colors bg-white/5 rounded-full"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                                <div className="space-y-3">
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] px-1">Mission Telemetry Stream</h4>
                                    <div className="bg-black/40 rounded-2xl border border-white/5 font-mono text-[11px] p-4 h-[240px] overflow-y-auto custom-scrollbar leading-relaxed">
                                        {(storageScanLog || []).filter(l => l.includes(activeAgent.id)).slice(-20).map((log, i) => (
                                            <div key={i} className="mb-2 py-1 border-b border-white/[0.02] last:border-0 flex gap-3">
                                                <span className="text-zinc-700 whitespace-nowrap">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                                                <span className="text-zinc-400">{log.split(':').slice(1).join(':').trim()}</span>
                                            </div>
                                        ))}
                                        {!(storageScanLog || []).some(l => l.includes(activeAgent.id)) && (
                                            <div className="h-full flex flex-col items-center justify-center text-zinc-600 italic">
                                                <Activity size={24} className="mb-3 opacity-20" />
                                                <p>Establishing secure channel to agent...</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showDeleteModal && (
                    <DeleteConfirmModal
                        items={selectedItems}
                        totalSize={selectedTotalSize}
                        onConfirm={async () => {
                            setShowDeleteModal(false);
                            await deleteSelectedStoragePaths();
                        }}
                        onCancel={() => setShowDeleteModal(false)}
                    />
                )}
            </AnimatePresence>

            <DeleteProgress
                progress={storageDeleteProgress}
                log={storageDeleteLog}
            />

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-[110] bg-[#1e1e1e]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl min-w-[200px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button
                        onClick={() => {
                            if (contextMenu.item?.path) toggleStoragePath(contextMenu.item.path);
                            setContextMenu(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-white/10 flex items-center gap-2"
                    >
                        Reveal in Finder
                    </button>
                    <button
                        onClick={() => {
                            clearStorageSelection();
                            toggleStoragePath(contextMenu.item.path);
                            setShowDeleteModal(true);
                            setContextMenu(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-red-500/10 text-red-400 flex items-center gap-2 font-medium"
                    >
                        <Trash2 size={14} /> Delete Item
                    </button>
                    <div className="h-px bg-white/5 my-1" />
                    <button
                        onClick={() => {
                            interrogateStorageItem(contextMenu.item.path);
                            setContextMenu(null);
                        }}
                        className="w-full text-left px-3 py-2 text-[11px] rounded-lg hover:bg-fuchsia-500/20 text-fuchsia-400 flex items-center gap-2 font-black italic tracking-tight"
                    >
                        <Zap size={14} className="animate-pulse" /> ASK AI INTELLIGENCE
                    </button>
                </div>
            )}
            {/* AI Interrogation Slide-over Panel */}
            <AnimatePresence>
                {(storageInterrogating || storageInterrogationResult) && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={resetInterrogation}
                            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed right-0 top-0 bottom-0 w-[450px] z-[130] bg-[#121212] border-l border-white/10 shadow-2xl flex flex-col"
                        >
                            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-500/20">
                                        <Zap size={20} className="text-fuchsia-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white leading-tight">AI Agent Report</h3>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Deep File Interrogation</p>
                                    </div>
                                </div>
                                <button onClick={resetInterrogation} className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                                {storageInterrogating ? (
                                    <div className="h-full flex flex-col items-center justify-center space-y-6">
                                        <div className="relative">
                                            <div className="w-16 h-16 rounded-full border-t-2 border-fuchsia-500 animate-spin" />
                                            <Zap size={24} className="absolute inset-0 m-auto text-fuchsia-400 animate-pulse" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-bold text-white italic">Scanning bitstreams...</p>
                                            <p className="text-xs text-zinc-500 mt-1">Interrogating OS metadata and project patterns.</p>
                                        </div>
                                    </div>
                                ) : storageInterrogationResult?.status === 'error' ? (
                                    <div className="p-6 rounded-3xl bg-red-500/5 border border-red-500/10 text-center">
                                        <AlertTriangle size={32} className="mx-auto text-red-500 mb-4" />
                                        <h4 className="text-white font-bold mb-2">Analysis Failed</h4>
                                        <p className="text-xs text-zinc-500">{storageInterrogationResult.message}</p>
                                    </div>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="space-y-8"
                                    >
                                        {/* Header Info */}
                                        <div className="space-y-4">
                                            <div className="flex items-start gap-4">
                                                <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                                    {storageInterrogationResult.is_directory ? <FolderOpen size={24} className="text-blue-400" /> : <FileText size={24} className="text-zinc-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-xl font-black text-white truncate" title={storageInterrogationResult.name}>
                                                        {storageInterrogationResult.name}
                                                    </h4>
                                                    <p className="text-xs text-zinc-500 truncate mt-1">{storageInterrogationResult.path}</p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                                                    <div className="text-[10px] text-zinc-500 uppercase font-black mb-1">Total Size</div>
                                                    <div className="text-lg font-black text-white">{storageInterrogationResult.total_size_formatted || storageInterrogationResult.size_formatted}</div>
                                                </div>
                                                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                                                    <div className="text-[10px] text-zinc-500 uppercase font-black mb-1">Entity Type</div>
                                                    <div className="text-lg font-black text-white">{storageInterrogationResult.project_type || (storageInterrogationResult.is_directory ? 'Folder' : 'File')}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Status / Risk */}
                                        <div className={`p-5 rounded-3xl border ${storageInterrogationResult.risk?.includes('safe') ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-amber-500/5 border-amber-500/10'}`}>
                                            <div className="flex items-center gap-3 mb-2">
                                                <Info size={16} className={storageInterrogationResult.risk?.includes('safe') ? 'text-emerald-400' : 'text-amber-400'} />
                                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Agent Recommendation</span>
                                            </div>
                                            <p className="text-sm text-white/90 leading-relaxed font-medium capitalize">
                                                {storageInterrogationResult.risk || "Standard resource. No immediate risk detected."}
                                            </p>
                                        </div>

                                        {/* Deep Insights */}
                                        {storageInterrogationResult.is_directory ? (
                                            <div className="space-y-4">
                                                <h5 className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">Top Components</h5>
                                                <div className="space-y-2">
                                                    {storageInterrogationResult.top_items?.map((item, i) => (
                                                        <div key={i} className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                                                                <span className="text-xs text-zinc-300 truncate font-medium">{item.name}</span>
                                                            </div>
                                                            <span className="text-[11px] font-mono text-zinc-500 bg-white/5 px-2 py-0.5 rounded-md">{item.size_formatted}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                <h5 className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">File Metadata</h5>
                                                <div className="grid grid-cols-1 gap-2">
                                                    {[
                                                        { label: 'MIME Type', value: storageInterrogationResult.mime_type },
                                                        { label: 'Created', value: storageInterrogationResult.created },
                                                        { label: 'Modified', value: storageInterrogationResult.modified },
                                                        { label: 'Last Accessed', value: storageInterrogationResult.accessed }
                                                    ].map((attr, i) => (
                                                        <div key={i} className="flex justify-between items-center bg-white/[0.02] p-3 rounded-xl border border-white/5 text-xs">
                                                            <span className="text-zinc-500">{attr.label}</span>
                                                            <span className="text-zinc-300 font-mono tracking-tighter">{attr.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Project Markers */}
                                        {storageInterrogationResult.markers?.length > 0 && (
                                            <div className="space-y-3">
                                                <h5 className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">Structure Markers</h5>
                                                <div className="flex flex-wrap gap-2">
                                                    {storageInterrogationResult.markers.map((m, i) => (
                                                        <span key={i} className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold px-3 py-1 rounded-full">
                                                            {m}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </div>

                            <div className="p-8 border-t border-white/5">
                                <button
                                    onClick={resetInterrogation}
                                    className="w-full py-4 rounded-2xl bg-white text-black text-sm font-black hover:bg-zinc-200 transition-colors shadow-xl"
                                >
                                    Done Analysis
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
