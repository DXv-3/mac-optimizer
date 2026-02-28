#!/usr/bin/env python3
"""
Storage Swarm Scanner — Multi-Agent Architecture for Mac Optimizer.

This scanner uses a Manager-Worker (Swarm) model to rapidly traverse the disk
and deeply analyze files without blocking the main event loop.

- Explorer Agents: Quickly walk directory structures and identify files.
- Analyzer Agents: Inspect specific complex items (e.g., node_modules, .git) to
  derive insights like "stale project" status and exact reclaimable disk space.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from datetime import datetime

# ─── Configuration ───────────────────────────────────────────────────────────
HOME = os.path.expanduser("~")
LIBRARY = os.path.join(HOME, "Library")
EMIT_INTERVAL = 0.2
MIN_ITEM_SIZE = 1024
DISK_WARN_THRESHOLD = 1 * 1024 * 1024 * 1024

# Resolve the absolute real path of THIS script's parent directory.
# We use this to prevent the scanner from ever walking into its own node_modules,
# which could cause EPERM if the directory is root-owned after a bad `sudo npm`.
THIS_PROJECT_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
THIS_PROJECT_NODE_MODULES = os.path.join(THIS_PROJECT_DIR, "node_modules")

# Directories to ALWAYS skip during an explorer walk (never recurse into these)
ALWAYS_SKIP_DIRS = {
    ".git",  # handled separately
    ".hg", ".svn",  # version control
    "node_modules",  # handled separately
    "__pycache__", "*.egg-info",
}

_emit_lock = Lock()
_item_buffer = []
_last_item_flush = 0.0
_ITEM_FLUSH_INTERVAL = 0.15

# Categories for simple heuristics
EXTENSION_CATEGORIES = {
    "cache": {".tmp", ".temp", ".cache"},
    "logs": {".log", ".out", ".err"},
}

def format_size(size_bytes: int) -> str:
    if size_bytes == 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024))) if size_bytes > 0 else 0
    i = min(i, len(units) - 1)
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {units[i]}"

def get_last_accessed(path: str) -> str:
    try:
        st = os.stat(path)
        return datetime.fromtimestamp(st.st_atime).strftime("%Y-%m-%d %H:%M:%S")
    except (OSError, ValueError):
        return "Unknown"

def _flush_item_buffer(force: bool = False):
    global _item_buffer, _last_item_flush
    now = time.monotonic()
    if not _item_buffer:
        return
    if not force and (now - _last_item_flush) < _ITEM_FLUSH_INTERVAL:
        return
    with _emit_lock:
        if not _item_buffer:
            return
        batch = _item_buffer[:]
        _item_buffer = []
        _last_item_flush = now
    try:
        sys.stdout.write(json.dumps({"event": "batch", "items": batch}) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)

def emit(event_dict: dict):
    global _item_buffer, _last_item_flush
    try:
        evt = event_dict.get("event")
        if evt == "item":
            if "size" in event_dict and "sizeBytes" not in event_dict:
                event_dict["sizeBytes"] = event_dict["size"]
            if "size_formatted" in event_dict and "sizeFormatted" not in event_dict:
                event_dict["sizeFormatted"] = event_dict["size_formatted"]
            if "last_accessed" in event_dict and "lastUsed" not in event_dict:
                event_dict["lastUsed"] = event_dict["last_accessed"]
            with _emit_lock:
                _item_buffer.append(event_dict)
            _flush_item_buffer()
            return

        if evt == "agent_status":
            # Real-time event for UI Swarm panel
            _flush_item_buffer(force=True)
            sys.stdout.write(json.dumps(event_dict) + "\n")
            sys.stdout.flush()
            return

        _flush_item_buffer(force=True)
        sys.stdout.write(json.dumps(event_dict) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)


class ProgressTracker:
    def __init__(self):
        self.start_time = time.monotonic()
        self.last_emit_time = 0
        self.files_processed = 0
        self.bytes_scanned = 0
        self.current_dir = ""
        self.phase = "swarm_scanning"
        self.errors = {"permission": 0, "other": 0}

    def update(self, current_dir: str, files: int = 0, bytes_added: int = 0):
        self.current_dir = current_dir
        self.files_processed += files
        self.bytes_scanned += bytes_added
        
        now = time.monotonic()
        if now - self.last_emit_time >= EMIT_INTERVAL:
            elapsed = now - self.start_time
            emit({
                "event": "progress",
                "phase": self.phase,
                "current_path": self.current_dir,
                "files_processed": self.files_processed,
                "bytes_scanned": self.bytes_scanned,
                "elapsed": round(elapsed, 1),
                "error_count": sum(self.errors.values()),
            })
            self.last_emit_time = now

# ─── SWARM AGENTS ────────────────────────────────────────────────────────────

def agent_worker_explorer(target_dir, agent_id="Explorer-1"):
    """
    Explorer Agent: rapidly walks a directory tree.
    If it finds a recognizable project folder (like node_modules), it yields it
    for the Analyzer Agents to inspect deeper.
    """
    emit({"event": "agent_status", "agent_id": agent_id, "status": f"Exploring {target_dir}", "type": "explorer"})
    
    found_items = []
    deep_analysis_targets = []
    bytes_added = 0
    files_added = 0

    try:
        for root, dirs, files in os.walk(target_dir, followlinks=False):
            # ── Safety: never scan this project's own node_modules ────────
            real_root = os.path.realpath(root)
            if real_root == THIS_PROJECT_NODE_MODULES or real_root.startswith(THIS_PROJECT_NODE_MODULES + os.sep):
                dirs.clear()
                continue

            # Tell Analyzer if we found a dev project (but skip our own)
            if "node_modules" in dirs:
                nm_path = os.path.join(root, "node_modules")
                real_nm = os.path.realpath(nm_path)
                dirs.remove("node_modules")  # Don't recurse into node_modules
                if real_nm != THIS_PROJECT_NODE_MODULES:
                    deep_analysis_targets.append(("dev_project", nm_path))

            if ".git" in dirs:
                git_path = os.path.join(root, ".git")
                dirs.remove(".git")
                deep_analysis_targets.append(("git_repo", git_path))
                
            # Basic file aggregation
            for f in files:
                try:
                    fpath = os.path.join(root, f)
                    if os.path.islink(fpath): continue
                    st = os.stat(fpath)
                    
                    if st.st_size > MIN_ITEM_SIZE:
                        # Identify simple caches
                        ext = os.path.splitext(f)[1].lower()
                        cat = "general_cache"
                        if ext in EXTENSION_CATEGORIES["cache"]: cat = "cache"
                        if ext in EXTENSION_CATEGORIES["logs"]: cat = "logs"

                        found_items.append({
                            "path": fpath,
                            "size": st.st_size,
                            "size_formatted": format_size(st.st_size),
                            "last_accessed": datetime.fromtimestamp(st.st_atime).strftime("%Y-%m-%d %H:%M:%S"),
                            "risk": "safe" if cat in ("cache", "logs") else "caution",
                            "category": cat,
                            "name": f,
                            "description": "Discovered by Explorer Agent"
                        })
                        bytes_added += st.st_size
                        files_added += 1
                except OSError:
                    pass
    except Exception as e:
        emit({"event": "agent_status", "agent_id": agent_id, "status": f"Error: {str(e)}", "type": "error"})

    emit({"event": "agent_status", "agent_id": agent_id, "status": "Finished exploring", "type": "explorer"})
    return found_items, deep_analysis_targets, bytes_added, files_added


def agent_worker_analyzer(target_type, target_path, agent_id="Analyzer-1"):
    """
    Analyzer Agent: Takes a specific large folder/file and does a deep dive.
    E.g. determines if a node_modules folder belongs to a stale project.
    """
    emit({"event": "agent_status", "agent_id": agent_id, "status": f"Deep analyzing {os.path.basename(target_path)}", "type": "analyzer"})
    
    item = None
    try:
        size = 0
        stale_days = 0
        oldest_access = time.time()
        
        # Fast recursive sum using scandir
        stack = [target_path]
        while stack:
            current = stack.pop()
            try:
                with os.scandir(current) as it:
                    for entry in it:
                        try:
                            if entry.is_symlink(): continue
                            st = entry.stat(follow_symlinks=False)
                            if entry.is_dir(follow_symlinks=False):
                                stack.append(entry.path)
                            else:
                                size += st.st_size
                                oldest_access = min(oldest_access, st.st_atime)
                        except OSError:
                            pass
            except OSError:
                pass

        if size > MIN_ITEM_SIZE:
            stale_days = int((time.time() - oldest_access) / (60*60*24)) if oldest_access < time.time() else 0
            
            project_name = os.path.basename(os.path.dirname(target_path)) if target_type == "dev_project" else os.path.basename(target_path)
            
            item = {
                "path": target_path,
                "size": size,
                "size_formatted": format_size(size),
                "last_accessed": datetime.fromtimestamp(oldest_access).strftime("%Y-%m-%d %H:%M:%S"),
                "risk": "safe",
                "category": "dev_cache",
                "name": f"{project_name} ({target_type})",
                "description": f"Analyzed by {agent_id}. Stale for ~{stale_days} days.",
                "traits": {"stale_days": stale_days}
            }
            
            # Emit an insight if it's very stale
            if stale_days > 30 and size > 10 * 1024 * 1024:
                emit({
                    "event": "insight",
                    "type": "stale_project",
                    "project_name": project_name,
                    "days_stale": stale_days,
                    "reclaimable_bytes": size,
                    "reclaimable_formatted": format_size(size),
                    "path": target_path
                })
    
    except Exception as e:
        emit({"event": "agent_status", "agent_id": agent_id, "status": f"Error analyzing: {str(e)}", "type": "error"})

    emit({"event": "agent_status", "agent_id": agent_id, "status": "Idle", "type": "analyzer"})
    return item

# ─── HIVE MIND (Manager) ─────────────────────────────────────────────────────

def deploy_swarm(target_path=None):
    """Coordinate the Explorer and Analyzer agents."""
    tracker = ProgressTracker()
    
    # Starting points for explorers
    if target_path:
        scan_roots = [target_path]
    else:
        scan_roots = [
            os.path.join(HOME, "Desktop"),
            os.path.join(HOME, "Documents"),
            os.path.join(HOME, "Downloads"),
            os.path.join(LIBRARY, "Caches"),
            os.path.join(LIBRARY, "Application Support"),
            os.path.join(HOME, ".npm"),
        ]
    
    all_items = []
    deep_targets = []
    
    emit({"event": "swarm_init", "message": "Deploying Explorer Agents..."})

    # Phase 1: Explorers map the territory
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(agent_worker_explorer, d, f"Exp-{i+1}"): d 
            for i, d in enumerate(scan_roots) if os.path.exists(d)
        }
        
        for future in as_completed(futures):
            root_dir = futures[future]
            try:
                items, targets, b_added, f_added = future.result()
                all_items.extend(items)
                deep_targets.extend(targets)
                tracker.update(root_dir, f_added, b_added)
                
                # Emit items incrementally
                for item in items:
                    emit({"event": "item", **item})
            except Exception as e:
                tracker.errors["other"] += 1
                
    emit({"event": "swarm_phase", "phase": "Deep Analysis", "message": f"Found {len(deep_targets)} complex targets."})

    # Phase 2: Analyzers deep dive into discovered targets
    with ThreadPoolExecutor(max_workers=4) as executor:
        analyzer_futures = []
        for i, (ttype, tpath) in enumerate(deep_targets):
            analyzer_futures.append(
                executor.submit(agent_worker_analyzer, ttype, tpath, f"Ana-{i+1}")
            )
            
        for future in as_completed(analyzer_futures):
            try:
                item = future.result()
                if item:
                    all_items.append(item)
                    emit({"event": "item", **item})
                    tracker.update(item["path"], 1, item["size"])
            except Exception as e:
                pass
                
    # Phase 3: Final Consolidation
    _flush_item_buffer(force=True)
    
    total_size = sum(i["size"] for i in all_items)
    
    emit({
        "event": "complete",
        "items": all_items,
        "metrics": {
            "total_bytes": total_size,
            "total_formatted": format_size(total_size),
            "files_scanned": tracker.files_processed,
            "items_found": len(all_items),
            "time_seconds": round(time.monotonic() - tracker.start_time, 2)
        },
        "disk_total": shutil.disk_usage("/")[0],
        "disk_used": shutil.disk_usage("/")[1],
        "disk_free": shutil.disk_usage("/")[2]
    })

def main():
    parser = argparse.ArgumentParser(description="Mac Optimizer Swarm Intelligence Scanner")
    parser.add_argument("command", choices=["scan", "status", "daemon"], default="scan", nargs="?")
    parser.add_argument("target_path", nargs="?", default=None, help="Optional specific path to scan")
    args = parser.parse_args()

    # The electron IPC bridge uses 'scan' to kick off the process
    if args.command == "scan":
        deploy_swarm(args.target_path)
    else:
        print(json.dumps({"error": "Only 'scan' is implemented in Swarm mode for now."}))

if __name__ == "__main__":
    main()
