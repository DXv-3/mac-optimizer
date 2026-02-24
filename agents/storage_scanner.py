#!/usr/bin/env python3
"""
Storage Deep Scanner — Streaming JSON-over-stdout agent for Mac Optimizer.

Emits newline-delimited JSON events:
  {"event":"progress", ...}   — every ~100ms during scanning
  {"event":"item", ...}       — each discovered cache/junk item
  {"event":"found", ...}      — category summary when a category scan completes
  {"event":"complete", ...}   — final summary with tree data for sunburst

Two-pass strategy:
  Pass 1 (fast): known macOS cache/junk locations for instant results
  Pass 2 (deep): broader filesystem walk for comprehensive analysis
"""

import json
import math
import os
import stat
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
EMIT_INTERVAL = 0.1  # seconds between progress events
MIN_ITEM_SIZE = 1024  # 1 KB minimum to report

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
    """Tracks scanning progress and emits events at intervals."""

    def __init__(self):
        self.start_time = time.monotonic()
        self.last_emit_time = 0
        self.files_processed = 0
        self.bytes_scanned = 0
        self.current_dir = ""
        self.rate_samples = []  # adaptive averaging for rate/ETA
        self.last_bytes = 0
        self.last_sample_time = time.monotonic()

    def update(self, current_dir: str, files: int = 0, bytes_added: int = 0):
        self.current_dir = current_dir
        self.files_processed += files
        self.bytes_scanned += bytes_added
        now = time.monotonic()

        if now - self.last_emit_time >= EMIT_INTERVAL:
            # Calculate adaptive rate
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
                "error_count": 0,
                "last_error": None,
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


# ─── Tree Builder for Sunburst ───────────────────────────────────────────────

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


# ─── SQLite Cache ────────────────────────────────────────────────────────────

def get_cache_db_path() -> str:
    cache_dir = os.path.join(LIBRARY, "Application Support", "MacOptimizer")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, "scan_cache.db")


def init_cache_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scan_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_time TEXT NOT NULL,
            items_json TEXT NOT NULL,
            tree_json TEXT NOT NULL,
            total_bytes INTEGER NOT NULL,
            duration_seconds REAL NOT NULL
        )
    """)
    conn.commit()
    return conn


def save_scan_to_cache(conn, items, tree, total_bytes, duration):
    conn.execute(
        "INSERT INTO scan_results (scan_time, items_json, tree_json, total_bytes, duration_seconds) VALUES (?, ?, ?, ?, ?)",
        (datetime.now().isoformat(), json.dumps(items), json.dumps(tree), total_bytes, duration)
    )
    conn.commit()
    # Keep only last 10 scans
    conn.execute("DELETE FROM scan_results WHERE id NOT IN (SELECT id FROM scan_results ORDER BY id DESC LIMIT 10)")
    conn.commit()


# ─── Main Scanner ────────────────────────────────────────────────────────────

def main():
    start_time = time.monotonic()
    tracker = ProgressTracker()
    all_items = []

    emit({
        "event": "progress",
        "dir": "Initializing scan...",
        "files": 0,
        "bytes": 0,
        "rate_mbps": 0,
        "eta_seconds": -1,
        "elapsed": 0,
        "phase": "fast",
    })

    # ── Pass 1: Fast Scan — known locations ──
    # Browser caches
    all_items.extend(scan_browser_caches(tracker))

    # App caches (known apps)
    all_items.extend(scan_app_caches(tracker))

    # System logs
    all_items.extend(scan_system_logs(tracker))

    # Mail, backups, trash
    all_items.extend(scan_mail_and_backups(tracker))

    # ── Pass 2: Deep Scan — broader coverage ──
    emit({
        "event": "progress",
        "dir": "Starting deep scan...",
        "files": tracker.files_processed,
        "bytes": tracker.bytes_scanned,
        "rate_mbps": 0,
        "eta_seconds": -1,
        "elapsed": round(time.monotonic() - start_time, 1),
        "phase": "deep",
    })

    # Dev tool caches (requires filesystem walking for node_modules)
    all_items.extend(scan_dev_caches(tracker))

    # General caches catch-all
    all_items.extend(scan_general_caches(tracker))

    # ── Build tree and emit completion ──
    duration = round(time.monotonic() - start_time, 2)
    total_bytes = sum(item["size"] for item in all_items)
    tree = build_tree(all_items)

    # Sort items by size descending
    all_items.sort(key=lambda x: x["size"], reverse=True)

    # Cache results in SQLite
    try:
        db_path = get_cache_db_path()
        conn = init_cache_db(db_path)
        save_scan_to_cache(conn, all_items, tree, total_bytes, duration)
        conn.close()
    except Exception:
        pass  # Non-critical, don't fail the scan

    emit({
        "event": "complete",
        "total_items": len(all_items),
        "total_bytes": total_bytes,
        "total_formatted": format_size(total_bytes),
        "tree": tree,
        "items": all_items,
        "duration": duration,
        "categories": _summarize_categories(all_items),
    })


def _summarize_categories(items: list) -> list:
    """Build category summary statistics."""
    cats = defaultdict(lambda: {"count": 0, "total_bytes": 0})
    category_labels = {
        "browser_cache": "Browser Caches",
        "dev_cache": "Developer Tools",
        "app_cache": "Application Caches",
        "system_logs": "System Logs",
        "mail_backups": "Mail & Backups",
        "general_cache": "Other Caches",
    }
    for item in items:
        cat = item.get("category", "other")
        cats[cat]["count"] += 1
        cats[cat]["total_bytes"] += item["size"]

    result = []
    for cat_id, data in cats.items():
        result.append({
            "id": cat_id,
            "name": category_labels.get(cat_id, cat_id),
            "count": data["count"],
            "total_bytes": data["total_bytes"],
            "total_formatted": format_size(data["total_bytes"]),
        })
    result.sort(key=lambda x: x["total_bytes"], reverse=True)
    return result


if __name__ == "__main__":
    main()
