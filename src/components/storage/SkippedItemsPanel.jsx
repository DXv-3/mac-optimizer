import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ChevronDown, ChevronRight, ExternalLink, Search, LockKeyhole } from 'lucide-react';
import useStore from '../../store/useStore';

// Paths known to be FDA-protected — used for the "FDA not granted" summary badge
const FDA_PROTECTED_HINTS = [
    { path: '/Library/Mail', label: 'Mail', estimatedMb: '50–200MB' },
    { path: '/Library/Safari', label: 'Safari', estimatedMb: '10–100MB' },
    { path: '/Library/Messages', label: 'Messages', estimatedMb: '5–50MB' },
    { path: '/Library/HomeKit', label: 'HomeKit', estimatedMb: '1–10MB' },
];

const FDA_REMEDIATION_KEYWORDS = [
    'full disk access',
    'grant full disk',
    'privacy & security',
    'privacy and security',
];

function isFdaItem(item) {
    const rem = (item.remediation || '').toLowerCase();
    return FDA_REMEDIATION_KEYWORDS.some(kw => rem.includes(kw));
}

export default function SkippedItemsPanel({ items = [], reconciliation }) {
    const [expanded, setExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('')
    const { fdaStatus, openFdaSettings } = useStore();

    const filtered = useMemo(() => {
        if (!searchQuery) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(i => i.path.toLowerCase().includes(q));
    }, [items, searchQuery]);

    // Split FDA-type items to the top, everything else below
    const { fdaItems, otherItems } = useMemo(() => {
        const fda = [], other = [];
        for (const item of filtered) {
            (isFdaItem(item) ? fda : other).push(item);
        }
        return { fdaItems: fda, otherItems: other };
    }, [filtered]);

    // Group non-FDA items by remediation string
    const otherGrouped = useMemo(() => {
        const groups = {};
        for (const item of otherItems) {
            const key = item.remediation || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        }
        return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }, [otherItems]);

    const hasFdaIssue = fdaItems.length > 0 || fdaStatus === 'denied';

    if (items.length === 0 && !hasFdaIssue && (!reconciliation || reconciliation.status === 'ok')) {
        return null;
    }

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-amber-500/[0.04] border border-amber-500/20 rounded-2xl overflow-hidden mb-3"
        >
            {/* ── FDA Summary Badge (always visible when relevant) ── */}
            {hasFdaIssue && (
                <div
                    className="flex items-center justify-between px-5 py-3 border-b border-amber-500/10"
                    style={{ background: 'rgba(245,158,11,0.06)' }}
                >
                    <div className="flex items-center gap-2.5">
                        <LockKeyhole size={14} className="text-amber-400 shrink-0" />
                        <span className="text-xs text-amber-300">
                            <span className="font-semibold">FDA not granted</span>
                            {fdaItems.length > 0
                                ? ` — ${fdaItems.length} protected folder${fdaItems.length !== 1 ? 's' : ''} skipped`
                                : ' — protected folders like Mail and Safari not scanned'}
                        </span>
                    </div>
                    <button
                        onClick={openFdaSettings}
                        className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors shrink-0 ml-3"
                    >
                        <ExternalLink size={10} />
                        Fix This
                    </button>
                </div>
            )}

            {/* ── Collapsible Header ── */}
            {items.length > 0 && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <ShieldAlert size={15} className="text-amber-400" />
                        <span className="text-sm font-medium text-amber-300">
                            {items.length} Skipped Item{items.length !== 1 ? 's' : ''}
                        </span>
                        {reconciliation?.mapped_pct > 0 && (
                            <span className="text-[10px] text-zinc-500 font-mono bg-white/[0.04] px-2 py-0.5 rounded">
                                {reconciliation.mapped_pct}% disk mapped
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500">
                            {expanded ? 'Collapse' : 'View details'}
                        </span>
                        {expanded
                            ? <ChevronDown size={14} className="text-zinc-500" />
                            : <ChevronRight size={14} className="text-zinc-500" />
                        }
                    </div>
                </button>
            )}

            <AnimatePresence>
                {expanded && items.length > 0 && (
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

                            {/* ── FDA group (pinned at top) ── */}
                            {fdaItems.length > 0 && (
                                <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <LockKeyhole size={11} className="text-amber-400" />
                                            <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
                                                Full Disk Access Required
                                            </span>
                                        </div>
                                        <button
                                            onClick={openFdaSettings}
                                            className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                                        >
                                            <ExternalLink size={9} /> Fix This
                                        </button>
                                    </div>
                                    <div className="space-y-0.5">
                                        {fdaItems.slice(0, 12).map((item, idx) => (
                                            <div
                                                key={idx}
                                                className="text-[10px] font-mono text-zinc-500 truncate pl-2 border-l border-amber-500/20 select-text cursor-text"
                                            >
                                                {item.path}
                                            </div>
                                        ))}
                                        {fdaItems.length > 12 && (
                                            <div className="text-[10px] text-zinc-600 pl-2">
                                                +{fdaItems.length - 12} more FDA-protected paths
                                            </div>
                                        )}
                                    </div>
                                    {/* Known FDA-protected size hints */}
                                    <div className="mt-2 pt-2 border-t border-amber-500/10">
                                        <div className="text-[9px] text-amber-400/50 mb-1">Estimated unscanned data:</div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                            {FDA_PROTECTED_HINTS.map(hint => (
                                                <span key={hint.path} className="text-[9px] text-zinc-600">
                                                    {hint.label}: <span className="text-amber-400/50">{hint.estimatedMb}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── Other grouped items ── */}
                            {otherGrouped.length > 0 && (
                                <div className="space-y-2 max-h-[160px] overflow-y-auto">
                                    {otherGrouped.map(([remediation, groupItems]) => (
                                        <div key={remediation} className="rounded-lg bg-white/[0.02] p-2.5">
                                            <div className="text-[10px] text-zinc-500 font-medium mb-1.5">{remediation}</div>
                                            <div className="space-y-0.5">
                                                {groupItems.slice(0, 8).map((item, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="text-[10px] font-mono text-zinc-600 truncate pl-2 border-l border-zinc-800 select-text cursor-text"
                                                    >
                                                        {item.path}
                                                    </div>
                                                ))}
                                                {groupItems.length > 8 && (
                                                    <div className="text-[10px] text-zinc-700 pl-2">
                                                        +{groupItems.length - 8} more paths
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Reconciliation info */}
                            {reconciliation?.unmapped_bytes > 0 && (
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
