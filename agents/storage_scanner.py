#!/usr/bin/env python3
"""
Storage Deep Scanner — Streaming JSON-over-stdout agent for Mac Optimizer.

CLI Contract:
  storage_scanner.py scan    — run one full discovery + analysis pass (default)
  storage_scanner.py daemon  — long-running watcher that re-scans on changes
  storage_scanner.py status  — emit last cached scan results without re-scanning

Emits newline-delimited JSON events:
  {"event":"progress", ...}   — every ~100ms during scanning
  {"event":"item", ...}       — each discovered cache/junk item
  {"event":"found", ...}      — category summary when a category scan completes
  {"event":"warning", ...}    — disk space or other warnings
  {"event":"complete", ...}   — final summary with metrics, tree, attestation

Two-pass strategy:
  Pass 1 (fast): known macOS cache/junk locations for instant results
  Pass 2 (deep): broader filesystem walk for comprehensive analysis

Error Handling Contract:
  PermissionError  → log path + skip, increment error_count
  Symlink loop     → resolve with os.path.realpath(), skip if circular
  FileNotFoundError→ log + skip (file deleted during scan)
  Disk < 1 GB free → emit warning event, continue but flag in UI
  BrokenPipeError  → exit cleanly (parent process closed)
  Any other OSError→ log full exception, skip item, continue
"""

import argparse
import hashlib
import json
import math
import os
import shutil
import stat
import struct
import subprocess
import sys
import time
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────

HOME = os.path.expanduser("~")
LIBRARY = os.path.join(HOME, "Library")
APP_SUPPORT = os.path.join(LIBRARY, "Application Support", "MacOptimizer")
EMIT_INTERVAL = 0.1  # seconds between progress events
MIN_ITEM_SIZE = 1024  # 1 KB minimum to report
DISK_WARN_THRESHOLD = 1 * 1024 * 1024 * 1024  # 1 GB
DISK_CHECK_INTERVAL = 100  # check every N items
ENTROPY_BINARY_THRESHOLD = 0.30  # >30% non-printable bytes = binary

# ─── Extension Allowlist (file-type targeting) ───────────────────────────────

EXTENSION_ALLOWLIST = {
    "text": {".txt", ".md", ".rst", ".org", ".log", ".out", ".err"},
    "code": {".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".rb",
             ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt",
             ".scala", ".pl", ".r", ".m", ".sh", ".bash", ".zsh", ".fish",
             ".ps1", ".bat", ".cmd", ".sql", ".php", ".lua", ".ex", ".exs"},
    "data": {".json", ".yml", ".yaml", ".toml", ".csv", ".tsv", ".xml",
             ".html", ".htm", ".xhtml", ".sgml", ".ini", ".cfg", ".conf",
             ".env", ".properties", ".tf", ".tfvars", ".ndjson", ".jsonl"},
    "docs": {".pdf", ".doc", ".docx", ".odt", ".rtf", ".xps", ".epub",
             ".mobi", ".azw", ".azw3", ".pdb", ".fb2", ".djvu",
             ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
             ".tex", ".latex", ".bib", ".ipynb"},
}
ALL_ALLOWED_EXTENSIONS = set().union(*EXTENSION_ALLOWLIST.values())


