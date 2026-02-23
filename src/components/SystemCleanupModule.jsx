import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield } from 'lucide-react';
import useStore from '../store/useStore';

export default function SystemCleanupModule() {
    const { cleanupData, isScanningCleanup, scanCleanup, executeCleanup, isCleaning } = useStore();
    const [selectedIds, setSelectedIds] = useState(new Set());

    useEffect(() => {
        if (!cleanupData && !isScanningCleanup) {
            scanCleanup();
        }
    }, [cleanupData, isScanningCleanup, scanCleanup]);

    useEffect(() => {
        if (cleanupData?.items) {
            setSelectedIds(new Set(cleanupData.items.map(i => i.id)));
        }
    }, [cleanupData]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleExecute = () => {
        const pathsToDelete = cleanupData?.items
            .filter(item => selectedIds.has(item.id))
            .map(item => item.path) || [];
        executeCleanup(pathsToDelete);
    };

    return (
        <div className="max-w-4xl mx-auto h-full flex flex-col pb-6">
            <div className="flex justify-between items-center mb-8 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">System Cleanup</h2>
                    <p className="text-zinc-400 mt-1">Safely remove hidden caches, derived developer data, and unnecessary system files.</p>
                </div>
                <button
                    onClick={scanCleanup}
                    disabled={isScanningCleanup || isCleaning}
                    className="bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-all backdrop-blur-md"
                >
                    {isScanningCleanup ? 'Scanning...' : 'Rescan'}
                </button>
            </div>

            <AnimatePresence mode="wait">
                {isScanningCleanup && !cleanupData ? (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white/5 backdrop-blur-[20px] border border-white/10 rounded-[24px] p-12 flex flex-col items-center justify-center mt-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
                    >
                        <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-6"></div>
                        <h3 className="text-xl font-medium text-white">Analyzing System Directories</h3>
                        <p className="text-zinc-400 mt-2 text-center max-w-sm">Checking ~/Library/Caches, Xcode DerivedData, and hidden application support folders.</p>
                    </motion.div>
                ) : cleanupData && cleanupData.status === "success" ? (
                    <motion.div
                        key="results"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="flex-1 flex flex-col space-y-6 overflow-hidden"
                    >
                        <div className="shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-2xl flex items-center backdrop-blur-xl">
                            <Shield className="mr-3 h-5 w-5" />
                            Scan complete. Found <strong>&nbsp;{cleanupData.items.length}&nbsp;</strong> safely removable areas totaling <strong>&nbsp;{(cleanupData.totalBytes / (1024 ** 3)).toFixed(2)} GB&nbsp;</strong>.
                        </div>

                        <div className="grid gap-4 flex-1 overflow-y-auto pb-4 pr-2">
                            <AnimatePresence>
                                {cleanupData.items.map(item => (
                                    <motion.div
                                        layout
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.98 }}
                                        key={item.id}
                                        onClick={() => toggleSelection(item.id)}
                                        className="bg-white/5 border border-white/10 p-5 rounded-[20px] flex items-center justify-between hover:bg-white/10 transition-colors cursor-pointer backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                                    >
                                        <div className="flex items-center overflow-hidden pr-4">
                                            <div className="relative flex items-center justify-center mr-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(item.id)}
                                                    onChange={() => toggleSelection(item.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-[6px] border border-white/20 bg-white/5 checked:bg-emerald-500 checked:border-emerald-500 transition-all"
                                                />
                                                <svg className="absolute w-3 h-3 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" viewBox="0 0 14 10" fill="none">
                                                    <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="font-semibold text-lg text-white truncate">{item.name}</h4>
                                                <p className="text-sm text-zinc-400 truncate">{item.description}</p>
                                                <p className="text-xs text-zinc-500 mt-1 font-mono truncate">{item.path}</p>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-xl font-bold whitespace-nowrap text-white">{item.sizeFormatted}</div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>

                        {cleanupData.items.length > 0 && (
                            <motion.div
                                layout
                                className="sticky bottom-0 pt-4 pb-2 flex justify-end shrink-0"
                            >
                                <button
                                    onClick={handleExecute}
                                    disabled={isCleaning || selectedIds.size === 0}
                                    className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-bold shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-95"
                                >
                                    {isCleaning ? 'Executing...' : `Clean ${selectedIds.size} Selected`}
                                </button>
                            </motion.div>
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
