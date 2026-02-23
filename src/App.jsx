import React from 'react';
import { Shield, Trash2, LayoutGrid } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import useStore from './store/useStore';
import SmartCareDashboard from './components/SmartCareDashboard';
import SystemCleanupModule from './components/SystemCleanupModule';
import AppTelemetryManager from './components/AppTelemetryManager';

const pageTransition = {
    initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -12, filter: 'blur(6px)' },
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
};

function App() {
    const { activeTab, setActiveTab, error } = useStore();

    return (
        <div className="flex h-screen text-white font-sans selection:bg-fuchsia-500/30 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#2A0A4A] to-[#0F0518]">
            {/* Sidebar */}
            <aside className="w-56 bg-zinc-950/40 backdrop-blur-xl border-r border-white/[0.06] flex flex-col pt-10 relative z-20">
                <div className="px-6 mb-8 pb-4 pt-2 -mt-10" style={{ WebkitAppRegion: 'drag' }}>
                    <div className="mt-8">
                        <h1 className="text-xl font-bold text-white tracking-tight">Optimization</h1>
                        <p className="text-xs text-fuchsia-400/80 mt-0.5 font-medium tracking-wide">System Nexus</p>
                    </div>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    <SidebarItem icon={<Shield size={18} />} label="Smart Care" isActive={activeTab === 'smartCare'} onClick={() => setActiveTab('smartCare')} />
                    <SidebarItem icon={<Trash2 size={18} />} label="Cleanup" isActive={activeTab === 'cleanup'} onClick={() => setActiveTab('cleanup')} />
                    <SidebarItem icon={<LayoutGrid size={18} />} label="Applications" isActive={activeTab === 'apps'} onClick={() => setActiveTab('apps')} />
                </nav>

                {/* Sidebar Footer */}
                <div className="px-4 py-4 border-t border-white/[0.04]">
                    <div className="text-[10px] text-zinc-600 uppercase tracking-[0.15em]">v1.0 — System Nexus</div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* Top Title Bar - Drag Region */}
                <div className="h-14 flex items-center px-8 border-b border-white/[0.04] w-full shrink-0 backdrop-blur-md bg-white/[0.01] relative z-10" style={{ WebkitAppRegion: 'drag' }}>
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.2 }}
                            className="text-sm font-medium text-zinc-400"
                        >
                            {activeTab === 'smartCare' && 'Smart Care Overview'}
                            {activeTab === 'cleanup' && 'System Cleanup'}
                            {activeTab === 'apps' && 'Application Telemetry'}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-8 relative">
                    {/* Error Overlay */}
                    <AnimatePresence>
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, filter: 'blur(4px)' }}
                                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, y: -20, filter: 'blur(4px)' }}
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center shadow-2xl backdrop-blur-xl"
                            >
                                <span className="mr-2">⚠️</span>
                                <span className="text-sm">{error}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence mode="wait">
                        {activeTab === 'smartCare' && (
                            <motion.div key="smartCare" {...pageTransition} className="h-full">
                                <SmartCareDashboard />
                            </motion.div>
                        )}
                        {activeTab === 'cleanup' && (
                            <motion.div key="cleanup" {...pageTransition} className="h-full">
                                <SystemCleanupModule />
                            </motion.div>
                        )}
                        {activeTab === 'apps' && (
                            <motion.div key="apps" {...pageTransition} className="h-full">
                                <AppTelemetryManager />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
}

function SidebarItem({ icon, label, isActive, onClick }) {
    return (
        <motion.button
            onClick={onClick}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.97 }}
            className={`w-full flex items-center px-4 py-2.5 rounded-xl transition-colors text-sm font-medium relative overflow-hidden ${isActive
                ? 'text-white'
                : 'text-zinc-500 hover:text-zinc-200'
                }`}
        >
            {isActive && (
                <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-white/[0.07] border border-white/[0.08] rounded-xl"
                    initial={false}
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
            )}
            <span className={`relative z-10 mr-3 transition-colors ${isActive ? 'text-fuchsia-400' : 'opacity-60'}`}>{icon}</span>
            <span className="relative z-10">{label}</span>
            {isActive && (
                <motion.div
                    layoutId="sidebar-dot"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-fuchsia-400 rounded-r-full"
                    initial={false}
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
            )}
        </motion.button>
    );
}

export default App;