def is_binary_heuristic(path: str, sample_size: int = 8192) -> bool:
    """Check if file is binary by sampling first bytes for non-printable ratio."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(sample_size)
        if not chunk:
            return False
        # Count non-text bytes (excluding common whitespace)
        text_chars = set(range(32, 127)) | {9, 10, 13}  # printable + tab/nl/cr
        non_text = sum(1 for b in chunk if b not in text_chars)
        return (non_text / len(chunk)) > ENTROPY_BINARY_THRESHOLD
    except (OSError, PermissionError):
        return True  # Can't read = treat as binary


def check_disk_space() -> dict:
    """Check available disk space, return status dict."""
    try:
        usage = shutil.disk_usage("/")
        return {
            "free_bytes": usage.free,
            "total_bytes": usage.total,
            "low": usage.free < DISK_WARN_THRESHOLD,
        }
    except OSError:
        return {"free_bytes": -1, "total_bytes": -1, "low": False}


def resolve_symlink_safe(path: str, seen: set = None) -> str | None:
    """Resolve symlink, return None if circular."""
    if seen is None:
        seen = set()
    real = os.path.realpath(path)
    if real in seen:
        return None  # Circular
    seen.add(real)
    return real

# ─── Risk Classification ────────────────────────────────────────────────────

SAFE_PATTERNS = [
    "/Caches/", "/cache/", "/Cache/", "/tmp/", "/Temp/",
    "/DerivedData/", "/node_modules/", "/.npm/", "/__pycache__/",
    "/target/debug/", "/target/release/", "/.cargo/registry/",
    "/pkg/mod/cache/", "/.Trash/", "/Logs/", "/log/",
    "/Code Cache/", "/Service Worker/", "/GPUCache/",
    "/ShaderCache/", "/GrShaderCache/", "/ScriptCache/",
]

CAUTION_PATTERNS = [
    "/Application Support/", "/Containers/", "/Preferences/",
    "/Saved Application State/", "/Homebrew/", "/Docker/",
    "/MobileSync/Backup/", "/Mail Downloads/",
    "/.venv/", "/venv/", "/.virtualenv/",
]

CRITICAL_PATTERNS = [
    "/System/", "/usr/", "/bin/", "/sbin/", "/private/var/db/",
    "/Library/LaunchDaemons/", "/Library/LaunchAgents/",
    "/System/Library/", "/private/etc/",
]


def classify_risk(path: str) -> str:
    """Classify deletion risk based on path patterns."""
    for pattern in CRITICAL_PATTERNS:
        if pattern in path:
            return "critical"
    for pattern in CAUTION_PATTERNS:
        if pattern in path:
            return "caution"
    for pattern in SAFE_PATTERNS:
        if pattern in path:
            return "safe"
    # Default: caution for unknown
    return "caution"


# ─── Utility Functions ──────────────────────────────────────────────────────

def emit(event_dict: dict):
    """Write a JSON event line to stdout and flush immediately."""
    try:
        # Auto-add camelCase aliases for item events (frontend compatibility)
        if event_dict.get("event") == "item":
            if "size" in event_dict and "sizeBytes" not in event_dict:
                event_dict["sizeBytes"] = event_dict["size"]
            if "size_formatted" in event_dict and "sizeFormatted" not in event_dict:
                event_dict["sizeFormatted"] = event_dict["size_formatted"]
            if "last_accessed" in event_dict and "lastUsed" not in event_dict:
                event_dict["lastUsed"] = event_dict["last_accessed"]
        sys.stdout.write(json.dumps(event_dict) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)


def format_size(size_bytes: int) -> str:
    """Convert bytes to human-readable format."""
    if size_bytes == 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024))) if size_bytes > 0 else 0
    i = min(i, len(units) - 1)
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {units[i]}"


def get_last_accessed(path: str) -> str:
    """Get last accessed date from stat, return ISO format string."""
    try:
        st = os.stat(path)
        return datetime.fromtimestamp(st.st_atime).strftime("%Y-%m-%d %H:%M:%S")
    except (OSError, ValueError):
        return "Unknown"


def get_last_modified(path: str) -> str:
    """Get last modified date from stat, return ISO format string."""
    try:
        st = os.stat(path)
        return datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    except (OSError, ValueError):
        return "Unknown"


def get_dir_size_fast(path: str) -> int:
    """Calculate directory size, skipping symlinks."""
    total = 0
    try:
        for dirpath, dirnames, filenames in os.walk(path, followlinks=False):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        total += os.path.getsize(fp)
                    except (OSError, FileNotFoundError):
                        pass
    except (PermissionError, OSError):
        pass
    return total


def dir_exists(path: str) -> bool:
    """Check if directory exists and is accessible."""
    return os.path.isdir(path)


# ─── Progress Tracker ───────────────────────────────────────────────────────

class ProgressTracker:
    """Tracks scanning progress and emits events at intervals.
    
    Error handling contract:
    - Tracks errors by type (permission, symlink, missing, other)
    - Periodically checks disk space (every DISK_CHECK_INTERVAL items)
    - Emits warning events when disk space is low
    """

    def __init__(self):
        self.start_time = time.monotonic()
        self.last_emit_time = 0
        self.files_processed = 0
        self.bytes_scanned = 0
        self.items_found = 0
        self.current_dir = ""
        self.phase = "fast"
        self.rate_samples = []
        self.last_bytes = 0
        self.last_sample_time = time.monotonic()
        # Error tracking
        self.errors = {"permission": 0, "symlink": 0, "missing": 0, "other": 0}
        self.last_error = None
        self.disk_warned = False

    @property
    def error_count(self):
        return sum(self.errors.values())

    def record_error(self, path: str, error: Exception):
        """Record an error according to the error handling contract."""
        if isinstance(error, PermissionError):
            self.errors["permission"] += 1
            self.last_error = f"Permission denied: {path}"
        elif isinstance(error, FileNotFoundError):
            self.errors["missing"] += 1
            self.last_error = f"File vanished: {path}"
        elif isinstance(error, OSError) and "symlink" in str(error).lower():
            self.errors["symlink"] += 1
            self.last_error = f"Symlink issue: {path}"
        else:
            self.errors["other"] += 1
            self.last_error = f"{type(error).__name__}: {path}"

    def check_disk(self):
        """Check disk space every DISK_CHECK_INTERVAL items."""
        if self.items_found > 0 and self.items_found % DISK_CHECK_INTERVAL == 0:
            status = check_disk_space()
            if status["low"] and not self.disk_warned:
                self.disk_warned = True
                emit({
                    "event": "warning",
                    "type": "low_disk_space",
                    "message": f"Low disk space: {format_size(status['free_bytes'])} remaining",
                    "free_bytes": status["free_bytes"],
                })

    def update(self, current_dir: str, files: int = 0, bytes_added: int = 0):
        self.current_dir = current_dir
        self.files_processed += files
        self.bytes_scanned += bytes_added
        if files > 0:
            self.items_found += files
            self.check_disk()
        now = time.monotonic()

        if now - self.last_emit_time >= EMIT_INTERVAL:
            dt = now - self.last_sample_time
            if dt > 0:
                rate = (self.bytes_scanned - self.last_bytes) / dt
                self.rate_samples.append(rate)
                if len(self.rate_samples) > 20:
                    self.rate_samples = self.rate_samples[-20:]
                self.last_bytes = self.bytes_scanned
                self.last_sample_time = now

            avg_rate = sum(self.rate_samples) / len(self.rate_samples) if self.rate_samples else 0
            rate_mbps = avg_rate / (1024 * 1024) if avg_rate > 0 else 0
            elapsed = now - self.start_time

            emit({
                "event": "progress",
                "phase": self.phase,
                "current_path": self.current_dir,
                "dir": self.current_dir,
                "files_processed": self.files_processed,
                "files": self.files_processed,
                "bytes_scanned": self.bytes_scanned,
                "bytes": self.bytes_scanned,
                "scan_rate_mbps": round(rate_mbps, 2),
                "rate_mbps": round(rate_mbps, 2),
                "eta_seconds": -1,
                "elapsed": round(elapsed, 1),
                "error_count": self.error_count,
                "errors": self.errors,
                "last_error": self.last_error,
            })
            self.last_emit_time = now


# ─── Scanner Categories ─────────────────────────────────────────────────────

def scan_browser_caches(tracker: ProgressTracker) -> list:
    """Scan browser cache directories with profile detection."""
    items = []
    browsers = {
        "Chrome": os.path.join(LIBRARY, "Application Support", "Google", "Chrome"),
        "Chrome Canary": os.path.join(LIBRARY, "Application Support", "Google", "Chrome Canary"),
        "Firefox": os.path.join(LIBRARY, "Application Support", "Firefox", "Profiles"),
        "Safari": os.path.join(LIBRARY, "Caches", "com.apple.Safari"),
        "Edge": os.path.join(LIBRARY, "Application Support", "Microsoft Edge"),
        "Brave": os.path.join(LIBRARY, "Application Support", "BraveSoftware", "Brave-Browser"),
    }

    for browser_name, base_path in browsers.items():
        if not dir_exists(base_path):
            continue

        tracker.update(base_path)

        if browser_name == "Firefox":
            # Firefox has profile subdirectories
            try:
                for profile_dir in os.listdir(base_path):
                    profile_path = os.path.join(base_path, profile_dir)
                    if not os.path.isdir(profile_path):
                        continue
                    cache_dirs = ["cache2", "startupCache", "thumbnails"]
                    for cd in cache_dirs:
                        cache_path = os.path.join(profile_path, cd)
                        if dir_exists(cache_path):
                            size = get_dir_size_fast(cache_path)
                            if size > MIN_ITEM_SIZE:
                                item = {
                                    "path": cache_path,
                                    "size": size,
                                    "size_formatted": format_size(size),
                                    "last_accessed": get_last_accessed(cache_path),
                                    "risk": "safe",
                                    "category": "browser_cache",
                                    "name": f"{browser_name} Cache ({profile_dir})",
                                    "description": f"{browser_name} browser cache for profile {profile_dir}",
                                }
                                items.append(item)
                                tracker.update(cache_path, files=1, bytes_added=size)
                                emit({"event": "item", **item})
            except (PermissionError, OSError):
                pass

        elif browser_name == "Safari":
            size = get_dir_size_fast(base_path)
            if size > MIN_ITEM_SIZE:
                item = {
                    "path": base_path,
                    "size": size,
                    "size_formatted": format_size(size),
                    "last_accessed": get_last_accessed(base_path),
                    "risk": "safe",
                    "category": "browser_cache",
                    "name": f"{browser_name} Cache",
                    "description": f"{browser_name} browser cache and website data",
                }
                items.append(item)
                tracker.update(base_path, files=1, bytes_added=size)
                emit({"event": "item", **item})
            # Also check Safari blob storage
            safari_websitedata = os.path.join(LIBRARY, "Caches", "com.apple.Safari.SafeBrowsing")
            if dir_exists(safari_websitedata):
                size = get_dir_size_fast(safari_websitedata)
                if size > MIN_ITEM_SIZE:
                    item = {
                        "path": safari_websitedata,
                        "size": size,
                        "size_formatted": format_size(size),
                        "last_accessed": get_last_accessed(safari_websitedata),
                        "risk": "safe",
                        "category": "browser_cache",
                        "name": "Safari Safe Browsing Data",
                        "description": "Safari safe browsing database cache",
                    }
                    items.append(item)
                    tracker.update(safari_websitedata, files=1, bytes_added=size)
                    emit({"event": "item", **item})

        else:
            # Chrome-based browsers: check each profile
            try:
                cache_subdirs = [
                    "Cache", "Code Cache", "GPUCache", "Service Worker",
                    "ShaderCache", "GrShaderCache", "ScriptCache",
                ]
                profiles = ["Default"] + [
                    d for d in os.listdir(base_path)
                    if d.startswith("Profile ") and os.path.isdir(os.path.join(base_path, d))
                ]
                for profile in profiles:
                    for cache_sub in cache_subdirs:
                        cache_path = os.path.join(base_path, profile, cache_sub)
                        if dir_exists(cache_path):
                            size = get_dir_size_fast(cache_path)
                            if size > MIN_ITEM_SIZE:
                                item = {
                                    "path": cache_path,
                                    "size": size,
                                    "size_formatted": format_size(size),
                                    "last_accessed": get_last_accessed(cache_path),
                                    "risk": "safe",
                                    "category": "browser_cache",
                                    "name": f"{browser_name} {cache_sub} ({profile})",
                                    "description": f"{browser_name} {cache_sub} for {profile}",
                                }
                                items.append(item)
                                tracker.update(cache_path, files=1, bytes_added=size)
                                emit({"event": "item", **item})
            except (PermissionError, OSError):
                pass

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "browser_cache",
            "name": "Browser Caches",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


def scan_dev_caches(tracker: ProgressTracker) -> list:
    """Scan developer tool caches: Docker, node_modules, Python, Homebrew, Cargo, Go."""
    items = []

    # ── Docker ──
    try:
        result = subprocess.run(
            ["docker", "system", "df", "--format", "{{json .}}"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            docker_total = 0
            for line in result.stdout.strip().split("\n"):
                try:
                    data = json.loads(line)
                    # Parse size string (e.g., "2.5GB")
                    size_str = data.get("Size", "0B")
                    reclaimable = data.get("Reclaimable", "0B")
                    # We'll report the reclaimable amount
                except (json.JSONDecodeError, KeyError):
                    continue

            # Also check Docker Desktop VM disk image
            docker_vm = os.path.join(LIBRARY, "Containers", "com.docker.docker", "Data")
            if dir_exists(docker_vm):
                size = get_dir_size_fast(docker_vm)
                if size > MIN_ITEM_SIZE:
                    item = {
                        "path": docker_vm,
                        "size": size,
                        "size_formatted": format_size(size),
                        "last_accessed": get_last_accessed(docker_vm),
                        "risk": "caution",
                        "category": "dev_cache",
                        "name": "Docker Desktop Data",
                        "description": "Docker Desktop VM disk image, containers, volumes, and build cache",
                    }
                    items.append(item)
                    tracker.update(docker_vm, files=1, bytes_added=size)
                    emit({"event": "item", **item})
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass  # Docker not installed

    # ── Node modules — scan common project directories ──
    node_search_paths = [
        os.path.join(HOME, "Desktop"),
        os.path.join(HOME, "Documents"),
        os.path.join(HOME, "Projects"),
        os.path.join(HOME, "Developer"),
        os.path.join(HOME, "dev"),
        os.path.join(HOME, "code"),
        os.path.join(HOME, "repos"),
        os.path.join(HOME, "workspace"),
        os.path.join(HOME, "src"),
    ]

    npm_cache = os.path.join(HOME, ".npm")
    if dir_exists(npm_cache):
        size = get_dir_size_fast(npm_cache)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": npm_cache,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(npm_cache),
                "risk": "safe",
                "category": "dev_cache",
                "name": "NPM Cache (~/.npm)",
                "description": "Global NPM package cache",
            }
            items.append(item)
            tracker.update(npm_cache, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # Scan for nested node_modules (limit depth to avoid excessive time)
    for search_root in node_search_paths:
        if not dir_exists(search_root):
            continue
        tracker.update(search_root)
        try:
            for dirpath, dirnames, _ in os.walk(search_root, followlinks=False):
                depth = dirpath.replace(search_root, "").count(os.sep)
                if depth > 5:
                    dirnames.clear()
                    continue
                if "node_modules" in dirnames:
                    nm_path = os.path.join(dirpath, "node_modules")
                    dirnames.remove("node_modules")  # Don't recurse into it
                    size = get_dir_size_fast(nm_path)
                    if size > MIN_ITEM_SIZE:
                        project_name = os.path.basename(dirpath)
                        item = {
                            "path": nm_path,
                            "size": size,
                            "size_formatted": format_size(size),
                            "last_accessed": get_last_accessed(nm_path),
                            "risk": "safe",
                            "category": "dev_cache",
                            "name": f"node_modules ({project_name})",
                            "description": f"Node.js dependencies for {project_name}",
                        }
                        items.append(item)
                        tracker.update(nm_path, files=1, bytes_added=size)
                        emit({"event": "item", **item})
                # Skip hidden dirs and common non-project dirs
                dirnames[:] = [
                    d for d in dirnames
                    if not d.startswith(".") and d not in ("node_modules", "__pycache__", ".git", "venv", ".venv")
                ]
        except (PermissionError, OSError):
            pass

    # ── Python venv and pip cache ──
    pip_cache = os.path.join(LIBRARY, "Caches", "pip")
    if dir_exists(pip_cache):
        size = get_dir_size_fast(pip_cache)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": pip_cache,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(pip_cache),
                "risk": "safe",
                "category": "dev_cache",
                "name": "Python pip Cache",
                "description": "Cached pip package downloads",
            }
            items.append(item)
            tracker.update(pip_cache, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # ── Homebrew ──
    homebrew_cache = os.path.join(LIBRARY, "Caches", "Homebrew")
    if dir_exists(homebrew_cache):
        size = get_dir_size_fast(homebrew_cache)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": homebrew_cache,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(homebrew_cache),
                "risk": "safe",
                "category": "dev_cache",
                "name": "Homebrew Cache",
                "description": "Homebrew downloaded packages and build artifacts",
            }
            items.append(item)
            tracker.update(homebrew_cache, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # ── Cargo (Rust) ──
    cargo_registry = os.path.join(HOME, ".cargo", "registry")
    if dir_exists(cargo_registry):
        size = get_dir_size_fast(cargo_registry)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": cargo_registry,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(cargo_registry),
                "risk": "safe",
                "category": "dev_cache",
                "name": "Cargo Registry Cache",
                "description": "Rust crate registry cache and source downloads",
            }
            items.append(item)
            tracker.update(cargo_registry, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # ── Go module cache ──
    go_cache = os.path.join(HOME, "go", "pkg", "mod", "cache")
    if not dir_exists(go_cache):
        # Check GOPATH env
        gopath = os.environ.get("GOPATH", "")
        if gopath:
            go_cache = os.path.join(gopath, "pkg", "mod", "cache")
    if dir_exists(go_cache):
        size = get_dir_size_fast(go_cache)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": go_cache,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(go_cache),
                "risk": "safe",
                "category": "dev_cache",
                "name": "Go Module Cache",
                "description": "Go module download cache",
            }
            items.append(item)
            tracker.update(go_cache, files=1, bytes_added=size)
            emit({"event": "item", **item})

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "dev_cache",
            "name": "Developer Caches",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


def scan_app_caches(tracker: ProgressTracker) -> list:
    """Scan application-specific caches: Spotify, Slack, Discord, Adobe, Xcode."""
    items = []
    app_targets = [
        # (name, path, description, risk)
        ("Spotify Cache", os.path.join(LIBRARY, "Caches", "com.spotify.client"), "Spotify streaming cache and offline data", "safe"),
        ("Spotify App Support", os.path.join(LIBRARY, "Application Support", "Spotify", "PersistentCache"), "Spotify persistent cache data", "safe"),
        ("Slack Cache", os.path.join(LIBRARY, "Application Support", "Slack", "Cache"), "Slack cached conversations and media", "safe"),
        ("Slack Service Worker", os.path.join(LIBRARY, "Application Support", "Slack", "Service Worker"), "Slack service worker cache", "safe"),
        ("Discord Cache", os.path.join(LIBRARY, "Application Support", "discord", "Cache"), "Discord cached messages and media", "safe"),
        ("Discord Code Cache", os.path.join(LIBRARY, "Application Support", "discord", "Code Cache"), "Discord compiled code cache", "safe"),
        ("Adobe Creative Cloud Cache", os.path.join(LIBRARY, "Caches", "Adobe"), "Adobe application caches", "safe"),
        ("Adobe CC App Data", os.path.join(LIBRARY, "Application Support", "Adobe", "Common", "Media Cache Files"), "Adobe media cache files", "safe"),
        ("Xcode DerivedData", os.path.join(LIBRARY, "Developer", "Xcode", "DerivedData"), "Compiled Xcode project build artifacts", "safe"),
        ("Xcode Archives", os.path.join(LIBRARY, "Developer", "Xcode", "Archives"), "Xcode archived app builds", "caution"),
        ("Xcode Device Logs", os.path.join(LIBRARY, "Developer", "Xcode", "iOS DeviceSupport"), "iOS device support files and symbols", "safe"),
        ("Xcode Simulators", os.path.join(LIBRARY, "Developer", "CoreSimulator", "Devices"), "iOS Simulator installations and data", "caution"),
        ("Xcode Caches", os.path.join(LIBRARY, "Caches", "com.apple.dt.Xcode"), "Xcode internal caches", "safe"),
        ("VS Code Cache", os.path.join(LIBRARY, "Application Support", "Code", "Cache"), "VS Code editor cache", "safe"),
        ("VS Code Cached Extensions", os.path.join(LIBRARY, "Application Support", "Code", "CachedExtensionVSIXs"), "VS Code extension installation cache", "safe"),
        ("Teams Cache", os.path.join(LIBRARY, "Application Support", "Microsoft Teams", "Cache"), "Microsoft Teams cache data", "safe"),
        ("Zoom Cache", os.path.join(LIBRARY, "Application Support", "zoom.us", "data"), "Zoom cached data", "safe"),
    ]

    for name, path, description, risk in app_targets:
        if not dir_exists(path):
            continue
        tracker.update(path)
        size = get_dir_size_fast(path)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": path,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(path),
                "risk": risk,
                "category": "app_cache",
                "name": name,
                "description": description,
            }
            items.append(item)
            tracker.update(path, files=1, bytes_added=size)
            emit({"event": "item", **item})

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "app_cache",
            "name": "Application Caches",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


def scan_system_logs(tracker: ProgressTracker) -> list:
    """Scan system and user log files."""
    items = []
    log_targets = [
        ("User Logs", os.path.join(LIBRARY, "Logs"), "Application and system log files in ~/Library/Logs", "safe"),
        ("System Logs", "/var/log", "macOS system log files", "caution"),
        ("ASL Logs", "/private/var/log/asl", "Apple System Log files", "safe"),
        ("Diagnostic Reports", os.path.join(LIBRARY, "Logs", "DiagnosticReports"), "Crash reports and diagnostic data", "safe"),
        ("CoreSimulator Logs", os.path.join(LIBRARY, "Logs", "CoreSimulator"), "iOS Simulator log files", "safe"),
    ]

    for name, path, description, risk in log_targets:
        if not dir_exists(path) and not os.path.isfile(path):
            continue
        tracker.update(path)
        size = get_dir_size_fast(path) if os.path.isdir(path) else os.path.getsize(path)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": path,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(path),
                "risk": risk,
                "category": "system_logs",
                "name": name,
                "description": description,
            }
            items.append(item)
            tracker.update(path, files=1, bytes_added=size)
            emit({"event": "item", **item})

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "system_logs",
            "name": "System Logs",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


def scan_mail_and_backups(tracker: ProgressTracker) -> list:
    """Scan Mail downloads, Time Machine snapshots, iOS backups, Trash."""
    items = []

    # ── Mail Downloads ──
    mail_downloads = os.path.join(LIBRARY, "Containers", "com.apple.mail", "Data", "Library", "Mail Downloads")
    if not dir_exists(mail_downloads):
        mail_downloads = os.path.join(LIBRARY, "Mail Downloads")
    if dir_exists(mail_downloads):
        tracker.update(mail_downloads)
        size = get_dir_size_fast(mail_downloads)
        if size > MIN_ITEM_SIZE:
            item = {
                "path": mail_downloads,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(mail_downloads),
                "risk": "safe",
                "category": "mail_backups",
                "name": "Mail Downloads",
                "description": "Email attachment downloads cached by Apple Mail",
            }
            items.append(item)
            tracker.update(mail_downloads, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # ── Time Machine Local Snapshots ──
    try:
        result = subprocess.run(
            ["tmutil", "listlocalsnapshots", "/"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            snapshot_lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
            if snapshot_lines:
                item = {
                    "path": "/System/Volumes/Data/.TimeMachine",
                    "size": 0,  # Can't easily determine size without root
                    "size_formatted": f"{len(snapshot_lines)} snapshots",
                    "last_accessed": get_last_accessed("/"),
                    "risk": "caution",
                    "category": "mail_backups",
                    "name": f"Time Machine Snapshots ({len(snapshot_lines)})",
                    "description": "Local Time Machine snapshots stored on this volume",
                }
                items.append(item)
                emit({"event": "item", **item})
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # ── iOS Backups ──
    ios_backups = os.path.join(LIBRARY, "Application Support", "MobileSync", "Backup")
    if dir_exists(ios_backups):
        tracker.update(ios_backups)
        size = get_dir_size_fast(ios_backups)
        if size > MIN_ITEM_SIZE:
            # Count individual backups
            try:
                backup_count = len([d for d in os.listdir(ios_backups) if os.path.isdir(os.path.join(ios_backups, d))])
            except OSError:
                backup_count = 0
            item = {
                "path": ios_backups,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(ios_backups),
                "risk": "caution",
                "category": "mail_backups",
                "name": f"iOS Device Backups ({backup_count} backup{'s' if backup_count != 1 else ''})",
                "description": "Local backups of iPhones and iPads via Finder/iTunes",
            }
            items.append(item)
            tracker.update(ios_backups, files=1, bytes_added=size)
            emit({"event": "item", **item})

    # ── Trash ──
    trash_path = os.path.join(HOME, ".Trash")
    if dir_exists(trash_path):
        tracker.update(trash_path)
        size = get_dir_size_fast(trash_path)
        if size > MIN_ITEM_SIZE:
            # List trash contents for original locations
            try:
                trash_count = len(os.listdir(trash_path))
            except OSError:
                trash_count = 0
            item = {
                "path": trash_path,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": get_last_accessed(trash_path),
                "risk": "safe",
                "category": "mail_backups",
                "name": f"Trash ({trash_count} items)",
                "description": "Items in the macOS Trash that haven't been permanently deleted",
            }
            items.append(item)
            tracker.update(trash_path, files=1, bytes_added=size)
            emit({"event": "item", **item})

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "mail_backups",
            "name": "Mail, Backups & Trash",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


def scan_general_caches(tracker: ProgressTracker) -> list:
    """Scan ~/Library/Caches for remaining app caches not covered by specific scanners."""
    items = []
    caches_root = os.path.join(LIBRARY, "Caches")

    # Already-scanned cache prefixes to skip
    already_scanned = {
        "com.spotify.client", "com.apple.Safari", "com.apple.Safari.SafeBrowsing",
        "Adobe", "pip", "Homebrew", "com.apple.dt.Xcode",
        "com.google.Chrome", "com.microsoft.Edge", "com.brave.Browser",
    }

    if not dir_exists(caches_root):
        return items

    try:
        for entry in os.listdir(caches_root):
            if any(entry.startswith(prefix) or entry == prefix for prefix in already_scanned):
                continue
            entry_path = os.path.join(caches_root, entry)
            if not os.path.isdir(entry_path):
                continue
            tracker.update(entry_path)
            size = get_dir_size_fast(entry_path)
            if size > 5 * 1024 * 1024:  # Only report caches > 5MB
                item = {
                    "path": entry_path,
                    "size": size,
                    "size_formatted": format_size(size),
                    "last_accessed": get_last_accessed(entry_path),
                    "risk": "safe",
                    "category": "general_cache",
                    "name": f"Cache: {entry}",
                    "description": f"Application cache for {entry}",
                }
                items.append(item)
                tracker.update(entry_path, files=1, bytes_added=size)
                emit({"event": "item", **item})
    except (PermissionError, OSError):
        pass

    if items:
        total = sum(i["size"] for i in items)
        emit({
            "event": "found",
            "category": "general_cache",
            "name": "Other Application Caches",
            "count": len(items),
            "total_bytes": total,
            "total_formatted": format_size(total),
        })

    return items


# ─── Pass 2: Full Disk Usage Map ─────────────────────────────────────────────

# macOS-style category classification for directories
DISK_CATEGORIES = {
    # Home directory mappings
    "Desktop": "documents",
    "Documents": "documents",
    "Downloads": "documents",
    "Movies": "media",
    "Music": "media",
    "Pictures": "photos",
    "Photos Library.photoslibrary": "photos",
    "Developer": "developer",
    "Projects": "developer",
    "dev": "developer",
    "code": "developer",
    "repos": "developer",
    "workspace": "developer",
    "src": "developer",
    "go": "developer",
    ".cargo": "developer",
    ".npm": "developer",
    ".rustup": "developer",
    ".pyenv": "developer",
    ".rbenv": "developer",
    ".nvm": "developer",
    "Public": "other",
    ".Trash": "other",
}

# Library subdirectory classification
LIBRARY_CATEGORIES = {
    "Caches": "system_data",
    "Logs": "system_data",
    "Application Support": "app_data",
    "Containers": "app_data",
    "Group Containers": "app_data",
    "Preferences": "system_data",
    "Saved Application State": "system_data",
    "Developer": "developer",
    "Mail": "mail_messages",
    "Messages": "mail_messages",
    "Calendars": "other",
    "Accounts": "other",
    "Fonts": "other",
    "Keychains": "system_data",
    "MobileDevice": "other",
    "Safari": "app_data",
}

CATEGORY_DISPLAY = {
    "applications": {"name": "Applications", "color": "blue"},
    "developer": {"name": "Developer", "color": "cyan"},
    "documents": {"name": "Documents", "color": "violet"},
    "media": {"name": "Music & Movies", "color": "pink"},
    "photos": {"name": "Photos", "color": "orange"},
    "mail_messages": {"name": "Mail & Messages", "color": "green"},
    "app_data": {"name": "App Data", "color": "amber"},
    "system_data": {"name": "System Data", "color": "slate"},
    "other": {"name": "Other", "color": "indigo"},
    "cleanable": {"name": "Cleanable Junk", "color": "red"},
}


def scan_full_disk(tracker: ProgressTracker) -> dict:
    """Pass 2: Map entire home directory + Applications into macOS-style categories.
    
    Returns a dict with:
      - 'categories': {cat_id: {name, bytes, count, dirs: [{name, path, bytes}]}}
      - 'total_bytes': total mapped bytes
      - 'hidden_space': APFS purgeable + unaccounted space
      - 'disk_total': total disk capacity
      - 'disk_used': total used space
      - 'disk_free': free space
    """
    tracker.phase = "full_map"
    emit({
        "event": "progress",
        "phase": "full_map",
        "dir": "Mapping entire disk...",
        "files": tracker.files_processed,
        "bytes": tracker.bytes_scanned,
        "rate_mbps": 0, "eta_seconds": -1,
        "elapsed": round(time.monotonic() - tracker.start_time, 1),
    })

    categories = {}
    for cat_id, meta in CATEGORY_DISPLAY.items():
        categories[cat_id] = {
            "name": meta["name"],
            "color": meta["color"],
            "bytes": 0,
            "count": 0,
            "dirs": [],
        }

    total_mapped = 0

    # ── 1. Scan home directory top-level ──
    try:
        for entry in os.scandir(HOME):
            if not entry.is_dir(follow_symlinks=False) and not entry.is_file(follow_symlinks=False):
                continue

            name = entry.name
            entry_path = entry.path

            # Skip the Library dir — we scan it separately
            if name == "Library":
                continue

            tracker.update(entry_path)

            # Determine category
            cat = DISK_CATEGORIES.get(name, "other")
            # Developer heuristic: if it has .git, package.json, etc.
            if cat == "other" and entry.is_dir(follow_symlinks=False):
                try:
                    children = {e.name for e in os.scandir(entry_path)}
                    if children & {".git", "package.json", "Cargo.toml", "go.mod", "setup.py", "Makefile", "CMakeLists.txt"}:
                        cat = "developer"
                except (PermissionError, OSError):
                    pass

            # Size it
            try:
                if entry.is_dir(follow_symlinks=False):
                    size = get_dir_size_fast(entry_path)
                else:
                    size = entry.stat(follow_symlinks=False).st_size
            except (PermissionError, OSError) as e:
                tracker.record_error(entry_path, e)
                continue

            if size > 0:
                categories[cat]["bytes"] += size
                categories[cat]["count"] += 1
                categories[cat]["dirs"].append({
                    "name": name,
                    "path": entry_path,
                    "bytes": size,
                    "formatted": format_size(size),
                })
                total_mapped += size
                tracker.update(entry_path, files=1, bytes_added=size)

    except (PermissionError, OSError) as e:
        tracker.record_error(HOME, e)

    # ── 2. Scan ~/Library subdirectories ──
    try:
        for entry in os.scandir(LIBRARY):
            if not entry.is_dir(follow_symlinks=False):
                continue

            name = entry.name
            entry_path = entry.path
            tracker.update(entry_path)

            cat = LIBRARY_CATEGORIES.get(name, "system_data")

            try:
                size = get_dir_size_fast(entry_path)
            except (PermissionError, OSError) as e:
                tracker.record_error(entry_path, e)
                continue

            if size > 1024 * 1024:  # Only report Library dirs > 1MB
                categories[cat]["bytes"] += size
                categories[cat]["count"] += 1
                categories[cat]["dirs"].append({
                    "name": f"Library/{name}",
                    "path": entry_path,
                    "bytes": size,
                    "formatted": format_size(size),
                })
                total_mapped += size
                tracker.update(entry_path, files=1, bytes_added=size)

    except (PermissionError, OSError) as e:
        tracker.record_error(LIBRARY, e)

    # ── 3. Scan /Applications ──
    apps_path = "/Applications"
    try:
        total_apps = 0
        app_count = 0
        for entry in os.scandir(apps_path):
            if not entry.is_dir(follow_symlinks=False):
                continue
            try:
                size = get_dir_size_fast(entry.path)
                if size > 1024 * 1024:  # > 1MB
                    total_apps += size
                    app_count += 1
                    categories["applications"]["dirs"].append({
                        "name": entry.name.replace(".app", ""),
                        "path": entry.path,
                        "bytes": size,
                        "formatted": format_size(size),
                    })
            except (PermissionError, OSError):
                pass
            tracker.update(entry.path)

        categories["applications"]["bytes"] = total_apps
        categories["applications"]["count"] = app_count
        total_mapped += total_apps
    except (PermissionError, OSError):
        pass

    # ── 4. Sort each category's dirs by size ──
    for cat in categories.values():
        cat["dirs"].sort(key=lambda x: x["bytes"], reverse=True)
        # Keep top 50 per category to avoid massive payloads
        if len(cat["dirs"]) > 50:
            others_bytes = sum(d["bytes"] for d in cat["dirs"][50:])
            cat["dirs"] = cat["dirs"][:50]
            cat["dirs"].append({
                "name": f"({len(cat['dirs'])} more items)",
                "path": "",
                "bytes": others_bytes,
                "formatted": format_size(others_bytes),
            })

    # ── 5. Detect hidden/purgeable space ──
    hidden_space = detect_hidden_space(total_mapped)

    # ── 6. Get disk totals ──
    disk = check_disk_space()

    return {
        "categories": categories,
        "total_mapped": total_mapped,
        "hidden_space": hidden_space,
        "disk_total": disk["total_bytes"],
        "disk_free": disk["free_bytes"],
        "disk_used": disk["total_bytes"] - disk["free_bytes"] if disk["total_bytes"] > 0 else 0,
    }


def detect_hidden_space(total_mapped: int) -> dict:
    """Detect APFS purgeable space, Time Machine snapshots, and unaccounted space."""
    result = {
        "purgeable_bytes": 0,
        "snapshots": [],
        "snapshot_count": 0,
        "unaccounted_bytes": 0,
    }

    # APFS purgeable space
    try:
        r = subprocess.run(
            ["diskutil", "info", "/"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            for line in r.stdout.split("\n"):
                if "Purgeable" in line and "Bytes" in line:
                    # Parse: "   Container Free Space:  3.1 GB (3145728000 Bytes)"
                    import re
                    match = re.search(r'\((\d+)\s*Bytes?\)', line)
                    if match:
                        result["purgeable_bytes"] = int(match.group(1))
                        break
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # Time Machine local snapshots
    try:
        r = subprocess.run(
            ["tmutil", "listlocalsnapshots", "/"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            snaps = [l.strip() for l in r.stdout.strip().split("\n") if l.strip() and "com.apple" in l]
            result["snapshots"] = snaps[:10]  # Keep first 10
            result["snapshot_count"] = len(snaps)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # Unaccounted space: disk used - total mapped
    disk = check_disk_space()
    disk_used = disk["total_bytes"] - disk["free_bytes"] if disk["total_bytes"] > 0 else 0
    if disk_used > total_mapped:
        result["unaccounted_bytes"] = disk_used - total_mapped

    return result


def build_full_disk_tree(disk_map: dict, cleanable_items: list) -> dict:
    """Build a unified tree showing full disk usage with cleanable items highlighted."""
    root = {"name": "Disk", "children": [], "size": 0}

    # Add each non-empty disk category
    for cat_id, cat_data in disk_map["categories"].items():
        if cat_data["bytes"] == 0:
            continue

        cat_node = {
            "name": cat_data["name"],
            "size": cat_data["bytes"],
            "color": cat_data["color"],
            "category": cat_id,
            "children": [],
        }

        for dir_entry in cat_data["dirs"]:
            cat_node["children"].append({
                "name": dir_entry["name"],
                "size": dir_entry["bytes"],
                "path": dir_entry.get("path", ""),
            })

        root["children"].append(cat_node)
        root["size"] += cat_data["bytes"]

    # Add cleanable items as a highlighted category
    if cleanable_items:
        clean_total = sum(i["size"] for i in cleanable_items)
        clean_node = {
            "name": "Cleanable Junk",
            "size": clean_total,
            "color": "red",
            "category": "cleanable",
            "cleanable": True,
            "children": [],
        }
        # Group by sub-category
        clean_cats = defaultdict(list)
        for item in cleanable_items:
            clean_cats[item.get("category", "other")].append(item)

        category_labels = {
            "browser_cache": "Browser Caches",
            "dev_cache": "Developer Tools",
            "app_cache": "Application Caches",
            "system_logs": "System Logs",
            "mail_backups": "Mail & Backups",
            "general_cache": "Other Caches",
        }

        for sub_cat, items in clean_cats.items():
            sub_total = sum(i["size"] for i in items)
            sub_node = {
                "name": category_labels.get(sub_cat, sub_cat),
                "size": sub_total,
                "cleanable": True,
                "children": [
                    {"name": i["name"], "size": i["size"], "path": i["path"],
                     "risk": i["risk"], "cleanable": True}
                    for i in sorted(items, key=lambda x: x["size"], reverse=True)
                ],
            }
            clean_node["children"].append(sub_node)

        root["children"].append(clean_node)
        # Don't add to root size — cleanable is a subset of existing categories

    # Add hidden space if significant
    hidden = disk_map.get("hidden_space", {})
    unaccounted = hidden.get("unaccounted_bytes", 0)
    if unaccounted > 100 * 1024 * 1024:  # > 100 MB
        root["children"].append({
            "name": "System & Hidden",
            "size": unaccounted,
            "color": "slate",
            "category": "hidden",
            "children": [
                {"name": "macOS System", "size": unaccounted,
                 "path": "/System"},
            ],
        })
        root["size"] += unaccounted

    # Sort by size
    root["children"].sort(key=lambda x: x["size"], reverse=True)

    return root


# ─── Tree Builder for Sunburst (cleanable items only) ───────────────────────

def build_tree(items: list) -> dict:
    """Build a hierarchical tree structure from discovered items for sunburst visualization."""
    root = {"name": "Storage", "children": {}, "size": 0}

    category_labels = {
        "browser_cache": "Browser Caches",
        "dev_cache": "Developer Tools",
        "app_cache": "Application Caches",
        "system_logs": "System Logs",
        "mail_backups": "Mail & Backups",
        "general_cache": "Other Caches",
    }

    for item in items:
        category = item.get("category", "other")
        cat_label = category_labels.get(category, category)

        if cat_label not in root["children"]:
            root["children"][cat_label] = {"name": cat_label, "children": {}, "size": 0}

        cat_node = root["children"][cat_label]
        cat_node["size"] += item["size"]
        root["size"] += item["size"]

        # Add item as leaf
        item_name = item["name"]
        cat_node["children"][item_name] = {
            "name": item_name,
            "size": item["size"],
            "path": item["path"],
            "risk": item["risk"],
            "last_accessed": item.get("last_accessed", "Unknown"),
        }

    # Convert children dicts to lists for D3
    def convert_children(node):
        if "children" in node and isinstance(node["children"], dict):
            children_list = list(node["children"].values())
            for child in children_list:
                convert_children(child)
            node["children"] = children_list
        return node

    return convert_children(root)


# ─── Agent Intelligence: Semantic File Classifier ────────────────────────────

# Semantic categories derived from filename patterns, extensions, and content
SEMANTIC_PATTERNS = {
    "financial": {
        "keywords": ["tax", "invoice", "receipt", "bank", "statement", "1099", "w2", "w-2",
                     "payroll", "salary", "budget", "expense", "financial", "irs", "quickbooks",
                     "turbotax", "accountant", "mortgage", "loan"],
        "extensions": {".ofx", ".qfx", ".qbo", ".qif"},
    },
    "academic": {
        "keywords": ["thesis", "essay", "homework", "assignment", "syllabus", "lecture",
                     "exam", "quiz", "grade", "course", "university", "college", "school",
                     "research", "dissertation", "paper", "study"],
        "extensions": {".tex", ".bib", ".cls"},
    },
    "professional": {
        "keywords": ["resume", "cv", "cover letter", "portfolio", "contract", "proposal",
                     "nda", "agreement", "meeting", "agenda", "presentation", "report",
                     "client", "project", "deliverable"],
        "extensions": {".pptx", ".ppt", ".key", ".numbers"},
    },
    "personal": {
        "keywords": ["photo", "vacation", "family", "wedding", "birthday", "diary",
                     "journal", "recipe", "travel", "passport", "insurance"],
        "extensions": set(),
    },
    "technical": {
        "keywords": ["readme", "changelog", "config", "setup", "docker", "kubernetes",
                     "terraform", "ansible", "nginx", "apache", "schema", "migration",
                     "api", "endpoint", "workflow"],
        "extensions": {".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf",
                      ".dockerfile", ".tf", ".hcl"},
    },
    "media": {
        "keywords": ["album", "playlist", "podcast", "movie", "episode", "trailer",
                     "soundtrack", "recording", "mix"],
        "extensions": {".mp4", ".mkv", ".avi", ".mov", ".mp3", ".flac", ".wav",
                      ".aac", ".m4a", ".m4v"},
    },
}

TEMP_INDICATORS = {"tmp", "temp", "cache", "backup", ".bak", "old", "copy", "draft",
                   "~", ".swp", ".swo", ".DS_Store", ".localized"}


def classify_file_semantic(path: str) -> dict:
    """Classify a file by semantic meaning using filename, extension, and path heuristics.
    
    Returns: {"label": str, "confidence": float, "reason": str}
    """
    name = os.path.basename(path).lower()
    ext = os.path.splitext(name)[1]
    path_lower = path.lower()

    # Check for temp/transient indicators first
    for indicator in TEMP_INDICATORS:
        if indicator in name:
            return {"label": "temporary", "confidence": 0.85, "reason": f"filename contains '{indicator}'"}

    # Score each semantic category
    best_label = "other"
    best_score = 0.0
    best_reason = ""

    for label, patterns in SEMANTIC_PATTERNS.items():
        score = 0.0
        reason = ""

        # Extension match (strong signal)
        if ext in patterns["extensions"]:
            score += 0.6
            reason = f"extension '{ext}' matches {label}"

        # Keyword match in filename or path
        for kw in patterns["keywords"]:
            if kw in name:
                score += 0.5
                reason = f"filename contains '{kw}'"
                break
            elif kw in path_lower:
                score += 0.3
                reason = f"path contains '{kw}'"
                break

        if score > best_score:
            best_score = score
            best_label = label
            best_reason = reason

    confidence = min(best_score, 0.95)
    if confidence < 0.2:
        best_label = "other"
        best_reason = "no strong semantic signals"
        confidence = 0.1

    return {"label": best_label, "confidence": round(confidence, 2), "reason": best_reason}


# ─── Agent Intelligence: Stale Project Detector ─────────────────────────────

# Dev project markers and their cleanable artifacts
PROJECT_MARKERS = {
    ".git": True,  # Git repo
    "package.json": True,
    "Cargo.toml": True,
    "go.mod": True,
    "setup.py": True,
    "pyproject.toml": True,
    "Gemfile": True,
    "Makefile": True,
    "CMakeLists.txt": True,
    "pom.xml": True,
    "build.gradle": True,
    ".xcodeproj": True,
}

# Cleanable artifact directories within dev projects
CLEANABLE_ARTIFACTS = {
    "node_modules": "npm dependencies",
    ".venv": "Python virtualenv",
    "venv": "Python virtualenv",
    "__pycache__": "Python bytecode cache",
    "target": "Rust/Maven build",
    "build": "Build output",
    "dist": "Distribution output",
    ".next": "Next.js build cache",
    ".nuxt": "Nuxt build cache",
    ".cache": "General build cache",
    "coverage": "Test coverage reports",
    ".tox": "Python tox environments",
    ".gradle": "Gradle cache",
    "Pods": "CocoaPods dependencies",
    "DerivedData": "Xcode build data",
    ".dart_tool": "Dart cache",
}

# Stale threshold in days
STALE_THRESHOLD_DAYS = 90


def detect_stale_projects(tracker: ProgressTracker) -> list:
    """Find dev projects not accessed in N months and estimate reclaimable space.
    
    Returns list of:
      {"path", "name", "last_accessed", "days_stale", "reclaimable_bytes",
       "cleanable_dirs": [{"name", "path", "bytes"}], "markers": [str]}
    """
    tracker.phase = "stale_detect"
    projects = []
    
    # Directories to search for dev projects
    search_roots = [
        HOME,
        os.path.join(HOME, "Desktop"),
        os.path.join(HOME, "Documents"),
        os.path.join(HOME, "Developer"),
        os.path.join(HOME, "Projects"),
        os.path.join(HOME, "dev"),
        os.path.join(HOME, "code"),
        os.path.join(HOME, "repos"),
        os.path.join(HOME, "workspace"),
        os.path.join(HOME, "src"),
    ]

    seen = set()

    for search_root in search_roots:
        if not os.path.isdir(search_root):
            continue

        try:
            for entry in os.scandir(search_root):
                if not entry.is_dir(follow_symlinks=False):
                    continue

                entry_path = entry.path
                if entry_path in seen:
                    continue
                seen.add(entry_path)

                tracker.update(entry_path)

                # Check for project markers
                try:
                    children = {e.name for e in os.scandir(entry_path)}
                except (PermissionError, OSError):
                    continue

                markers = [m for m in PROJECT_MARKERS if m in children]
                if not markers:
                    continue

                # Check staleness — use most recent access time of marker files
                try:
                    most_recent = 0
                    for child_name in children:
                        child_path = os.path.join(entry_path, child_name)
                        try:
                            st = os.stat(child_path, follow_symlinks=False)
                            most_recent = max(most_recent, st.st_atime, st.st_mtime)
                        except OSError:
                            pass

                    if most_recent == 0:
                        continue

                    days_since = (time.time() - most_recent) / 86400

                    if days_since < STALE_THRESHOLD_DAYS:
                        continue  # Project is active

                except OSError:
                    continue

                # Find cleanable artifact directories
                cleanable_dirs = []
                reclaimable = 0
                for artifact_name, description in CLEANABLE_ARTIFACTS.items():
                    artifact_path = os.path.join(entry_path, artifact_name)
                    if os.path.isdir(artifact_path):
                        try:
                            size = get_dir_size_fast(artifact_path)
                            if size > 1024 * 1024:  # > 1 MB
                                cleanable_dirs.append({
                                    "name": artifact_name,
                                    "description": description,
                                    "path": artifact_path,
                                    "bytes": size,
                                    "formatted": format_size(size),
                                })
                                reclaimable += size
                        except OSError:
                            pass

                if cleanable_dirs:
                    last_accessed_dt = datetime.fromtimestamp(most_recent)
                    projects.append({
                        "path": entry_path,
                        "name": os.path.basename(entry_path),
                        "last_accessed": last_accessed_dt.strftime("%Y-%m-%d"),
                        "days_stale": round(days_since),
                        "reclaimable_bytes": reclaimable,
                        "reclaimable_formatted": format_size(reclaimable),
                        "cleanable_dirs": cleanable_dirs,
                        "markers": markers,
                    })

        except (PermissionError, OSError) as e:
            tracker.record_error(search_root, e)

    # Sort by reclaimable space
    projects.sort(key=lambda p: p["reclaimable_bytes"], reverse=True)

    emit({
        "event": "progress",
        "phase": "stale_detect",
        "dir": f"Found {len(projects)} stale projects",
        "files": tracker.files_processed,
        "bytes": tracker.bytes_scanned,
        "rate_mbps": 0, "eta_seconds": -1,
        "elapsed": round(time.monotonic() - tracker.start_time, 1),
    })

    return projects


# ─── Agent Intelligence: Smart Recommendations ──────────────────────────────

def build_recommendations(items: list, disk_map: dict, stale_projects: list) -> list:
    """Generate ranked cleanup recommendations with confidence and impact.
    
    Returns list of recommendation dicts:
      {"id", "title", "description", "category", "impact_bytes", "impact_formatted",
       "confidence", "risk", "items": [paths], "action_type"}
    """
    recs = []

    # ── Quick Wins: Large single-item cleanups ──
    for item in items:
        if item["size"] > 500 * 1024 * 1024 and item["risk"] == "safe":  # > 500 MB safe items
            recs.append({
                "id": f"quick_{hashlib.md5(item['path'].encode()).hexdigest()[:8]}",
                "title": f"Remove {item['name']}",
                "description": f"{item.get('description', 'Large cache/junk item')} — {format_size(item['size'])}",
                "category": "quick_wins",
                "impact_bytes": item["size"],
                "impact_formatted": format_size(item["size"]),
                "confidence": 0.95 if item["risk"] == "safe" else 0.7,
                "risk": item["risk"],
                "items": [item["path"]],
                "action_type": "delete",
            })

    # ── Dev Cleanup: Stale project artifacts ──
    for proj in stale_projects:
        if proj["reclaimable_bytes"] > 50 * 1024 * 1024:  # > 50 MB
            artifact_names = ", ".join(d["name"] for d in proj["cleanable_dirs"][:3])
            recs.append({
                "id": f"stale_{hashlib.md5(proj['path'].encode()).hexdigest()[:8]}",
                "title": f"Clean stale project: {proj['name']}",
                "description": f"Not accessed in {proj['days_stale']} days. "
                              f"Remove {artifact_names} to free {proj['reclaimable_formatted']}",
                "category": "dev_cleanup",
                "impact_bytes": proj["reclaimable_bytes"],
                "impact_formatted": proj["reclaimable_formatted"],
                "confidence": 0.85,
                "risk": "safe",
                "items": [d["path"] for d in proj["cleanable_dirs"]],
                "action_type": "delete",
                "project_path": proj["path"],
                "days_stale": proj["days_stale"],
            })

    # ── Category Aggregates ──
    # Group small items by category for batch recommendations
    cat_groups = defaultdict(list)
    for item in items:
        if item["size"] < 500 * 1024 * 1024 and item["risk"] == "safe":
            cat_groups[item.get("category", "other")].append(item)

    category_labels = {
        "browser_cache": "browser caches",
        "dev_cache": "developer caches",
        "app_cache": "application caches",
        "system_logs": "system logs",
        "general_cache": "general caches",
    }

    for cat_id, cat_items in cat_groups.items():
        total = sum(i["size"] for i in cat_items)
        if total > 100 * 1024 * 1024:  # > 100 MB combined
            label = category_labels.get(cat_id, cat_id)
            recs.append({
                "id": f"batch_{cat_id}",
                "title": f"Clear all {label}",
                "description": f"{len(cat_items)} items totaling {format_size(total)}. "
                              f"All marked as safe to delete.",
                "category": "maintenance",
                "impact_bytes": total,
                "impact_formatted": format_size(total),
                "confidence": 0.9,
                "risk": "safe",
                "items": [i["path"] for i in cat_items],
                "action_type": "delete",
            })

    # ── Disk Space Warning ──
    disk_free = disk_map.get("disk_free", 0)
    disk_total = disk_map.get("disk_total", 1)
    free_pct = (disk_free / disk_total * 100) if disk_total > 0 else 100

    if free_pct < 10:
        total_cleanable = sum(i["size"] for i in items if i["risk"] == "safe")
        recs.insert(0, {
            "id": "urgent_space",
            "title": "⚠️ Disk space critically low",
            "description": f"Only {format_size(disk_free)} free ({round(free_pct, 1)}%). "
                          f"Clean safe items to reclaim {format_size(total_cleanable)}.",
            "category": "urgent",
            "impact_bytes": total_cleanable,
            "impact_formatted": format_size(total_cleanable),
            "confidence": 1.0,
            "risk": "safe",
            "items": [i["path"] for i in items if i["risk"] == "safe"],
            "action_type": "delete",
        })

    # Sort by impact (largest first), with urgent at top
    priority_order = {"urgent": 0, "quick_wins": 1, "dev_cleanup": 2, "maintenance": 3, "media_management": 4}
    recs.sort(key=lambda r: (priority_order.get(r["category"], 5), -r["impact_bytes"]))

    return recs


# ─── Agent Intelligence: Storage Growth Timeline ────────────────────────────

def get_storage_timeline(conn) -> list:
    """Build storage growth timeline from historical scan data.
    
    Returns list of:
      {"scan_time": str, "total_bytes": int, "total_formatted": str}
    """
    try:
        rows = conn.execute(
            "SELECT scan_time, total_bytes FROM scan_results ORDER BY id ASC"
        ).fetchall()
        return [
            {
                "scan_time": row[0],
                "total_bytes": row[1],
                "total_formatted": format_size(row[1]),
            }
            for row in rows
        ]
    except Exception:
        return []


def predict_space_exhaustion(timeline: list, disk_free: int) -> dict | None:
    """Predict days until disk runs out of space based on growth trend.
    
    Returns: {"days_until_full": int, "growth_rate_bytes_per_day": int, ...} or None
    """
    if len(timeline) < 2:
        return None

    # Calculate growth rate from first and last scans
    try:
        first_time = datetime.fromisoformat(timeline[0]["scan_time"])
        last_time = datetime.fromisoformat(timeline[-1]["scan_time"])
        days_span = max((last_time - first_time).total_seconds() / 86400, 0.01)

        first_bytes = timeline[0]["total_bytes"]
        last_bytes = timeline[-1]["total_bytes"]
        growth = last_bytes - first_bytes

        if growth <= 0 or days_span < 0.1:
            return None

        rate_per_day = growth / days_span
        days_until_full = disk_free / rate_per_day if rate_per_day > 0 else -1

        return {
            "days_until_full": round(days_until_full),
            "growth_rate_bytes_per_day": round(rate_per_day),
            "growth_rate_formatted": f"{format_size(round(rate_per_day))}/day",
            "data_points": len(timeline),
            "span_days": round(days_span, 1),
        }
    except (ValueError, TypeError):
        return None


# ─── SQLite Cache + Checkpointing ────────────────────────────────────────────

def get_cache_db_path() -> str:
    os.makedirs(APP_SUPPORT, exist_ok=True)
    return os.path.join(APP_SUPPORT, "scan_cache.db")


def init_cache_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS scan_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_time TEXT NOT NULL,
            items_json TEXT NOT NULL,
            tree_json TEXT NOT NULL,
            metrics_json TEXT,
            total_bytes INTEGER NOT NULL,
            duration_seconds REAL NOT NULL,
            signature TEXT
        );
        CREATE TABLE IF NOT EXISTS scan_state (
            path TEXT PRIMARY KEY,
            crawl_status TEXT DEFAULT 'pending',
            last_mtime REAL,
            size_bytes INTEGER DEFAULT 0,
            last_scan_ts TEXT
        );
        CREATE TABLE IF NOT EXISTS scan_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()
    return conn


def check_path_unchanged(conn, path: str) -> bool:
    """Check if a path is unchanged since last scan (checkpoint resume)."""
    try:
        cur_mtime = os.path.getmtime(path)
    except OSError:
        return False
    row = conn.execute(
        "SELECT last_mtime FROM scan_state WHERE path = ? AND crawl_status = 'scanned'",
        (path,)
    ).fetchone()
    return row is not None and abs(row[0] - cur_mtime) < 0.01


def mark_path_scanned(conn, path: str, size_bytes: int):
    """Mark a path as scanned in the checkpoint table."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = 0
    conn.execute(
        "INSERT OR REPLACE INTO scan_state (path, crawl_status, last_mtime, size_bytes, last_scan_ts) VALUES (?, 'scanned', ?, ?, ?)",
        (path, mtime, size_bytes, datetime.now().isoformat())
    )


