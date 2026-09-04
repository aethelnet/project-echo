import os
import sys
import uuid
import random
import requests
import psycopg2

def run_recon():
    workspace = os.environ.get('WORKSPACE', 'Shadow_Museum_Atlas')
    target_node = os.environ.get('TARGET_NODE')
    db_url = os.environ.get('DATABASE_URL')
    
    if not target_node or not db_url:
        print("Missing env vars (TARGET_NODE or DATABASE_URL)", file=sys.stderr)
        sys.exit(1)
        
    print(f"Starting OpenAlex Recon for {target_node} in Postgres...")
    
    # Very basic query to OpenAlex API
    url = f"https://api.openalex.org/works?search={target_node}"
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        results = data.get('results', [])
    except Exception as e:
        print(f"OpenAlex fetch failed: {e}", file=sys.stderr)
        sys.exit(1)
        
    new_nodes = []
    for work in results[:3]:
        authorships = work.get('authorships', [])
        if authorships:
            author_name = authorships[0].get('author', {}).get('display_name')
            if author_name and author_name != target_node:
                new_nodes.append((author_name, 'person'))
                
        concepts = work.get('concepts', [])
        if concepts:
            concept_name = concepts[0].get('display_name')
            if concept_name and concept_name != target_node:
                new_nodes.append((concept_name, 'location')) 
                
    if not new_nodes:
        new_nodes = [
            (f"KI_Vorschlag_{random.randint(10,99)}", "artifact"),
            ("Archiv Berlin", "location"),
            ("Unbekannter Sammler", "person")
        ]
        
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # 1. find target node id
        cur.execute("SELECT id FROM nodes WHERE workspace = %s AND label = %s", (workspace, target_node))
        row = cur.fetchone()
        if not row:
            print(f"Target node {target_node} not found in DB.", file=sys.stderr)
            sys.exit(1)
        
        target_id = row[0]
        inserted_edges = 0
        
        for label, ntype in new_nodes[:3]:
            n_id = label.replace(" ", "_").lower() + "_" + str(uuid.uuid4())[:4]
            
            # Insert Node
            try:
                cur.execute("""
                    INSERT INTO nodes (id, workspace, label, type, status)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (workspace, id) DO NOTHING
                """, (n_id, workspace, label, ntype, 'suggested'))
            except Exception as e:
                print(f"Node insert failed: {e}")
                
            # Insert Edge
            edge_id = str(uuid.uuid4())
            try:
                cur.execute("""
                    INSERT INTO edges (id, workspace, source, target, quote, file, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (workspace, id) DO NOTHING
                """, (
                    edge_id,
                    workspace,
                    target_id,
                    n_id,
                    "OpenAlex KI Recon Suggestion",
                    "",
                    "suggested"
                ))
                inserted_edges += 1
            except Exception as e:
                print(f"Edge insert failed: {e}", file=sys.stderr)
                
        conn.commit()
        cur.close()
        conn.close()
        print(f"Recon complete. Inserted {inserted_edges} new edges.")
    except Exception as e:
        print(f"DB Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    run_recon()
