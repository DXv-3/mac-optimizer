import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, Trash2, LayoutGrid } from 'lucide-react';
import useStore from '../store/useStore';
import StatBadge from './StatBadge';

export default function SmartCareDashboard() {
    const { scanState, metrics, runSmartScan, setActiveTab } = useStore();

    return (
        <div className="max-w-4xl mx-auto space-y-8 h-full flex flex-col">
            {/* Morphing Hero Section */}
            <motion.div
                layout
                className="bg-white/5 backdrop-blur-[20px] border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-[24px] p-10 relative overflow-hidden"
            >
                <motion.div
                    layout
                    className={`absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -mr-20 -mt-20 transition-colors duration-1000 ${scanState === 'complete' ? 'bg-emerald-500/20' : 'bg-fuchsia-500/20'
                        }`}
                />

                <div className="relative z-10 max-w-lg">
                    <AnimatePresence mode="wait">
                        {scanState === 'idle' && (
                            <motion.div
                                key="idle"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.3 }}
                            >
                                <h2 className="text-4xl font-bold mb-4 tracking-tight drop-shadow-md text-white">Your Mac is due for a deep clean.</h2>
                                <p className="text-zinc-300 text-lg mb-8 leading-relaxed">Run a Smart Scan to identify gigabytes of hidden system bloat and unused applications instantly.</p>
                                <button
                                    onClick={runSmartScan}
                                    className="bg-white/10 hover:bg-white/20 border border-white/10 text-white px-8 py-3 rounded-xl font-medium shadow-lg backdrop-blur-md transition-all active:scale-95"
                                >
                                    Start Smart Scan
                                </button>
                            </motion.div>
                        )}

                        {scanState === 'scanning' && (
                            <motion.div
                                key="scanning"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.3 }}
                                className="py-4"
                            >
                                <div className="flex items-center space-x-4 mb-4">
                                    <div className="w-8 h-8 border-4 border-fuchsia-500/30 border-t-fuchsia-400 rounded-full animate-spin"></div>
                                    <h2 className="text-2xl font-bold tracking-tight text-white">Analyzing System...</h2>
                                </div>
                                <p className="text-zinc-400 text-lg">Scanning caches, checking application telemetry, and calculating potential space savings.</p>
                            </motion.div>
                        )}

                        {scanState === 'complete' && (
                            <motion.div
                                key="complete"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.4, type: 'spring' }}
                                className="py-4"
                            >
                                <h2 className="text-4xl font-bold mb-4 tracking-tight text-emerald-400 drop-shadow-sm">Scan Complete.</h2>
                                <p className="text-zinc-300 text-lg mb-8">We found <span className="text-white font-bold">{metrics.totalGb} GB</span> of safely removable data.</p>
                                <button
                                    onClick={() => setActiveTab('cleanup')}
                                    className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-100 px-8 py-3 rounded-xl font-medium shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all active:scale-95"
                                >
                                    Review & Clean
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* KPI Metrics */}
            <motion.div layout className="grid grid-cols-3 gap-4">
                <StatBadge
                    title="Potential Space"
                    value={scanState === 'idle' ? '---' : metrics.totalGb}
                    icon={<HardDrive />}
                    isActive={scanState === 'complete'}
                />
                <StatBadge
                    title="System Caches"
                    value={scanState === 'idle' ? '---' : metrics.cachesGb}
                    icon={<Trash2 />}
                    isActive={scanState === 'complete'}
                />
                <StatBadge
                    title="Unused Apps"
                    value={scanState === 'idle' ? '---' : metrics.appsCount}
                    icon={<LayoutGrid />}
                    isActive={scanState === 'complete'}
                />
            </motion.div>
        </div>
    );
}
