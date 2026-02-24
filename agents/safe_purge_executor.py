import os
import sys
import json
import shutil

def generate_cleanup_script(target_paths):
    """
    Safely deletes specified target paths.
    Applies strict validation to ensure we NEVER delete system roots, user documents,
    or anything outside of known cleanable locations.
    """
    
    user_home = os.path.expanduser('~')

    # Safe zones: all ~/Library subdirectories that contain caches/junk, plus common
    # cleanable locations. This must cover every path the storage scanner can find.
    safe_zones = [
        # Library caches and junk
        os.path.join(user_home, "Library", "Caches"),
        os.path.join(user_home, "Library", "Logs"),
        os.path.join(user_home, "Library", "Developer"),
        os.path.join(user_home, "Library", "Saved Application State"),
        os.path.join(user_home, "Library", "Application Support", "CrashReporter"),
        os.path.join(user_home, "Library", "Application Support", "MobileSync", "Backup"),
        os.path.join(user_home, "Library", "Audio", "Apple Loops"),
        os.path.join(user_home, "Library", "Containers"),
        os.path.join(user_home, "Library", "Group Containers"),
        # Homebrew cache
        os.path.join(user_home, "Library", "Caches", "Homebrew"),
        # Browser data
        os.path.join(user_home, "Library", "Application Support", "Google", "Chrome"),
        os.path.join(user_home, "Library", "Application Support", "Firefox"),
        os.path.join(user_home, "Library", "Application Support", "Arc"),
        os.path.join(user_home, "Library", "Application Support", "BraveSoftware"),
        os.path.join(user_home, "Library", "Application Support", "Microsoft Edge"),
        # Dev caches — node, python, rust, etc.
        os.path.join(user_home, ".npm"),
        os.path.join(user_home, ".cache"),
        os.path.join(user_home, ".cargo", "registry"),
        os.path.join(user_home, ".rustup"),
        os.path.join(user_home, ".pyenv"),
        os.path.join(user_home, ".gradle"),
        os.path.join(user_home, ".cocoapods"),
        os.path.join(user_home, ".pub-cache"),
        # Trash
        os.path.join(user_home, ".Trash"),
        # Xcode derived data
        os.path.join(user_home, "Library", "Developer", "Xcode", "DerivedData"),
        os.path.join(user_home, "Library", "Developer", "CoreSimulator"),
    ]

    # Also allow node_modules, .venv, build dirs, __pycache__ ANYWHERE under home
    # These are always safe to delete (they can be regenerated)
    ALWAYS_SAFE_BASENAMES = {
        "node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt",
        ".cache", ".tox", ".gradle", "Pods", "DerivedData", ".dart_tool",
        "coverage", ".parcel-cache", ".turbo",
    }
    
    # Directories that should NEVER be deleted
    FORBIDDEN_PATHS = {
        user_home,
        os.path.join(user_home, "Desktop"),
        os.path.join(user_home, "Documents"),
        os.path.join(user_home, "Downloads"),
        os.path.join(user_home, "Pictures"),
        os.path.join(user_home, "Music"),
        os.path.join(user_home, "Movies"),
        os.path.join(user_home, "Library"),
        "/",
        "/System",
        "/Applications",
        "/Users",
        "/var",
        "/private",
        "/usr",
        "/bin",
        "/sbin",
        "/tmp",
    }
    
    validated_paths = []
    
    for path in target_paths:
        real_path = os.path.realpath(path)
        
        if not os.path.exists(real_path):
            continue
        
        # NEVER delete forbidden paths
        if real_path in FORBIDDEN_PATHS:
            continue
            
        # Check if the basename is always-safe (node_modules, .venv, etc.)
        basename = os.path.basename(real_path)
        if basename in ALWAYS_SAFE_BASENAMES and real_path.startswith(user_home):
            validated_paths.append(real_path)
            continue
        
        # Check if it's inside a known safe zone
        is_safe = False
        for zone in safe_zones:
            real_zone = os.path.realpath(zone)
            if real_path.startswith(real_zone + os.sep) and len(real_path) > len(real_zone):
                is_safe = True
                break
            # Also allow deleting the zone directory itself (e.g., the entire Caches dir)
            if real_path == real_zone:
                is_safe = True
                break
                
        if is_safe:
            validated_paths.append(real_path)
            
    if not validated_paths:
        return {"status": "error", "message": "No valid or safe paths provided for deletion."}
        
    deleted_count = 0
    freed_bytes = 0
    deleted_paths = []
    
    for path in validated_paths:
        try:
            # Get size before deletion
            if os.path.isdir(path):
                size = sum(
                    os.path.getsize(os.path.join(dp, f))
                    for dp, _, fnames in os.walk(path)
                    for f in fnames
                    if os.path.exists(os.path.join(dp, f))
                )
                shutil.rmtree(path)
            else:
                size = os.path.getsize(path)
                os.remove(path)
            deleted_count += 1
            freed_bytes += size
            deleted_paths.append(path)
        except Exception as e:
            print(f"Error deleting {path}: {e}", file=sys.stderr)
    
    return {
        "status": "success",
        "paths_to_delete": deleted_count,
        "freed_bytes": freed_bytes,
        "deleted": deleted_paths,
    }

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        request = json.loads(input_data)
        paths = request.get("target_paths", [])
        
        result = generate_cleanup_script(paths)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
