import os
import json
import urllib.parse
import urllib.request
import re

GRAPH_FILE = "data_dropzone/knowledge_graph.json"
SPIDER_OUTPUT_DIR = "data_dropzone/verified_research"

def get_seeds_from_graph():
    print("🕸️  Lese Seeds aus dem Atlas der Abwesenheit...")
    if not os.path.exists(GRAPH_FILE):
        print("Kein Graph gefunden. Bitte erst source_extractor.py ausführen.")
        return []
        
    with open(GRAPH_FILE, 'r') as f:
        graph = json.load(f)
        
    seeds = []
    for node in graph.get("nodes", []):
        # We only use verified nodes as seeds
        if node.get("status") == "verified":
            label = node.get("label", "")
            # Clean up the label for searching (remove brackets, etc)
            clean_label = re.sub(r'\(.*?\)', '', label).strip()
            # Ignore very long sentences or purely archival codes for this basic wiki spider
            if 3 < len(clean_label) < 30 and not "BArch" in clean_label:
                seeds.append(clean_label)
                
    return list(set(seeds)) # Deduplicate

def crawl_wikipedia(seed_term, context_term="Kamerun Kolonialzeit"):
    # We give the spider a "compass" (context) to orient itself on the atlas!
    search_query = f"{seed_term} {context_term}"
    url_search = f"https://de.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(search_query)}&utf8=&format=json"
    
    try:
        # Step 1: Full-text search to find the best matching article title
        req_search = urllib.request.Request(url_search, headers={'User-Agent': 'ShadowMuseumSpider/2.0'})
        with urllib.request.urlopen(req_search) as response:
            data = json.loads(response.read().decode())
            search_results = data.get('query', {}).get('search', [])
            
            if not search_results:
                return None
                
            # Take the best match title
            best_title = search_results[0]['title']
            print(f"      [KOMPASS] Richtet Fokus auf Artikel: '{best_title}'")
            
            # Step 2: Fetch the actual text of that article
            url_extract = f"https://de.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=10&exlimit=1&titles={urllib.parse.quote(best_title)}&explaintext=1&format=json"
            req_extract = urllib.request.Request(url_extract, headers={'User-Agent': 'ShadowMuseumSpider/2.0'})
            
            with urllib.request.urlopen(req_extract) as response2:
                data2 = json.loads(response2.read().decode())
                pages = data2['query']['pages']
                for page_id in pages:
                    if page_id != "-1":
                        extract = pages[page_id].get('extract', '')
                        if extract:
                            return extract
    except Exception as e:
        print(f"Fehler beim Crawlen von {seed_term}: {e}")
    return None

def run_spider():
    print("==============================================")
    print("    SHADOW MUSEUM - SEED-DRIVEN SPIDER        ")
    print("==============================================")
    
    seeds = get_seeds_from_graph()
    print(f"✅ {len(seeds)} organische Suchbegriffe aus dem Atlas extrahiert.")
    
    # We don't want to spam Wikipedia, so we just take the first 5 seeds for this run
    target_seeds = seeds[:5]
    print(f"🕸️  Spider startet autonome Suche für: {', '.join(target_seeds)}")
    
    found_count = 0
    for seed in target_seeds:
        print(f"   -> Crawle Datenbanken nach: '{seed}'...")
        result_text = crawl_wikipedia(seed)
        
        if result_text:
            filename = f"spider_crawl_{seed.replace(' ', '_')}.txt"
            filepath = os.path.join(SPIDER_OUTPUT_DIR, filename)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(f"AUTONOMOUS SPIDER CRAWL\nSEED: {seed}\n\n{result_text}")
                
            print(f"      [TREFFER] Dokument gespeichert: {filename}")
            found_count += 1
        else:
            print(f"      [LEER] Keine offenen Dokumente gefunden.")
            
    print("==============================================")
    print(f"🏁 Spider Run beendet. {found_count} neue Dokumente in die Dropzone gelegt.")
    print("Führe nun start_shadow_museum.sh aus, um die neuen Texte vom NLP parsen zu lassen!")

if __name__ == "__main__":
    run_spider()
