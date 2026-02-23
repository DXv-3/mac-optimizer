import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
        <div className="max-w-5xl mx-auto h-full flex flex-col pb-6">
            <div className="flex justify-between items-center mb-8 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">Application Telemetry</h2>
                    <p className="text-zinc-400 mt-1">Identify massively bloated or rarely used applications wasting disk space.</p>
                </div>
                <button
                    onClick={scanApps}
                    disabled={isScanningApps}
                    className="bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-all backdrop-blur-md"
                >
                    {isScanningApps ? 'Scanning...' : 'Analyze Apps'}
                </button>
            </div>

            <AnimatePresence mode="wait">
                {isScanningApps && !appTelemetryData ? (
                    <motion.div
                        key="scanning"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white/5 backdrop-blur-[20px] border border-white/10 rounded-[24px] p-12 flex flex-col items-center justify-center mt-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
                    >
                        <div className="w-16 h-16 border-4 border-fuchsia-500/30 border-t-fuchsia-500 rounded-full animate-spin mb-6"></div>
                        <h3 className="text-xl font-medium text-white">Interrogating macOS Registry</h3>
                        <p className="text-zinc-400 mt-2 text-center max-w-sm">Checking mdls telemetry on all installed applications to calculate true age and utility.</p>
                    </motion.div>
                ) : appTelemetryData && appTelemetryData.status === "success" ? (
                    <motion.div
                        key="results"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="flex-1 bg-white/5 backdrop-blur-[20px] border border-white/10 rounded-[24px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] overflow-hidden flex flex-col"
                    >
                        <TableGrid items={appTelemetryData.items} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
