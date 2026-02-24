import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Trash2, X, ChevronDown, ChevronRight, Shield, AlertCircle } from 'lucide-react';

const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

const CATEGORY_LABELS = {
    browser_cache: 'Browser Caches',
    dev_cache: 'Developer Tools',
    app_cache: 'Application Caches',
    system_logs: 'System Logs',
    mail_backups: 'Mail & Backups',
    general_cache: 'Other Caches',
};

const RISK_CONSEQUENCES = {
    safe: 'These are temporary files and caches. Deleting them is safe — apps will recreate them as needed.',
    caution: 'These items may require re-downloading content, re-authenticating, or lose some workflow state. Apps should still function normally.',
    critical: 'These are system files. Deleting them could affect system stability or app functionality. Proceed with extreme caution.',
};

export default function DeleteConfirmModal({ items, totalSize, onConfirm, onCancel }) {
    // Group items by category
    const grouped = useMemo(() => {
        const groups = {};
        for (const item of items) {
            const cat = item.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(item);
        }
        return groups;
    }, [items]);

    const hasCritical = items.some(i => i.risk === 'critical');
    const hasCaution = items.some(i => i.risk === 'caution');

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onCancel}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-zinc-900/95 backdrop-blur-2xl border border-white/[0.1] rounded-[24px] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] w-[560px] max-h-[80vh] flex flex-col overflow-hidden"
            >
                {/* Header */}
                <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasCritical ? 'bg-red-500/15' : hasCaution ? 'bg-amber-500/15' : 'bg-emerald-500/15'
                                }`}>
                                {hasCritical ? <AlertCircle size={20} className="text-red-400" /> :
                                    hasCaution ? <AlertTriangle size={20} className="text-amber-400" /> :
                                        <Shield size={20} className="text-emerald-400" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                    {items.length} items • {formatSize(totalSize)} to recover
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onCancel}
                            className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors"
                        >
                            <X size={16} className="text-zinc-500" />
                        </button>
                    </div>

                    {/* Recovery progress bar preview */}
                    <div className="mt-4 bg-white/[0.04] rounded-full h-2 overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 1.2, ease: 'easeOut' }}
                            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                        />
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-zinc-600">
                        <span>Space to recover</span>
                        <span className="font-bold text-cyan-400">{formatSize(totalSize)}</span>
                    </div>
                </div>

                {/* Body — grouped tree */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {Object.entries(grouped).map(([category, catItems]) => (
                        <div key={category}>
                            <div className="flex items-center gap-2 mb-2">
                                <ChevronDown size={12} className="text-zinc-600" />
                                <span className="text-xs uppercase tracking-[0.12em] text-zinc-500 font-semibold">
                                    {CATEGORY_LABELS[category] || category}
                                </span>
                                <span className="text-[10px] text-zinc-600">
                                    ({catItems.length}) — {formatSize(catItems.reduce((s, i) => s + (i.sizeBytes || 0), 0))}
                                </span>
                            </div>
                            <div className="space-y-1 ml-5">
                                {catItems.map(item => (
                                    <div
                                        key={item.path}
                                        className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                                    >
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.risk === 'safe' ? 'bg-emerald-400' :
                                                item.risk === 'caution' ? 'bg-amber-400' : 'bg-red-400'
                                                }`} />
                                            <span className="text-sm text-zinc-300 truncate">{item.name}</span>
                                        </div>
                                        <span className="text-xs font-mono text-zinc-500 ml-2 flex-shrink-0">
                                            {item.sizeFormatted || formatSize(item.sizeBytes)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Consequences warnings */}
                <div className="px-6 py-3 border-t border-white/[0.06] space-y-2">
                    {hasCritical && (
                        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/15 rounded-xl px-3 py-2.5">
                            <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                            <p className="text-[11px] text-red-400/90 leading-relaxed">{RISK_CONSEQUENCES.critical}</p>
                        </div>
                    )}
                    {hasCaution && (
                        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/15 rounded-xl px-3 py-2.5">
                            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                            <p className="text-[11px] text-amber-400/90 leading-relaxed">{RISK_CONSEQUENCES.caution}</p>
                        </div>
                    )}
                    {!hasCritical && !hasCaution && (
                        <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/15 rounded-xl px-3 py-2.5">
                            <Shield size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                            <p className="text-[11px] text-emerald-400/90 leading-relaxed">{RISK_CONSEQUENCES.safe}</p>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3">
                    <motion.button
                        onClick={onCancel}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-400 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    >
                        Cancel
                    </motion.button>
                    <motion.button
                        onClick={onConfirm}
                        whileHover={{ scale: 1.02, boxShadow: '0 0 25px rgba(239, 68, 68, 0.2)' }}
                        whileTap={{ scale: 0.98 }}
                        className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${hasCritical
                            ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white border border-red-500/30'
                            : 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white border border-cyan-500/20'
                            }`}
                    >
                        <Trash2 size={14} />
                        Move to Trash ({formatSize(totalSize)})
                    </motion.button>
                </div>
            </motion.div>
        </motion.div>
    );
}
