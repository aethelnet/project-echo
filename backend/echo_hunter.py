import time
import requests
import json
import random
import os

# Autonomous Hunter Configuration
ECHO_API_URL = "http://127.0.0.1:5000/trace"
LOG_FILE = os.path.join(os.path.dirname(__file__), "hunter_database.json")

# Hunt Topics (Target regions and cultures for restitution)
HUNT_TARGETS = [
    "Benin", "Edo", "Cameroon", "Nso", "Bamum", "Ashanti", 
    "Ghana", "Togo", "Namibia", "Herero", "Maori", "Rapa Nui"
]

def load_db():
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r') as f:
            try:
                return json.load(f)
            except:
                return []
    return []

def save_db(db):
    with open(LOG_FILE, 'w') as f:
        json.dump(db, f, indent=4)

def run_hunter_loop():
    print("🦅 [Project Echo] Autonomous Hunter Daemon initialized.")
    print(f"🎯 Targets loaded: {len(HUNT_TARGETS)} regions/cultures.")
    
    database = load_db()
    known_ids = {item['id'] for item in database}
    
    while True:
        target = random.choice(HUNT_TARGETS)
        print(f"\n🔍 [HUNTER] Deploying autonomous trace for target: '{target}'...")
        
        try:
            # Command the Echo Engine to run a trace
            res = requests.get(f"{ECHO_API_URL}?q={target}", timeout=20)
            if res.status_code == 200:
                data = res.json()
                results = data.get("results", [])
                
                if results:
                    print(f"✅ [HUNTER] Trace complete. Found {len(results)} artifacts.")
                    new_discoveries = 0
                    
                    for artifact in results:
                        conf = artifact.get("confidence", 0)
                        art_id = artifact.get("id")
                        title = artifact.get("title", "Unknown")
                        
                        # Only log high-confidence looted items that we haven't seen yet
                        if conf > 80.0 and art_id not in known_ids:
                            print(f"🚨 [NEW DISCOVERY] {title} (Confidence: {conf:.1f}%)")
                            database.append(artifact)
                            known_ids.add(art_id)
                            new_discoveries += 1
                            
                    if new_discoveries > 0:
                        save_db(database)
                        print(f"💾 [HUNTER] Database updated. Total recorded artifacts: {len(database)}")
                else:
                    print(f"👻 [HUNTER] No artifacts found for '{target}'.")
            else:
                print(f"⚠️ [HUNTER] Echo Engine returned status code {res.status_code}")
                
        except Exception as e:
            print(f"❌ [HUNTER] Trace failed: {e}")
            
        # Wait before next hunt to avoid rate limits
        sleep_time = random.randint(15, 30)
        print(f"💤 [HUNTER] Sleeping for {sleep_time} seconds before next trace...")
        time.sleep(sleep_time)

if __name__ == "__main__":
    run_hunter_loop()
