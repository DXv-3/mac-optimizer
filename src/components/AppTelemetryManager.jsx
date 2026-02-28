import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scan, AlertTriangle } from 'lucide-react';
import useStore from '../store/useStore';
import TableGrid from './TableGrid';

export default function AppTelemetryManager() {
    const { appTelemetryData, isScanningApps, scanApps } = useStore();

    useEffect(() => {
        if (!appTelemetryData && !isScanningApps) {
            scanApps();
        }
    }, [appTelemetryData, isScanningApps, scanApps]);

    return (
        <div className="max-w-5xl mx-auto flex flex-col h-full pb-6">
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-between items-center mb-8 shrink-0"
            >
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">Application Telemetry</h2>
                    <p className="text-zinc-400 mt-1 text-sm">Track your installed applications by size, usage frequency, and last-accessed date.</p>
                </div>
                <motion.button
                    onClick={scanApps}
                    disabled={isScanningApps}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-colors backdrop-blur-md"
                >
                    {isScanningApps ? 'Scanning...' : 'Rescan'}
                </motion.button>
            </motion.div>

            <AnimatePresence mode="wait">
                {isScanningApps && !appTelemetryData ? (
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
                                className="w-16 h-16 border-[3px] border-fuchsia-500/20 border-t-fuchsia-500 rounded-full"
                            />
                            <motion.div
                                animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                className="absolute inset-0 w-16 h-16 bg-fuchsia-500/10 rounded-full"
                            />
                        </div>
                        <h3 className="text-xl font-semibold text-white">Querying Application Metadata</h3>
                        <p className="text-zinc-400 mt-2 text-center max-w-sm text-sm">Scanning /Applications, inspecting bundle sizes, and analyzing mdls metadata.</p>
                    </motion.div>
                ) : appTelemetryData?.status === "error" ? (
                    <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-red-500/[0.07] border border-red-500/15 rounded-2xl p-6 flex items-center gap-3 select-text cursor-text"
                    >
                        <AlertTriangle className="text-red-400 h-5 w-5 flex-shrink-0" />
                        <div>
                            <h4 className="text-white font-semibold">Telemetry Scan Failed</h4>
                            <p className="text-red-400/80 text-sm mt-1">{appTelemetryData.message}</p>
                        </div>
                    </motion.div>
                ) : appTelemetryData?.status === "success" ? (
                    <motion.div
                        key="results"
                        initial={{ opacity: 0, y: 20, scale: 0.98, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className="flex-1 overflow-hidden flex flex-col"
                    >
                        {/* Summary */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                            className="shrink-0 bg-fuchsia-500/[0.07] border border-fuchsia-500/15 text-fuchsia-300 p-4 rounded-2xl flex items-center backdrop-blur-xl mb-5"
                        >
                            <Scan className="mr-3 h-5 w-5 flex-shrink-0" />
                            {(() => {
                                const deadWeightCount = appTelemetryData.items.filter(a => a.category === 'Dead Weight').length;
                                return (
                                    <span className="text-sm">
                                        Found <strong>{appTelemetryData.items.length}</strong> applications.
                                        {deadWeightCount > 0 && (
                                            <> <strong>{deadWeightCount}</strong> classified as Dead Weight.</>
                                        )}
                                    </span>
                                );
                            })()}
                        </motion.div>

                        <div className="flex-1 overflow-hidden">
                            <TableGrid data={appTelemetryData.items} />
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
