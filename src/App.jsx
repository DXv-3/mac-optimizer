import React from 'react';
import { Shield, Trash2, LayoutGrid, HardDrive, AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import useStore from './store/useStore';
import SmartCareDashboard from './components/SmartCareDashboard';
import SystemCleanupModule from './components/SystemCleanupModule';
import AppTelemetryManager from './components/AppTelemetryManager';
import StorageAnalyzer from './components/storage/StorageAnalyzer';

// ─── Page transition (250ms macOS-native ease) ───────────────────────────────
const transition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] };
const pageVariants = {
    initial: { opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' },
    animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -8, scale: 0.98, filter: 'blur(4px)' },
};

// ─── Tab config ──────────────────────────────────────────────────────────────
const TABS = [
    { id: 'smartCare', icon: Shield, label: 'Smart Care', accent: 'from-violet-500 to-purple-600' },
    { id: 'cleanup', icon: Trash2, label: 'Cleanup', accent: 'from-green-400  to-emerald-500' },
    { id: 'apps', icon: LayoutGrid, label: 'Applications', accent: 'from-sky-400    to-blue-500' },
    { id: 'storage', icon: HardDrive, label: 'Storage', accent: 'from-orange-400 to-amber-500' },
];

// ─── Background gradient per tab (mirrors CleanMyMac's dynamic bg) ───────────
const BG = {
    smartCare: 'from-[#1a0533] via-[#230441] to-[#0d0220]',
    cleanup: 'from-[#012b10] via-[#013d18] to-[#000e06]',
    apps: 'from-[#001a33] via-[#01254d] to-[#000a1a]',
    storage: 'from-[#2b1400] via-[#3d1d00] to-[#0d0600]',
};

function App() {
    const { activeTab, setActiveTab, error } = useStore();

    const activeConfig = TABS.find(t => t.id === activeTab) ?? TABS[0];

    return (
        <div
            className={`flex h-screen text-white relative overflow-hidden bg-gradient-to-br ${BG[activeTab]}`}
            style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif" }}
        >
            {/* Dynamic ambient orb — fades between tabs */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab + '-orb'}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 0.35, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.6 }}
                    className={`absolute top-[-180px] left-[80px] w-[600px] h-[600px] rounded-full bg-gradient-to-br ${activeConfig.accent} blur-[120px] pointer-events-none`}
                />
            </AnimatePresence>

            {/* ─── Slim icon sidebar (CleanMyMac style ~64px) ──────────────── */}
            <aside
                className="w-[72px] flex flex-col items-center py-6 gap-1 relative z-20 select-none"
                style={{
                    background: 'rgba(10, 4, 18, 0.55)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    borderRight: '1px solid rgba(255,255,255,0.06)',
                    WebkitAppRegion: 'drag',
                }}
            >
                {/* Traffic lights area */}
                <div className="h-7 mb-3" />

                {/* Logo mark */}
                <div className="mb-5 flex flex-col items-center gap-1.5">
                    <div className={`w-9 h-9 rounded-[11px] bg-gradient-to-br ${activeConfig.accent} flex items-center justify-center shadow-lg`}>
                        <Shield size={18} className="text-white" />
                    </div>
                </div>

                {/* Nav items */}
                <nav className="flex flex-col gap-1 w-full px-2" style={{ WebkitAppRegion: 'no-drag' }}>
                    {TABS.map(({ id, icon: Icon, label, accent }) => {
                        const isActive = activeTab === id;
                        return (
                            <motion.button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.94 }}
                                title={label}
                                className="relative flex flex-col items-center justify-center w-full aspect-square rounded-[14px] transition-colors group"
                                style={{ WebkitAppRegion: 'no-drag' }}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="sidebar-bg"
                                        className="absolute inset-0 rounded-[14px]"
                                        style={{
                                            background: 'rgba(255,255,255,0.1)',
                                            border: '1px solid rgba(255,255,255,0.12)',
                                        }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                                    />
                                )}
                                {/* Glow behind active icon */}
                                {isActive && (
                                    <motion.div
                                        layoutId="sidebar-glow"
                                        className={`absolute inset-0 rounded-[14px] opacity-30 blur-sm bg-gradient-to-br ${accent}`}
                                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                                    />
                                )}
                                <Icon
                                    size={20}
                                    className={`relative z-10 transition-colors ${isActive ? 'text-white' : 'text-white/40 group-hover:text-white/70'}`}
                                />
                            </motion.button>
                        );
                    })}
                </nav>

                {/* Bottom label */}
                <div className="mt-auto text-[8px] text-white/20 tracking-widest uppercase rotate-180"
                    style={{ writingMode: 'vertical-rl' }}>
                    Nexus
                </div>
            </aside>

            {/* ─── Main content ─────────────────────────────────────────────── */}
            <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* Title bar drag region */}
                <div
                    className="h-10 flex-shrink-0 flex items-center px-4"
                    style={{ WebkitAppRegion: 'drag' }}
                >
                    <AnimatePresence mode="wait">
                        <motion.span
                            key={activeTab + '-label'}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.2 }}
                            className="text-[13px] font-semibold text-white/40 tracking-wide"
                        >
                            {activeConfig.label}
                        </motion.span>
                    </AnimatePresence>
                </div>

                {/* Scrollable content panel */}
                <div
                    className="flex-1 overflow-y-auto m-3 mt-0 rounded-2xl relative"
                    style={{
                        background: 'rgba(255,255,255,0.04)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255,255,255,0.07)',
                    }}
                >
                    {/* Error toast */}
                    <AnimatePresence>
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={transition}
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm text-red-300"
                                style={{
                                    background: 'rgba(255,60,48,0.12)',
                                    backdropFilter: 'blur(16px)',
                                    border: '1px solid rgba(255,60,48,0.25)',
                                }}
                            >
                                <AlertTriangle size={14} className="flex-shrink-0" />
                                <span className="font-medium">{error}</span>
                                <button
                                    onClick={() => useStore.setState({ error: null })}
                                    className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
                                >
                                    <X size={13} />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Page content with slide transition */}
                    <AnimatePresence mode="wait">
                        {activeTab === 'smartCare' && (
                            <motion.div key="smartCare" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={transition} className="h-full">
                                <SmartCareDashboard />
                            </motion.div>
                        )}
                        {activeTab === 'cleanup' && (
                            <motion.div key="cleanup" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={transition} className="h-full">
                                <SystemCleanupModule />
                            </motion.div>
                        )}
                        {activeTab === 'apps' && (
                            <motion.div key="apps" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={transition} className="h-full">
                                <AppTelemetryManager />
                            </motion.div>
                        )}
                        {activeTab === 'storage' && (
                            <motion.div key="storage" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={transition} className="h-full">
                                <StorageAnalyzer />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
}

export default App;
