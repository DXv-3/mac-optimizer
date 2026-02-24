import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown, FolderOpen, ExternalLink, ChevronDown, ChevronRight, CheckSquare, Square } from 'lucide-react';

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

const CATEGORY_LABELS = {
    browser_cache: { name: 'Browser Caches', color: 'cyan' },
    dev_cache: { name: 'Developer Tools', color: 'violet' },
    app_cache: { name: 'Application Caches', color: 'pink' },
    system_logs: { name: 'System Logs', color: 'amber' },
    mail_backups: { name: 'Mail & Backups', color: 'teal' },
    general_cache: { name: 'Other Caches', color: 'indigo' },
};

const COLOR_MAP = {
    cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', bar: 'bg-cyan-500' },
    violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', bar: 'bg-violet-500' },
    pink: { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-400', bar: 'bg-pink-500' },
    amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', bar: 'bg-amber-500' },
    teal: { bg: 'bg-teal-500/10', border: 'border-teal-500/20', text: 'text-teal-400', bar: 'bg-teal-500' },
    indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', text: 'text-indigo-400', bar: 'bg-indigo-500' },
};

const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
};

const columns = [
    { key: 'name', label: 'Name', className: 'flex-[2] min-w-0' },
    { key: 'size', label: 'Size', className: 'w-24 text-right' },
    { key: 'risk', label: 'Risk', className: 'w-20 text-center' },
    { key: 'date', label: 'Accessed', className: 'w-28 text-right hidden xl:block' },
];

