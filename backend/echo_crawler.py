import requests
import json
import os

def fetch_looted_artifacts():
    """
    Queries the Metropolitan Museum of Art (Open API) for artifacts
    originating from specific regions (e.g., Benin, Edo) that were 
    historically displaced.
    """
    print("[ECHO CRAWLER] Initializing Archive Trace via Met API...")
    
    # Search for Benin Bronzes and similar Edo artifacts
    search_url = "https://collectionapi.metmuseum.org/public/collection/v1/search?q=Benin+Bronze"
    
    try:
        res = requests.get(search_url, timeout=10)
        data = res.json()
        object_ids = data.get('objectIDs', [])[:5] # Grab top 5 for speed
        
        if not object_ids:
            print("[ECHO CRAWLER] No artifacts found.")
            return None
            
        artifacts = []
        for obj_id in object_ids:
            obj_url = f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{obj_id}"
            obj_res = requests.get(obj_url, timeout=10).json()
            
            title = obj_res.get('title', 'Unknown Artifact')
            country = obj_res.get('country', 'Unknown Origin')
            culture = obj_res.get('culture', 'Unknown Culture')
            image = obj_res.get('primaryImageSmall', None)
            
            artifacts.append({
                "name": title,
                "current_location": "Metropolitan Museum of Art (NY)",
                "origin": f"{country} ({culture})",
                "image": image
            })
            
        print(f"[ECHO CRAWLER] Successfully traced {len(artifacts)} cultural artifacts.")
        
        # Save to JSON for the frontend
        output_path = "/home/nikahrlyn/auratic-systems-prime/frontend/echo_live_data.json"
        with open(output_path, 'w') as f:
            json.dump(artifacts, f, indent=4)
            
        print(f"[ECHO CRAWLER] Live Data written to {output_path}")
        return artifacts
        
    except Exception as e:
        print(f"[!] Crawler Error: {e}")
        return None

if __name__ == "__main__":
    fetch_looted_artifacts()
