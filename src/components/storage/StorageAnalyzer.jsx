import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, Download, Play, Square, Trash2, RefreshCw, CheckCircle2, Shield, ShieldCheck, Zap, Clock, Eye, FolderOpen, MoreHorizontal, AlertTriangle, ExternalLink } from 'lucide-react';
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
    browser_cache: { name: 'Browser', color: 'cyan' },
    dev_cache: { name: 'Dev Tools', color: 'violet' },
    app_cache: { name: 'Apps', color: 'pink' },
    system_logs: { name: 'Logs', color: 'amber' },
    mail_backups: { name: 'Mail/Backup', color: 'teal' },
    general_cache: { name: 'Other', color: 'indigo' },
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
        storageState, storageScanProgress, storageItems, storageTree,
        storageFullTree, storageDiskMap, storageDiskTotal, storageDiskUsed, storageDiskFree,
        storageCategories, storageSearchQuery, storageFilters,
        storageSortBy, storageSortDir, storageSelectedPaths,
        storageMetrics, storageAttestation, storageWarnings,
        storageRecommendations, storageStaleProjects, storagePrediction,
        storageSkippedItems, storageReconciliation,
        storageDeleteProgress, storageDeleteLog, storageScanLog,
        startStorageScan, cancelStorageScan, setStorageSearch,
        setStorageFilter, setStorageSort, toggleStoragePath,
        selectAllStoragePaths, clearStorageSelection,
        deleteSelectedStoragePaths, exportStorageReport,
        // FDA
        fdaStatus, fdaDismissed, openFdaSettings,

        // SWARM Tracking (Assuming these will be added to useStore.js next)
        storageSwarmStatus, storageSwarmInsights
    } = useStore();

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [sunburstZoomPath, setSunburstZoomPath] = useState(null);
    const [vizMode, setVizMode] = useState('treemap'); // 'treemap' | 'sunburst'
    const [sunburstView, setSunburstView] = useState('full');
    const [contextMenu, setContextMenu] = useState(null);

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

    const totalBytes = useMemo(() =>
        storageItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0), [storageItems]);

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
        for (const item of storageItems) {
            const cat = item.category || 'general_cache';
            if (!cats[cat]) cats[cat] = { bytes: 0, count: 0 };
            cats[cat].bytes += (item.sizeBytes || 0);
            cats[cat].count += 1;
        }
        // Calculate total for percentage - cap at 100% to prevent "170% Disc Map" errors
        const effectiveTotal = totalBytes > 0 ? totalBytes : 1;
        return Object.entries(cats)
            .map(([id, data]) => ({
                id,
                ...data,
                // Cap percentage at 100% to prevent visualization overflow
                pct: Math.min(100, (data.bytes / effectiveTotal) * 100)
            }))
            .sort((a, b) => b.bytes - a.bytes);
    }, [storageItems, totalBytes]);

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
        <div className="h-full flex flex-col max-w-[1400px] mx-auto pb-6 relative">
            {/* FDA Gate Modal — absolute overlay, shown when storageState === 'fda_gate' */}
            <FDAGateModal onScanReady={startStorageScan} />
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-between items-center mb-6 shrink-0"
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
                    {storageState === 'scanning' ? (
                        <motion.button
                            onClick={cancelStorageScan}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-5 py-2.5 rounded-xl font-medium transition-colors backdrop-blur-md flex items-center gap-2"
                        >
                            <Square size={14} /> Cancel
                        </motion.button>
                    ) : (
                        <motion.button
                            onClick={startStorageScan}
                            whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(88, 166, 255, 0.2)' }}
                            whileTap={{ scale: 0.95 }}
                            className="bg-gradient-to-r from-cyan-600/80 to-blue-600/80 hover:from-cyan-500/80 hover:to-blue-500/80 border border-cyan-500/20 text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg backdrop-blur-md transition-colors flex items-center gap-2"
                        >
                            {storageState === 'complete' ? <RefreshCw size={16} /> : <Play size={16} />}
                            {storageState === 'complete' ? 'Rescan' : 'Start Scan'}
                        </motion.button>
                    )}
                </div>
            </motion.div>

            {/* Degraded Mode Banner — shown when FDA denied but user chose to scan anyway */}
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
                                <ExternalLink size={11} />
                                Grant Full Disk Access
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {/* Idle State — also shown during fda_gate so background content stays visible */}
                {(storageState === 'idle' || storageState === 'fda_gate') && (
                    <motion.div
                        key="idle"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="flex-1 flex items-center justify-center"
                    >
                        <div className="text-center max-w-md">
                            <motion.div
                                animate={{ y: [0, -8, 0] }}
                                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                                className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-cyan-500/20 to-blue-500/10 border border-cyan-500/20 flex items-center justify-center"
                            >
                                <HardDrive size={40} className="text-cyan-400" />
                            </motion.div>
                            <h3 className="text-2xl font-bold text-white mb-3">Ready to Analyze</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">
                                Scan your system to discover browser caches, dev tool artifacts,
                                app data, system logs, and more — all visualized as an interactive,
                                explorable map.
                            </p>
                        </div>
                    </motion.div>
                )}

                {/* Scanning / Swarm State */}
                {storageState === 'scanning' && (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col gap-4 overflow-hidden"
                    >
                        {/* Swarm Intelligence Panel */}
                        <div className="shrink-0 bg-white/[0.03] backdrop-blur-[20px] border border-cyan-500/20 rounded-[20px] p-5">
                            <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2 mb-4">
                                <Zap size={16} /> Swarm Intelligence Network Active
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {storageSwarmStatus && Object.values(storageSwarmStatus).map(agent => (
                                    <div key={agent.id} className="bg-white/[0.05] border border-white/[0.05] rounded-xl p-3 flex flex-col gap-2">
                                        <div className="flex justify-between items-center">
                                            <span className={`text-xs font-bold ${agent.type === 'explorer' ? 'text-blue-400' : 'text-purple-400'}`}>
                                                {agent.id}
                                            </span>
                                            {agent.status.includes('Finished') || agent.status === 'Idle' ? (
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                                            ) : (
                                                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_#06b6d4]" />
                                            )}
                                        </div>
                                        <div className="text-[10px] text-zinc-400 truncate opacity-80" title={agent.status}>
                                            {agent.status}
                                        </div>
                                    </div>
                                ))}
                                {(!storageSwarmStatus || Object.keys(storageSwarmStatus).length === 0) && (
                                    <div className="col-span-4 text-xs text-zinc-500 italic text-center py-2">
                                        Deploying swarm agents...
                                    </div>
                                )}
                            </div>
                        </div>

                        <ScanProgress
                            progress={storageScanProgress}
                            items={storageItems}
                            categories={storageCategories}
                            warnings={storageWarnings}
                            log={storageScanLog}
                        />
                    </motion.div>
                )}

                {/* Complete State */}
                {storageState === 'complete' && storageTree && (
                    <motion.div
                        key="complete"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex-1 flex flex-col space-y-4 overflow-hidden"
                    >
                        {/* Summary Bar */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="shrink-0 bg-cyan-500/[0.07] border border-cyan-500/15 text-cyan-400 p-4 rounded-2xl backdrop-blur-xl"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center">
                                    <HardDrive className="mr-3 h-5 w-5 flex-shrink-0" />
                                    <span className="text-sm">
                                        Found <strong>{storageItems.length}</strong> items totaling{' '}
                                        <strong className="text-lg">{formatSize(totalBytes)}</strong>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {safeItems.length > 0 && (
                                        <motion.button
                                            onClick={handleSelectAllSafe}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                                        >
                                            <Shield size={12} /> Select All Safe ({formatSize(safeTotalBytes)})
                                        </motion.button>
                                    )}
                                    <motion.button
                                        onClick={() => exportStorageReport()}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        className="bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                    >
                                        <Download size={12} /> Export
                                    </motion.button>
                                </div>
                            </div>

                            {/* Category Breakdown Bar */}
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
                                {categoryBreakdown.map((cat, idx) => {
                                    const meta = CATEGORY_LABELS[cat.id] || { color: 'indigo' };
                                    const gradientClass = COLOR_MAP[meta.color] || COLOR_MAP.indigo;
                                    return (
                                        <motion.div
                                            key={cat.id}
                                            initial={{ width: 0 }}
                                            animate={{ width: `${cat.pct}%` }}
                                            transition={{ duration: 0.8, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
                                            className={`h-full bg-gradient-to-r ${gradientClass} ${idx > 0 ? 'border-l border-black/20' : ''}`}
                                            title={`${meta.name || cat.id}: ${formatSize(cat.bytes)} (${cat.pct.toFixed(1)}%)`}
                                        />
                                    );
                                })}
                            </div>
                            {/* Category Legend */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                                {categoryBreakdown.map(cat => {
                                    const meta = CATEGORY_LABELS[cat.id] || { name: cat.id, color: 'indigo' };
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => setStorageFilter({ ...storageFilters, category: storageFilters.category === cat.id ? 'all' : cat.id })}
                                            className={`flex items-center gap-1.5 text-[10px] transition-all cursor-pointer ${storageFilters.category === cat.id ? 'text-white font-bold' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${COLOR_MAP[meta.color]}`} />
                                            {meta.name} <span className="font-mono">{formatSize(cat.bytes)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Risk + Attestation Row */}
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.04]">
                                {storageMetrics?.risk_breakdown && (
                                    <div className="flex items-center gap-3 text-[10px]">
                                        <span className="text-zinc-600 uppercase tracking-wider">Risk:</span>
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            {storageMetrics.risk_breakdown.safe || 0} safe
                                        </span>
                                        <span className="flex items-center gap-1 text-amber-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                            {storageMetrics.risk_breakdown.caution || 0} caution
                                        </span>
                                        {(storageMetrics.risk_breakdown.critical || 0) > 0 && (
                                            <span className="flex items-center gap-1 text-red-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                                {storageMetrics.risk_breakdown.critical} critical
                                            </span>
                                        )}
                                    </div>
                                )}
                                {storageAttestation && (
                                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-500/70">
                                        <ShieldCheck size={11} />
                                        <span>Signed ({storageAttestation.algorithm})</span>
                                    </div>
                                )}
                            </div>
                        </motion.div>

                        {/* Two-column layout: Treemap/Sunburst + List */}
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
                            {/* Left: Visualization + Disk Overview */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.1 }}
                                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] rounded-[20px] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] overflow-hidden flex flex-col"
                            >
                                {/* Disk Usage Overview Bar */}
                                {storageDiskTotal > 0 && (
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold">Disk Usage</span>
                                            <span className="text-[10px] text-zinc-500">
                                                {formatSize(storageDiskUsed)} used / {formatSize(storageDiskTotal)} total
                                            </span>
                                        </div>
                                        {/* Calculate percentages with caps to prevent overflow */}
                                        {(() => {
                                            const usedPct = Math.min(100, Math.max(0, ((storageDiskUsed - totalBytes) / storageDiskTotal) * 100));
                                            const cleanablePct = Math.min(100 - usedPct, Math.max(0, (totalBytes / storageDiskTotal) * 100));
                                            const freePct = Math.min(100, Math.max(0, (storageDiskFree / storageDiskTotal) * 100));
                                            return (
                                                <>
                                                    <div className="h-3 rounded-full overflow-hidden bg-white/[0.04] flex">
                                                        <div
                                                            className="bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-700"
                                                            style={{ width: `${usedPct}%` }}
                                                            title={`Used: ${formatSize(storageDiskUsed - totalBytes)}`}
                                                        />
                                                        <div
                                                            className="bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-700"
                                                            style={{ width: `${cleanablePct}%` }}
                                                            title={`Cleanable: ${formatSize(totalBytes)}`}
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-4 mt-1.5 text-[10px] text-zinc-500">
                                                        <span className="flex items-center gap-1">
                                                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                                                            Used ({formatSize(storageDiskUsed - totalBytes)})
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                                                            Cleanable ({formatSize(totalBytes)})
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <span className="w-2 h-2 rounded-full bg-white/[0.1]" />
                                                            Free ({formatSize(storageDiskFree)})
                                                        </span>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}

                                {/* Reconciliation Info - Shows unmapped bytes (400GB discrepancy) */}
                                {storageReconciliation && storageReconciliation.unmapped_bytes > 0 && (
                                    <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                            <span className="text-amber-400 font-medium">Unmapped Space:</span>
                                            <span className="text-amber-300">
                                                {storageReconciliation.unmapped_formatted} ({storageReconciliation.discrepancy_pct}%) not categorized
                                            </span>
                                        </div>
                                        <div className="text-[9px] text-zinc-500 mt-1 ml-3.5">
                                            This includes system files, APFS snapshots, and permission-protected directories
                                        </div>
                                    </div>
                                )}

                                {/* Skipped Items Panel */}
                                <SkippedItemsPanel
                                    items={storageSkippedItems}
                                    reconciliation={storageReconciliation}
                                />

                                {/* Viz Toggle */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold">
                                        {vizMode === 'treemap' ? 'Disk Map' : (sunburstView === 'full' ? 'Full Disk Map' : 'Cleanable Items')}
                                    </div>
                                    <div className="flex bg-white/[0.04] rounded-lg p-0.5 text-[10px] gap-0.5">
                                        <button
                                            onClick={() => setVizMode('treemap')}
                                            className={`px-2.5 py-1 rounded-md transition-all ${vizMode === 'treemap'
                                                ? 'bg-white/[0.1] text-white font-medium'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            Treemap
                                        </button>
                                        <button
                                            onClick={() => setVizMode('sunburst')}
                                            className={`px-2.5 py-1 rounded-md transition-all ${vizMode === 'sunburst'
                                                ? 'bg-white/[0.1] text-white font-medium'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            Sunburst
                                        </button>
                                        {vizMode === 'sunburst' && storageFullTree && (
                                            <>
                                                <span className="w-px h-4 self-center bg-white/[0.1]" />
                                                <button
                                                    onClick={() => setSunburstView(v => v === 'full' ? 'cleanable' : 'full')}
                                                    className="px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-300 transition-all"
                                                >
                                                    {sunburstView === 'full' ? 'Show Cleanable' : 'Show Full'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Visualization */}
                                <div className="flex-1 min-h-0">
                                    {vizMode === 'treemap' ? (
                                        <TreemapChart
                                            data={storageFullTree || storageTree}
                                            onItemClick={(item) => {
                                                if (item.path) toggleStoragePath(item.path);
                                            }}
                                            onContextMenu={(e, item) => {
                                                setContextMenu({ x: e.clientX, y: e.clientY, item });
                                            }}
                                        />
                                    ) : (
                                        <SunburstChart
                                            data={sunburstView === 'full' && storageFullTree ? storageFullTree : storageTree}
                                            zoomPath={sunburstZoomPath}
                                            onZoom={setSunburstZoomPath}
                                            onItemClick={(item) => {
                                                if (item.path) toggleStoragePath(item.path);
                                            }}
                                        />
                                    )}
                                </div>
                            </motion.div>

                            {/* Right: Search + Item List */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.2 }}
                                className="flex flex-col overflow-hidden"
                            >
                                <SearchBar
                                    query={storageSearchQuery}
                                    onQueryChange={setStorageSearch}
                                    filters={storageFilters}
                                    onFilterChange={setStorageFilter}
                                    categories={storageCategories}
                                />
                                <div className="flex-1 mt-3 overflow-hidden">
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
                                transition={{ delay: 0.3 }}
                                className="shrink-0 bg-white/[0.02] backdrop-blur-[20px] border border-white/[0.06] rounded-[20px] p-5 max-h-[260px] overflow-y-auto"
                            >
                                <div className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold mb-3 flex items-center gap-2">
                                    <Zap size={12} className="text-amber-400" />
                                    Agent Insights
                                </div>

                                {/* Prediction Banner */}
                                {storagePrediction && storagePrediction.days_until_full < 90 && (
                                    <div className="flex items-center gap-3 p-3 mb-3 rounded-xl bg-red-500/10 border border-red-500/20">
                                        <Clock size={16} className="text-red-400 shrink-0" />
                                        <div className="text-xs text-red-300">
                                            At current growth ({storagePrediction.growth_rate_formatted}),
                                            disk will be full in <strong className="text-red-200">{storagePrediction.days_until_full} days</strong>.
                                        </div>
                                    </div>
                                )}

                                {/* Swarm Deep Insights (Duplicates, Large Media, etc.) */}
                                {storageSwarmInsights && storageSwarmInsights.length > 0 && (
                                    <div className="mb-3">
                                        <div className="text-[10px] uppercase tracking-wider text-purple-400 mb-1.5 flex items-center gap-1.5">
                                            <Shield size={10} /> Deep Analysis Alerts
                                        </div>
                                        <div className="space-y-1">
                                            {storageSwarmInsights.map((insight, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                                                        <span className="text-xs text-purple-100 truncate">{insight.project_name || insight.message}</span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-purple-300 shrink-0">
                                                        {insight.reclaimable_formatted}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Stale Projects */}
                                {storageStaleProjects.length > 0 && (
                                    <div className="mb-3">
                                        <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Stale Dev Projects</div>
                                        <div className="space-y-1">
                                            {storageStaleProjects.slice(0, 5).map((proj, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                                                        <span className="text-xs text-zinc-300 truncate">{proj.name}</span>
                                                        <span className="text-[10px] text-zinc-600">{proj.days_stale}d stale</span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-amber-400 shrink-0">
                                                        {proj.reclaimable_formatted}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Recommendations */}
                                <div className="space-y-1.5">
                                    {storageRecommendations.slice(0, 6).map((rec, idx) => {
                                        const priorityColors = {
                                            urgent: 'bg-red-500/20 text-red-300 border-red-500/30',
                                            quick_wins: 'bg-green-500/10 text-green-300 border-green-500/20',
                                            dev_cleanup: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
                                            maintenance: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
                                        };
                                        const colorClass = priorityColors[rec.category] || priorityColors.maintenance;
                                        return (
                                            <div key={rec.id || idx}
                                                className={`flex items-center justify-between p-2.5 rounded-xl border transition-colors hover:bg-white/[0.02] ${colorClass}`}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-medium truncate">{rec.title}</div>
                                                    <div className="text-[10px] opacity-60 truncate mt-0.5">{rec.description}</div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0 ml-3">
                                                    <span className="text-xs font-mono font-semibold">
                                                        {rec.impact_formatted}
                                                    </span>
                                                    <button
                                                        onClick={() => {
                                                            rec.items?.forEach(p => {
                                                                if (!storageSelectedPaths.has(p)) toggleStoragePath(p);
                                                            });
                                                        }}
                                                        className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 transition-colors"
                                                    >
                                                        Select
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}

                        {/* Bottom Action Bar */}
                        <AnimatePresence>
                            {storageSelectedPaths.size > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 20 }}
                                    className="shrink-0 flex items-center justify-between bg-white/[0.04] backdrop-blur-xl border border-white/[0.1] rounded-2xl px-5 py-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <CheckCircle2 size={16} className="text-cyan-400" />
                                        <div className="text-sm text-zinc-400">
                                            <strong className="text-white">{storageSelectedPaths.size}</strong> items selected
                                            <span className="text-cyan-400 font-bold ml-1.5">({formatSize(selectedTotalSize)})</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <motion.button
                                            onClick={clearStorageSelection}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            className="bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-400 px-4 py-2 rounded-xl text-sm font-medium"
                                        >
                                            Clear
                                        </motion.button>
                                        <motion.button
                                            onClick={() => setShowDeleteModal(true)}
                                            whileHover={{ scale: 1.03, boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)' }}
                                            whileTap={{ scale: 0.97 }}
                                            className="bg-gradient-to-r from-red-600/80 to-rose-600/80 hover:from-red-500 hover:to-rose-500 border border-red-500/20 text-white px-5 py-2 rounded-xl font-semibold shadow-[0_0_15px_rgba(239,68,68,0.15)] flex items-center gap-2 text-sm"
                                        >
                                            <Trash2 size={14} /> Delete Selected
                                        </motion.button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete Confirmation Modal */}
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

            {/* Delete Progress - Centered Modal */}
            {(storageDeleteProgress || storageDeleteLog.length > 0) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-[550px] max-w-[95vw] max-h-[80vh] overflow-hidden">
                        <DeleteProgress
                            progress={storageDeleteProgress}
                            log={storageDeleteLog}
                        />
                    </div>
                </div>
            )}

            {/* Context Menu */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                        style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100 }}
                        className="bg-zinc-900/95 backdrop-blur-xl border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden min-w-[220px]"
                    >
                        <div className="px-3 py-2 border-b border-white/[0.06]">
                            <div className="text-xs font-medium text-white truncate max-w-[200px]">{contextMenu.item?.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">{contextMenu.item?.path}</div>
                        </div>
                        <button
                            onClick={() => { window.ipcRenderer?.invoke('open-in-finder', contextMenu.item.path); setContextMenu(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            <FolderOpen size={14} className="text-zinc-500" /> Open in Finder
                        </button>
                        <button
                            onClick={() => { window.ipcRenderer?.invoke('quick-look-file', contextMenu.item.path); setContextMenu(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            <Eye size={14} className="text-zinc-500" /> Quick Look
                        </button>
                        <button
                            onClick={() => { navigator.clipboard.writeText(contextMenu.item.path); setContextMenu(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            <MoreHorizontal size={14} className="text-zinc-500" /> Copy Path
                        </button>
                        <div className="border-t border-white/[0.06]" />
                        <button
                            onClick={() => { toggleStoragePath(contextMenu.item.path); setShowDeleteModal(true); setContextMenu(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={14} /> Move to Trash
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
