import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';

const CATEGORY_COLORS = {
    'System Data': ['#6366f1', '#4f46e5'],     // indigo
    'Applications': ['#ec4899', '#db2777'],    // pink
    'Music & Movies': ['#f59e0b', '#d97706'],  // amber
    'Documents': ['#14b8a6', '#0d9488'],       // teal
    'App Data': ['#06b6d4', '#0891b2'],        // cyan
    'Developer': ['#8b5cf6', '#7c3aed'],       // violet
    'Photos': ['#f472b6', '#db2777'],          // pink-ish
    'Mail & Messages': ['#818cf8', '#4f46e5'], // indigo-ish
    'Cleanable Junk': ['#22d3ee', '#0891b2'],  // cyan
    'System & Hidden': ['#6b7280', '#4b5563'], // gray
    'Other': ['#fbbf24', '#d97706'],           // amber
};

const RISK_COLORS = {
    safe: '#059669',
    caution: '#d97706',
    critical: '#dc2626',
};

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const MathLog = Math.log;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(MathLog(bytes) / MathLog(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

export default function SunburstChart({ data, zoomPath, onZoom, onItemClick }) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const [tooltip, setTooltip] = useState(null);
    const [dimensions, setDimensions] = useState({ width: 400, height: 400 });

    // Observe container size
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const size = Math.min(width, height);
                setDimensions({ width: size, height: size });
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // 1. Calculate D3 Layout Math (Pure Math, No DOM)
    const renderData = useMemo(() => {
        if (!data || !data.children) return null;

        const { width, height } = dimensions;
        const radius = Math.min(width, height) / 2;

        // Find zoom node if specified
        let computeRoot = data;
        let activeScale = 1;

        if (zoomPath) {
            const findNode = (node) => {
                if (node.name === zoomPath || node.path === zoomPath) return node;
                if (node.children) {
                    for (const child of node.children) {
                        const found = findNode(child);
                        if (found) return found;
                    }
                }
                return null;
            };
            const target = findNode(data);
            if (target) computeRoot = target;
        }

        const root = d3.hierarchy(computeRoot)
            .sum(d => d.size || 0)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        const partition = d3.partition()
            .size([2 * Math.PI, radius]);

        partition(root);

        const arcGen = d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
            .padRadius(radius / 3)
            .innerRadius(d => d.y0)
            .outerRadius(d => d.y1 - 1);

        const nodes = root.descendants().filter(d => d.depth > 0);

        const paths = nodes.map(d => {
            // Determine Color
            let fill = '#58a6ff';
            if (d.depth === 1) {
                fill = CATEGORY_COLORS[d.data.name] ? CATEGORY_COLORS[d.data.name][0] : '#58a6ff';
            } else if (d.data.risk) {
                fill = RISK_COLORS[d.data.risk] || '#58a6ff';
            } else if (d.parent && d.parent.depth === 1) {
                fill = CATEGORY_COLORS[d.parent.data.name] ? CATEGORY_COLORS[d.parent.data.name][1] : '#388bfd';
            }

            return {
                ...d,
                svgPath: arcGen(d),
                fill,
                opacity: d.depth === 1 ? 0.85 : 0.65
            };
        });

        return {
            nodes: paths,
            totalNodes: paths.length,
            radius,
            middleText: computeRoot.children ? `${computeRoot.children.length}` : '',
            arcGen
        };
    }, [data, dimensions, zoomPath]);

    const useCanvas = renderData && renderData.totalNodes > 10000;

    // 2. Fallback Canvas Renderer for > 10,000 nodes
    useEffect(() => {
        if (!useCanvas || !renderData || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const { width, height } = dimensions;
        const dpr = window.devicePixelRatio || 1;

        // High-DPI canvas setup
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // Center drawing
        ctx.translate(width / 2, height / 2);

        // Draw nodes directly
        renderData.nodes.forEach(node => {
            const p = new Path2D(node.svgPath);
            ctx.fillStyle = node.fill;
            ctx.globalAlpha = node.opacity;
            ctx.fill(p);
            ctx.strokeStyle = '#0d1117';
            ctx.lineWidth = 0.5;
            ctx.stroke(p);
        });

    }, [useCanvas, renderData, dimensions]);

    // Canvas Hit Testing
    const handleCanvasMouseMove = useCallback((e) => {
        if (!useCanvas || !renderData || !canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left - dimensions.width / 2;
        const y = e.clientY - rect.top - dimensions.height / 2;

        // Math hit-testing: angle and radius
        const hitRadius = Math.sqrt(x * x + y * y);
        let hitAngle = Math.atan2(y, x) + Math.PI / 2; // Offset by 90deg to match D3 start angle 0
        if (hitAngle < 0) hitAngle += 2 * Math.PI;

        const hitNode = renderData.nodes.find(d =>
            hitAngle >= d.x0 && hitAngle <= d.x1 &&
            hitRadius >= d.y0 && hitRadius <= d.y1
        );

        if (hitNode) {
            setTooltip({
                name: hitNode.data.name,
                size: formatBytes(hitNode.value),
                path: hitNode.data.path || null,
                risk: hitNode.data.risk || null,
                x: e.nativeEvent.offsetX,
                y: e.nativeEvent.offsetY,
            });
            document.body.style.cursor = 'pointer';
        } else {
            setTooltip(null);
            document.body.style.cursor = 'default';
        }
    }, [useCanvas, renderData, dimensions]);

    const handleCanvasClick = useCallback((e) => {
        if (!useCanvas || !renderData || !canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left - dimensions.width / 2;
        const y = e.clientY - rect.top - dimensions.height / 2;

        const hitRadius = Math.sqrt(x * x + y * y);
        let hitAngle = Math.atan2(y, x) + Math.PI / 2;
        if (hitAngle < 0) hitAngle += 2 * Math.PI;

        const hitNode = renderData.nodes.find(d =>
            hitAngle >= d.x0 && hitAngle <= d.x1 &&
            hitRadius >= d.y0 && hitRadius <= d.y1
        );

        if (hitNode) {
            if (hitNode.data.path) {
                onItemClick?.(hitNode.data);
            } else if (hitNode.children) {
                onZoom?.(hitNode.data.name);
            }
        } else if (zoomPath) {
            // Clicked empty space, zoom out
            onZoom?.(null);
        }
    }, [useCanvas, renderData, dimensions, zoomPath, onItemClick, onZoom]);

    if (!renderData) {
        return <div ref={containerRef} className="w-full h-full flex items-center justify-center text-zinc-600">No data</div>;
    }

    return (
        <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
            {/* Center zoom out button if zoomed */}
            {zoomPath && (
                <button
                    onClick={() => onZoom(null)}
                    className="absolute z-10 w-16 h-16 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-xs text-white border border-white/10 backdrop-blur-md transition-colors"
                    style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                >
                    Back
                </button>
            )}

            {useCanvas ? (
                <canvas
                    ref={canvasRef}
                    style={{ width: dimensions.width, height: dimensions.height }}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseLeave={() => { setTooltip(null); document.body.style.cursor = 'default'; }}
                    onClick={handleCanvasClick}
                />
            ) : (
                <svg width={dimensions.width} height={dimensions.height} className="overflow-visible">
                    <g transform={`translate(${dimensions.width / 2},${dimensions.height / 2})`}>
                        <AnimatePresence>
                            {renderData.nodes.map((node, i) => (
                                <motion.path
                                    key={node.data.path || node.data.name || i}
                                    d={node.svgPath}
                                    fill={node.fill}
                                    stroke="#0d1117"
                                    strokeWidth={0.5}
                                    initial={{ opacity: 0, scale: 0 }}
                                    animate={{ opacity: node.opacity, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0 }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 200,
                                        damping: 20,
                                        delay: node.depth * 0.05 // Stagger by depth
                                    }}
                                    whileHover={{
                                        opacity: 1,
                                        stroke: '#58a6ff',
                                        strokeWidth: 1.5,
                                        transition: { duration: 0.1 }
                                    }}
                                    onMouseMove={(e) => {
                                        let bounds = e.target.closest('svg').getBoundingClientRect();
                                        setTooltip({
                                            name: node.data.name,
                                            size: formatBytes(node.value),
                                            path: node.data.path,
                                            risk: node.data.risk,
                                            x: e.clientX - bounds.left,
                                            y: e.clientY - bounds.top
                                        });
                                    }}
                                    onMouseLeave={() => setTooltip(null)}
                                    onClick={() => {
                                        if (node.data.path && !node.children) {
                                            onItemClick?.(node.data);
                                        } else if (node.children || node.data.name.includes('Caches')) {
                                            onZoom?.(node.data.name);
                                        }
                                    }}
                                    style={{ cursor: 'pointer' }}
                                />
                            ))}
                        </AnimatePresence>

                        {!zoomPath && (
                            <>
                                <text textAnchor="middle" dy="-0.2em" fill="#c9d1d9" fontSize="14px" fontWeight="700">
                                    {renderData.middleText}
                                </text>
                                <text textAnchor="middle" dy="1.2em" fill="#8b949e" fontSize="10px" fontWeight="500">
                                    categories
                                </text>
                            </>
                        )}
                    </g>
                </svg>
            )}

            {/* Tooltip */}
            <AnimatePresence>
                {tooltip && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="absolute pointer-events-none z-50 bg-zinc-900/95 backdrop-blur-xl border border-white/[0.12] rounded-xl px-4 py-3 shadow-2xl max-w-[280px]"
                        style={{
                            left: Math.min(tooltip.x + 12, dimensions.width - 200),
                            top: Math.min(tooltip.y - 10, dimensions.height - 100),
                        }}
                    >
                        <div className="font-semibold text-white text-sm mb-1 truncate">{tooltip.name}</div>
                        <div className="text-cyan-400 font-bold text-lg">{tooltip.size}</div>
                        {tooltip.path && (
                            <div className="text-[11px] text-zinc-500 mt-1 font-mono break-all">{tooltip.path}</div>
                        )}
                        {tooltip.risk && (
                            <span className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${tooltip.risk === 'safe' ? 'bg-emerald-500/20 text-emerald-400' :
                                tooltip.risk === 'caution' ? 'bg-amber-500/20 text-amber-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                {tooltip.risk.toUpperCase()}
                            </span>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
