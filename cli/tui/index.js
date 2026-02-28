#!/usr/bin/env node
/**
 * mac-optimizer TUI (Terminal User Interface)
 * 
 * Built with Ink + React for a beautiful terminal experience.
 * This provides an interactive interface for the Rust core.
 */

const React = require('react');
const { render, Text, Box, useInput, useApp } = require('ink');
const { useState, useEffect } = useState;

// Simple placeholder TUI - will be expanded in full implementation
function App() {
    const { exit } = useApp();
    const [selectedIndex, setSelectedIndex] = useState(0);
    
    const menuItems = [
        { label: '🔍 Scan Filesystem', action: 'scan' },
        { label: '🧹 Clean Caches', action: 'clean' },
        { label: '📊 View Storage Report', action: 'report' },
        { label: '🌳 Directory Tree', action: 'tree' },
        { label: '🔎 Find Duplicates', action: 'dupes' },
        { label: '❌ Exit', action: 'exit' },
    ];
    
    useInput((input, key) => {
        if (key.upArrow) {
            setSelectedIndex(i => (i > 0 ? i - 1 : menuItems.length - 1));
        }
        if (key.downArrow) {
            setSelectedIndex(i => (i < menuItems.length - 1 ? i + 1 : 0));
        }
        if (key.return) {
            const item = menuItems[selectedIndex];
            if (item.action === 'exit') {
                exit();
            } else {
                // Will implement actual actions
                console.log(`\nSelected: ${item.label}\n`);
            }
        }
        if (key.escape || input === 'q') {
            exit();
        }
    });
    
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">mac-optimizer TUI</Text>
            </Box>
            <Text dimColor>v1.0.0 | Navigate with arrow keys, Enter to select, Q to quit</Text>
            <Box marginTop={1} flexDirection="column">
                {menuItems.map((item, index) => (
                    <Box key={item.action}>
                        <Text color={selectedIndex === index ? 'cyan' : undefined}>
                            {selectedIndex === index ? '▶ ' : '  '}
                            {item.label}
                        </Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

render(<App />);
