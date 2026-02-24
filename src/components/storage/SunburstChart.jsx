import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';

const RISK_COLORS = {
    safe: { fill: '#059669', gradient: ['#10b981', '#059669'], text: '#6ee7b7' },
    caution: { fill: '#d97706', gradient: ['#f59e0b', '#d97706'], text: '#fcd34d' },
    critical: { fill: '#dc2626', gradient: ['#ef4444', '#dc2626'], text: '#fca5a5' },
};

const CATEGORY_COLORS = {
    'Browser Caches': ['#06b6d4', '#0891b2'],
    'Developer Tools': ['#8b5cf6', '#7c3aed'],
    'Application Caches': ['#ec4899', '#db2777'],
    'System Logs': ['#f59e0b', '#d97706'],
    'Mail & Backups': ['#14b8a6', '#0d9488'],
    'Other Caches': ['#6366f1', '#4f46e5'],
};

export default function SunburstChart({ data, zoomPath, onZoom, onItemClick }) {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
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

    // Build the D3 sunburst
    useEffect(() => {
        if (!data || !svgRef.current) return;

        const { width, height } = dimensions;
        const radius = Math.min(width, height) / 2;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Create hierarchy
        const root = d3.hierarchy(data)
            .sum(d => d.size || 0)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        const partition = d3.partition()
            .size([2 * Math.PI, radius]);

        partition(root);

        // Create SVG defs for gradients
        const defs = svg.append('defs');

        // Center the chart
        const g = svg.append('g')
            .attr('transform', `translate(${width / 2},${height / 2})`);

        // Arc generator
        const arc = d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
            .padRadius(radius / 3)
            .innerRadius(d => d.y0)
            .outerRadius(d => d.y1 - 1);

        // Color function
        const getColor = (d) => {
            if (d.depth === 0) return 'transparent';
            // Category level (depth 1)
            if (d.depth === 1) {
                const colors = CATEGORY_COLORS[d.data.name] || ['#58a6ff', '#388bfd'];
                return colors[0];
            }
            // Item level (depth 2+) – use risk color if available
            if (d.data.risk) {
                return RISK_COLORS[d.data.risk]?.fill || '#58a6ff';
            }
            // Inherit parent color with opacity change
            const parent = d.parent;
            if (parent && parent.depth === 1) {
                const colors = CATEGORY_COLORS[parent.data.name] || ['#58a6ff', '#388bfd'];
                return colors[1];
            }
            return '#58a6ff';
        };

        // Create gradient for each category
        const descendants = root.descendants().filter(d => d.depth > 0);

        descendants.forEach((d, i) => {
            if (d.depth === 1) {
                const colors = CATEGORY_COLORS[d.data.name] || ['#58a6ff', '#388bfd'];
                const grad = defs.append('radialGradient')
                    .attr('id', `grad-${i}`)
                    .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
                grad.append('stop').attr('offset', '0%').attr('stop-color', colors[0]).attr('stop-opacity', 0.9);
                grad.append('stop').attr('offset', '100%').attr('stop-color', colors[1]).attr('stop-opacity', 0.7);
            }
        });

        // Draw arcs
        const paths = g.selectAll('path')
            .data(descendants)
            .join('path')
            .attr('d', arc)
            .attr('fill', (d, i) => d.depth === 1 ? `url(#grad-${i})` : getColor(d))
            .attr('fill-opacity', d => d.depth === 1 ? 0.85 : 0.65)
            .attr('stroke', '#0d1117')
            .attr('stroke-width', 0.5)
            .style('cursor', 'pointer')
            .on('mouseenter', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(150)
                    .attr('fill-opacity', 1)
                    .attr('stroke', '#58a6ff')
                    .attr('stroke-width', 1.5);

                const formatBytes = (bytes) => {
                    if (!bytes || bytes === 0) return '0 B';
                    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(1024));
                    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
                };

                setTooltip({
                    name: d.data.name,
                    size: formatBytes(d.value),
                    path: d.data.path || null,
                    risk: d.data.risk || null,
                    lastAccessed: d.data.last_accessed || null,
                    x: event.offsetX,
                    y: event.offsetY,
                });
            })
            .on('mousemove', function (event) {
                setTooltip(prev => prev ? { ...prev, x: event.offsetX, y: event.offsetY } : null);
            })
            .on('mouseleave', function () {
                d3.select(this)
                    .transition()
                    .duration(150)
                    .attr('fill-opacity', d => d.depth === 1 ? 0.85 : 0.65)
                    .attr('stroke', '#0d1117')
                    .attr('stroke-width', 0.5);
                setTooltip(null);
            })
            .on('click', function (event, d) {
                if (d.data.path) {
                    onItemClick?.(d.data);
                } else if (d.children) {
                    onZoom?.(d.data.name);
                }
            });

        // Initial animation: arcs grow from center
        paths
            .attr('opacity', 0)
            .transition()
            .duration(800)
            .delay((d, i) => i * 15)
            .ease(d3.easeCubicOut)
            .attr('opacity', 1);

        // Center text
        g.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '-0.2em')
            .attr('fill', '#c9d1d9')
            .attr('font-size', '14px')
            .attr('font-weight', '700')
            .text(data.children?.length ? `${data.children.length}` : '');

        g.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '1.2em')
            .attr('fill', '#8b949e')
            .attr('font-size', '10px')
            .attr('font-weight', '500')
            .text('categories');

    }, [data, dimensions, onItemClick, onZoom]);

    return (
        <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
            <svg
                ref={svgRef}
                width={dimensions.width}
                height={dimensions.height}
                className="overflow-visible"
            />

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="absolute pointer-events-none z-50 bg-zinc-900/95 backdrop-blur-xl border border-white/[0.12] rounded-xl px-4 py-3 shadow-2xl max-w-[280px]"
                    style={{
                        left: Math.min(tooltip.x + 12, dimensions.width - 200),
                        top: Math.min(tooltip.y - 10, dimensions.height - 100),
                    }}
                >
                    <div className="font-semibold text-white text-sm mb-1 truncate">{tooltip.name}</div>
                    <div className="text-cyan-400 font-bold text-lg">{tooltip.size}</div>
                    {tooltip.path && (
                        <div className="text-[11px] text-zinc-500 mt-1 font-mono truncate">{tooltip.path}</div>
                    )}
                    {tooltip.lastAccessed && tooltip.lastAccessed !== 'Unknown' && (
                        <div className="text-[11px] text-zinc-500 mt-0.5">Last accessed: {tooltip.lastAccessed}</div>
                    )}
                    {tooltip.risk && (
                        <span className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${tooltip.risk === 'safe' ? 'bg-emerald-500/20 text-emerald-400' :
                                tooltip.risk === 'caution' ? 'bg-amber-500/20 text-amber-400' :
                                    'bg-red-500/20 text-red-400'
                            }`}>
                            {tooltip.risk.toUpperCase()}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
