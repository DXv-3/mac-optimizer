import React, { useMemo, useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, CheckCircle2, AlertTriangle, XCircle, Download, X } from 'lucide-react';
import useStore from '../../store/useStore';

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

export default function DeleteProgress({ progress, log = [] }) {
    const scrollRef = useRef(null);
    const [searchQuery, setSearchQuery] = useState('');
    const closeDeleteProgressModal = useStore(state => state.closeDeleteProgressModal);

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

    const stats = useMemo(() => {
        const success = log.filter(e => e.status === 'success').length;
        const failed = log.filter(e => e.status === 'error').length;
        const skipped = log.filter(e => e.status === 'skipped').length;
        const freedBytes = log.reduce((sum, e) => sum + (e.status === 'success' ? (e.freedBytes || 0) : 0), 0);
        return { success, failed, skipped, freedBytes };
    }, [log]);

    const exportCSV = () => {
        const csv = ['Status,Path,Size,Message']
            .concat(log.map(e => `${e.status},"${e.path}",${e.freedBytes || 0},"${e.message || ''}"`))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `delete-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!progress && log.length === 0) return null;

    const pct = progress ? (progress.completed / Math.max(1, progress.total) * 100) : 100;
    const isActive = progress && progress.completed < progress.total;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_20px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Trash2 size={14} className="text-red-400" />
                    <span className="text-sm font-medium text-white">
                        {isActive ? 'Deleting Files...' : 'Deletion Complete'}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 text-[10px]">
                        <span className="flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 size={10} /> {stats.success}
                        </span>
                        {stats.skipped > 0 && (
                            <span className="flex items-center gap-1 text-amber-400">
                                <AlertTriangle size={10} /> {stats.skipped}
                            </span>
                        )}
                        {stats.failed > 0 && (
                            <span className="flex items-center gap-1 text-red-400">
                                <XCircle size={10} /> {stats.failed}
                            </span>
                        )}
                        <span className="text-cyan-400 font-mono font-bold mr-2">{formatSize(stats.freedBytes)} freed</span>
                    </div>
                    {!isActive && (
                        <button
                            onClick={closeDeleteProgressModal}
                            className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 p-1.5 rounded-md transition-colors flex items-center gap-1 text-[10px] font-medium"
                        >
                            <X size={12} /> Close
                        </button>
                    )}
                </div>
            </div>

            {/* Dual-pane layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-white/[0.06]">
                {/* Left: Progress */}
                <div className="p-5 space-y-3">
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Progress</span>
                            <span className="text-white font-mono">{pct.toFixed(2)}%</span>
                        </div>
                        <div className="h-2.5 bg-white/[0.04] rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-gradient-to-r from-red-500 to-amber-500 rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                            />
                        </div>
                    </div>
                    {progress && (
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div className="bg-white/[0.02] rounded-lg px-3 py-2">
                                <div className="text-zinc-600">Completed</div>
                                <div className="text-white font-mono">{progress.completed} / {progress.total}</div>
                            </div>
                            <div className="bg-white/[0.02] rounded-lg px-3 py-2">
                                <div className="text-zinc-600">Space Freed</div>
                                <div className="text-cyan-400 font-mono font-bold">{formatSize(stats.freedBytes)}</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Action Log */}
                <div className="flex flex-col max-h-[200px]">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04]">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter log..."
                            className="flex-1 bg-transparent text-[10px] text-zinc-300 placeholder-zinc-600 outline-none"
                        />
                        <button
                            onClick={exportCSV}
                            className="text-zinc-600 hover:text-zinc-400 transition-colors"
                            title="Export log to CSV"
                        >
                            <Download size={11} />
                        </button>
                    </div>
                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
                        {filteredLog.map((entry, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-[10px] py-0.5">
                                {entry.status === 'success' && <CheckCircle2 size={10} className="text-emerald-400 mt-0.5 shrink-0" />}
                                {entry.status === 'error' && <XCircle size={10} className="text-red-400 mt-0.5 shrink-0" />}
                                {entry.status === 'skipped' && <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0" />}
                                <span className={`truncate font-mono ${entry.status === 'success' ? 'text-zinc-400' :
                                    entry.status === 'error' ? 'text-red-400/70 select-text cursor-text' :
                                        'text-amber-400/70'
                                    }`}>
                                    {entry.path}
                                    {entry.freedBytes > 0 && (
                                        <span className="text-zinc-600 ml-1">{formatSize(entry.freedBytes)}</span>
                                    )}
                                </span>
                            </div>
                        ))}
                        {filteredLog.length === 0 && (
                            <div className="text-[10px] text-zinc-600 py-2 text-center">
                                {log.length === 0 ? 'No operations yet' : 'No matches'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
