import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LockKeyhole, CheckCircle, ExternalLink, ScanLine } from 'lucide-react';
import useStore from '../../store/useStore';

// ─── Polling config ───────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;   // check FDA every 2s
const POLL_TIMEOUT_MS = 12000;  // stop polling after 12s

// ─── Animation variants ───────────────────────────────────────────────────────
const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
};

const panelVariants = {
    hidden: { opacity: 0, scale: 0.90, y: 20 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } },
    exit: { opacity: 0, scale: 0.92, y: 10, transition: { duration: 0.2 } },
};

// Status types managed internally
// 'checking'    → brief IPC probe
// 'denied'      → FDA not granted (main UI)
// 'polling'     → user opened System Settings, polling for change
// 'poll_timeout'→ polling timed out — show retry button
// 'granted'     → FDA just became granted, auto-dismiss in 800ms

export default function FDAGateModal({ onScanReady }) {
    const {
        fdaStatus,
        fdaChecking,
        fdaDismissed,
        storageState,
        openFdaSettings,
        dismissFdaWarning,
        startStorageScan,
        resetFda,
    } = useStore();

    // Internal UI state, separate from storageState
    const [phase, setPhase] = useState('denied'); // 'denied' | 'polling' | 'poll_timeout' | 'granted'
    const pollTimerRef = useRef(null);
    const pollCountRef = useRef(0);
    const maxPolls = Math.floor(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);

    // Is the modal visible?
    const isOpen = storageState === 'fda_gate';

    // ── Stop external polling when modal closes ───────────────────────────────
    useEffect(() => {
        if (!isOpen) {
            _stopPolling();
            setPhase('denied');
        }
    }, [isOpen]);

    // ── Polling loop ──────────────────────────────────────────────────────────
    function _startPolling() {
        setPhase('polling');
        pollCountRef.current = 0;
        _stopPolling(); // clear any existing timer
        pollTimerRef.current = setInterval(_pollFda, POLL_INTERVAL_MS);
    }

    function _stopPolling() {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }

    async function _pollFda() {
        pollCountRef.current += 1;

        try {
            const result = window.electronAPI?.checkFdaStatus
                ? await window.electronAPI.checkFdaStatus()
                : { granted: false };

            if (result.granted) {
                _stopPolling();
                setPhase('granted');
                // Auto-close modal and start scan after 800ms
                setTimeout(() => {
                    useStore.setState({ fdaStatus: 'granted', storageState: 'idle' });
                    onScanReady?.(); // caller triggers startStorageScan with dismissed = true
                }, 800);
                return;
            }
        } catch (_) { /* ignore probe error — keep polling */ }

        // Timeout check
        if (pollCountRef.current >= maxPolls) {
            _stopPolling();
            setPhase('poll_timeout');
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────────
    async function handleOpenSettings() {
        await openFdaSettings();
        _startPolling();
    }

    function handleScanWithout() {
        _stopPolling();
        dismissFdaWarning();     // sets fdaDismissed = true in store
        // Close fade_gate and let StorageAnalyzer re-call startStorageScan
        // which will now bypass the gate (fdaDismissed = true)
        useStore.setState({ storageState: 'idle' });
        // Small delay so the modal exit animation plays before scan starts
        setTimeout(() => {
            startStorageScan();
        }, 280);
    }

    function handleRetryPoll() {
        setPhase('denied');
    }

    // ── Escape key ────────────────────────────────────────────────────────────
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape' && isOpen) handleScanWithout();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen]);

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    useEffect(() => () => _stopPolling(), []);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="fda-backdrop"
                    variants={backdropVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0 z-50 flex items-center justify-center"
                    style={{
                        background: 'rgba(0,0,0,0.62)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                    }}
                    // Click backdrop = scan without access
                    onClick={(e) => { if (e.target === e.currentTarget) handleScanWithout(); }}
                >
                    <motion.div
                        key="fda-panel"
                        variants={panelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="relative max-w-sm w-full mx-6 text-center"
                        style={{
                            background: 'rgba(26, 12, 40, 0.92)',
                            backdropFilter: 'blur(32px)',
                            WebkitBackdropFilter: 'blur(32px)',
                            border: '1px solid rgba(255,255,255,0.10)',
                            borderRadius: '28px',
                            boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)',
                            padding: '40px 36px 36px',
                        }}
                    >
                        <AnimatePresence mode="wait">

                            {/* ── Phase: Checking ── */}
                            {fdaChecking && (
                                <motion.div
                                    key="checking"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex flex-col items-center gap-4"
                                >
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                                        className="w-10 h-10 rounded-full border-[3px] border-amber-500/20 border-t-amber-400"
                                    />
                                    <p className="text-sm text-white/50">Checking permissions…</p>
                                </motion.div>
                            )}

                            {/* ── Phase: Denied (main state) ── */}
                            {!fdaChecking && phase === 'denied' && (
                                <motion.div
                                    key="denied"
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -12 }}
                                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                                    className="flex flex-col items-center"
                                >
                                    {/* Lock icon with amber glow */}
                                    <div className="relative mb-6">
                                        <motion.div
                                            animate={{ scale: [1, 1.08, 1] }}
                                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                                            className="w-16 h-16 rounded-[20px] flex items-center justify-center"
                                            style={{
                                                background: 'rgba(245,158,11,0.12)',
                                                border: '1px solid rgba(245,158,11,0.25)',
                                                boxShadow: '0 0 30px rgba(245,158,11,0.2)',
                                            }}
                                        >
                                            <LockKeyhole size={28} className="text-amber-400" />
                                        </motion.div>
                                        {/* Ambient glow blob */}
                                        <div
                                            className="absolute inset-0 -m-4 rounded-full blur-2xl opacity-30"
                                            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.6) 0%, transparent 70%)' }}
                                        />
                                    </div>

                                    <h3 className="text-xl font-bold text-white mb-3 tracking-tight">
                                        Full Disk Access Needed
                                    </h3>
                                    <p className="text-[13px] text-white/50 leading-relaxed mb-8">
                                        For a complete scan, grant <span className="text-amber-400/90 font-medium">Full Disk Access</span> in
                                        System Settings. Without it, protected folders like Mail and Safari will be skipped.
                                    </p>

                                    {/* Primary CTA */}
                                    <motion.button
                                        whileHover={{ scale: 1.03, boxShadow: '0 0 24px rgba(245,158,11,0.35)' }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={handleOpenSettings}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-[14px] font-semibold text-white text-sm mb-3"
                                        style={{
                                            background: 'linear-gradient(135deg, rgba(245,158,11,0.85), rgba(234,88,12,0.85))',
                                            border: '1px solid rgba(245,158,11,0.3)',
                                        }}
                                    >
                                        <ExternalLink size={14} />
                                        Open System Settings
                                    </motion.button>

                                    {/* Secondary ghost button */}
                                    <motion.button
                                        whileHover={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={handleScanWithout}
                                        className="w-full py-2.5 rounded-[14px] text-sm text-white/40 hover:text-white/60 transition-colors"
                                        style={{ border: '1px solid rgba(255,255,255,0.07)' }}
                                    >
                                        Scan Without Full Access
                                    </motion.button>
                                </motion.div>
                            )}

                            {/* ── Phase: Polling ── */}
                            {!fdaChecking && phase === 'polling' && (
                                <motion.div
                                    key="polling"
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -12 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex flex-col items-center gap-5"
                                >
                                    <div className="relative">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                                            className="w-14 h-14 rounded-full border-[3px] border-amber-500/20 border-t-amber-400"
                                        />
                                        <ScanLine
                                            size={20}
                                            className="absolute inset-0 m-auto text-amber-400/60"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-white font-semibold mb-1.5">Waiting for permission…</p>
                                        <p className="text-[12px] text-white/40 leading-relaxed">
                                            Grant Full Disk Access in System Settings,<br />
                                            then return here — we'll detect it automatically.
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleScanWithout}
                                        className="text-xs text-white/30 hover:text-white/50 transition-colors mt-1"
                                    >
                                        Skip and scan without full access
                                    </button>
                                </motion.div>
                            )}

                            {/* ── Phase: Poll timeout ── */}
                            {!fdaChecking && phase === 'poll_timeout' && (
                                <motion.div
                                    key="timeout"
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -12 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex flex-col items-center gap-5"
                                >
                                    <div
                                        className="w-14 h-14 rounded-[18px] flex items-center justify-center"
                                        style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.2)' }}
                                    >
                                        <LockKeyhole size={26} className="text-amber-400/60" />
                                    </div>
                                    <div>
                                        <p className="text-white font-semibold mb-1.5">Permission not detected</p>
                                        <p className="text-[12px] text-white/40 leading-relaxed">
                                            Grant Full Disk Access, then tap <span className="text-amber-400/80">Check Again</span>.
                                        </p>
                                    </div>
                                    <div className="w-full flex flex-col gap-2">
                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.97 }}
                                            onClick={_startPolling}
                                            className="w-full py-2.5 rounded-[14px] text-sm font-semibold text-amber-300"
                                            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.2)' }}
                                        >
                                            Check Again
                                        </motion.button>
                                        <button
                                            onClick={handleScanWithout}
                                            className="text-xs text-white/30 hover:text-white/50 transition-colors py-1"
                                        >
                                            Scan without full access
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* ── Phase: Granted (auto-dismiss) ── */}
                            {!fdaChecking && phase === 'granted' && (
                                <motion.div
                                    key="granted"
                                    initial={{ opacity: 0, scale: 0.85 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.92 }}
                                    transition={{ type: 'spring', stiffness: 240, damping: 18 }}
                                    className="flex flex-col items-center gap-4"
                                >
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.1 }}
                                        className="w-16 h-16 rounded-[20px] flex items-center justify-center"
                                        style={{
                                            background: 'rgba(16,185,129,0.12)',
                                            border: '1px solid rgba(16,185,129,0.3)',
                                            boxShadow: '0 0 30px rgba(16,185,129,0.2)',
                                        }}
                                    >
                                        <CheckCircle size={32} className="text-emerald-400" />
                                    </motion.div>
                                    <div>
                                        <p className="text-xl font-bold text-emerald-400 mb-1">Full Disk Access Granted</p>
                                        <p className="text-xs text-white/40">Starting full scan…</p>
                                    </div>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