def save_scan_to_cache(conn, items, tree, metrics, total_bytes, duration, signature=None):
    conn.execute(
        "INSERT INTO scan_results (scan_time, items_json, tree_json, metrics_json, total_bytes, duration_seconds, signature) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (datetime.now().isoformat(), json.dumps(items), json.dumps(tree),
         json.dumps(metrics), total_bytes, duration, signature)
    )
    conn.execute(
        "INSERT OR REPLACE INTO scan_meta (key, value) VALUES ('last_run', ?)",
        (datetime.now().isoformat(),)
    )
    conn.commit()
    conn.execute("DELETE FROM scan_results WHERE id NOT IN (SELECT id FROM scan_results ORDER BY id DESC LIMIT 10)")
    conn.commit()


def get_last_scan(conn) -> dict | None:
    """Get the most recent cached scan result."""
    row = conn.execute(
        "SELECT items_json, tree_json, metrics_json, total_bytes, duration_seconds, signature, scan_time FROM scan_results ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    return {
        "items": json.loads(row[0]),
        "tree": json.loads(row[1]),
        "metrics": json.loads(row[2]) if row[2] else None,
        "total_bytes": row[3],
        "duration": row[4],
        "signature": row[5],
        "scan_time": row[6],
    }


# ─── Ed25519 Attestation ────────────────────────────────────────────────────

