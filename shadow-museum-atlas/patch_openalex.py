import re

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/museum_auto_crawler.py', 'r') as f:
    crawler = f.read()

new_logic = """        import requests
        import uuid
        
        logging.info(f"📚 Found {len(artifacts)} anchor artifacts. Querying global knowledge graphs (OpenAlex API)...")
        
        new_nodes = []
        new_edges = []
        
        for art_id, art_label in artifacts:
            logging.info(f"🔎 Scanning OpenAlex for scientific literature on: {art_label}...")
            
            try:
                # Query OpenAlex for scientific papers mentioning the artifact
                query = art_label.replace(' ', '+')
                res = requests.get(f"https://api.openalex.org/works?search={query}&per-page=1", timeout=5)
                data = res.json()
                
                if data.get('results') and len(data['results']) > 0:
                    paper = data['results'][0]
                    paper_title = paper.get('title', 'Unknown Paper')
                    author_name = paper.get('authorships', [{}])[0].get('author', {}).get('display_name', 'Unknown Researcher')
                    
                    logging.info(f"💡 OPENALEX HIT! Found Paper: '{paper_title[:50]}...' by {author_name}")
                    
                    # Create the author as a new node
                    discovered_id = f"author_{uuid.uuid4().hex[:6]}"
                    new_nodes.append((discovered_id, 'Shadow_Museum_Atlas', author_name, 'person', 'ki-suggested'))
                    
                    # Link the author to the artifact
                    edge_id = f"link_{uuid.uuid4().hex[:8]}"
                    new_edges.append((edge_id, 'Shadow_Museum_Atlas', discovered_id, art_id, '2023', f"OpenAlex Source: {paper_title[:40]}", 'ki-suggested'))
                else:
                    logging.info(f"⚪ No OpenAlex literature found for {art_label}.")
            except Exception as e:
                logging.error(f"❌ OpenAlex API Error: {e}")
            
            time.sleep(1) # Respect API rate limits"""

crawler = re.sub(r'logging.info\(f"📚 Found.*?time\.sleep\(1\)', new_logic, crawler, flags=re.DOTALL)

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/museum_auto_crawler.py', 'w') as f:
    f.write(crawler)

print("OpenAlex API Integration Complete!")