export default function ItemList({ items, selectedPaths, onTogglePath, onContextMenu, sortBy, sortDir, onSort }) {
    const [collapsedCategories, setCollapsedCategories] = useState(new Set());

    const handleSort = useCallback((key) => {
        if (sortBy === key) {
            if (sortDir === 'desc') onSort('size', 'desc');
            else onSort(key, sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            onSort(key, 'desc');
        }
    }, [sortBy, sortDir, onSort]);

    // Group items by category
    const grouped = useMemo(() => {
        const groups = {};
        let totalBytes = 0;
        for (const item of items) {
            totalBytes += (item.sizeBytes || 0);
            const cat = item.category || 'general_cache';
            if (!groups[cat]) groups[cat] = { items: [], totalBytes: 0 };
            groups[cat].items.push(item);
            groups[cat].totalBytes += (item.sizeBytes || 0);
        }
        // Sort categories by total size
        const sorted = Object.entries(groups)
            .sort(([, a], [, b]) => b.totalBytes - a.totalBytes);
        return { categories: sorted, totalBytes };
    }, [items]);

    const toggleCategory = useCallback((cat) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return next;
        });
    }, []);

    const toggleCategoryItems = useCallback((catItems) => {
        const allPaths = catItems.map(i => i.path);
        const allSelected = allPaths.every(p => selectedPaths.has(p));
        if (allSelected) {
            // Deselect all in this category
            allPaths.forEach(p => {
                if (selectedPaths.has(p)) onTogglePath(p);
            });
        } else {
            // Select all in this category
            allPaths.forEach(p => {
                if (!selectedPaths.has(p)) onTogglePath(p);
            });
        }
    }, [selectedPaths, onTogglePath]);

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
                <div className="w-8" />
                {columns.map(col => (
                    <button
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`${col.className} flex items-center text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold hover:text-zinc-300 transition-colors cursor-pointer select-none ${col.key !== 'name' ? 'justify-end' : ''}`}
                    >
                        {col.key === 'risk' ? <span className="mx-auto flex items-center">{col.label}<SortIcon colKey={col.key} /></span> : <>{col.label}<SortIcon colKey={col.key} /></>}
                    </button>
                ))}
                <div className="w-8" />
            </div>

            {/* Scrollable grouped list */}
            <div className="flex-1 overflow-y-auto">
                {grouped.categories.map(([category, group]) => {
                    const catMeta = CATEGORY_LABELS[category] || { name: category, color: 'indigo' };
                    const colors = COLOR_MAP[catMeta.color] || COLOR_MAP.indigo;
                    const isCollapsed = collapsedCategories.has(category);
                    const allSelected = group.items.every(i => selectedPaths.has(i.path));
                    const someSelected = group.items.some(i => selectedPaths.has(i.path));
                    const pct = grouped.totalBytes > 0 ? ((group.totalBytes / grouped.totalBytes) * 100) : 0;

                    return (
                        <div key={category}>
                            {/* Category Header */}
                            <div className={`sticky top-0 z-10 flex items-center px-4 py-2 ${colors.bg} border-b ${colors.border} backdrop-blur-xl cursor-pointer select-none group`}>
                                {/* Category checkbox */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleCategoryItems(group.items); }}
                                    className="w-8 flex-shrink-0 flex items-center justify-center"
                                >
                                    {allSelected
                                        ? <CheckSquare size={14} className={colors.text} />
                                        : someSelected
                                            ? <div className="relative"><Square size={14} className="text-zinc-500" /><div className="absolute inset-0 flex items-center justify-center"><div className={`w-1.5 h-1.5 rounded-sm ${colors.bar}`} /></div></div>
                                            : <Square size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                                    }
                                </button>

                                <button onClick={() => toggleCategory(category)} className="flex-1 flex items-center gap-2 min-w-0">
                                    <motion.div animate={{ rotate: isCollapsed ? -90 : 0 }} transition={{ duration: 0.15 }}>
                                        <ChevronDown size={12} className={colors.text} />
                                    </motion.div>
                                    <span className={`text-[10px] uppercase tracking-[0.15em] font-bold ${colors.text}`}>
                                        {catMeta.name}
                                    </span>
                                    <span className="text-[10px] text-zinc-600">
                                        {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                                    </span>

                                    {/* Percentage bar */}
                                    <div className="flex-1 max-w-[120px] h-1 bg-white/[0.04] rounded-full overflow-hidden ml-1">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${pct}%` }}
                                            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                                            className={`h-full rounded-full ${colors.bar} opacity-60`}
                                        />
                                    </div>
                                </button>

                                <span className={`text-xs font-bold font-mono ${colors.text} ml-2`}>
                                    {formatSize(group.totalBytes)}
                                </span>
                                <span className="text-[10px] text-zinc-600 ml-1.5 w-10 text-right">
                                    {pct.toFixed(0)}%
                                </span>
                            </div>

                            {/* Items */}
                            <AnimatePresence>
                                {!isCollapsed && group.items.map((item, idx) => {
                                    const isSelected = selectedPaths.has(item.path);
                                    return (
                                        <motion.div
                                            key={item.path}
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.15 }}
                                            onClick={() => onTogglePath(item.path)}
                                            onContextMenu={(e) => onContextMenu(e, item)}
                                            className={`flex items-center px-4 py-2.5 border-b border-white/[0.03] cursor-pointer transition-all hover:bg-white/[0.04] group/row ${isSelected ? 'bg-cyan-500/[0.06] border-l-2 border-l-cyan-500' : ''}`}
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
                                                <div className="text-sm font-medium text-white truncate group-hover/row:text-cyan-300 transition-colors">{item.name}</div>
                                                <div className="text-[11px] text-zinc-600 font-mono truncate">{item.path}</div>
                                            </div>

                                            {/* Size with proportional bar */}
                                            <div className="w-24 text-right flex flex-col items-end">
                                                <span className="text-sm font-bold text-white whitespace-nowrap">{item.sizeFormatted || formatSize(item.sizeBytes)}</span>
                                                <div className="w-full h-0.5 bg-white/[0.04] rounded-full mt-1 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${colors.bar} opacity-40`}
                                                        style={{ width: `${group.totalBytes > 0 ? Math.max(2, (item.sizeBytes / group.totalBytes) * 100) : 0}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Risk */}
                                            <div className="w-20 text-center">
                                                {riskBadge(item.risk)}
                                            </div>

                                            {/* Last accessed */}
                                            <div className="w-28 text-right hidden xl:block">
                                                <span className="text-[11px] text-zinc-500">{item.lastUsed || '—'}</span>
                                            </div>

                                            {/* Action button */}
                                            <div className="w-8 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity">
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
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            {/* Footer with live running total */}
            <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02] text-[11px] text-zinc-500 flex justify-between">
                <span>
                    {items.length} items in {grouped.categories.length} categories •
                    <span className="text-zinc-600 ml-1">{selectedPaths.size > 0 ? `${selectedPaths.size} selected` : 'Right-click for options'}</span>
                </span>
                <span className="font-mono text-zinc-400">
                    Total: {formatSize(grouped.totalBytes)}
                </span>
            </div>
        </div>
    );
}
