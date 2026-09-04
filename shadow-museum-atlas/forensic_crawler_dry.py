import requests
import uuid
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [FORENSICS] %(message)s')

FORENSIC_KEYWORDS = ["provenance", "looted", "plundered", "expedition", "private collection", "archive", "restitution", "repatriation", "colonial", "stolen"]

def forensic_search():
    logging.info("🕵️ Initiating Forensic OSINT Crawler (Dry-Run Mode)")
    
    artifacts = [
        ("art_001", "Benin Bronze"),
        ("art_002", "Maqdala treasure"),
        ("art_003", "Parthenon Marbles")
    ]
    
    for art_id, art_label in artifacts:
        logging.info(f"\n=======================================================")
        logging.info(f"🔎 Tracing data shadow for artifact: {art_label}")
        logging.info(f"=======================================================")
        
        query = art_label.replace(' ', '+')
        url = f"https://api.openalex.org/works?search={query}&filter=has_abstract:true&per-page=5"
        
        try:
            res = requests.get(url, timeout=10).json()
            results = res.get('results', [])
            
            if not results:
                logging.info(f"⚪ No traces found.")
                continue
                
            for paper in results:
                title = paper.get('title', 'Unknown Document')
                year = paper.get('publication_year', 'Unknown')
                abstract_inverted = paper.get('abstract_inverted_index', {})
                
                words = [""] * (max([max(pos) for pos in abstract_inverted.values()] + [0]) + 1)
                for word, positions in abstract_inverted.items():
                    for pos in positions:
                        words[pos] = word
                abstract_text = " ".join(words).lower()
                
                hit_keywords = [kw for kw in FORENSIC_KEYWORDS if kw in abstract_text]
                
                if hit_keywords:
                    logging.info(f"🚨 SMOKING GUN FOUND in {year}:")
                    logging.info(f"   📄 '{title}'")
                    logging.info(f"   🔑 Keywords Matched: {hit_keywords}")
                    logging.info(f"   🔗 Action: Generated Evidence Node -> [Linked to {art_label}]")
                else:
                    logging.info(f"   - Ignored (Clean): '{title[:50]}...'")
                    
        except Exception as e:
            logging.error(f"API Error: {e}")
            
        time.sleep(1.5)

if __name__ == "__main__":
    forensic_search()
