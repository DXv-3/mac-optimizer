# mac-optimizer CLI & TUI

Terminal-based interface for the mac-optimizer Rust core.

## Installation

```bash
# Link the CLI globally
npm link

# Or run directly
./bin/cli.js --help
```

## Usage

### Commands

```bash
# Scan filesystem (outputs NDJSON)
mac-optimizer scan /Users/$USER

# List cleanable caches
mac-optimizer clean

# Clean Homebrew caches (dry-run by default)
mac-optimizer brew-clean
mac-optimizer brew-clean --execute

# Clean npm caches
mac-optimizer npm-clean
mac-optimizer npm-clean --execute

# View directory tree with sizes
mac-optimizer tree /Users/$USER --depth 3

# Find duplicate files
mac-optimizer dupes /Users/$USER/Downloads

# Generate comprehensive report
mac-optimizer report

# Launch interactive TUI
mac-optimizer tui
```

## TUI (Terminal User Interface)

The TUI provides an interactive ncurses-like experience built with Ink and React:

- **Navigation**: Arrow keys or Vim keys (j/k)
- **Select**: Enter
- **Quit**: Q or Escape

## Development

```bash
# Install dependencies
npm install

# Run TUI in dev mode
npm run dev
```
