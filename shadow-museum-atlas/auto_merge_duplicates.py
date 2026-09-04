import psycopg2
import sys
import difflib
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict

def get_node_context(cur, ws, node_id):
    cur.execute("""
        SELECT quote FROM edges 
        WHERE workspace = %s AND (source = %s OR target = %s)
        AND quote IS NOT NULL AND quote != ''
    """, (ws, node_id, node_id))
    rows = cur.fetchall()
    return " ".join([r[0] for r in rows]) if rows else ""

def clean_label(label):
    if not label: return ""
    return str(label).lower().replace("-> bio", "").replace("->", "").strip()

def main():
    ws = "Shadow_Museum_Atlas"
    print("🤖 Lade SentenceTransformer Modell (all-MiniLM-L6-v2)...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    conn = psycopg2.connect("postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas")
    cur = conn.cursor()

    print("📊 Lade Knoten aus Datenbank...")
    cur.execute("SELECT id, label FROM nodes WHERE workspace = %s", (ws,))
    nodes = cur.fetchall()
    
    if not nodes:
        print("Keine Knoten gefunden.")
        return

    # 1. Kandidaten finden (String Similarity)
    print("🔎 Suche nach Namens-Duplikaten (Fuzzy String Match)...")
    candidates = []
    
    # Sort nodes to ensure consistent primary selection
    nodes = sorted(nodes, key=lambda x: len(str(x[1]) if x[1] else x[0]))
    
    processed = set()
    for i, (id1, label1) in enumerate(nodes):
        if id1 in processed: continue
        
        group = [(id1, label1)]
        c_label1 = clean_label(label1)
        if not c_label1: continue

        for j in range(i+1, len(nodes)):
            id2, label2 = nodes[j]
            if id2 in processed: continue
            
            c_label2 = clean_label(label2)
            if not c_label2: continue
            
            # Substring or high similarity
            if c_label1 in c_label2 or c_label2 in c_label1:
                similarity = 1.0
            else:
                similarity = difflib.SequenceMatcher(None, c_label1, c_label2).ratio()
                
            if similarity > 0.70:
                group.append((id2, label2))
                processed.add(id2)
        
        if len(group) > 1:
            candidates.append(group)
            
    print(f"✅ {len(candidates)} potenzielle Duplikat-Gruppen gefunden!")
    
    if len(candidates) == 0:
        return

    suggestions_added = 0
    
    # 2. Aktives Feedback-Lernen (Negative Embedding Boundaries)
    cur.execute("SELECT primary_id, duplicate_id FROM merge_suggestions WHERE status = 'rejected' AND workspace = %s", (ws,))
    rejected_rows = cur.fetchall()
    forbidden_axes = []
    
    if rejected_rows:
        print(f"🎓 Lade {len(rejected_rows)} abgelehnte Merges für Active Learning Feedback...")
        for pid, did in rejected_rows:
            ctx_p = get_node_context(cur, ws, pid)
            ctx_d = get_node_context(cur, ws, did)
            vec_p = model.encode([ctx_p if ctx_p else str(pid)])[0]
            vec_d = model.encode([ctx_d if ctx_d else str(did)])[0]
            # Vektor der historischen Fehlannahme
            forbidden_axes.append(vec_d - vec_p)

    # 3. Semantic Entity Disambiguation (Tensor Check)
    print("🧠 Generiere Merge-Suggestions mit Feedback-Penalty...")
    for group in candidates:
        primary_id, primary_label = group[0]
        primary_context = get_node_context(cur, ws, primary_id)
        primary_vec = model.encode([primary_context if primary_context else str(primary_label)])[0]
        
        for dup_id, dup_label in group[1:]:
            dup_context = get_node_context(cur, ws, dup_id)
            dup_vec = model.encode([dup_context if dup_context else str(dup_label)])[0]
            
            sim = cosine_similarity([primary_vec], [dup_vec])[0][0]
            
            # Dynamischer Feedback-Penalty (Belief Revision)
            penalty = 0.0
            if forbidden_axes:
                diff_vec = dup_vec - primary_vec
                for f_axis in forbidden_axes:
                    # Wie ähnlich ist dieser Fehler zu einem vergangenen Fehler?
                    axis_sim = cosine_similarity([diff_vec], [f_axis])[0][0]
                    if axis_sim > 0.70:
                        penalty += 0.15 # Bestrafe die Confidence, wenn es nach einem bekannten Fehler-Muster aussieht
            
            final_sim = sim - penalty
            sim_pct = round(float(final_sim) * 100, 1)
            
            # Suggest if similarity is decent (>= 50%)
            if final_sim >= 0.50:
                # Check if already suggested
                cur.execute("SELECT id FROM merge_suggestions WHERE primary_id = %s AND duplicate_id = %s", (primary_id, dup_id))
                if cur.fetchone():
                    continue
                
                print(f"➕ Suggestion: '{dup_label}' -> '{primary_label}' (Confidence: {sim_pct}%)")
                cur.execute("""
                    INSERT INTO merge_suggestions (workspace, primary_id, duplicate_id, confidence)
                    VALUES (%s, %s, %s, %s)
                """, (ws, primary_id, dup_id, sim_pct))
                suggestions_added += 1

    conn.commit()
    print(f"\n🚀 {suggestions_added} NEUE VORSCHLÄGE IN DIE HUMAN-IN-THE-LOOP WARTESCHLANGE GELEGT!")

if __name__ == "__main__":
    main()
