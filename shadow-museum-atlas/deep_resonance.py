import sys
import json
import psycopg2
import spacy
from collections import Counter

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing workspace or node_id"}))
        sys.exit(1)

    workspace = sys.argv[1]
    node_id = sys.argv[2]

    try:
        conn = psycopg2.connect("postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas")
        cur = conn.cursor()

        # Hole alle Zitate, die an diesen Knoten angrenzen
        cur.execute("""
            SELECT quote FROM edges 
            WHERE workspace = %s AND (source = %s OR target = %s)
            AND quote IS NOT NULL AND quote != ''
        """, (workspace, node_id, node_id))
        
        rows = cur.fetchall()
        quotes = [r[0] for r in rows]
        
        if not quotes:
            print(json.dumps({"keywords": [node_id], "context_size": 0}))
            return

        combined_text = " ".join(quotes)

        # Nutze SpaCy um den "Reasoning-State" (die wichtigsten Entitäten/Nomen) zu extrahieren
        nlp = spacy.load("de_core_news_sm")
        doc = nlp(combined_text)
        
        # Filtere nach Eigennamen und Nomen, ignoriere Stopwörter
        keywords = []
        for token in doc:
            if token.pos_ in ["NOUN", "PROPN"] and not token.is_stop and len(token.text) > 3:
                keywords.append(token.text)
                
        # Zähle die häufigsten Konzepte im "Tensor"
        most_common = [word for word, count in Counter(keywords).most_common(4)]
        
        if not most_common:
            most_common = [node_id]

        print(json.dumps({
            "keywords": most_common,
            "context_size": len(quotes),
            "query": " AND ".join(most_common)
        }))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
