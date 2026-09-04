import os
import json
import time
from sentence_transformers import SentenceTransformer, util

DROPZONE_DIR = "data_dropzone/verified_research"
GRAPH_FILE = "src/data.json"
SIMILARITY_THRESHOLD = 0.40 # 40% Overlap für das Mini-Modell

def load_texts_and_chunk():
    print("📖 Lese komplette Texte aus der Dropzone...")
    documents = []
    
    for filename in os.listdir(DROPZONE_DIR):
        if filename.endswith(".txt"):
            filepath = os.path.join(DROPZONE_DIR, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Chunking: Wir teilen den Text in Absätze
            paragraphs = [p.strip() for p in content.split('\n\n') if len(p.strip()) > 30]
            
            for i, p in enumerate(paragraphs):
                documents.append({
                    "id": f"{filename}_chunk_{i}",
                    "source": filename,
                    "text": p
                })
    return documents

def run_lgnn():
    print("==============================================")
    print("   SHADOW MUSEUM - LGNN GRAPH BUILDER         ")
    print("==============================================\n")
    
    # 1. Bestehende Knoten laden (Die echten historischen Entitäten aus dem UI)
    with open(GRAPH_FILE, 'r', encoding='utf-8') as f:
        graph = json.load(f)
    
    nodes = graph.get("nodes", [])
    # Filtere alle Knoten, die keine reinen Dokumenten-Knoten sind
    entity_nodes = [n for n in nodes if n.get("type") != "source_document"]
    
    # 2. Textkörper laden
    docs = load_texts_and_chunk()
    print(f"✅ {len(docs)} Sinnabschnitte aus dem Atlas und Spider-Quellen geladen.")
    
    print("🧠 Starte KI-Modell (Vektor-Transformation)...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    print("🌌 Berechne Vektor-Schwerkraft für das gesamte Universum...")
    
    # Vektorisieren aller Entitäten (Namen, Orte)
    entity_texts = [n['label'] for n in entity_nodes]
    entity_embeddings = model.encode(entity_texts, convert_to_tensor=True)
    
    # Vektorisieren aller Buch/Wikipedia Absätze
    doc_texts = [d['text'] for d in docs]
    doc_embeddings = model.encode(doc_texts, convert_to_tensor=True)
    
    new_links = []
    source_nodes_to_add = {}
    
    # 3. Berechne Schwerkraft zwischen JEDER Entität und JEDEM Absatz
    print("🔗 Verknüpfe Vektoren (Cosine Similarity)...")
    cosine_scores = util.cos_sim(entity_embeddings, doc_embeddings)
    
    for i, entity in enumerate(entity_nodes):
        for j, doc in enumerate(docs):
            score = cosine_scores[i][j].item()
            
            if score > SIMILARITY_THRESHOLD:
                source_filename = doc["source"]
                
                # Wir stellen sicher, dass das Quelldokument als Knoten existiert
                if source_filename not in source_nodes_to_add:
                    source_nodes_to_add[source_filename] = {
                        "id": source_filename,
                        "label": source_filename.replace('.txt', '').replace('spider_crawl_', ''),
                        "type": "source_document",
                        "status": "verified"
                    }
                
                # Wir ziehen eine Edge zwischen der Entität und dem Dokument!
                new_links.append({
                    "source": entity["id"],
                    "target": source_filename,
                    "label": "Semantisch verwandt",
                    "status": "suggested", # Muss von Forscher verifiziert werden
                    "confidence": round(score, 3)
                })

    # 4. Speichern der neuen Galaxie
    all_nodes = entity_nodes + list(source_nodes_to_add.values())
    
    # Dedupliziere Links
    unique_links = []
    seen = set()
    for link in new_links:
        sig = f"{link['source']}-{link['target']}"
        if sig not in seen:
            seen.add(sig)
            unique_links.append(link)

    new_graph = {
        "nodes": all_nodes,
        "edges": unique_links
    }
    
    with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
        json.dump(new_graph, f, indent=2, ensure_ascii=False)
        
    print("\n==============================================")
    print(f"🏁 Galaxie gebaut! {len(unique_links)} KI-Verbindungen basierend auf tiefem Sinn gefunden.")
    print("Die Frontend-UI (App.tsx) aktualisiert sich jetzt automatisch.")

if __name__ == "__main__":
    run_lgnn()
