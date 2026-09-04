import json
import time
from playwright.sync_api import sync_playwright

GRAPH_FILE = "src/data.json"

def run_spider_loop():
    print("==============================================")
    print("   SHADOW MUSEUM - SPIDER INJECTION LOOP      ")
    print("==============================================\n")
    
    # 1. Graphen laden
    with open(GRAPH_FILE, 'r', encoding='utf-8') as f:
        graph = json.load(f)
        
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    
    # 2. Die Top Hubs (wichtigsten Knoten) finden
    degree_map = {}
    for edge in edges:
        s = edge["source"]
        t = edge["target"]
        degree_map[s] = degree_map.get(s, 0) + 1
        degree_map[t] = degree_map.get(t, 0) + 1
        
    # Sort nodes by degree descending
    sorted_nodes = sorted(nodes, key=lambda x: degree_map.get(x["id"], 0), reverse=True)
    
    # Wir nehmen die Top 5 für diesen Lauf, die noch keine URL haben
    target_nodes = [n for n in sorted_nodes if "url" not in n][:5]
    
    if not target_nodes:
        print("Alle Top-Knoten haben bereits Quellen verknüpft!")
        return

    print(f"🕸️ Starte Headless-Crawl für {len(target_nodes)} Top-Entitäten...\n")
    
    updated_count = 0
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        
        for node in target_nodes:
            seed = node["label"]
            print(f"-> Scrape nach digitalen Spuren für: '{seed}'...")
            
            try:
                # Suche über Wikipedia (historisch zuverlässig)
                search_url = f"https://de.wikipedia.org/w/index.php?search={seed}"
                page.goto(search_url, timeout=15000)
                
                # Wir suchen nach externen Links in den Fußnoten/Referenzen
                links = page.locator('ol.references a.external')
                target_url = None
                
                for i in range(links.count()):
                    url = links.nth(i).get_attribute('href')
                    if url and "archive.org" not in url and "google" not in url:
                        target_url = url
                        break
                
                if target_url:
                    print(f"   [🟢 LINK FOUND] {target_url}")
                    # Update Node!
                    node["url"] = target_url
                    node["source"] = "Automatisch durch Spider verknüpft."
                    node["status"] = "verified"
                    updated_count += 1
                else:
                    print("   [🔴 LEER] Keine tiefen Archiv-Links auf Wikipedia gefunden.")
                    
            except Exception as e:
                print(f"   [⚠️ ERROR] {str(e)}")
                
            time.sleep(2) # Politeness Delay
            
        browser.close()

    if updated_count > 0:
        with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
            json.dump(graph, f, indent=2, ensure_ascii=False)
        print(f"\n✅ {updated_count} Knoten erfolgreich mit Archiv-Links injiziert.")
        print("Die UI zeigt die klickbaren URLs jetzt im Inspektor an!")
    else:
        print("\nKeine neuen Updates für den Graphen.")

if __name__ == "__main__":
    run_spider_loop()
