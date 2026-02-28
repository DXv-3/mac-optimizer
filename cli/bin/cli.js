#!/usr/bin/env node

/**
 * mac-optimizer CLI
 * 
 * Usage:
 *   mac-optimizer --scan [path]     # Scan filesystem and output JSON
 *   mac-optimizer --clean           # Run cleanup operations
 *   mac-optimizer --tui             # Launch interactive TUI
 *   mac-optimizer --help            # Show help
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const RUST_BINARY = path.join(__dirname, '../../bin/mac-optimizer-core');

function checkBinary() {
    if (!fs.existsSync(RUST_BINARY)) {
        console.error('Error: mac-optimizer-core binary not found.');
        console.error('Please build the Rust core first: ./build-rust-core.sh');
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
mac-optimizer CLI - Mac cleaning and optimization tool

Usage:
  mac-optimizer <command> [options]

Commands:
  scan [path]       Scan filesystem and output NDJSON (default: /)
  clean             List cleanable caches and logs
  brew-clean        Clean Homebrew caches (--execute to actually clean)
  npm-clean         Clean npm caches (--execute to actually clean)
  tree [path]       Show directory tree with sizes
  dupes [path]      Find duplicate files
  report            Generate comprehensive system report
  tui               Launch interactive Terminal UI

Options:
  --execute         Actually perform cleanup (default is dry-run)
  --depth N         Maximum depth for tree command (default: 3)
  --help            Show this help message
  --version         Show version

Examples:
  mac-optimizer scan /Users/$USER
  mac-optimizer scan -- | jq '.path'
  mac-optimizer clean
  mac-optimizer brew-clean --execute
  mac-optimizer tui
`);
}

function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        showHelp();
        return;
    }
    
    if (args.includes('--version') || args.includes('-v')) {
        console.log('mac-optimizer v1.0.0');
        return;
    }
    
    const command = args[0];
    
    // TUI mode - launch ink-based interface
    if (command === 'tui') {
        const tuiPath = path.join(__dirname, '../tui/index.js');
        if (fs.existsSync(tuiPath)) {
            require(tuiPath);
        } else {
            console.error('TUI not yet implemented. Using Rust CLI instead.');
            checkBinary();
            execSync(`${RUST_BINARY} --help`, { stdio: 'inherit' });
        }
        return;
    }
    
    checkBinary();
    
    // Pass through to Rust binary
    const rustArgs = args.filter(a => a !== '--execute');
    const execute = args.includes('--execute');
    
    switch (command) {
        case 'scan': {
            const scanPath = args[1] || '/';
            execSync(`${RUST_BINARY} scan "${scanPath}"`, { stdio: 'inherit' });
            break;
        }
        case 'clean':
        case 'caches':
            execSync(`${RUST_BINARY} caches`, { stdio: 'inherit' });
            break;
        case 'brew-clean':
            execSync(`${RUST_BINARY} brew-clean ${execute ? '--execute' : ''}`, { stdio: 'inherit' });
            break;
        case 'npm-clean':
            execSync(`${RUST_BINARY} npm-clean ${execute ? '--execute' : ''}`, { stdio: 'inherit' });
            break;
        case 'tree': {
            const treePath = args[1] || '.';
            const depth = args.find((a, i) => args[i - 1] === '--depth') || '3';
            execSync(`${RUST_BINARY} tree "${treePath}" --depth ${depth}`, { stdio: 'inherit' });
            break;
        }
        case 'dupes': {
            const dupePath = args[1] || '.';
            execSync(`${RUST_BINARY} dupes "${dupePath}"`, { stdio: 'inherit' });
            break;
        }
        case 'report':
            execSync(`${RUST_BINARY} report`, { stdio: 'inherit' });
            break;
        default:
            console.error(`Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

main();