def get_keys_dir() -> str:
    keys_dir = os.path.join(APP_SUPPORT, "keys")
    os.makedirs(keys_dir, exist_ok=True)
    return keys_dir


def sign_scan_results(items: list) -> dict:
    """Sign scan results with a locally generated Ed25519 keypair.
    
    Uses HMAC-SHA256 as a portable fallback when cryptography lib isn't available.
    The signature creates a verifiable attestation that results haven't been tampered with.
    """
    # Create deterministic content hash from sorted items
    content = json.dumps(
        sorted([{"path": i["path"], "size": i["size"]} for i in items],
               key=lambda x: x["path"]),
        sort_keys=True
    ).encode("utf-8")
    content_hash = hashlib.sha256(content).hexdigest()

    keys_dir = get_keys_dir()
    key_path = os.path.join(keys_dir, "scan_signing.key")

    # Try Ed25519 via cryptography library
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives import serialization
        import base64

        if os.path.exists(key_path):
            with open(key_path, "rb") as f:
                private_key = serialization.load_pem_private_key(f.read(), password=None)
        else:
            private_key = Ed25519PrivateKey.generate()
            pem = private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()
            )
            with open(key_path, "wb") as f:
                f.write(pem)
            os.chmod(key_path, 0o600)
            # Save public key too
            pub_pem = private_key.public_key().public_bytes(
                serialization.Encoding.PEM,
                serialization.SubjectPublicKeyInfo
            )
            with open(os.path.join(keys_dir, "scan_signing.pub"), "wb") as f:
                f.write(pub_pem)

        signature = base64.b64encode(private_key.sign(content)).decode("ascii")
        return {
            "algorithm": "Ed25519",
            "content_hash": content_hash,
            "signature": signature,
            "timestamp": datetime.now().isoformat(),
            "key_id": hashlib.sha256(
                private_key.public_key().public_bytes(
                    serialization.Encoding.Raw,
                    serialization.PublicFormat.Raw
                )
            ).hexdigest()[:16],
        }
    except ImportError:
        pass

    # Fallback: HMAC-SHA256 with a locally stored secret
    import hmac
    secret_path = os.path.join(keys_dir, "hmac_secret.key")
    if os.path.exists(secret_path):
        with open(secret_path, "rb") as f:
            secret = f.read()
    else:
        secret = os.urandom(32)
        with open(secret_path, "wb") as f:
            f.write(secret)
        os.chmod(secret_path, 0o600)

    sig = hmac.new(secret, content, hashlib.sha256).hexdigest()
    return {
        "algorithm": "HMAC-SHA256",
        "content_hash": content_hash,
        "signature": sig,
        "timestamp": datetime.now().isoformat(),
        "key_id": hashlib.sha256(secret).hexdigest()[:16],
    }


