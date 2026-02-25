import React, { useMemo, useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, FolderSearch, Zap, Clock, AlertTriangle, Download, CheckCircle2, Info, XCircle } from 'lucide-react';

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

export default function ScanProgress({ progress, items, categories, warnings = [], log = [] }) {
    const scrollRef = useRef(null);
    const [searchQuery, setSearchQuery] = useState('');

    const phase = progress?.phase || 'fast';
    const dir = progress?.currentPath || progress?.dir || 'Initializing...';
    const filesProcessed = progress?.filesProcessed || progress?.files || 0;
    const bytesScanned = progress?.bytesScanned || progress?.bytes || 0;
    const rateMbps = progress?.scanRateMbps || progress?.rate_mbps || 0;
    const elapsed = progress?.elapsed || 0;
    const errorCount = progress?.errorCount || 0;

    // Auto-scroll log to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [log.length]);

    const filteredLog = useMemo(() => {
        if (!searchQuery) return log;
        try {
            const regex = new RegExp(searchQuery, 'i');
            return log.filter(entry => regex.test(entry.path) || regex.test(entry.message));
        } catch {
            const q = searchQuery.toLowerCase();
            return log.filter(entry => entry.path?.toLowerCase().includes(q) || entry.message?.toLowerCase().includes(q));
        }
    }, [log, searchQuery]);

    const totalDiscovered = useMemo(() =>
        items.reduce((s, i) => s + (i.sizeBytes || i.size || 0), 0), [items]);

    const exportCSV = () => {
        const csv = ['Status,Path,Message,Timestamp']
            .concat(log.map(e => `${e.status},"${e.path}","${e.message || ''}",${new Date(e.timestamp).toISOString()}`))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scan-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4 h-full flex flex-col">
            {warnings.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-500/[0.07] border border-amber-500/20 text-amber-400 px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm shrink-0"
                >
                    <AlertTriangle size={14} className="flex-shrink-0" />
                    <span>{warnings[warnings.length - 1].message}</span>
                </motion.div>
            )}

            <motion.div
                layout
                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_20px_60px_-20px_rgba(0,0,0,0.5)] rounded-[28px] overflow-hidden flex-1 flex flex-col min-h-0"
            >
                {/* Header Strip */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-black/20 shrink-0">
                    <div className="flex items-center gap-3">
                        <Loader2 size={16} className="text-cyan-400 animate-spin" />
                        <span className="text-sm font-medium text-white">
                            {phase === 'fast' ? 'Quick Scan' : 'Deep Analysis'}
                        </span>
                        <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold px-2 py-0.5 rounded-full ${phase === 'fast' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-violet-500/15 text-violet-400'}`}>
                            {phase === 'fast' ? 'Pass 1' : 'Pass 2'}
                        </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                        <span className="text-zinc-400">Errors: <span className="text-red-400">{errorCount}</span></span>
                        <span className="text-cyan-400 font-mono font-bold">{formatSize(totalDiscovered)} found</span>
                    </div>
                </div>

                {/* Dual-pane layout */}
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-x divide-white/[0.06]">

                    {/* Left: Progress Tracking */}
                    <div className="p-6 flex flex-col min-h-0 overflow-y-auto">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="relative shrink-0">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                    className="w-12 h-12 border-[3px] border-cyan-500/20 border-t-cyan-400 rounded-full"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <motion.p
                                    key={dir}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-zinc-300 text-sm font-mono truncate"
                                >
                                    {dir}
                                </motion.p>
                            </div>
                        </div>

                        <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden mb-6 shrink-0">
                            <motion.div
                                initial={{ width: '0%' }}
                                animate={{ width: phase === 'fast' ? '45%' : '90%' }}
                                transition={{ duration: phase === 'fast' ? 30 : 60, ease: 'easeOut' }}
                                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3 shrink-0 mb-6">
                            <StatPill label="Files Checked" value={filesProcessed.toLocaleString()} icon={<FolderSearch size={12} />} />
                            <StatPill label="Data Scanned" value={formatSize(bytesScanned)} icon={<Zap size={12} />} />
                            <StatPill label="Scan Rate" value={`${rateMbps.toFixed(1)} MB/s`} />
                            <StatPill label="Time Elapsed" value={`${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`} icon={<Clock size={12} />} />
                        </div>
                    </div>

                    {/* Right: Action Log */}
                    <div className="flex flex-col min-h-0 bg-black/10">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Filter scan events..."
                                className="flex-1 bg-transparent text-[11px] text-zinc-300 placeholder-zinc-500 outline-none"
                            />
                            <button
                                onClick={exportCSV}
                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                title="Export scan log to CSV"
                            >
                                <Download size={13} />
                            </button>
                        </div>
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                            {filteredLog.map((entry, i) => (
                                <div key={i} className="flex items-start gap-2 text-[11px] py-1 border-b border-white/[0.02] last:border-0">
                                    {entry.status === 'success' && <CheckCircle2 size={12} className="text-emerald-400 mt-0.5 shrink-0" />}
                                    {entry.status === 'error' && <XCircle size={12} className="text-red-400 mt-0.5 shrink-0" />}
                                    {entry.status === 'warning' && <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />}
                                    {entry.status === 'info' && <Info size={12} className="text-cyan-400 mt-0.5 shrink-0" />}

                                    <div className={`flex-1 min-w-0 ${entry.status === 'error' ? 'select-text cursor-text' : ''}`}>
                                        <div className={`truncate font-mono ${entry.status === 'success' ? 'text-zinc-300' :
                                            entry.status === 'error' ? 'text-red-400/90' :
                                                entry.status === 'warning' ? 'text-amber-400/90' :
                                                    'text-zinc-500'
                                            }`}>
                                            {entry.path}
                                        </div>
                                        {entry.message && (
                                            <div className="text-zinc-500 text-[10px] mt-0.5">{entry.message}</div>
                                        )}
                                    </div>
                                    {entry.freedBytes > 0 && (
                                        <span className="text-zinc-400 font-mono shrink-0 ml-2">{formatSize(entry.freedBytes)}</span>
                                    )}
                                </div>
                            ))}
                            {filteredLog.length === 0 && (
                                <div className="text-[11px] text-zinc-600 py-4 text-center">
                                    {log.length === 0 ? 'Awaiting scan events...' : 'No events match filter'}
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </motion.div>
        </div>
    );
}

function StatPill({ label, value, icon }) {
    return (
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-medium mb-1.5 flex items-center justify-center gap-1.5">
                {icon}
                {label}
            </div>
            <div className="text-sm font-bold text-white truncate">{value}</div>
        </div>
    );
}
