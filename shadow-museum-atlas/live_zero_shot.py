import sys
import json
import psycopg2
import time
import os
from sentence_transformers import SentenceTransformer, util
from transformers import pipeline

def run():
    ws = sys.argv[1]
    user_tag = sys.argv[2]
    
    print(f"[{user_tag}] 1. Verbinde mit PostgreSQL...", file=sys.stderr)
    db_url = os.getenv("DATABASE_URL", "postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    cur.execute("SELECT id, quote FROM edges WHERE workspace = %s", (ws,))
    edges = cur.fetchall()
    
    quote_to_edge_ids = {}
    for edge_id, q in edges:
        if not q or len(q.strip()) < 15: continue
        if q not in quote_to_edge_ids:
            quote_to_edge_ids[q] = []
        quote_to_edge_ids[q].append(edge_id)
        
    quotes = list(quote_to_edge_ids.keys())
    if not quotes:
        print("[]")
        return
        
    print(f"[{user_tag}] 2. Berechne LGNN Vektoren für {len(quotes)} Zitate...", file=sys.stderr)
    emb_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    tag_embedding = emb_model.encode([user_tag], convert_to_tensor=True)
    quote_embeddings = emb_model.encode(quotes, convert_to_tensor=True)
    
    # Cosine Similarity zwischen Tag und allen Zitaten
    cosine_scores = util.cos_sim(tag_embedding, quote_embeddings)[0]
    
    # Filtere die Top 30 relevantesten Zitate (Pre-Filtering)
    top_k = min(30, len(quotes))
    top_results = torch.topk(cosine_scores, k=top_k)
    
    candidates = []
    for score, idx in zip(top_results[0], top_results[1]):
        if score > 0.05: # Grundrauschen filtern
            candidates.append(quotes[idx])
            
    if not candidates:
        print("[]")
        return
        
    print(f"[{user_tag}] 3. Überprüfe {len(candidates)} Kandidaten mit Zero-Shot (mDeBERTa)...", file=sys.stderr)
    classifier = pipeline("zero-shot-classification", model="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
    
    matching_edge_ids = []
    for quote in candidates:
        res = classifier(quote, [user_tag])
        score = res['scores'][0]
        if score > 0.4: # Hohe Konfidenz
            for eid in quote_to_edge_ids[quote]:
                matching_edge_ids.append({
                    "edge_id": eid,
                    "score": round(score * 100, 1),
                    "quote": quote
                })
                
    # Gebe die Liste an das Node-Backend
    print(json.dumps(matching_edge_ids))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("[]")
        sys.exit(1)
    import torch
    run()
