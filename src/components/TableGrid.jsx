import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TableGrid({ items }) {
    const [sortKey, setSortKey] = useState('sizeBytes');
    const [sortOrder, setSortOrder] = useState('desc');

    const sortedItems = useMemo(() => {
        return [...items].sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];

            if (sortKey === 'lastUsed') {
                // If sorting by lastUsed, use daysSinceUsed for actual numeric sorting
                valA = a['daysSinceUsed'];
                valB = b['daysSinceUsed'];
            }

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }, [items, sortKey, sortOrder]);

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('desc'); // Default to descending when changing keys
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="overflow-x-auto flex-1 h-full flex flex-col pt-2 relative">
                <table className="w-full text-left font-sans flex-1">
                    <thead className="text-zinc-400 text-sm border-b border-white/10 sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('name')}>
                                Application Name <span className="text-xs">{sortKey === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}</span>
                            </th>
                            <th className="px-6 py-4 font-semibold">Diagnosis</th>
                            <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('lastUsed')}>
                                Last Used <span className="text-xs">{sortKey === 'lastUsed' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}</span>
                            </th>
                            <th className="px-6 py-4 font-semibold text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('sizeBytes')}>
                                Size <span className="text-xs">{sortKey === 'sizeBytes' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 relative bg-transparent">
                        <AnimatePresence>
                            {sortedItems.map((app) => (
                                <motion.tr
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                    key={app.id}
                                    className="hover:bg-white/5 transition-colors group"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-semibold text-white">{app.name}</div>
                                        <div className="text-xs text-zinc-500 font-mono mt-0.5 truncate max-w-xs">{app.path}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${app.category === 'Dead Weight' ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' :
                                                app.category === 'Rarely Used' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                                                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                            }`}>
                                            {app.category}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-zinc-300">
                                        {app.lastUsed}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-semibold text-white">{app.sizeFormatted}</div>
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                    </tbody>
                </table>
            </div>
        </div>
    );
}
