import sys
import json
import psycopg2
import time
import os
from sentence_transformers import SentenceTransformer, util
import torch

def run():
    ws = sys.argv[1] if len(sys.argv) > 1 else 'Shadow_Museum_Atlas'
    
    print("Verbinde mit PostgreSQL...", file=sys.stderr)
    db_url = os.getenv("DATABASE_URL", "postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas")
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
    except Exception as e:
        print(f"DB Error: {e}", file=sys.stderr)
        print("[]")
        return
    
    cur.execute("SELECT source, target, quote FROM edges WHERE workspace = %s", (ws,))
    edges = cur.fetchall()
    
    existing_links = set()
    quote_to_nodes = {}
    
    for s, t, q in edges:
        s, t = min(s, t), max(s, t)
        existing_links.add(f"{s}_{t}")
        if not q or len(q.strip()) < 20: continue
        if q not in quote_to_nodes:
            quote_to_nodes[q] = set()
        quote_to_nodes[q].add(s)
        quote_to_nodes[q].add(t)
        
    quotes = list(quote_to_nodes.keys())
    
    print(f"Starte LGNN Embeddings für {len(quotes)} einzigartige Sätze...", file=sys.stderr)
    start_load = time.time()
    model = SentenceTransformer('all-MiniLM-L6-v2')
    print(f"Modell in {time.time()-start_load:.2f}s geladen.", file=sys.stderr)
    
    start_enc = time.time()
    embeddings = model.encode(quotes, convert_to_tensor=True)
    print(f"Vektoren in {time.time()-start_enc:.2f}s berechnet.", file=sys.stderr)
    
    cosine_scores = util.cos_sim(embeddings, embeddings)
    
    hidden_edges = []
    added_hidden = set()
    
    # Wir suchen nach extrem ähnlichen Aussagen (> 85% Cosine Similarity)
    for i in range(len(quotes)):
        for j in range(i + 1, len(quotes)):
            score = cosine_scores[i][j].item()
            if score > 0.85:
                nodes_i = quote_to_nodes[quotes[i]]
                nodes_j = quote_to_nodes[quotes[j]]
                
                for n1 in nodes_i:
                    for n2 in nodes_j:
                        if n1 == n2: continue
                        m1, m2 = min(n1, n2), max(n1, n2)
                        link_id = f"{m1}_{m2}"
                        
                        if link_id not in existing_links and link_id not in added_hidden:
                            added_hidden.add(link_id)
                            hidden_edges.append({
                                "id": f"hidden_{link_id}",
                                "source": n1,
                                "target": n2,
                                "lineDash": [4, 4], "color": "#10B981",
                                "status": "hidden_prediction",
                                "score": round(score * 100, 1),
                                "label": f"KI MATCH {round(score * 100, 1)}%"
                            })
                            
                            if len(hidden_edges) >= 30: # Limit für die UI
                                break
        if len(hidden_edges) >= 30:
            break

    # Gebe die versteckten Kanten als reines JSON an Node.js zurück
    print(json.dumps(hidden_edges))
    
if __name__ == "__main__":
    run()
