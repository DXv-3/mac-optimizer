import os
import sys
import json
import uuid
import shutil

def generate_cleanup_script(target_paths):
    """
    Generates a safe bash script that exclusively deletes specified target paths.
    It applies strict validation to ensure we NEVER delete system roots or user documents.
    """
    
    # HARDCODED SAFETY NET: If a generated path is not strictly inside these safe zones, block it.
    user_home = os.path.expanduser('~')
    safe_zones = [
        os.path.join(user_home, "Library", "Caches"),
        os.path.join(user_home, "Library", "Developer"),
        os.path.join(user_home, "Library", "Audio", "Apple Loops"),
        os.path.join(user_home, "Library", "Application Support", "MobileSync", "Backup")
    ]
    
    validated_paths = []
    
    for path in target_paths:
        # Use realpath to resolve symlinks and prevent bypass attacks
        real_path = os.path.realpath(path)
        
        # Ensure it actually exists to prevent failing the script
        if not os.path.exists(real_path):
            continue
            
        # VERY IMPORTANT: Verify it sits strictly inside a known safe zone using real paths
        is_safe = False
        for zone in safe_zones:
            real_zone = os.path.realpath(zone)
            if real_path.startswith(real_zone + os.sep) and len(real_path) > len(real_zone):
                is_safe = True
                break
                
        if is_safe:
            validated_paths.append(real_path)
            
    if not validated_paths:
        return {"status": "error", "message": "No valid or safe paths provided for deletion."}
        
    # Delete the files directly using shutil instead of generating shell scripts
    deleted_count = 0
    for path in validated_paths:
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            deleted_count += 1
        except Exception as e:
            print(f"Error deleting {path}: {e}", file=sys.stderr)
    
    return {
        "status": "success",
        "paths_to_delete": deleted_count
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
