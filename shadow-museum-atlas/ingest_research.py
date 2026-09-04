import os
import json
import hashlib
from datetime import datetime

DROPZONE_DIR = "data_dropzone/verified_research"
OUTPUT_GRAPH = "data_dropzone/knowledge_graph.json"

def generate_id(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:8]

def ingest_dropzone():
    print("=== SHADOW MUSEUM: INGESTION PIPELINE ===")
    
    # 1. Human-in-the-Loop Core: Verified Data from Researchers
    verified_nodes = {}
    verified_edges = []
    
    # Simulate reading from the dropzone
    print(f"Scanning {DROPZONE_DIR} for verified research...")
    if not os.path.exists(DROPZONE_DIR):
        os.makedirs(DROPZONE_DIR)
        
    # Read actual files dropped into the folder by researchers
    real_research = []
    for filename in os.listdir(DROPZONE_DIR):
        if filename.endswith(".json"):
            filepath = os.path.join(DROPZONE_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        real_research.extend(data)
            except Exception as e:
                print(f"Error reading {filename}: {e}")
    
    # If no files found, use some fallback data to not leave it empty
    if not real_research:
        print("No verified research files found. Waiting for data drop...")
    
    for entry in real_research:
        subj_id = generate_id(entry["subject"])
        loc_id = generate_id(entry["location"])
        
        verified_nodes[subj_id] = {"id": subj_id, "label": entry["subject"], "type": "Subject", "status": "verified", "source": "Atlas der Abwesenheit"}
        verified_nodes[loc_id] = {"id": loc_id, "label": entry["location"], "type": "Location", "status": "verified", "source": "Atlas der Abwesenheit"}
        
        verified_edges.append({
            "source": subj_id, 
            "target": loc_id, 
            "label": "located_at", 
            "status": "verified",
            "context": entry["note"]
        })
        
    # 2. AI Penumbra: Suggested connections from LGNN / Deep Soak
    # These are visually distinct in the UI so researchers are not polluted with unverified data.
    suggested_nodes = {}
    suggested_edges = []
    
    # Mocking AI discovering a living descendant community link
    comm_id = generate_id("Nso Community, Kumbo")
    suggested_nodes[comm_id] = {"id": comm_id, "label": "Nso Community, Kumbo", "type": "Community", "status": "suggested", "confidence": 0.89, "source": "AI Deep Soak (Open Databases)"}
    
    suggested_edges.append({
        "source": generate_id("Ngonnso"), 
        "target": comm_id, 
        "label": "spiritual_belonging", 
        "status": "suggested",
        "confidence": 0.89
    })

    # Combine data
    graph = {
        "metadata": {
            "last_updated": datetime.now().isoformat(),
            "verified_node_count": len(verified_nodes),
            "suggested_node_count": len(suggested_nodes)
        },
        "nodes": list(verified_nodes.values()) + list(suggested_nodes.values()),
        "edges": verified_edges + suggested_edges
    }
    
    with open(OUTPUT_GRAPH, 'w') as f:
        json.dump(graph, f, indent=2)
        
    print(f"Ingestion complete. Graph compiled to {OUTPUT_GRAPH}.")
    print(f" -> Verified Nodes (Core): {len(verified_nodes)}")
    print(f" -> Suggested Nodes (Shadow/Penumbra): {len(suggested_nodes)}")
    print("UI can now strictly separate verified research from AI suggestions.")

if __name__ == "__main__":
    ingest_dropzone()
