import json
import re
import hashlib
from collections import defaultdict

TEXT_FILE = "data_dropzone/verified_research/atlas_der_abwesenheit.txt"
GRAPH_FILE = "src/data.json"

def generate_id(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:8]

def is_valid_entity(text):
    # Filter out common stop words that might be capitalized at start of sentence
    stopwords = {"Der", "Die", "Das", "Ein", "Eine", "Und", "In", "Mit", "Von", "Zu", "Auf", "Für", "Es", "Ist", "Sie", "Er", "Wir", "Auch"}
    if text in stopwords or len(text) < 3:
        return False
    return True

def build_massive_starmap():
    print("==============================================")
    print("   SHADOW MUSEUM - MASSIVE STAR MAP BUILDER   ")
    print("==============================================\n")
    
    print(f"📖 Lese {TEXT_FILE}...")
    try:
        with open(TEXT_FILE, 'r', encoding='utf-8') as f:
            text = f.read()
    except Exception as e:
        print("Konnte Textdatei nicht laden:", e)
        return

    # In Sinneinheiten/Sätze zerlegen
    sentences = re.split(r'(?<=[.!?]) +', text)
    print(f"✅ {len(sentences)} Sätze analysiert.")
    
    nodes_dict = {}
    edges_list = []
    co_occurrences = defaultdict(int)
    
    print("🧠 Extrahiere historische Entitäten (Personen, Orte, Artefakte)...")
    
    # Simples aber effektives NER: Alle aufeinanderfolgenden großgeschriebenen Wörter
    for sentence in sentences:
        # Find sequences of Title Case words
        entities = re.findall(r'([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*)', sentence)
        valid_entities = [e.strip() for e in entities if is_valid_entity(e.strip())]
        
        # Füge Knoten hinzu
        for ent in valid_entities:
            ent_id = generate_id(ent)
            
            # Typisierung schätzen
            e_type = "entity"
            if "Museum" in ent or "Archiv" in ent or "Sammlung" in ent:
                e_type = "archive"
            elif "Kumbo" in ent or "Berlin" in ent or "Kamerun" in ent or "Stadt" in ent or "Dorf" in ent:
                e_type = "location"
            elif "Ngonnso" in ent or "Statue" in ent or "Thron" in ent:
                e_type = "artifact"
            else:
                e_type = "person" # Default guess for Title Case
                
            if ent_id not in nodes_dict:
                nodes_dict[ent_id] = {
                    "id": ent_id,
                    "label": ent,
                    "type": e_type,
                    "status": "verified"
                }
                
        # Füge Co-Occurrence (Kanten) hinzu
        # Wenn zwei Entitäten im selben Satz auftauchen, sind sie verknüpft
        if len(valid_entities) > 1:
            for i in range(len(valid_entities)):
                for j in range(i+1, len(valid_entities)):
                    e1 = valid_entities[i]
                    e2 = valid_entities[j]
                    if e1 != e2:
                        edge_id = tuple(sorted([e1, e2]))
                        co_occurrences[edge_id] += 1

    print("🔗 Knüpfe das galaktische Netz...")
    
    # Filtere Kanten (nur starke Verbindungen, um visuelles Chaos zu vermeiden)
    for (e1, e2), weight in co_occurrences.items():
        if weight > 1: # Muss mindestens 2 Mal im selben Satz auftauchen
            e1_id = generate_id(e1)
            e2_id = generate_id(e2)
            edges_list.append({
                "source": e1_id,
                "target": e2_id,
                "label": f"co_mentioned ({weight}x)",
                "status": "verified"
            })

    # Füge den geopolitischen Status zu Kumbo hinzu, wie wir es besprochen haben
    kumbo_id = generate_id("Kumbo")
    if kumbo_id in nodes_dict:
        nodes_dict[kumbo_id]["geopolitical_status"] = "Active Anglophone Conflict Zone"

    graph = {
        "nodes": list(nodes_dict.values()),
        "edges": edges_list
    }
    
    with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
        
    print(f"\n==============================================")
    print(f"🚀 STERNENKARTE GENERIERT!")
    print(f"Knoten: {len(nodes_dict)}")
    print(f"Kanten: {len(edges_list)}")
    print("Die Frontend-UI zeigt jetzt eine massive, verwobene Galaxie.")

if __name__ == "__main__":
    build_massive_starmap()
