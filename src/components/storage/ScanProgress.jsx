import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader2, FolderSearch, Zap, Clock, AlertTriangle } from 'lucide-react';

const CATEGORY_COLORS = {
    browser_cache: { name: 'Browser', bar: 'bg-cyan-500' },
    dev_cache: { name: 'Dev Tools', bar: 'bg-violet-500' },
    app_cache: { name: 'Apps', bar: 'bg-pink-500' },
    system_logs: { name: 'Logs', bar: 'bg-amber-500' },
    mail_backups: { name: 'Mail/Backup', bar: 'bg-teal-500' },
    general_cache: { name: 'Other', bar: 'bg-indigo-500' },
};

const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

export default function ScanProgress({ progress, items, categories, warnings = [] }) {
    const phase = progress?.phase || 'fast';
    const dir = progress?.currentPath || progress?.dir || 'Initializing...';
    const filesProcessed = progress?.filesProcessed || progress?.files || 0;
    const bytesScanned = progress?.bytesScanned || progress?.bytes || 0;
    const rateMbps = progress?.scanRateMbps || progress?.rate_mbps || 0;
    const elapsed = progress?.elapsed || 0;
    const etaSeconds = progress?.etaSeconds || 0;
    const errorCount = progress?.errorCount || 0;

    // Live category breakdown from streamed items 
    const liveCategories = useMemo(() => {
        const cats = {};
        let total = 0;
        for (const item of items) {
            const cat = item.category || 'general_cache';
            const size = item.sizeBytes || item.size || 0;
            if (!cats[cat]) cats[cat] = { bytes: 0, count: 0 };
            cats[cat].bytes += size;
            cats[cat].count += 1;
            total += size;
        }
        return Object.entries(cats)
            .map(([id, data]) => ({ id, ...data, pct: total > 0 ? (data.bytes / total) * 100 : 0 }))
            .sort((a, b) => b.bytes - a.bytes);
    }, [items]);

    const totalDiscovered = useMemo(() =>
        items.reduce((s, i) => s + (i.sizeBytes || i.size || 0), 0), [items]);

    return (
        <div className="space-y-5">
            {/* Main scanning card */}
            <motion.div
                layout
                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_20px_60px_-20px_rgba(0,0,0,0.5)] rounded-[28px] p-8 relative overflow-hidden"
            >
                {/* Animated background pulse */}
                <motion.div
                    animate={{ opacity: [0.05, 0.15, 0.05], scale: [1, 1.1, 1] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-blue-500/5 rounded-[28px]"
                />

                {/* Particle dots */}
                <div className="absolute inset-0 overflow-hidden rounded-[28px]">
                    {[...Array(8)].map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{
                                x: [Math.random() * 100, Math.random() * 200 - 50],
                                y: [Math.random() * 100, Math.random() * 200 - 50],
                                opacity: [0, 0.6, 0],
                            }}
                            transition={{ duration: 3 + Math.random() * 2, repeat: Infinity, delay: Math.random() * 2, ease: 'easeInOut' }}
                            className="absolute w-1 h-1 rounded-full bg-cyan-400"
                            style={{ left: `${10 + Math.random() * 80}%`, top: `${10 + Math.random() * 80}%` }}
                        />
                    ))}
                </div>

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                className="w-12 h-12 border-[3px] border-cyan-500/20 border-t-cyan-400 rounded-full"
                            />
                            <motion.div
                                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                className="absolute inset-0 w-12 h-12 bg-cyan-500/15 rounded-full"
                            />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold text-white">
                                    {phase === 'fast' ? 'Quick Scan' : 'Deep Analysis'}
                                </h3>
                                <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold px-2 py-0.5 rounded-full ${phase === 'fast' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-violet-500/15 text-violet-400'}`}>
                                    {phase === 'fast' ? 'Pass 1' : 'Pass 2'}
                                </span>
                            </div>
                            <motion.p
                                key={dir}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-zinc-500 text-sm mt-0.5 font-mono truncate"
                            >
                                {dir}
                            </motion.p>
                        </div>

                        {/* Live total discovered */}
                        <div className="text-right">
                            <div className="text-2xl font-bold text-cyan-400">{formatSize(totalDiscovered)}</div>
                            <div className="text-[10px] text-zinc-600 uppercase tracking-wider">discovered</div>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden mb-5">
                        <motion.div
                            initial={{ width: '0%' }}
                            animate={{ width: phase === 'fast' ? '45%' : '90%' }}
                            transition={{ duration: phase === 'fast' ? 30 : 60, ease: 'easeOut' }}
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 relative"
                        >
                            <motion.div
                                animate={{ x: ['-100%', '200%'] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                            />
                        </motion.div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-3">
                        <StatPill label="Files" value={filesProcessed.toLocaleString()} icon={<FolderSearch size={12} />} />
                        <StatPill label="Scanned" value={formatSize(bytesScanned)} icon={<Zap size={12} />} />
                        <StatPill label="Rate" value={`${rateMbps.toFixed(1)} MB/s`} />
                        <StatPill label="Elapsed" value={`${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`} icon={<Clock size={12} />} />
                    </div>

                    {/* Error indicator */}
                    {errorCount > 0 && (
                        <div className="mt-3 text-xs text-amber-400/80 flex items-center gap-1.5">
                            <AlertTriangle size={12} />
                            {errorCount} permission error{errorCount !== 1 ? 's' : ''} (some folders skipped)
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Warning banners (e.g. low disk space) */}
            {warnings.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-500/[0.07] border border-amber-500/20 text-amber-400 px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm"
                >
                    <AlertTriangle size={14} className="flex-shrink-0" />
                    <span>{warnings[warnings.length - 1].message}</span>
                </motion.div>
            )}

            {/* Live category breakdown bar */}
            {liveCategories.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/[0.02] backdrop-blur-md border border-white/[0.06] rounded-2xl p-4"
                >
                    <div className="flex items-center justify-between mb-2.5">
                        <span className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold">
                            Category Breakdown
                        </span>
                        <span className="text-xs text-cyan-400 font-bold">
                            {items.length} items • {formatSize(totalDiscovered)}
                        </span>
                    </div>
                    {/* Stacked bar */}
                    <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.04] mb-3">
                        {liveCategories.map((cat, idx) => {
                            const meta = CATEGORY_COLORS[cat.id] || { bar: 'bg-indigo-500' };
                            return (
                                <motion.div
                                    key={cat.id}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${cat.pct}%` }}
                                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                                    className={`h-full ${meta.bar} ${idx > 0 ? 'border-l border-black/20' : ''}`}
                                />
                            );
                        })}
                    </div>
                    {/* Legend */}
                    <div className="grid grid-cols-3 gap-2">
                        {liveCategories.map(cat => {
                            const meta = CATEGORY_COLORS[cat.id] || { name: cat.id, bar: 'bg-indigo-500' };
                            return (
                                <div key={cat.id} className="flex items-center gap-2 text-xs">
                                    <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${meta.bar}`} />
                                    <span className="text-zinc-400 truncate">{meta.name}</span>
                                    <span className="text-zinc-600 font-mono ml-auto">{formatSize(cat.bytes)}</span>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            )}

            {/* Live discovered items feed */}
            {items.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/[0.02] backdrop-blur-md border border-white/[0.06] rounded-2xl p-5"
                >
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold">
                            Latest Discoveries
                        </span>
                    </div>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                        {items.slice(-10).reverse().map((item, idx) => (
                            <motion.div
                                key={item.path}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.03 }}
                                className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                            >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.risk === 'safe' ? 'bg-emerald-400' : item.risk === 'caution' ? 'bg-amber-400' : 'bg-red-400'}`} />
                                    <span className="text-sm text-zinc-300 truncate">{item.name}</span>
                                </div>
                                <span className="text-sm text-zinc-500 font-mono ml-2 flex-shrink-0">
                                    {item.sizeFormatted || item.size_formatted || formatSize(item.sizeBytes || item.size || 0)}
                                </span>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

function StatPill({ label, value, icon }) {
    return (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600 font-medium mb-1 flex items-center justify-center gap-1">
                {icon}
                {label}
            </div>
            <div className="text-sm font-bold text-white truncate">{value}</div>
        </div>
    );
}