# ─── Metrics Builder (D3 Data Contract) ─────────────────────────────────────

def build_metrics(items: list, duration: float, tracker: ProgressTracker) -> dict:
    """Build the formalized metrics object for the D3 visualization data contract."""
    total_bytes = sum(i["size"] for i in items)

    # Category breakdown
    cats = defaultdict(lambda: {"bytes": 0, "count": 0})
    for item in items:
        cat = item.get("category", "other")
        cats[cat]["bytes"] += item["size"]
        cats[cat]["count"] += 1

    category_labels = {
        "browser_cache": "Browser Caches",
        "dev_cache": "Developer Tools",
        "app_cache": "Application Caches",
        "system_logs": "System Logs",
        "mail_backups": "Mail & Backups",
        "general_cache": "Other Caches",
    }

    categories = []
    for cat_id, data in cats.items():
        pct = (data["bytes"] / total_bytes * 100) if total_bytes > 0 else 0
        categories.append({
            "id": cat_id,
            "name": category_labels.get(cat_id, cat_id),
            "bytes": data["bytes"],
            "count": data["count"],
            "pct": round(pct, 1),
        })
    categories.sort(key=lambda x: x["bytes"], reverse=True)

    # Extension breakdown
    extensions = defaultdict(int)
    for item in items:
        ext = os.path.splitext(item["path"])[1].lower() or "(dir)"
        extensions[ext] += 1

    # Risk breakdown
    risk = {"safe": 0, "caution": 0, "critical": 0}
    for item in items:
        r = item.get("risk", "caution")
        risk[r] = risk.get(r, 0) + 1

    return {
        "total_bytes": total_bytes,
        "total_formatted": format_size(total_bytes),
        "total_items": len(items),
        "scan_duration_seconds": duration,
        "categories": categories,
        "extensions": dict(sorted(extensions.items(), key=lambda x: -x[1])[:20]),
        "risk_breakdown": risk,
        "errors": tracker.errors.copy(),
        "error_count": tracker.error_count,
        "disk_space": check_disk_space(),
    }


