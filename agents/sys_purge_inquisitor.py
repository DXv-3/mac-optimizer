import os
import json
import pwd
import sys
import math

def get_directory_size(start_path):
    """Recursively calculates the true disk size of a directory in bytes."""
    total_size = 0
    if not os.path.exists(start_path):
        return 0
    
    try:
        for dirpath, dirnames, filenames in os.walk(start_path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                # Skip symbolic links to avoid infinite loops and mapping outside the target
                if not os.path.islink(fp):
                    try:
                        total_size += os.path.getsize(fp)
                    except (OSError, FileNotFoundError):
                        pass
    except Exception:
        pass # Catch broad exceptions for permission denied on root files
        
    return total_size

def format_size(size_bytes):
    """Converts bytes to a human-readable format."""
    if size_bytes == 0:
        return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024))) if size_bytes > 0 else 0
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"

def scan_system_junk():
    """Scans specific, known macOS 'bloat' directories."""
    user_home = os.path.expanduser('~')
    
    # Target specific directories known to hold massive amounts of safe-to-delete cache
    targets = [
        {"id": "user_caches", "name": "User Caches", "path": os.path.join(user_home, "Library", "Caches"), "description": "Application temporary files and cache."},
        {"id": "xcode_derived", "name": "Xcode DerivedData", "path": os.path.join(user_home, "Library", "Developer", "Xcode", "DerivedData"), "description": "Compiled Xcode project caches."},
        {"id": "xcode_simulators", "name": "Xcode Simulators", "path": os.path.join(user_home, "Library", "Developer", "CoreSimulator", "Devices"), "description": "iOS Simulator installations and data."},
        {"id": "ios_backups", "name": "iOS Device Backups", "path": os.path.join(user_home, "Library", "Application Support", "MobileSync", "Backup"), "description": "Local backups of iPhones and iPads."},
        {"id": "apple_loops", "name": "Apple Audio Loops", "path": os.path.join(user_home, "Library", "Audio", "Apple Loops"), "description": "GarageBand/Logic Pro audio loops."}
    ]

    results = []
    total_bytes_found = 0

    for target in targets:
        path = target['path']
        if os.path.exists(path):
            size_bytes = get_directory_size(path)
            if size_bytes > 0:
                results.append({
                    "id": target["id"],
                    "name": target["name"],
                    "path": path,
                    "description": target["description"],
                    "sizeBytes": size_bytes,
                })
                total_bytes_found += size_bytes

    # Output strict JSON to stdout so Node.js can parse it cleanly
    output = {
        "status": "success",
        "totalBytes": total_bytes_found,
        "items": sorted(results, key=lambda x: x['sizeBytes'], reverse=True)
    }
    
    for item in output['items']:
        
        # Add formatted size
        size_bytes = item['sizeBytes']
        size_name = ("B", "KB", "MB", "GB", "TB")
        i = int(math.floor(math.log(size_bytes, 1024))) if size_bytes > 0 else 0
        p = math.pow(1024, i)
        s = round(size_bytes / p, 2)
        item['sizeFormatted'] = f"{s} {size_name[i]}"

    print(json.dumps(output))

if __name__ == "__main__":
    scan_system_junk()
