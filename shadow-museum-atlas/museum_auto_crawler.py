import time
import logging
import psycopg2
import uuid
import random
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [AUTO-CRAWLER] %(message)s')

DATABASE_URL = "postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas"

class MuseumAutoCrawler:
    def __init__(self):
        self.conn = psycopg2.connect(DATABASE_URL)
        logging.info("🧠 Auto-Crawler connected to Shadow Museum Database.")

    def crawl_night_shift(self):
        logging.info("🌙 Initiating Night Shift Protocol: Deep Web Reconnaissance...")
        
        cur = self.conn.cursor()
        
        cur.execute("SELECT id, label FROM nodes WHERE type = 'artifact' LIMIT 5;")
        artifacts = cur.fetchall()
        
        if not artifacts:
            logging.info("No artifacts found to cross-reference.")
            return

        logging.info(f"📚 Found {len(artifacts)} anchor artifacts. Querying global knowledge graphs (OpenAlex API)...")
        
        new_nodes = []
        new_edges = []
        
        for art_id, art_label in artifacts:
            logging.info(f"🔎 Scanning OpenAlex for scientific literature on: {art_label}...")
            
            try:
                query = art_label.replace(' ', '+')
                res = requests.get(f"https://api.openalex.org/works?search={query}&per-page=1", timeout=5)
                data = res.json()
                
                if data.get('results') and len(data['results']) > 0:
                    paper = data['results'][0]
                    paper_title = paper.get('title', 'Unknown Paper')
                    author_name = paper.get('authorships', [{}])[0].get('author', {}).get('display_name', 'Unknown Researcher')
                    
                    logging.info(f"💡 OPENALEX HIT! Found Paper: '{paper_title[:50]}...' by {author_name}")
                    
                    discovered_id = f"author_{uuid.uuid4().hex[:6]}"
                    new_nodes.append((discovered_id, 'Shadow_Museum_Atlas', author_name, 'person', 'ki-suggested'))
                    
                    edge_id = f"link_{uuid.uuid4().hex[:8]}"
                    new_edges.append((edge_id, 'Shadow_Museum_Atlas', discovered_id, art_id, '2023', f"OpenAlex Source: {paper_title[:40]}", 'ki-suggested'))
                else:
                    logging.info(f"⚪ No OpenAlex literature found for {art_label}.")
            except Exception as e:
                logging.error(f"❌ OpenAlex API Error: {e}")
            
            time.sleep(1)

        # Insert new suggested nodes
        for node in new_nodes:
            try:
                cur.execute("INSERT INTO nodes (id, workspace, label, type, status) VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", node)
            except Exception as e:
                pass
                
        # Insert new suggested edges
        for edge in new_edges:
            try:
                cur.execute("INSERT INTO edges (id, workspace, source, target, year, quote, status) VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", edge)
            except Exception as e:
                pass
                
        self.conn.commit()
        cur.close()
        
        logging.info(f"✅ Night Shift complete. {len(new_nodes)} new Ghost-Nodes injected into the Atlas for Historian Verification.")

if __name__ == "__main__":
    crawler = MuseumAutoCrawler()
    crawler.crawl_night_shift()
