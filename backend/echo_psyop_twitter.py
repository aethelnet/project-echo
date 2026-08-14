import os
import json
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Echo-PsyOp")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HUNTER_DB_PATH = os.path.join(BASE_DIR, "hunter_database.json")
TWEETED_IDS_PATH = os.path.join(BASE_DIR, "tweeted_ids.txt")
PSYOP_DRAFTS_PATH = os.path.join(BASE_DIR, "psyop_drafts.json")

def load_hunter_db(filepath=HUNTER_DB_PATH):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return []

def load_tweeted_ids(filepath=TWEETED_IDS_PATH):
    if not os.path.exists(filepath):
        return set()
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return {line.strip() for line in f if line.strip()}
    except:
        return set()

def save_tweeted_ids(tweeted_ids, filepath=TWEETED_IDS_PATH):
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            for art_id in sorted(tweeted_ids):
                f.write(f"{art_id}\n")
    except:
        pass

def load_existing_drafts(filepath=PSYOP_DRAFTS_PATH):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return []

def save_psyop_drafts(drafts, filepath=PSYOP_DRAFTS_PATH):
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(drafts, f, indent=4, ensure_ascii=False)
        logger.info(f"💾 Saved {len(drafts)} drafts to {filepath}")
    except:
        pass

def generate_restitution_tweet(artifact):
    title = artifact.get("title", "Unknown Artifact")
    confidence = float(artifact.get("confidence", 0.0))
    
    repository = artifact.get("repository")
    if not repository:
        credit = artifact.get("creditLine", "")
        if credit:
            repository = f"Metropolitan Museum of Art ({credit})"
        else:
            repository = "Metropolitan Museum of Art"
            
    provenance = artifact.get("provenance")
    if not provenance:
        origin = artifact.get("origin", "")
        if origin and origin != "Unknown":
            provenance = f"Colonial acquisition from {origin}"
        else:
            provenance = "19th Century Colonial Expedition"
            
    tweet = (
        f"ALERT: {title} located at {repository}. "
        f"Stolen during {provenance}. "
        f"The LGNN confidence for colonial looting is {confidence:.1f}%. "
        f"#RestitutionNow #ProjectEcho"
    )
    return tweet, repository, provenance

def run_psyop_campaign(confidence_threshold=90.0):
    print("📢 [Project Echo] Initializing Social Engineering / PsyOp Campaign Module...")
    
    artifacts = load_hunter_db()
    tweeted_ids = load_tweeted_ids()
    existing_drafts = load_existing_drafts()
    
    pending_artifacts = []
    for item in artifacts:
        art_id = str(item.get("id"))
        conf = float(item.get("confidence", 0.0))
        if conf > confidence_threshold and art_id not in tweeted_ids:
            pending_artifacts.append(item)
            
    print(f"🔍 Found {len(pending_artifacts)} high-confidence artifact(s) awaiting restitution tweets.")
    
    if not pending_artifacts:
        print("✅ No new high-confidence artifacts to tweet at this time.")
        return existing_drafts

    new_drafts = []
    for artifact in pending_artifacts:
        art_id = str(artifact.get("id"))
        conf = float(artifact.get("confidence", 0.0))
        tweet_text, repo, prov = generate_restitution_tweet(artifact)
        
        draft_record = {
            "id": art_id,
            "title": artifact.get("title", "Unknown"),
            "confidence": conf,
            "repository": repo,
            "provenance": prov,
            "tweet": tweet_text,
            "url": artifact.get("url", ""),
            "image": artifact.get("image", ""),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
        print("\n" + "=" * 60)
        print(f"🚀 [MOCK TWITTER POST] Tweet ID #{art_id}")
        print(f"📝 Text: {tweet_text}")
        print("=" * 60)
        
        new_drafts.append(draft_record)
        tweeted_ids.add(art_id)

    all_drafts = existing_drafts + new_drafts
    save_psyop_drafts(all_drafts)
    save_tweeted_ids(tweeted_ids)
    
    print(f"🎉 PsyOp Campaign cycle complete. {len(new_drafts)} new restitution tweet(s) deployed.")
    return all_drafts

if __name__ == "__main__":
    run_psyop_campaign()
