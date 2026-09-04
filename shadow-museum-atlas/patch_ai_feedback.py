import re

with open('auto_merge_duplicates.py', 'r') as f:
    code = f.read()

old_tensor = """    # 2. Semantic Entity Disambiguation (Tensor Check)
    print("🧠 Generiere Merge-Suggestions (Tensor-Vektor-Abgleich)...")"""

new_tensor = """    # 2. Aktives Feedback-Lernen (Negative Embedding Boundaries)
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
    print("🧠 Generiere Merge-Suggestions mit Feedback-Penalty...")"""

old_sim = """            sim = cosine_similarity([primary_vec], [dup_vec])[0][0]
            sim_pct = round(float(sim) * 100, 1)
            
            # Suggest if similarity is decent (>= 50%)
            if sim >= 0.50:"""

new_sim = """            sim = cosine_similarity([primary_vec], [dup_vec])[0][0]
            
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
            if final_sim >= 0.50:"""

code = code.replace(old_tensor, new_tensor)
code = code.replace(old_sim, new_sim)

with open('auto_merge_duplicates.py', 'w') as f:
    f.write(code)

print("Feedback Loop Injected!")