# ─── Main Scanner ────────────────────────────────────────────────────────────

def run_scan():
    """Run one full discovery + analysis pass."""
    start_time = time.monotonic()
    tracker = ProgressTracker()
    all_items = []

    # Open checkpoint DB
    try:
        db_path = get_cache_db_path()
        conn = init_cache_db(db_path)
    except Exception:
        conn = None

    emit({
        "event": "progress",
        "phase": "fast",
        "dir": "Initializing scan...",
        "files": 0, "bytes": 0, "rate_mbps": 0,
        "eta_seconds": -1, "elapsed": 0,
    })

    # ── Pass 1: Fast Scan — known locations ──
    tracker.phase = "fast"
    all_items.extend(scan_browser_caches(tracker))
    all_items.extend(scan_app_caches(tracker))
    all_items.extend(scan_system_logs(tracker))
    all_items.extend(scan_mail_and_backups(tracker))

    # ── Pass 2: Deep Scan — broader coverage ──
    tracker.phase = "deep"
    emit({
        "event": "progress",
        "phase": "deep",
        "dir": "Starting deep scan...",
        "files": tracker.files_processed,
        "bytes": tracker.bytes_scanned,
        "rate_mbps": 0, "eta_seconds": -1,
        "elapsed": round(time.monotonic() - start_time, 1),
    })

    all_items.extend(scan_dev_caches(tracker))
    all_items.extend(scan_general_caches(tracker))

    # ── Pass 3: Full Disk Map — complete picture ──
    disk_map = scan_full_disk(tracker)

    # ── Pass 4: Agent Intelligence ──
    stale_projects = detect_stale_projects(tracker)

    # ── Build completion payload ──
    duration = round(time.monotonic() - start_time, 2)
    total_bytes = sum(item["size"] for item in all_items)
    tree = build_tree(all_items)
    full_tree = build_full_disk_tree(disk_map, all_items)
    all_items.sort(key=lambda x: x["size"], reverse=True)

    # Build D3 metrics contract
    metrics = build_metrics(all_items, duration, tracker)
    metrics["disk_total"] = disk_map["disk_total"]
    metrics["disk_used"] = disk_map["disk_used"]
    metrics["disk_free"] = disk_map["disk_free"]
    metrics["disk_mapped"] = disk_map["total_mapped"]
    metrics["hidden_space"] = disk_map["hidden_space"]

    # Smart recommendations
    recommendations = build_recommendations(all_items, disk_map, stale_projects)

    # Storage timeline + prediction
    timeline = []
    prediction = None
    if conn:
        try:
            timeline = get_storage_timeline(conn)
            prediction = predict_space_exhaustion(timeline, disk_map.get("disk_free", 0))
        except Exception:
            pass

    # Sign scan results (attestation)
    try:
        attestation = sign_scan_results(all_items)
    except Exception:
        attestation = None

    # Save to checkpoint DB
    if conn:
        try:
            save_scan_to_cache(conn, all_items, tree, metrics, total_bytes, duration,
                             attestation.get("signature") if attestation else None)
            for item in all_items:
                mark_path_scanned(conn, item["path"], item["size"])
            conn.commit()
            conn.close()
        except Exception:
            pass

    emit({
        "event": "complete",
        "total_items": len(all_items),
        "total_bytes": total_bytes,
        "total_formatted": format_size(total_bytes),
        "tree": tree,
        "full_tree": full_tree,
        "disk_map": {
            cat_id: {
                "name": cat["name"],
                "color": cat["color"],
                "bytes": cat["bytes"],
                "count": cat["count"],
                "formatted": format_size(cat["bytes"]),
                "dirs": cat["dirs"][:20],
            }
            for cat_id, cat in disk_map["categories"].items()
            if cat["bytes"] > 0
        },
        "disk_total": disk_map["disk_total"],
        "disk_used": disk_map["disk_used"],
        "disk_free": disk_map["disk_free"],
        "items": all_items,
        "duration": duration,
        "metrics": metrics,
        "attestation": attestation,
        "categories": metrics["categories"],
        # Agent intelligence
        "stale_projects": stale_projects,
        "recommendations": recommendations,
        "timeline": timeline,
        "prediction": prediction,
    })


