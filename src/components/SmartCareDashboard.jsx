import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, Trash2, LayoutGrid, Sparkles, Zap } from 'lucide-react';
import useStore from '../store/useStore';
import StatBadge from './StatBadge';

const scanningPulse = {
    scale: [1, 1.02, 1],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" }
};

const orbFloat = {
    x: [0, 15, -10, 0],
    y: [0, -10, 5, 0],
    transition: { duration: 8, repeat: Infinity, ease: "easeInOut" }
};

export default function SmartCareDashboard() {
    const { scanState, metrics, runSmartScan, setActiveTab, error } = useStore();

    return (
        <div className="max-w-4xl mx-auto space-y-8 h-full flex flex-col">
            {/* Error Banner */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center backdrop-blur-xl overflow-hidden select-text cursor-text"
                    >
                        <span className="mr-2">⚠️</span>
                        <span>{error}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Hero Section */}
            <motion.div
                layout
                animate={scanState === 'scanning' ? scanningPulse : {}}
                className="bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_20px_60px_-20px_rgba(0,0,0,0.5)] rounded-[28px] p-10 relative overflow-hidden min-h-[240px]"
            >
                {/* Animated Background Orbs */}
                <motion.div
                    animate={orbFloat}
                    className={`absolute top-0 right-0 w-72 h-72 rounded-full blur-[80px] -mr-20 -mt-20 transition-colors duration-[2000ms] ${scanState === 'complete' ? 'bg-emerald-500/15' :
                        scanState === 'scanning' ? 'bg-fuchsia-500/20' : 'bg-indigo-500/10'
                        }`}
                />
                <motion.div
                    animate={{ ...orbFloat, transition: { ...orbFloat.transition, delay: 2 } }}
                    className={`absolute bottom-0 left-1/3 w-48 h-48 rounded-full blur-[60px] transition-colors duration-[2000ms] ${scanState === 'complete' ? 'bg-emerald-400/10' :
                        scanState === 'scanning' ? 'bg-violet-500/15' : 'bg-transparent'
                        }`}
                />

                <div className="relative z-10 max-w-lg">
                    <AnimatePresence mode="wait">
                        {scanState === 'idle' && (
                            <motion.div
                                key="idle"
                                initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="flex items-center gap-2 mb-4"
                                >
                                    <Sparkles size={14} className="text-fuchsia-400" />
                                    <span className="text-xs uppercase tracking-[0.2em] text-fuchsia-400/80 font-semibold">System Analysis</span>
                                </motion.div>
                                <h2 className="text-4xl font-bold mb-4 tracking-tight drop-shadow-md text-white leading-[1.1]">Your Mac is due<br />for a deep clean.</h2>
                                <p className="text-zinc-400 text-lg mb-8 leading-relaxed">Run a Smart Scan to identify gigabytes of hidden system bloat and unused applications.</p>
                                <motion.button
                                    onClick={runSmartScan}
                                    whileHover={{ scale: 1.03, boxShadow: '0 0 30px rgba(168, 85, 247, 0.3)' }}
                                    whileTap={{ scale: 0.97 }}
                                    className="bg-gradient-to-r from-fuchsia-600/80 to-violet-600/80 hover:from-fuchsia-500/80 hover:to-violet-500/80 border border-white/10 text-white px-8 py-3.5 rounded-2xl font-semibold shadow-lg backdrop-blur-md transition-colors"
                                >
                                    Start Smart Scan
                                </motion.button>
                            </motion.div>
                        )}

                        {scanState === 'scanning' && (
                            <motion.div
                                key="scanning"
                                initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                                className="py-4"
                            >
                                <div className="flex items-center space-x-4 mb-6">
                                    <div className="relative">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                            className="w-10 h-10 border-[3px] border-fuchsia-500/20 border-t-fuchsia-400 rounded-full"
                                        />
                                        <motion.div
                                            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                                            transition={{ duration: 2, repeat: Infinity }}
                                            className="absolute inset-0 w-10 h-10 bg-fuchsia-500/20 rounded-full"
                                        />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold tracking-tight text-white">Analyzing System...</h2>
                                        <motion.p
                                            animate={{ opacity: [0.4, 0.8, 0.4] }}
                                            transition={{ duration: 3, repeat: Infinity }}
                                            className="text-zinc-400 text-sm mt-1"
                                        >
                                            Scanning caches, application telemetry, and calculating savings
                                        </motion.p>
                                    </div>
                                </div>

                                {/* Scanning Progress Bar */}
                                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                    <motion.div
                                        initial={{ width: '0%' }}
                                        animate={{ width: '85%' }}
                                        transition={{ duration: 15, ease: "easeOut" }}
                                        className="h-full bg-gradient-to-r from-fuchsia-500 to-violet-500 rounded-full"
                                    />
                                </div>
                            </motion.div>
                        )}

                        {scanState === 'complete' && (
                            <motion.div
                                key="complete"
                                initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                                className="py-4"
                            >
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
                                    className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-semibold mb-4"
                                >
                                    <Zap size={12} /> Analysis Complete
                                </motion.div>
                                <h2 className="text-4xl font-bold mb-3 tracking-tight text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]">Scan Complete.</h2>
                                <p className="text-zinc-300 text-lg mb-8">We found <span className="text-white font-bold">{metrics.totalGb} GB</span> of safely removable data.</p>
                                <motion.button
                                    onClick={() => setActiveTab('cleanup')}
                                    whileHover={{ scale: 1.03, boxShadow: '0 0 30px rgba(16, 185, 129, 0.3)' }}
                                    whileTap={{ scale: 0.97 }}
                                    className="bg-gradient-to-r from-emerald-600/80 to-teal-600/80 border border-emerald-500/20 text-white px-8 py-3.5 rounded-2xl font-semibold shadow-[0_0_20px_rgba(16,185,129,0.15)] transition-colors"
                                >
                                    Review & Clean
                                </motion.button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* KPI Metrics with Staggered Entrance */}
            <motion.div
                layout
                className="grid grid-cols-3 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: {},
                    visible: { transition: { staggerChildren: 0.1 } }
                }}
            >
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20 } } }}>
                    <StatBadge
                        title="Potential Space"
                        value={scanState === 'idle' ? '---' : metrics.totalGb}
                        icon={<HardDrive size={20} />}
                        isActive={scanState === 'complete'}
                        color="emerald"
                    />
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20 } } }}>
                    <StatBadge
                        title="System Caches"
                        value={scanState === 'idle' ? '---' : metrics.cachesGb}
                        icon={<Trash2 size={20} />}
                        isActive={scanState === 'complete'}
                        color="fuchsia"
                    />
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20 } } }}>
                    <StatBadge
                        title="Unused Apps"
                        value={scanState === 'idle' ? '---' : metrics.appsCount}
                        icon={<LayoutGrid size={20} />}
                        isActive={scanState === 'complete'}
                        color="violet"
                    />
                </motion.div>
            </motion.div>
        </div>
    );
}
