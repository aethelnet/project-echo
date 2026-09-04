import requests
import psycopg2
import uuid
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [FORENSICS] %(message)s')

DATABASE_URL = "postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas"

# Keywords that indicate a paper or document contains clues about the location or history
FORENSIC_KEYWORDS = ["provenance", "looted", "plundered", "expedition", "private collection", "archive", "restitution"]

def forensic_search():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
    except Exception as e:
        logging.error(f"DB Connection failed: {e}")
        return

    logging.info("🕵️ Initiating Forensic OSINT Crawler (Project: Interactive Chain of Evidence)")
    
    # Let's see what artifacts we have in the DB, or use a default one for the test
    cur.execute("SELECT id, label FROM nodes WHERE type = 'artifact' LIMIT 5;")
    artifacts = cur.fetchall()
    
    if not artifacts:
        logging.warning("No artifacts found in DB. Seeding a test artifact 'Benin Bronze'...")
        art_id = f"artifact_{uuid.uuid4().hex[:6]}"
        cur.execute("INSERT INTO nodes (id, workspace, label, type, status) VALUES (%s, %s, %s, %s, %s)",
                    (art_id, 'Shadow_Museum_Atlas', 'Benin Bronze', 'artifact', 'verified'))
        conn.commit()
        artifacts = [(art_id, 'Benin Bronze')]

    new_nodes = 0
    
    for art_id, art_label in artifacts:
        logging.info(f"🔎 Tracing data shadow for artifact: {art_label}")
        
        # We query OpenAlex for papers that mention the artifact AND forensic keywords
        query = art_label.replace(' ', '+')
        keyword_filter = " OR ".join(FORENSIC_KEYWORDS)
        
        url = f"https://api.openalex.org/works?search={query}&filter=has_abstract:true&per-page=3"
        
        try:
            res = requests.get(url, timeout=10).json()
            results = res.get('results', [])
            
            if not results:
                logging.info(f"⚪ No forensic traces found for {art_label}.")
                continue
                
            for paper in results:
                title = paper.get('title', 'Unknown Document')
                year = paper.get('publication_year', 'Unknown')
                abstract_inverted = paper.get('abstract_inverted_index', {})
                
                # Reconstruct a snippet of the abstract to find "smoking guns"
                # (In a real scenario we use NLP, here we just check if it contains our keywords)
                words = [""] * (max([max(pos) for pos in abstract_inverted.values()] + [0]) + 1)
                for word, positions in abstract_inverted.items():
                    for pos in positions:
                        words[pos] = word
                abstract_text = " ".join(words).lower()
                
                # Check for forensic hits
                hit_keywords = [kw for kw in FORENSIC_KEYWORDS if kw in abstract_text]
                
                if hit_keywords:
                    logging.info(f"🚨 SMOKING GUN FOUND in {year}: '{title}' (Hits: {hit_keywords})")
                    
                    evidence_id = f"evidence_{uuid.uuid4().hex[:6]}"
                    evidence_label = f"Doc [{year}]: {title[:40]}..."
                    
                    # Insert the Evidence Document as a node
                    cur.execute("INSERT INTO nodes (id, workspace, label, type, status) VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                                (evidence_id, 'Shadow_Museum_Atlas', evidence_label, 'evidence_document', 'ki-suggested'))
                    
                    # Link the Artifact to the Evidence
                    edge_id = f"trace_{uuid.uuid4().hex[:8]}"
                    cur.execute("INSERT INTO edges (id, workspace, source, target, year, quote, status) VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                                (edge_id, 'Shadow_Museum_Atlas', evidence_id, art_id, str(year), f"Keywords: {', '.join(hit_keywords)}", 'ki-suggested'))
                    new_nodes += 1
                else:
                    logging.info(f"    - Document '{title[:30]}...' analyzed. No forensic keywords found.")
                    
        except Exception as e:
            logging.error(f"API Error for {art_label}: {e}")
            
        time.sleep(1) # Polite API rate limiting
        
    conn.commit()
    cur.close()
    conn.close()
    
    logging.info(f"✅ Forensic sweep complete. {new_nodes} new Evidence Nodes secured.")

if __name__ == "__main__":
    forensic_search()
