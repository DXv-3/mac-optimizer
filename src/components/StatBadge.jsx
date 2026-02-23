import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

const colorMap = {
    emerald: { active: 'text-emerald-400', glow: 'shadow-emerald-500/10', border: 'border-emerald-500/20' },
    fuchsia: { active: 'text-fuchsia-400', glow: 'shadow-fuchsia-500/10', border: 'border-fuchsia-500/20' },
    violet: { active: 'text-violet-400', glow: 'shadow-violet-500/10', border: 'border-violet-500/20' },
    blue: { active: 'text-blue-400', glow: 'shadow-blue-500/10', border: 'border-blue-500/20' },
};

export default function StatBadge({ title, value, icon, isActive, color = 'emerald' }) {
    const isNumber = typeof value === 'number';
    const colors = colorMap[color] || colorMap.emerald;

    const spring = useSpring(0, { bounce: 0, duration: 1800 });
    const display = useTransform(spring, (current) => {
        if (!isNumber) return current;
        return current % 1 === 0 ? Math.round(current).toString() : current.toFixed(1);
    });

    useEffect(() => {
        if (isNumber) {
            spring.set(value);
        }
    }, [value, isNumber, spring]);

    return (
        <motion.div
            layout
            className={`bg-white/[0.03] backdrop-blur-[20px] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] rounded-[20px] p-6 flex flex-col justify-between transition-all duration-500 ${isActive ? `${colors.border} shadow-lg ${colors.glow}` : ''
                }`}
            whileHover={{ scale: 1.02, borderColor: 'rgba(255,255,255,0.15)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
            <div className="flex items-center justify-between mb-4">
                <motion.span
                    className={isActive ? colors.active : "text-zinc-500"}
                    animate={isActive ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 0.5 }}
                >
                    {icon}
                </motion.span>
                <span className="text-zinc-500 text-[10px] uppercase tracking-[0.15em] font-bold">{title}</span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-white">
                {isNumber ? (
                    <motion.span>{display}</motion.span>
                ) : (
                    <span className="text-zinc-600">{value}</span>
                )}
                {isNumber && (title.includes('Space') || title.includes('Caches')) ? (
                    <span className="text-lg text-zinc-400 ml-1 font-medium">GB</span>
                ) : ''}
            </div>
        </motion.div>
    );
}
