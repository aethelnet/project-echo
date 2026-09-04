import os
import re
import json
import hashlib
from datetime import datetime

DROPZONE_DIR = "data_dropzone/verified_research"
OUTPUT_GRAPH = "data_dropzone/knowledge_graph.json"

def generate_id(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:8]

def extract_sources_from_text(filepath):
    print(f"Extracting sources from {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    # Very basic regex to find potential sources and entities
    # In a production environment, we would use spaCy or an LLM
    sources = []
    
    # 1. Look for archival signatures (e.g., BArch, Geheimes Staatsarchiv, etc.)
    archiv_matches = re.findall(r'([A-Z][a-z]+archiv.*?)\s+(\w+\s\d+/?\d*)', text)
    for match in archiv_matches:
        sources.append({"type": "Archive File", "label": f"{match[0]} {match[1]}"})
        
    # 2. Look for explicit diaries/letters (Tagebuch, Brief)
    diary_matches = re.findall(r'((?:Tagebuch|Brief|Aufzeichnungen) von [A-Z][a-z]+(?: [A-Z][a-z]+)?)', text)
    for match in diary_matches:
        sources.append({"type": "Personal Document", "label": match})

    # Deduplicate
    unique_sources = {s['label']: s for s in sources}.values()
    return list(unique_sources)

def ingest_all():
    print("=== SHADOW MUSEUM: SOURCE-FIRST INGESTION ===")
    
    verified_nodes = {}
    verified_edges = []
    
    if not os.path.exists(DROPZONE_DIR):
        os.makedirs(DROPZONE_DIR)
        
    for filename in os.listdir(DROPZONE_DIR):
        filepath = os.path.join(DROPZONE_DIR, filename)
        
        # Parse JSON Files (like before)
        if filename.endswith(".json"):
            with open(filepath, 'r') as f:
                data = json.load(f)
                for entry in data:
                    subj_id = generate_id(entry["subject"])
                    loc_id = generate_id(entry["location"])
                    
                    verified_nodes[subj_id] = {"id": subj_id, "label": entry["subject"], "type": "Subject", "status": "verified", "source": filename}
                    verified_nodes[loc_id] = {"id": loc_id, "label": entry["location"], "type": "Location", "status": "verified", "source": filename}
                    
                    verified_edges.append({
                        "source": subj_id, 
                        "target": loc_id, 
                        "label": "located_at", 
                        "status": "verified"
                    })
                    
        # Parse Text/PDF Files (Source Extractor)
        elif filename.endswith(".txt"):
            sources = extract_sources_from_text(filepath)
            doc_id = generate_id(filename)
            verified_nodes[doc_id] = {"id": doc_id, "label": f"Document: {filename}", "type": "Document", "status": "verified", "source": filename}
            
            for src in sources:
                src_id = generate_id(src["label"])
                verified_nodes[src_id] = {"id": src_id, "label": src["label"], "type": src["type"], "status": "verified", "source": filename}
                verified_edges.append({
                    "source": doc_id,
                    "target": src_id,
                    "label": "cites_source",
                    "status": "verified"
                })

    # AI Penumbra (Mocked LGNN Discovery)
    suggested_nodes = {}
    suggested_edges = []
    
    if len(verified_nodes) > 0:
        # Example of the AI finding a new source based on extracted sources
        ai_src_id = generate_id("Bundesarchiv R 1001/4433 (Unknown Document)")
        suggested_nodes[ai_src_id] = {"id": ai_src_id, "label": "BArch R 1001/4433 (AI Discovery)", "type": "Archive File", "status": "suggested", "confidence": 0.92}
        
        # Connect it to the first found document
        first_doc_id = list(verified_nodes.keys())[0]
        suggested_edges.append({
            "source": first_doc_id,
            "target": ai_src_id,
            "label": "related_archival_context",
            "status": "suggested"
        })

    graph = {
        "nodes": list(verified_nodes.values()) + list(suggested_nodes.values()),
        "edges": verified_edges + suggested_edges
    }
    
    with open(OUTPUT_GRAPH, 'w') as f:
        json.dump(graph, f, indent=2)
        
    print(f"Extraction complete! Found {len(verified_nodes)} verified nodes and {len(suggested_nodes)} AI suggested nodes.")

if __name__ == "__main__":
    ingest_all()
