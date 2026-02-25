import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';

const CATEGORY_COLORS = {
    'System Data': '#ef4444',
    'Applications': '#3b82f6',
    'Music & Movies': '#a855f7',
    'Documents': '#22c55e',
    'App Data': '#f97316',
    'Developer': '#06b6d4',
    'Photos': '#ec4899',
    'Mail & Messages': '#14b8a6',
    'Cleanable Junk': '#f43f5e',
    'System & Hidden': '#64748b',
    'Other': '#6b7280',
};

const TRANSITION_MS = 400;
const TOOLTIP_DEBOUNCE = 50;

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

function getCategoryColor(node) {
    // Walk up to find the category ancestor
    let current = node;
    while (current && current.depth > 1) {
        current = current.parent;
    }
    if (current && current.data.name) {
        return CATEGORY_COLORS[current.data.name] || '#6b7280';
    }
    return '#6b7280';
}

function darken(hex, amount = 0.3) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))})`;
}

function lighten(hex, amount = 0.15) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))}, ${Math.min(255, Math.round(g + (255 - g) * amount))}, ${Math.min(255, Math.round(b + (255 - b) * amount))})`;
}

export default function TreemapChart({ data, onItemClick, onContextMenu }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [hovered, setHovered] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [zoomStack, setZoomStack] = useState([]);
    const tooltipTimer = useRef(null);
    const nodesRef = useRef([]);
    const animFrameRef = useRef(null);
    const [selectedNodes, setSelectedNodes] = useState(new Set());

    // Observe container size
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // Current zoom root
    const zoomRoot = useMemo(() => {
        if (!data) return null;
        let root = data;
        for (const name of zoomStack) {
            const child = (root.children || []).find(c => c.name === name);
            if (child) root = child;
            else break;
        }
        return root;
    }, [data, zoomStack]);

    // Breadcrumb path
    const breadcrumbs = useMemo(() => {
        const crumbs = [{ name: 'Disk', path: [] }];
        let pathSoFar = [];
        for (const name of zoomStack) {
            pathSoFar = [...pathSoFar, name];
            crumbs.push({ name, path: [...pathSoFar] });
        }
        return crumbs;
    }, [zoomStack]);

    // Compute treemap layout
    const treemapLayout = useMemo(() => {
        if (!zoomRoot || !dimensions.width || !dimensions.height) return null;

        const hierarchy = d3.hierarchy(zoomRoot)
            .sum(d => (d.children && d.children.length > 0) ? 0 : (d.size || 0))
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        d3.treemap()
            .tile(d3.treemapSquarify.ratio(1.2))
            .size([dimensions.width, dimensions.height])
            .paddingOuter(3)
            .paddingInner(2)
            .round(true)(hierarchy);

        return hierarchy;
    }, [zoomRoot, dimensions]);

    // Draw on canvas
    useEffect(() => {
        if (!treemapLayout || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
        ctx.scale(dpr, dpr);

        // Clear
        ctx.clearRect(0, 0, dimensions.width, dimensions.height);

        // Get leaf and branch nodes
        const leaves = treemapLayout.leaves();
        nodesRef.current = leaves;

        // Draw each rect
        for (const node of leaves) {
            const x = node.x0;
            const y = node.y0;
            const w = node.x1 - node.x0;
            const h = node.y1 - node.y0;

            if (w < 1 || h < 1) continue;

            const baseColor = getCategoryColor(node);
            const isHovered = hovered === node;
            const isSelected = selectedNodes.has(node.data.path);

            // Fill
            if (isHovered) {
                ctx.fillStyle = lighten(baseColor, 0.25);
            } else if (isSelected) {
                ctx.fillStyle = lighten(baseColor, 0.15);
            } else {
                // Darken based on depth for visual hierarchy
                const depthFactor = Math.min(0.4, (node.depth - 1) * 0.08);
                ctx.fillStyle = darken(baseColor, depthFactor);
            }

            // Rounded rect
            const r = Math.min(4, w / 4, h / 4);
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            ctx.fill();

            // Hover border
            if (isHovered) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else if (isSelected) {
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }

            // Label (only if rect is big enough)
            if (w > 40 && h > 20) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = `${Math.min(12, Math.max(9, w / 12))}px -apple-system, system-ui, sans-serif`;
                ctx.textBaseline = 'top';

                const label = node.data.name || '';
                const maxChars = Math.floor(w / 7);
                const truncated = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;

                ctx.fillText(truncated, x + 4, y + 4);

                // Size label if enough room
                if (h > 34 && node.value > 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.font = `${Math.min(10, Math.max(8, w / 14))}px -apple-system, system-ui, sans-serif`;
                    ctx.fillText(formatBytes(node.value), x + 4, y + 18);
                }
            }
        }
    }, [treemapLayout, dimensions, hovered, selectedNodes]);

    // Hit test
    const hitTest = useCallback((clientX, clientY) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        // Search in reverse order (drawn later = on top)
        const nodes = nodesRef.current;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (x >= n.x0 && x <= n.x1 && y >= n.y0 && y <= n.y1) {
                return n;
            }
        }
        return null;
    }, []);

    // Mouse handlers
    const handleMouseMove = useCallback((e) => {
        clearTimeout(tooltipTimer.current);
        tooltipTimer.current = setTimeout(() => {
            const node = hitTest(e.clientX, e.clientY);
            setHovered(node);
            if (node) {
                const rect = containerRef.current.getBoundingClientRect();
                let tx = e.clientX - rect.left + 12;
                let ty = e.clientY - rect.top - 8;
                // Avoid overflow
                if (tx + 280 > dimensions.width) tx = e.clientX - rect.left - 290;
                if (ty + 100 > dimensions.height) ty = e.clientY - rect.top - 100;
                setTooltipPos({ x: Math.max(0, tx), y: Math.max(0, ty) });
            }
        }, TOOLTIP_DEBOUNCE);
    }, [hitTest, dimensions]);

    const handleMouseLeave = useCallback(() => {
        clearTimeout(tooltipTimer.current);
        setHovered(null);
    }, []);

    const handleClick = useCallback((e) => {
        const node = hitTest(e.clientX, e.clientY);
        if (!node) return;

        if (e.metaKey || e.ctrlKey) {
            // Multi-select
            setSelectedNodes(prev => {
                const next = new Set(prev);
                const p = node.data.path;
                if (p) {
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                }
                return next;
            });
            return;
        }

        // If node has children data, drill down
        if (node.data.children && node.data.children.length > 0) {
            // Find the ancestor chain from zoom root
            const names = [];
            let current = node;
            while (current && current.depth > 0) {
                names.unshift(current.data.name);
                current = current.parent;
            }
            setZoomStack(prev => [...prev, ...names.filter(n => !prev.includes(n))]);
        } else if (onItemClick && node.data.path) {
            onItemClick(node.data);
        }
    }, [hitTest, onItemClick]);

    const handleContextMenu = useCallback((e) => {
        e.preventDefault();
        const node = hitTest(e.clientX, e.clientY);
        if (node && onContextMenu) {
            onContextMenu(e, node.data);
        }
    }, [hitTest, onContextMenu]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape' && zoomStack.length > 0) {
            setZoomStack(prev => prev.slice(0, -1));
            e.preventDefault();
        }
    }, [zoomStack]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    if (!data || !data.children || data.children.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                No data to display
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-1 px-1 py-2 text-xs shrink-0">
                {breadcrumbs.map((crumb, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <span className="text-zinc-600 mx-0.5">›</span>}
                        <button
                            onClick={() => setZoomStack(crumb.path)}
                            className={`px-2 py-0.5 rounded-md transition-colors ${i === breadcrumbs.length - 1
                                    ? 'text-white bg-white/[0.08]'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                                }`}
                        >
                            {crumb.name}
                        </button>
                    </React.Fragment>
                ))}
                {zoomStack.length > 0 && (
                    <button
                        onClick={() => setZoomStack([])}
                        className="ml-auto text-zinc-500 hover:text-zinc-300 text-[10px] px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                    >
                        Reset Zoom
                    </button>
                )}
            </div>

            {/* Canvas treemap */}
            <div
                ref={containerRef}
                className="flex-1 relative rounded-xl overflow-hidden cursor-pointer"
                style={{ minHeight: 200 }}
            >
                <canvas
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%' }}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}
                    onContextMenu={handleContextMenu}
                />

                {/* Tooltip */}
                {hovered && (
                    <div
                        className="absolute pointer-events-none z-50 bg-zinc-900/95 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 shadow-2xl max-w-[280px]"
                        style={{
                            left: tooltipPos.x,
                            top: tooltipPos.y,
                            transition: 'left 100ms ease-out, top 100ms ease-out',
                        }}
                    >
                        <div className="text-sm font-medium text-white truncate">{hovered.data.name}</div>
                        {hovered.data.path && (
                            <div className="text-[10px] text-zinc-500 mt-0.5 truncate font-mono">{hovered.data.path}</div>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs">
                            <span className="text-cyan-400 font-mono font-bold">{formatBytes(hovered.value)}</span>
                            {hovered.data.children && hovered.data.children.length > 0 && (
                                <span className="text-zinc-500">
                                    {hovered.data.children.length} items • click to drill down
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
