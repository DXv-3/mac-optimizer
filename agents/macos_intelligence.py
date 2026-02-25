import os
import json
import subprocess
import plistlib
from datetime import datetime
import time

HOME = os.path.expanduser("~")

def format_size(bytes_val: int) -> str:
    if bytes_val == 0:
        return "0 B"
    sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    while bytes_val >= 1024 and i < len(sizes) - 1:
        bytes_val /= 1024.0
        i += 1
    return f"{bytes_val:.1f} {sizes[i]}"

def run_cmd(cmd: list) -> str:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
        return result.stdout.strip()
    except Exception:
        return ""

def get_docker_data() -> dict:
    """Returns Docker overhead (images, containers, volumes, build cache)."""
    # Check if docker is installed and running
    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True, timeout=5)
    except Exception:
        return None

    out = run_cmd(["docker", "system", "df", "--format", "{{json .}}"])
    if not out:
        return None

    # system df returns multiple JSON objects (one per line)
    total_bytes = 0
    reclaimable_bytes = 0
    
    try:
        for line in out.splitlines():
            if not line.strip():
                continue
            data = json.loads(line)
            # Size often comes back as e.g. "1.2GB" or "0B". We parse roughly.
            # However docker provides Size and Reclaimable
            # Docker 20+ --format json produces standard JSON with Size, Reclaimable fields
            # Actually, let's just use docker system df and parse it
            pass
    except Exception:
        pass

    # A simpler way is to just use `docker image prune -n` or something, but let's parse `docker system df` without formatting
    out = run_cmd(["docker", "system", "df"])
    if not out:
        return None

    def parse_docker_size(size_str: str) -> int:
        size_str = size_str.replace(" ", "").upper()
        if "GB" in size_str: return int(float(size_str.replace("GB", "")) * 1024**3)
        if "MB" in size_str: return int(float(size_str.replace("MB", "")) * 1024**2)
        if "KB" in size_str: return int(float(size_str.replace("KB", "")) * 1024)
        if "B" in size_str: return int(float(size_str.replace("B", "")))
        return 0

    lines = out.splitlines()
    for line in lines[1:]: # Skip header
        parts = line.split()
        if len(parts) >= 4: # TYPE TOTAL ACTIVE SIZE RECLAIMABLE
            size_str = parts[-2]
            if len(parts) == 6: # SIZE RECLAIMABLE has parenthesis like 1.2GB (50%)
                size_str = parts[-3]
            total_bytes += parse_docker_size(size_str)
            # Reclaimable is parts[-2] or parts[-1]
            try:
                rec_str = parts[-2] if "%" in parts[-1] else parts[-1]
                reclaimable_bytes += parse_docker_size(rec_str)
            except Exception:
                pass

    if total_bytes > 0:
        return {
            "name": "Docker Environment",
            "path": "Docker virtual machine",
            "size": total_bytes,
            "reclaimable_bytes": reclaimable_bytes,
            "type": "developer",
            "description": "Images, containers, and volumes",
            "recommendation": f"Run `docker system prune` to free {format_size(reclaimable_bytes)}" if reclaimable_bytes > 0 else ""
        }
    return None

def get_xcode_derived_data() -> list:
    """Finds Xcode DerivedData projects and their sizes."""
    derived_dir = os.path.join(HOME, "Library", "Developer", "Xcode", "DerivedData")
    if not os.path.exists(derived_dir):
        return []

    items = []
    try:
        for entry in os.scandir(derived_dir):
            if entry.is_dir(follow_symlinks=False) and entry.name != "ModuleCache.noindex":
                # Get size via du
                out = run_cmd(["du", "-sk", entry.path])
                if out:
                    kb = int(out.split()[0])
                    size_bytes = kb * 1024
                    # Extract original project name from folder (e.g., MyApp-abcxyz)
                    proj_name = entry.name.rsplit("-", 1)[0] if "-" in entry.name else entry.name
                    
                    st = entry.stat()
                    days_stale = (time.time() - st.st_mtime) / 86400
                    
                    items.append({
                        "name": proj_name,
                        "path": entry.path,
                        "size": size_bytes,
                        "days_stale": int(days_stale),
                        "type": "xcode_derived",
                        "description": "Xcode Build Artifacts",
                        "risk": "safe" if days_stale > 30 else "caution",
                    })
    except Exception:
        pass
    
    return items

def get_ios_backups() -> list:
    """Finds local iOS device backups."""
    backup_dir = os.path.join(HOME, "Library", "Application Support", "MobileSync", "Backup")
    if not os.path.exists(backup_dir):
        return []

    items = []
    try:
        for entry in os.scandir(backup_dir):
            if entry.is_dir(follow_symlinks=False):
                # Check for Info.plist
                plist_path = os.path.join(entry.path, "Info.plist")
                device_name = "Unknown Device"
                last_backup = "Unknown Date"
                if os.path.exists(plist_path):
                    try:
                        with open(plist_path, "rb") as f:
                            pl = plistlib.load(f)
                            device_name = pl.get("Device Name", "Unknown Device")
                            last_backup_date = pl.get("Last Backup Date")
                            if last_backup_date:
                                last_backup = last_backup_date.strftime("%Y-%m-%d")
                    except Exception:
                        pass
                
                out = run_cmd(["du", "-sk", entry.path])
                if out:
                    kb = int(out.split()[0])
                    size_bytes = kb * 1024
                    
                    st = entry.stat()
                    days_stale = (time.time() - st.st_mtime) / 86400
                    
                    items.append({
                        "name": f"iOS Backup: {device_name}",
                        "path": entry.path,
                        "size": size_bytes,
                        "days_stale": int(days_stale),
                        "last_backup": last_backup,
                        "type": "ios_backup",
                        "description": f"Device backup from {last_backup}",
                        "risk": "safe" if days_stale > 180 else "caution", # Safe to delete if > 6 months old
                    })
    except Exception:
        pass
        
    return items

