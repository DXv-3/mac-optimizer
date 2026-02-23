import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

export default function StatBadge({ title, value, icon, isActive }) {
    // Check if value is a number to animate it
    const isNumber = typeof value === 'number';

    // Custom spring for counter animation
    const spring = useSpring(0, { bounce: 0, duration: 1500 });
    const display = useTransform(spring, (current) =>
        isNumber ? (current % 1 === 0 ? current : current.toFixed(1)) : current
    );

    useEffect(() => {
        if (isNumber) {
            spring.set(value);
        }
    }, [value, isNumber, spring]);

    return (
        <motion.div
            layout
            className="bg-white/5 backdrop-blur-[20px] border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-[24px] p-6 flex flex-col justify-between"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="flex items-center justify-between mb-4">
                <span className={isActive ? "text-emerald-400" : "text-blue-400"}>{icon}</span>
                <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">{title}</span>
            </div>
            <div className="text-3xl font-bold tracking-tight">
                {isNumber ? <motion.span>{display}</motion.span> : value}
                {isNumber && (title.includes('Space') || title.includes('Caches')) ? ' GB' : ''}
            </div>
        </motion.div>
    );
}
