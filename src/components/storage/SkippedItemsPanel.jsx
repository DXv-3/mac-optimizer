import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';

export default function SkippedItemsPanel({ items = [], reconciliation }) {
    const [expanded, setExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filtered = useMemo(() => {
        if (!searchQuery) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(i => i.path.toLowerCase().includes(q));
    }, [items, searchQuery]);

    const grouped = useMemo(() => {
        const groups = {};
        for (const item of filtered) {
            const key = item.remediation || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        }
        return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }, [filtered]);

    if (items.length === 0 && (!reconciliation || reconciliation.status === 'ok')) {
        return null;
    }

    const openFDA = () => {
        window.ipcRenderer?.invoke?.('open-system-prefs', 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    };

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-amber-500/[0.04] border border-amber-500/20 rounded-2xl overflow-hidden"
        >
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <ShieldAlert size={16} className="text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">
                        {items.length} Skipped Item{items.length !== 1 ? 's' : ''}
                    </span>
                    {reconciliation && reconciliation.mapped_pct > 0 && (
                        <span className="text-[10px] text-zinc-500 font-mono bg-white/[0.04] px-2 py-0.5 rounded">
                            {reconciliation.mapped_pct}% disk mapped
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500">
                        {expanded ? 'Collapse' : 'View details'}
                    </span>
                    {expanded ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-4 space-y-3">
                            {/* Search */}
                            <div className="relative">
                                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Filter skipped paths..."
                                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:border-amber-500/30"
                                />
                            </div>

                            {/* Quick action */}
                            <button
                                onClick={openFDA}
                                className="flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                            >
                                <ExternalLink size={11} />
                                Open System Settings → Privacy & Security → Full Disk Access
                            </button>

                            {/* Grouped items */}
                            <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                {grouped.map(([remediation, groupItems]) => (
                                    <div key={remediation} className="rounded-lg bg-white/[0.02] p-2.5">
                                        <div className="text-[10px] text-amber-400/70 font-medium mb-1.5">{remediation}</div>
                                        <div className="space-y-0.5">
                                            {groupItems.slice(0, 10).map((item, idx) => (
                                                <div key={idx} className="text-[10px] font-mono text-zinc-500 truncate pl-2 border-l border-zinc-800">
                                                    {item.path}
                                                </div>
                                            ))}
                                            {groupItems.length > 10 && (
                                                <div className="text-[10px] text-zinc-600 pl-2">
                                                    +{groupItems.length - 10} more paths
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Reconciliation info */}
                            {reconciliation && reconciliation.unmapped_bytes > 0 && (
                                <div className="text-[10px] text-zinc-600 mt-2 px-1">
                                    {reconciliation.unmapped_formatted} unmapped space — likely system-protected
                                    directories requiring Full Disk Access
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
