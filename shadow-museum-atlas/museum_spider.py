import os
import json
import time
import re
from playwright.sync_api import sync_playwright

GRAPH_FILE = "src/data.json"
SPIDER_OUTPUT_DIR = "data_dropzone/verified_research"
TRIAGE_KEYWORDS = ["Kamerun", "Kolonie", "Afrika", "Museum", "Sammlung", "Ethnologisch", "Schiff", "Expedition", "Raub", "Nso", "Bamum", "Pavel", "Glauning"]

def get_seeds_from_graph():
    print("🕸️ Lese Seeds für den Headless Deep-Dive...")
    if not os.path.exists(GRAPH_FILE): return []
    with open(GRAPH_FILE, 'r') as f: graph = json.load(f)
    seeds = []
    for node in graph.get("nodes", []):
        if node.get("status") == "verified" and node.get("type") in ["entity", "archive"]:
            label = node.get("label", "")
            clean_label = re.sub(r'\(.*?\)', '', label).strip()
            if 3 < len(clean_label) < 30: seeds.append(clean_label)
    return list(set(seeds))

def run_headless_spider():
    print("==============================================")
    print("   SHADOW MUSEUM - HEADLESS PLAYWRIGHT SPIDER ")
    print("==============================================\n")
    
    seeds = get_seeds_from_graph()
    
    with sync_playwright() as p:
        # Wir starten den Chromium-Browser im Headless-Modus
        # So können wir JS-heavy Museums-Datenbanken crawlen
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent="ShadowMuseum Research Crawler / Polite")
        page = context.new_page()
        
        found_count = 0
        triage_rejects = 0
        
        for seed in seeds:
            print(f"-> Deep-Scrape nach: '{seed}'...")
            
            try:
                # 1. Wir nutzen Wikipedia als Hub für echte Archiv-Links (References)
                search_url = f"https://de.wikipedia.org/w/index.php?search={seed}"
                page.goto(search_url, timeout=10000)
                
                # Wir suchen nach externen Links in den Fußnoten/Referenzen
                links = page.locator('ol.references a.external')
                target_url = None
                
                for i in range(links.count()):
                    url = links.nth(i).get_attribute('href')
                    if url and "archive.org" not in url and "google" not in url:
                        target_url = url
                        break
                
                if target_url:
                    print(f"   [PLAYWRIGHT] Öffne JS-gerenderte Seite: {target_url}")
                    # Hier glänzt Playwright: Es wartet, bis React/Vue/JS fertig gerendert haben
                    page.goto(target_url, timeout=15000, wait_until="domcontentloaded")
                    time.sleep(2) # Kurzer Puffer für nachladende Museumsbilder
                    
                    # Wir extrahieren den gesamten sichtbaren Text der Seite
                    page_text = page.locator("body").inner_text()
                    
                    # === TRIAGE LEVEL 1 (Filter) ===
                    text_lower = page_text.lower()
                    relevance_score = sum(1 for kw in TRIAGE_KEYWORDS if kw.lower() in text_lower)
                    
                    if relevance_score >= 2: # Etwas strenger beim echten Internet
                        filename = f"deep_scrape_{seed.replace(' ', '_')}.txt"
                        filepath = os.path.join(SPIDER_OUTPUT_DIR, filename)
                        
                        with open(filepath, 'w', encoding='utf-8') as f:
                            f.write(f"HEADLESS DEEP SCRAPE\nSEED: {seed}\nURL: {target_url}\n\n{page_text}")
                            
                        print(f"   [🟢 ACCEPTED] Headless Scrape erfolgreich (Score: {relevance_score}).")
                        found_count += 1
                    else:
                        print(f"   [🔴 REJECTED] Zu wenig Kontext auf Seite.")
                        triage_rejects += 1
                else:
                    print("   [LEER] Keine tiefen Archiv-Links gefunden.")
                    
            except Exception as e:
                print(f"   [FEHLER] Beim Crawlen blockiert oder Timeout.")
                
            time.sleep(3) # Polite Pause
            
        browser.close()
        
    print("\n==============================================")
    print(f"🏁 Headless Spider Run beendet.")
    print(f"🟢 {found_count} Javascript-gerenderte Archivtexte gesichert.")
    print("==============================================")

if __name__ == "__main__":
    run_headless_spider()