def run_status():
    """Emit last cached scan results without re-scanning."""
    try:
        db_path = get_cache_db_path()
        conn = init_cache_db(db_path)
        cached = get_last_scan(conn)
        conn.close()
    except Exception:
        cached = None

    if cached:
        emit({
            "event": "complete",
            "total_items": len(cached["items"]),
            "total_bytes": cached["total_bytes"],
            "total_formatted": format_size(cached["total_bytes"]),
            "tree": cached["tree"],
            "items": cached["items"],
            "duration": cached["duration"],
            "metrics": cached["metrics"],
            "attestation": {"signature": cached["signature"]} if cached["signature"] else None,
            "categories": cached["metrics"]["categories"] if cached["metrics"] else [],
            "cached": True,
            "scan_time": cached["scan_time"],
        })
    else:
        emit({"event": "error", "message": "No cached scan results found. Run 'scan' first."})


def run_daemon():
    """Long-running watcher that re-scans on filesystem changes.
    
    This is a user-space process only — no LaunchAgents or system services.
    Uses polling (not fsevents) for simplicity and portability.
    """
    import signal

    scan_interval = 3600  # Re-scan every hour
    running = True

    def handle_signal(sig, frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    emit({"event": "daemon_started", "interval_seconds": scan_interval})

    while running:
        run_scan()
        # Sleep in small increments so we can respond to signals
        for _ in range(scan_interval):
            if not running:
                break
            time.sleep(1)

    emit({"event": "daemon_stopped"})


# ─── CLI Entrypoint ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Storage Deep Scanner for Mac Optimizer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
subcommands:
  scan     Run one full discovery + analysis pass (default)
  daemon   Start background watcher that re-scans periodically
  status   Emit last cached scan results without re-scanning
        """
    )
    parser.add_argument(
        "command", nargs="?", default="scan",
        choices=["scan", "daemon", "status"],
        help="Subcommand to run (default: scan)"
    )

    args = parser.parse_args()

    if args.command == "scan":
        run_scan()
    elif args.command == "status":
        run_status()
    elif args.command == "daemon":
        run_daemon()


if __name__ == "__main__":
    main()
