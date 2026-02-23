import React from 'react';
import { Shield, Trash2, LayoutGrid } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import useStore from './store/useStore';
import SmartCareDashboard from './components/SmartCareDashboard';
import SystemCleanupModule from './components/SystemCleanupModule';
import AppTelemetryManager from './components/AppTelemetryManager';

function App() {
    const { activeTab, setActiveTab, error } = useStore();

    return (
        <div className="flex h-screen text-white font-sans selection:bg-fuchsia-500/30 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#2A0A4A] to-[#0F0518]">
            {/* Sidebar */}
            <aside className="w-56 bg-zinc-950/40 backdrop-blur-xl border-r border-white/10 flex flex-col pt-10 relative z-20">
                <div className="px-6 mb-8 pb-4 pt-2 -mt-10" style={{ WebkitAppRegion: 'drag' }}>
                    <div className="mt-8">
                        <h1 className="text-xl font-bold text-white tracking-tight">Optimization</h1>
                        <p className="text-xs text-fuchsia-400/80 mt-0.5">System Nexus</p>
                    </div>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    <SidebarItem
                        icon={<Shield size={18} />}
                        label="Smart Care"
                        isActive={activeTab === 'smartCare'}
                        onClick={() => setActiveTab('smartCare')}
                    />
                    <SidebarItem
                        icon={<Trash2 size={18} />}
                        label="Cleanup"
                        isActive={activeTab === 'cleanup'}
                        onClick={() => setActiveTab('cleanup')}
                    />
                    <SidebarItem
                        icon={<LayoutGrid size={18} />}
                        label="Applications"
                        isActive={activeTab === 'apps'}
                        onClick={() => setActiveTab('apps')}
                    />
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* Top Title Bar - Drag Region */}
                <div className="h-14 flex items-center px-8 border-b border-white/5 w-full absolute top-0 z-10" style={{ WebkitAppRegion: 'drag' }}>
                    <div className="text-sm font-medium text-zinc-400">
                        {activeTab === 'smartCare' && 'Smart Care Overview'}
                        {activeTab === 'cleanup' && 'System Cleanup'}
                        {activeTab === 'apps' && 'Application Telemetry'}
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto mt-14 p-8 relative">
                    {/* Error Overlay */}
                    <AnimatePresence>
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center shadow-2xl backdrop-blur-md"
                            >
                                <span className="mr-2">⚠️</span>
                                <span>{error}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence mode="wait">
                        {activeTab === 'smartCare' && (
                            <motion.div
                                key="smartCare"
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.3 }}
                                className="h-full"
                            >
                                <SmartCareDashboard />
                            </motion.div>
                        )}

                        {activeTab === 'cleanup' && (
                            <motion.div
                                key="cleanup"
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.3 }}
                                className="h-full"
                            >
                                <SystemCleanupModule />
                            </motion.div>
                        )}

                        {activeTab === 'apps' && (
                            <motion.div
                                key="apps"
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.3 }}
                                className="h-full"
                            >
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
        <button
            onClick={onClick}
            className={`w-full flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-medium relative overflow-hidden ${isActive
                ? 'text-white'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
        >
            {isActive && (
                <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-white/10 rounded-xl"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
            )}
            <span className="relative z-10 mr-3 opacity-80">{icon}</span>
            <span className="relative z-10">{label}</span>
        </button>
    );
}

export default App;
