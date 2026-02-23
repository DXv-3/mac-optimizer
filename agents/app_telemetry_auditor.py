import os
import json
import subprocess
import datetime
import math

def get_directory_size(start_path):
    """Calculates the size of an .app bundle."""
    total_size = 0
    if not os.path.exists(start_path): return 0
    try:
        for dirpath, _, filenames in os.walk(start_path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        total_size += os.path.getsize(fp)
                    except (OSError, FileNotFoundError):
                        pass
    except Exception:
        pass
    return total_size

def extract_metadata(app_path):
    """Uses macOS mdls to get reliable creation and last-used dates."""
    result = {
        "kMDItemFSCreationDate": None,
        "kMDItemLastUsedDate": None
    }
    try:
        # Run mdls to extract all metadata key-values
        process = subprocess.Popen(['mdls', '-name', 'kMDItemFSCreationDate', '-name', 'kMDItemLastUsedDate', app_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = process.communicate()
        if process.returncode != 0:
            return result
        
        output = out.decode('utf-8').split('\n')
        for line in output:
            if "kMDItemFSCreationDate" in line:
                parts = line.split('=')
                if len(parts) > 1 and "(null)" not in parts[1]:
                    # Extract date string like '2023-10-25 14:32:00 +0000'
                    date_str = parts[1].strip()
                    result["kMDItemFSCreationDate"] = date_str
            elif "kMDItemLastUsedDate" in line:
                parts = line.split('=')
                if len(parts) > 1 and "(null)" not in parts[1]:
                    date_str = parts[1].strip()
                    result["kMDItemLastUsedDate"] = date_str
    except Exception as e:
        pass
    return result

def format_date(date_string):
    """Parses Apple metadata dates into human relative strings."""
    if not date_string:
        return "Never Used", 99999
        
    try:
        # Expected format: 2024-02-15 18:22:33 +0000
        dt_obj = datetime.datetime.strptime(date_string[:19], '%Y-%m-%d %H:%M:%S')
        now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        delta = now - dt_obj
        
        days_ago = delta.days
        if days_ago == 0:
            return "Today", days_ago
        elif days_ago == 1:
            return "Yesterday", days_ago
        elif days_ago < 30:
            return f"{days_ago} days ago", days_ago
        elif days_ago < 365:
            months = days_ago // 30
            return f"{months} month{'s' if months > 1 else ''} ago", days_ago
        else:
            years = days_ago // 365
            return f"{years} year{'s' if years > 1 else ''} ago", days_ago
    except Exception:
        return "Unknown", 99999

def format_size(size_bytes):
    if size_bytes == 0: return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024))) if size_bytes > 0 else 0
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"

def scan_apps():
    app_directories = ['/Applications', os.path.expanduser('~/Applications')]
    results = []

    for d in app_directories:
        if not os.path.exists(d): continue
        
        try:
            for item in os.listdir(d):
                if item.endswith('.app'):
                    app_path = os.path.join(d, item)
                    app_name = item.replace('.app', '')
                    
                    # Ignore tiny system stubs
                    size_bytes = get_directory_size(app_path)
                    if size_bytes < 5 * 1024 * 1024: # Smaller than 5MB
                        continue
                        
                    meta = extract_metadata(app_path)
                    
                    # Calculate relative usage
                    last_used_str, days_since_used = format_date(meta['kMDItemLastUsedDate'])
                    install_str, _ = format_date(meta['kMDItemFSCreationDate'])
                    
                    # Determine weight category
                    category = "Active"
                    if days_since_used > 180 or last_used_str == "Never Used":
                        category = "Dead Weight"
                    elif days_since_used > 60:
                        category = "Rarely Used"

                    results.append({
                        "id": app_name,
                        "name": app_name,
                        "path": app_path,
                        "sizeBytes": size_bytes,
                        "sizeFormatted": format_size(size_bytes),
                        "lastUsedRaw": meta['kMDItemLastUsedDate'],
                        "lastUsed": last_used_str,
                        "daysSinceUsed": days_since_used, # for sorting
                        "installed": install_str,
                        "category": category
                    })
        except PermissionError:
            pass

    # Sort largest apps first
    sorted_results = sorted(results, key=lambda x: x['sizeBytes'], reverse=True)

    output = {
        "status": "success",
        "totalAppsScanned": len(results),
        "items": sorted_results
    }
    
    print(json.dumps(output))

if __name__ == "__main__":
    scan_apps()
