import os
import json
import urllib.parse
import urllib.request
import re
import time

GRAPH_FILE = "src/data.json"
SPIDER_OUTPUT_DIR = "data_dropzone/verified_research"
# Triage-Filter: Wir speichern nur Texte, die diese Signalwörter enthalten
TRIAGE_KEYWORDS = ["Kamerun", "Kolonie", "Afrika", "Museum", "Sammlung", "Ethnologisch", "Schiff", "Expedition", "Raub", "Nso", "Bamum"]

def get_seeds_from_graph():
    print("🕸️ Lese Seeds aus der Galaxie...")
    if not os.path.exists(GRAPH_FILE):
        return []
        
    with open(GRAPH_FILE, 'r') as f:
        graph = json.load(f)
        
    seeds = []
    for node in graph.get("nodes", []):
        if node.get("status") == "verified" and node.get("type") in ["entity", "archive"]:
            label = node.get("label", "")
            clean_label = re.sub(r'\(.*?\)', '', label).strip()
            if 3 < len(clean_label) < 30:
                seeds.append(clean_label)
                
    return list(set(seeds))

def crawl_wikipedia(seed_term, context_term="Kamerun Kolonialzeit"):
    search_query = f"{seed_term} {context_term}"
    url_search = f"https://de.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(search_query)}&utf8=&format=json"
    
    try:
        req_search = urllib.request.Request(url_search, headers={'User-Agent': 'ShadowMuseumSpider/3.0 (Polite)'})
        with urllib.request.urlopen(req_search) as response:
            data = json.loads(response.read().decode())
            search_results = data.get('query', {}).get('search', [])
            
            if not search_results:
                return None
                
            best_title = search_results[0]['title']
            
            # Rate Limiting: 2 Sekunden Pause, um nicht geblockt zu werden!
            time.sleep(2)
            
            url_extract = f"https://de.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=10&exlimit=1&titles={urllib.parse.quote(best_title)}&explaintext=1&format=json"
            req_extract = urllib.request.Request(url_extract, headers={'User-Agent': 'ShadowMuseumSpider/3.0 (Polite)'})
            
            with urllib.request.urlopen(req_extract) as response2:
                data2 = json.loads(response2.read().decode())
                pages = data2['query']['pages']
                for page_id in pages:
                    if page_id != "-1":
                        return pages[page_id].get('extract', '')
    except Exception as e:
        print(f"Fehler: {e}")
    return None

def run_pimped_spider():
    print("==============================================")
    print("   SHADOW MUSEUM - PIMPED TRIAGE SPIDER       ")
    print("==============================================\n")
    
    seeds = get_seeds_from_graph()
    print(f"✅ {len(seeds)} organische Suchbegriffe gefunden.")
    
    found_count = 0
    triage_rejects = 0
    
    for seed in seeds:
        print(f"-> Crawle nach: '{seed}'...")
        result_text = crawl_wikipedia(seed)
        
        if result_text:
            # === TRIAGE LEVEL 1 (Filter) ===
            # Wir prüfen, ob der Text überhaupt historisch relevant ist
            text_lower = result_text.lower()
            relevance_score = sum(1 for kw in TRIAGE_KEYWORDS if kw.lower() in text_lower)
            
            if relevance_score >= 1:
                filename = f"spider_crawl_{seed.replace(' ', '_')}.txt"
                filepath = os.path.join(SPIDER_OUTPUT_DIR, filename)
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(f"AUTONOMOUS SPIDER CRAWL\nSEED: {seed}\n\n{result_text}")
                    
                print(f"   [🟢 ACCEPTED] Relevanz-Score: {relevance_score}. Gespeichert.")
                found_count += 1
            else:
                print(f"   [🔴 REJECTED] Müll gefiltert (Keine historischen Keywords).")
                triage_rejects += 1
                
        # Rate Limiting (Polite Crawler)
        time.sleep(1)
            
    print("\n==============================================")
    print(f"🏁 Spider Run beendet.")
    print(f"🟢 {found_count} wertvolle historische Dokumente gesichert.")
    print(f"🔴 {triage_rejects} irrelevante Artikel automatisch verworfen.")
    print("==============================================")

if __name__ == "__main__":
    run_pimped_spider()