def get_mail_attachments() -> dict:
    """Estimates size of Mail attachments."""
    mail_dir = os.path.join(HOME, "Library", "Mail")
    if not os.path.exists(mail_dir):
        return None

    # macOS containers for mail downloads
    mail_dl = os.path.join(HOME, "Library", "Containers", "com.apple.mail", "Data", "Library", "Mail Downloads")
    
    total_size = 0
    paths = []
    
    # Check mail downloads
    if os.path.exists(mail_dl):
        try:
            out = run_cmd(["du", "-sk", mail_dl])
            if out:
                total_size += int(out.split()[0]) * 1024
                paths.append(mail_dl)
        except Exception:
            pass
            
    # Check V* folders
    try:
        for entry in os.scandir(mail_dir):
            if entry.is_dir() and entry.name.startswith("V"):
                v_dir = entry.path
                # Search for Attachments folders
                try:
                    for root, dirs, _ in os.walk(v_dir):
                        if "Attachments" in dirs:
                            att_path = os.path.join(root, "Attachments")
                            out = run_cmd(["du", "-sk", att_path])
                            if out:
                                total_size += int(out.split()[0]) * 1024
                                paths.append(att_path)
                            # Don't descend into Attachments
                            dirs.remove("Attachments")
                except Exception:
                    pass
    except Exception:
        pass
        
    if total_size > 50 * 1024 * 1024: # > 50MB
        return {
            "name": "Mail Attachments",
            "paths": paths,
            "size": total_size,
            "type": "mail_attachments",
            "description": "Downloaded email attachments",
        }
    return None

def get_time_machine_snapshots() -> list:
    """Lists local Time Machine snapshots."""
    # Requires sudo for full unique size, but listing is allowed
    # Just checking what exists
    out = run_cmd(["tmutil", "listlocalsnapshots", "/"])
    if not out:
        return []
        
    snapshots = []
    for line in out.splitlines():
        if "com.apple.TimeMachine" in line:
            snapshots.append(line.strip())
            
    if snapshots:
        return [{
            "name": "Local Snapshots",
            "count": len(snapshots),
            "description": f"{len(snapshots)} local Time Machine snapshots (purged automatically by macOS when space is low)",
            "type": "time_machine",
        }]
    return []

def get_stale_downloads() -> list:
    """Finds old files in the ~/Downloads folder."""
    downloads_dir = os.path.join(HOME, "Downloads")
    if not os.path.exists(downloads_dir):
        return []
        
    items = []
    try:
        for entry in os.scandir(downloads_dir):
            if entry.is_file(follow_symlinks=False):
                st = entry.stat()
                days_stale = (time.time() - max(st.st_atime, st.st_mtime)) / 86400
                if days_stale > 30 and st.st_size > 50 * 1024 * 1024: # > 30 days old and > 50 MB
                    items.append({
                        "name": entry.name,
                        "path": entry.path,
                        "size": st.st_size,
                        "days_stale": int(days_stale),
                        "type": "stale_download",
                        "description": f"Downloaded {int(days_stale)} days ago",
                        "risk": "safe" if days_stale > 90 else "caution",
                    })
    except Exception:
        pass
    
    # Sort by size
    items.sort(key=lambda x: x["size"], reverse=True)
    return items

def get_forgotten_installers() -> list:
    """Uses Spotlight to find large DMG, PKG, and ISO files that are old."""
    items = []
    # mdfind is efficient because it uses the spotlight index
    out = run_cmd(["mdfind", "kMDItemFSName == '*.dmg' || kMDItemFSName == '*.pkg' || kMDItemFSName == '*.iso'"])
    if not out:
        return []
        
    for path in out.splitlines():
        if not path.startswith(HOME): # Only look in user directory
            continue
        try:
            st = os.stat(path, follow_symlinks=False)
            days_stale = (time.time() - max(st.st_atime, st.st_mtime)) / 86400
            
            # If it's larger than 100MB and older than 14 days
            if st.st_size > 100 * 1024 * 1024 and days_stale > 14:
                # Make sure it's not currently mounted (rough check)
                if not os.path.ismount(path):
                    items.append({
                        "name": os.path.basename(path),
                        "path": path,
                        "size": st.st_size,
                        "days_stale": int(days_stale),
                        "type": "installer",
                        "description": f"Installer unused for {int(days_stale)} days",
                        "risk": "safe" if days_stale > 30 else "caution",
                    })
        except Exception:
            pass
            
    items.sort(key=lambda x: x["size"], reverse=True)
    return items

def gather_macos_intelligence() -> dict:
    """Gathers all macOS-specific storage intelligence."""
    insights = {
        "xcode": get_xcode_derived_data(),
        "ios_backups": get_ios_backups(),
        "docker": get_docker_data(),
        "mail": get_mail_attachments(),
        "snapshots": get_time_machine_snapshots(),
        "stale_downloads": get_stale_downloads(),
        "forgotten_installers": get_forgotten_installers(),
    }
    return insights

if __name__ == "__main__":
    print(json.dumps(gather_macos_intelligence(), indent=2))
