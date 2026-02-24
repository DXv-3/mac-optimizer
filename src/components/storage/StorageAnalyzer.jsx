import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, Search, Filter, Download, Play, Square, Trash2, ChevronRight, RefreshCw } from 'lucide-react';
import useStore from '../../store/useStore';
import SunburstChart from './SunburstChart';
import ScanProgress from './ScanProgress';
import ItemList from './ItemList';
import SearchBar from './SearchBar';
import DeleteConfirmModal from './DeleteConfirmModal';

export default function StorageAnalyzer() {
    const {
        storageState, storageScanProgress, storageItems, storageTree,
        storageCategories, storageSearchQuery, storageFilters,
        storageSortBy, storageSortDir, storageSelectedPaths,
        startStorageScan, cancelStorageScan, setStorageSearch,
        setStorageFilter, setStorageSort, toggleStoragePath,
        selectAllStoragePaths, clearStorageSelection,
        deleteSelectedStoragePaths, exportStorageReport,
    } = useStore();

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [sunburstZoomPath, setSunburstZoomPath] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);

    // Filter and sort items based on current search/filter/sort state
    const filteredItems = useMemo(() => {
        let filtered = [...storageItems];

        // Search filter (regex support)
        if (storageSearchQuery) {
            try {
                const regex = new RegExp(storageSearchQuery, 'i');
                filtered = filtered.filter(item =>
                    regex.test(item.name) || regex.test(item.path)
                );
            } catch {
                // Invalid regex, fall back to string match
                const q = storageSearchQuery.toLowerCase();
                filtered = filtered.filter(item =>
                    item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
                );
            }
        }

        // Category filter
        if (storageFilters.category !== 'all') {
            filtered = filtered.filter(item => item.category === storageFilters.category);
        }

        // Risk level filter
        if (storageFilters.riskLevel !== 'all') {
            filtered = filtered.filter(item => item.risk === storageFilters.riskLevel);
        }

        // Min size filter
        if (storageFilters.minSize > 0) {
            filtered = filtered.filter(item => (item.sizeBytes || item.size || 0) >= storageFilters.minSize);
        }

        // Sort
        filtered.sort((a, b) => {
            let cmp = 0;
            switch (storageSortBy) {
                case 'size': cmp = (a.sizeBytes || a.size || 0) - (b.sizeBytes || b.size || 0); break;
                case 'name': cmp = a.name.localeCompare(b.name); break;
                case 'risk': {
                    const riskOrder = { safe: 0, caution: 1, critical: 2 };
                    cmp = (riskOrder[a.risk] || 0) - (riskOrder[b.risk] || 0);
                    break;
                }
                case 'date': cmp = (a.lastUsed || a.last_accessed || '').localeCompare(b.lastUsed || b.last_accessed || ''); break;
                default: cmp = (a.sizeBytes || a.size || 0) - (b.sizeBytes || b.size || 0);
            }
            return storageSortDir === 'desc' ? -cmp : cmp;
        });

        return filtered;
    }, [storageItems, storageSearchQuery, storageFilters, storageSortBy, storageSortDir]);

    const totalFilteredSize = useMemo(() =>
        filteredItems.reduce((sum, item) => sum + (item.sizeBytes || item.size || 0), 0),
        [filteredItems]
    );

    const selectedItems = useMemo(() =>
        storageItems.filter(item => storageSelectedPaths.has(item.path)),
        [storageItems, storageSelectedPaths]
    );

    const selectedTotalSize = useMemo(() =>
        selectedItems.reduce((sum, item) => sum + (item.sizeBytes || item.size || 0), 0),
        [selectedItems]
    );

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

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
    };

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
                            <h3 className="text-2xl font-bold text-white mb-3">
                                Ready to Analyze
                            </h3>
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
                        className="flex-1 flex flex-col space-y-5 overflow-hidden"
                    >
                        {/* Summary Bar */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="shrink-0 bg-cyan-500/[0.07] border border-cyan-500/15 text-cyan-400 p-4 rounded-2xl flex items-center justify-between backdrop-blur-xl"
                        >
                            <div className="flex items-center">
                                <HardDrive className="mr-3 h-5 w-5 flex-shrink-0" />
                                <span className="text-sm">
                                    Found <strong>{storageItems.length}</strong> items totaling{' '}
                                    <strong>{formatSize(storageItems.reduce((s, i) => s + (i.sizeBytes || i.size || 0), 0))}</strong>
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <motion.button
                                    onClick={() => exportStorageReport()}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className="bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                >
                                    <Download size={12} /> Export
                                </motion.button>
                            </div>
                        </motion.div>

                        {/* Two-column layout: Sunburst + List */}
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 overflow-hidden">
                            {/* Left: Sunburst Visualization */}
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
                                    className="shrink-0 flex items-center justify-between bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl px-5 py-3"
                                >
                                    <div className="text-sm text-zinc-400">
                                        <strong className="text-white">{storageSelectedPaths.size}</strong> items selected
                                        ({formatSize(selectedTotalSize)})
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
                            onClick={() => {
                                window.ipcRenderer.invoke('open-in-finder', contextMenu.item.path);
                                setContextMenu(null);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            📂 Open in Finder
                        </button>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(contextMenu.item.path);
                                setContextMenu(null);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors"
                        >
                            📋 Copy Path
                        </button>
                        <div className="border-t border-white/[0.06]" />
                        <button
                            onClick={() => {
                                toggleStoragePath(contextMenu.item.path);
                                setShowDeleteModal(true);
                                setContextMenu(null);
                            }}
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
