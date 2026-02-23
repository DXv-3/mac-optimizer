import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';

const categoryColor = {
    'Active': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    'Rarely Used': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'Dead Weight': 'text-red-400 bg-red-500/10 border-red-500/20',
    'Unknown': 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
};

export default function TableGrid({ data }) {
    const [sortKey, setSortKey] = useState('sizeBytes');
    const [sortDir, setSortDir] = useState('desc');

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const sorted = useMemo(() => {
        if (!data) return [];
        return [...data].sort((a, b) => {
            let aVal = a[sortKey];
            let bVal = b[sortKey];
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, sortKey, sortDir]);

    const SortIcon = ({ field }) => {
        if (sortKey !== field) return <ArrowUpDown size={11} className="text-zinc-600 ml-1.5" />;
        return sortDir === 'asc'
            ? <ChevronUp size={13} className="text-fuchsia-400 ml-1" />
            : <ChevronDown size={13} className="text-fuchsia-400 ml-1" />;
    };

    const columns = [
        { key: 'name', label: 'Application', className: 'flex-[2] min-w-0' },
        { key: 'sizeFormatted', sortKey: 'sizeBytes', label: 'Size', className: 'flex-[0.8] text-right' },
        { key: 'lastUsedFormatted', sortKey: 'daysSinceUsed', label: 'Last Used', className: 'flex-[1] text-right' },
        { key: 'category', label: 'Category', className: 'flex-[0.8] text-right' },
    ];

    return (
        <div className="flex flex-col h-full overflow-hidden bg-white/[0.02] backdrop-blur-[20px] border border-white/[0.06] rounded-[20px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]">
            {/* Header */}
            <div className="flex items-center px-5 py-3 border-b border-white/[0.06] shrink-0">
                {columns.map(col => (
                    <button
                        key={col.key}
                        onClick={() => handleSort(col.sortKey || col.key)}
                        className={`${col.className} flex items-center justify-${col.key === 'name' ? 'start' : 'end'} text-[10px] uppercase tracking-[0.15em] font-bold text-zinc-500 hover:text-zinc-300 transition-colors`}
                    >
                        {col.label}
                        <SortIcon field={col.sortKey || col.key} />
                    </button>
                ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                <AnimatePresence>
                    {sorted.map((app) => (
                        <motion.div
                            layout
                            key={app.name}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            className="flex items-center px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
                        >
                            <div className="flex-[2] min-w-0">
                                <div className="font-medium text-white text-sm truncate group-hover:text-fuchsia-300 transition-colors">{app.name}</div>
                            </div>
                            <div className="flex-[0.8] text-right text-sm text-zinc-300 font-mono">{app.sizeFormatted}</div>
                            <div className="flex-[1] text-right text-sm text-zinc-400">{app.lastUsedFormatted}</div>
                            <div className="flex-[0.8] flex justify-end">
                                <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold uppercase tracking-wider ${categoryColor[app.category] || categoryColor['Unknown']}`}>
                                    {app.category}
                                </span>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
