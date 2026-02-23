import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, CheckCircle } from 'lucide-react';
import useStore from '../store/useStore';

const cardVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.95 },
    visible: (i) => ({
        opacity: 1, y: 0, scale: 1,
        transition: { delay: i * 0.08, type: 'spring', stiffness: 200, damping: 22 }
    }),
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
};

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
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-between items-center mb-8 shrink-0"
            >
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">System Cleanup</h2>
                    <p className="text-zinc-400 mt-1 text-sm">Safely remove hidden caches, derived developer data, and unnecessary system files.</p>
                </div>
                <motion.button
                    onClick={scanCleanup}
                    disabled={isScanningCleanup || isCleaning}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-colors backdrop-blur-md"
                >
                    {isScanningCleanup ? 'Scanning...' : 'Rescan'}
                </motion.button>
            </motion.div>

            <AnimatePresence mode="wait">
                {isScanningCleanup && !cleanupData ? (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] rounded-[28px] p-14 flex flex-col items-center justify-center mt-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]"
                    >
                        <div className="relative mb-6">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                className="w-16 h-16 border-[3px] border-emerald-500/20 border-t-emerald-500 rounded-full"
                            />
                            <motion.div
                                animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                className="absolute inset-0 w-16 h-16 bg-emerald-500/10 rounded-full"
                            />
                        </div>
                        <h3 className="text-xl font-semibold text-white">Analyzing System Directories</h3>
                        <p className="text-zinc-400 mt-2 text-center max-w-sm text-sm">Checking ~/Library/Caches, Xcode DerivedData, and hidden application support folders.</p>
                    </motion.div>
                ) : cleanupData && cleanupData.status === "success" ? (
                    <motion.div
                        key="results"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex-1 flex flex-col space-y-5 overflow-hidden"
                    >
                        {/* Summary Banner */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                            className="shrink-0 bg-emerald-500/[0.07] border border-emerald-500/15 text-emerald-400 p-4 rounded-2xl flex items-center backdrop-blur-xl"
                        >
                            <Shield className="mr-3 h-5 w-5 flex-shrink-0" />
                            <span className="text-sm">
                                Scan complete. Found <strong>{cleanupData.items.length}</strong> safely removable areas totaling <strong>{(cleanupData.totalBytes / (1024 ** 3)).toFixed(2)} GB</strong>.
                            </span>
                        </motion.div>

                        {/* Cleanup Cards */}
                        <div className="grid gap-3 flex-1 overflow-y-auto pb-4 pr-1">
                            {cleanupData.items.map((item, index) => (
                                <motion.div
                                    custom={index}
                                    variants={cardVariants}
                                    initial="hidden"
                                    animate="visible"
                                    exit="exit"
                                    key={item.id}
                                    onClick={() => toggleSelection(item.id)}
                                    whileHover={{ scale: 1.01, borderColor: 'rgba(16, 185, 129, 0.25)' }}
                                    className={`bg-white/[0.03] border p-5 rounded-[20px] flex items-center justify-between cursor-pointer backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] transition-colors ${selectedIds.has(item.id) ? 'border-emerald-500/20' : 'border-white/[0.06]'
                                        }`}
                                >
                                    <div className="flex items-center overflow-hidden pr-4">
                                        <div className="relative flex items-center justify-center mr-4 flex-shrink-0">
                                            <motion.div
                                                animate={selectedIds.has(item.id) ? { scale: [1, 1.15, 1] } : {}}
                                                transition={{ duration: 0.3 }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(item.id)}
                                                    onChange={() => toggleSelection(item.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-[6px] border border-white/20 bg-white/5 checked:bg-emerald-500 checked:border-emerald-500 transition-all"
                                                />
                                                <svg className="absolute w-3 h-3 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" viewBox="0 0 14 10" fill="none">
                                                    <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </motion.div>
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-semibold text-white truncate">{item.name}</h4>
                                            <p className="text-sm text-zinc-400 truncate">{item.description}</p>
                                            <p className="text-xs text-zinc-600 mt-0.5 font-mono truncate">{item.path}</p>
                                        </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <div className="text-xl font-bold whitespace-nowrap text-white">{item.sizeFormatted}</div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        {/* Action Button */}
                        {cleanupData.items.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="sticky bottom-0 pt-4 pb-2 flex justify-end shrink-0"
                            >
                                <motion.button
                                    onClick={handleExecute}
                                    disabled={isCleaning || selectedIds.size === 0}
                                    whileHover={{ scale: 1.03, boxShadow: '0 0 30px rgba(16, 185, 129, 0.3)' }}
                                    whileTap={{ scale: 0.97 }}
                                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-3 rounded-2xl font-bold shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all"
                                >
                                    {isCleaning ? (
                                        <span className="flex items-center gap-2">
                                            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                                            Executing...
                                        </span>
                                    ) : (
                                        `Clean ${selectedIds.size} Selected`
                                    )}
                                </motion.button>
                            </motion.div>
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
