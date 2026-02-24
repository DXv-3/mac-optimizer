import React from 'react';
import { motion } from 'framer-motion';
import { Search, SlidersHorizontal } from 'lucide-react';

const CATEGORY_OPTIONS = [
    { value: 'all', label: 'All Categories' },
    { value: 'browser_cache', label: 'Browser Caches' },
    { value: 'dev_cache', label: 'Developer Tools' },
    { value: 'app_cache', label: 'Application Caches' },
    { value: 'system_logs', label: 'System Logs' },
    { value: 'mail_backups', label: 'Mail & Backups' },
    { value: 'general_cache', label: 'Other Caches' },
];

const RISK_OPTIONS = [
    { value: 'all', label: 'All Risks' },
    { value: 'safe', label: '🟢 Safe' },
    { value: 'caution', label: '🟡 Caution' },
    { value: 'critical', label: '🔴 Critical' },
];

const SIZE_OPTIONS = [
    { value: 0, label: 'Any Size' },
    { value: 1024 * 1024, label: '> 1 MB' },
    { value: 10 * 1024 * 1024, label: '> 10 MB' },
    { value: 100 * 1024 * 1024, label: '> 100 MB' },
    { value: 1024 * 1024 * 1024, label: '> 1 GB' },
];

export default function SearchBar({ query, onQueryChange, filters, onFilterChange }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5"
        >
            {/* Search input */}
            <div className="relative flex-1">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Search by name or path (regex supported)..."
                    className="w-full bg-white/[0.04] border border-white/[0.08] text-white text-sm rounded-xl pl-10 pr-4 py-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/30 focus:ring-1 focus:ring-cyan-500/20 transition-all backdrop-blur-md"
                />
                {query && (
                    <button
                        onClick={() => onQueryChange('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors text-xs"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Category filter */}
            <select
                value={filters.category}
                onChange={(e) => onFilterChange({ ...filters, category: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500/30 transition-all backdrop-blur-md appearance-none cursor-pointer"
            >
                {CATEGORY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
                ))}
            </select>

            {/* Risk filter */}
            <select
                value={filters.riskLevel}
                onChange={(e) => onFilterChange({ ...filters, riskLevel: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500/30 transition-all backdrop-blur-md appearance-none cursor-pointer"
            >
                {RISK_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
                ))}
            </select>

            {/* Size filter */}
            <select
                value={filters.minSize}
                onChange={(e) => onFilterChange({ ...filters, minSize: Number(e.target.value) })}
                className="bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500/30 transition-all backdrop-blur-md appearance-none cursor-pointer"
            >
                {SIZE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
                ))}
            </select>
        </motion.div>
    );
}
