import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, Download, Play, Square, Trash2, RefreshCw, CheckCircle2, Shield, ShieldCheck } from 'lucide-react';
import useStore from '../../store/useStore';
import SunburstChart from './SunburstChart';
import ScanProgress from './ScanProgress';
import ItemList from './ItemList';
import SearchBar from './SearchBar';
import DeleteConfirmModal from './DeleteConfirmModal';

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
        storageCategories, storageSearchQuery, storageFilters,
        storageSortBy, storageSortDir, storageSelectedPaths,
        storageMetrics, storageAttestation, storageWarnings,
        startStorageScan, cancelStorageScan, setStorageSearch,
        setStorageFilter, setStorageSort, toggleStoragePath,
        selectAllStoragePaths, clearStorageSelection,
        deleteSelectedStoragePaths, exportStorageReport,
    } = useStore();

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [sunburstZoomPath, setSunburstZoomPath] = useState(null);
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
        return Object.entries(cats)
            .map(([id, data]) => ({ id, ...data, pct: totalBytes > 0 ? (data.bytes / totalBytes) * 100 : 0 }))
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
        <div className="h-full flex flex-col max-w-[1400px] mx-auto pb-6">
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

            <AnimatePresence mode="wait">
                {/* Idle State */}
                {storageState === 'idle' && (
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

                {/* Scanning State */}
                {storageState === 'scanning' && (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col"
                    >
                        <ScanProgress
                            progress={storageScanProgress}
                            items={storageItems}
                            categories={storageCategories}
                            warnings={storageWarnings}
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

                        {/* Two-column layout: Sunburst + List */}
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
                            {/* Left: Sunburst */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.1 }}
                                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] rounded-[20px] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] overflow-hidden flex flex-col"
                            >
                                <div className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold mb-3">
                                    Disk Space Map
                                </div>
                                <div className="flex-1 min-h-0">
                                    <SunburstChart
                                        data={storageTree}
                                        zoomPath={sunburstZoomPath}
                                        onZoom={setSunburstZoomPath}
                                        onItemClick={(item) => {
                                            if (item.path) toggleStoragePath(item.path);
                                        }}
                                    />
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

            {/* Context Menu */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100 }}
                        className="bg-zinc-900/95 backdrop-blur-xl border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden min-w-[200px]"
                    >
                        <button
                            onClick={() => { window.ipcRenderer.invoke('open-in-finder', contextMenu.item.path); setContextMenu(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            📂 Open in Finder
                        </button>
                        <button
                            onClick={() => { navigator.clipboard.writeText(contextMenu.item.path); setContextMenu(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            📋 Copy Path
                        </button>
                        <div className="border-t border-white/[0.06]" />
                        <button
                            onClick={() => { toggleStoragePath(contextMenu.item.path); setShowDeleteModal(true); setContextMenu(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            🗑 Delete
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
