import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown, FolderOpen, ExternalLink } from 'lucide-react';

const riskBadge = (risk) => {
    const styles = {
        safe: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        caution: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        critical: 'bg-red-500/15 text-red-400 border-red-500/20',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${styles[risk] || styles.caution}`}>
            {risk}
        </span>
    );
};

const columns = [
    { key: 'name', label: 'Name', className: 'flex-[2] min-w-0' },
    { key: 'size', label: 'Size', className: 'w-24 text-right' },
    { key: 'risk', label: 'Risk', className: 'w-20 text-center' },
    { key: 'date', label: 'Accessed', className: 'w-28 text-right hidden xl:block' },
];

export default function ItemList({ items, selectedPaths, onTogglePath, onContextMenu, sortBy, sortDir, onSort }) {

    const handleSort = useCallback((key) => {
        if (sortBy === key) {
            // Three-state: asc -> desc -> none
            if (sortDir === 'desc') onSort('size', 'desc'); // reset to default
            else onSort(key, sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            onSort(key, 'desc');
        }
    }, [sortBy, sortDir, onSort]);

    const SortIcon = ({ colKey }) => {
        if (sortBy !== colKey) return <ArrowUpDown size={10} className="text-zinc-600 ml-1" />;
        return sortDir === 'asc'
            ? <ArrowUp size={10} className="text-cyan-400 ml-1" />
            : <ArrowDown size={10} className="text-cyan-400 ml-1" />;
    };

    const handleOpenInFinder = useCallback((e, path) => {
        e.stopPropagation();
        window.ipcRenderer.invoke('open-in-finder', path);
    }, []);

    if (items.length === 0) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center text-zinc-600">
                    <FolderOpen size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No items match your filters</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white/[0.02] backdrop-blur-md border border-white/[0.06] rounded-2xl overflow-hidden">
            {/* Header row */}
            <div className="flex items-center px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="w-8" /> {/* Checkbox spacer */}
                {columns.map(col => (
                    <button
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`${col.className} flex items-center text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold hover:text-zinc-300 transition-colors cursor-pointer select-none ${col.key !== 'name' ? 'justify-end' : ''}`}
                    >
                        {col.key === 'risk' ? <span className="mx-auto flex items-center">{col.label}<SortIcon colKey={col.key} /></span> : <>{col.label}<SortIcon colKey={col.key} /></>}
                    </button>
                ))}
                <div className="w-8" /> {/* Action spacer */}
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto">
                {items.map((item, idx) => {
                    const isSelected = selectedPaths.has(item.path);
                    return (
                        <motion.div
                            key={item.path}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                            onClick={() => onTogglePath(item.path)}
                            onContextMenu={(e) => onContextMenu(e, item)}
                            className={`flex items-center px-4 py-2.5 border-b border-white/[0.03] cursor-pointer transition-all hover:bg-white/[0.04] group ${isSelected ? 'bg-cyan-500/[0.06] border-l-2 border-l-cyan-500' : ''
                                }`}
                        >
                            {/* Checkbox */}
                            <div className="w-8 flex-shrink-0 flex items-center justify-center">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => onTogglePath(item.path)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-white/20 bg-white/5 checked:bg-cyan-500 checked:border-cyan-500 transition-all"
                                    />
                                    <svg className="absolute w-2.5 h-2.5 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" viewBox="0 0 14 10" fill="none">
                                        <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </div>

                            {/* Name + path */}
                            <div className="flex-[2] min-w-0 pr-3">
                                <div className="text-sm font-medium text-white truncate">{item.name}</div>
                                <div className="text-[11px] text-zinc-600 font-mono truncate">{item.path}</div>
                            </div>

                            {/* Size */}
                            <div className="w-24 text-right">
                                <span className="text-sm font-bold text-white whitespace-nowrap">{item.sizeFormatted || item.size_formatted}</span>
                            </div>

                            {/* Risk */}
                            <div className="w-20 text-center">
                                {riskBadge(item.risk)}
                            </div>

                            {/* Last accessed */}
                            <div className="w-28 text-right hidden xl:block">
                                <span className="text-[11px] text-zinc-500">{item.lastUsed || item.last_accessed || '—'}</span>
                            </div>

                            {/* Action button */}
                            <div className="w-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => handleOpenInFinder(e, item.path)}
                                    className="p-1 hover:bg-white/[0.08] rounded-md transition-colors"
                                    title="Open in Finder"
                                >
                                    <ExternalLink size={12} className="text-zinc-500" />
                                </button>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Footer with live running total */}
            <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02] text-[11px] text-zinc-500 flex justify-between">
                <span>{items.length} items shown • Right-click for more options</span>
                <span className="font-mono text-zinc-400">
                    Total: {(() => {
                        const bytes = items.reduce((sum, i) => sum + (i.sizeBytes || i.size || 0), 0);
                        if (bytes === 0) return '0 B';
                        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                        const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
                        return `${(bytes / Math.pow(1024, idx)).toFixed(2)} ${units[idx]}`;
                    })()}
                </span>
            </div>
        </div>
    );
}
