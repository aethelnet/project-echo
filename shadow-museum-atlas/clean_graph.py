import json

GRAPH_FILE = "src/data.json"

def clean_graph():
    print("==============================================")
    print("   SHADOW MUSEUM - GRAPH OPTIMIZER            ")
    print("==============================================\n")
    
    with open(GRAPH_FILE, 'r', encoding='utf-8') as f:
        graph = json.load(f)
        
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    
    print(f"Ursprüngliche Größe: {len(nodes)} Knoten, {len(edges)} Kanten.")
    
    # Kanten zählen (Degree)
    degree_map = {}
    for edge in edges:
        s = edge["source"]
        t = edge["target"]
        degree_map[s] = degree_map.get(s, 0) + 1
        degree_map[t] = degree_map.get(t, 0) + 1
        
    # Wir behalten nur Knoten, die wirklich historische Bedeutung haben (starke Gravitation)
    # Ein Knoten muss mindestens 4 Verbindungen haben, um im Haupt-Atlas zu bleiben
    MIN_DEGREE = 4
    
    kept_node_ids = set()
    cleaned_nodes = []
    
    for n in nodes:
        node_id = n["id"]
        # Ausnahmen für hartcodierte Kern-Entitäten
        if degree_map.get(node_id, 0) >= MIN_DEGREE or node_id == "Kumbo":
            kept_node_ids.add(node_id)
            cleaned_nodes.append(n)
            
    # Kanten anpassen (nur Kanten behalten, deren Start UND Ziel noch existieren)
    cleaned_edges = []
    for edge in edges:
        if edge["source"] in kept_node_ids and edge["target"] in kept_node_ids:
            cleaned_edges.append(edge)
            
    # Speichern
    new_graph = {
        "nodes": cleaned_nodes,
        "edges": cleaned_edges
    }
    
    with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
        json.dump(new_graph, f, indent=2, ensure_ascii=False)
        
    print(f"🧹 Bereinigung abgeschlossen!")
    print(f"Neue, hochgradig performante Größe: {len(cleaned_nodes)} Knoten, {len(cleaned_edges)} Kanten.")
    print("Die unwichtigen Rauschnomen wurden vaporisiert.")

if __name__ == "__main__":
    clean_graph()
