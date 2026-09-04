import json

GRAPH_FILE = "src/data.json"

def patch_categories():
    with open(GRAPH_FILE, 'r', encoding='utf-8') as f:
        graph = json.load(f)
        
    for node in graph["nodes"]:
        # Wenn der Knoten "person" ist, aber kein offensichtlicher Name
        # (Da unser Skript alles als Person deklariert hat, was es nicht kannte)
        if node["type"] == "person":
            # Bekannte historische Figuren manuell behalten
            known_persons = ["Glauning", "Pavel", "Putlitz", "Ramsay", "Zintgraff", "Bismarck", "Kaiser", "Hesse"]
            is_real_person = any(kp in node["label"] for kp in known_persons)
            
            if not is_real_person:
                node["type"] = "uncategorized"
                
    with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
        
    print("Kategorien gepatcht! Unbekannte Knoten sind jetzt 'uncategorized'.")

if __name__ == "__main__":
    patch_categories()
