import os
import sys
import uuid
import time
from PIL import Image
import psycopg2
from sentence_transformers import SentenceTransformer, util

def load_images(dropzone_dir):
    print("📸 Suche visuelle Beweise (Bilder) in der Dropzone...")
    image_paths = []
    
    if not os.path.exists(dropzone_dir):
        return image_paths
        
    for filename in os.listdir(dropzone_dir):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            filepath = os.path.join(dropzone_dir, filename)
            image_paths.append({
                "id": filename.replace(" ", "_"),
                "path": filepath,
                "label": filename,
                "type": "image_evidence"
            })
    return image_paths

def run_vision_lgnn():
    print("==============================================")
    print("   SHADOW MUSEUM - MULTIMODAL VISION LGNN     ")
    print("==============================================\n")
    
    workspace = os.environ.get('WORKSPACE', 'Shadow_Museum_Atlas')
    db_url = os.environ.get('DATABASE_URL', 'postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas')
    dropzone_dir = os.environ.get('DROPZONE_DIR', 'data_dropzone/workspaces/Shadow_Museum_Atlas/verified_research')
    similarity_threshold = 0.15 
    
    images = load_images(dropzone_dir)
    if not images:
        print("Keine Bilder gefunden. Lege ein paar .jpg Dateien in die Dropzone!")
        return

    print(f"✅ {len(images)} Bilder gefunden.")
    
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
    except Exception as e:
        print(f"❌ DB connection failed: {e}")
        return

    # 1. Bestehende Knoten laden
    cur.execute("SELECT id, label, type FROM nodes WHERE workspace = %s", (workspace,))
    nodes = [{"id": r[0], "label": r[1], "type": r[2]} for r in cur.fetchall()]
    
    # Wir matchen Bilder gegen alle echten Entitäten
    entity_nodes = [n for n in nodes if n.get("type") in ["entity", "archive", "person"]]
    
    if not entity_nodes:
        print("Keine Entitäten im Graphen für visuelles Matching.")
        return
        
    print("👁️ Starte Vision-KI (CLIP Modell)...")
    # Das CLIP Modell übersetzt Bilder und Texte in denselben Vektorraum!
    model = SentenceTransformer('clip-ViT-B-32')
    
    print("🌌 Berechne visuelle Schwerkraft...")
    
    # Text-Vektoren für die Knoten berechnen
    entity_texts = [n['label'] for n in entity_nodes]
    text_embeddings = model.encode(entity_texts, convert_to_tensor=True)
    
    # Bild-Vektoren für die Fotos berechnen
    pil_images = [Image.open(img["path"]) for img in images]
    image_embeddings = model.encode(pil_images, convert_to_tensor=True)
    
    # 3. Berechne Schwerkraft zwischen JEDER Entität und JEDEM Bild
    print("🔗 Verknüpfe visuelle Beweise mit historischen Texten...")
    cosine_scores = util.cos_sim(text_embeddings, image_embeddings)
    
    inserted_nodes = 0
    inserted_edges = 0
    
    for i, entity in enumerate(entity_nodes):
        for j, img in enumerate(images):
            score = cosine_scores[i][j].item()
            
            if score > similarity_threshold:
                filename = img["id"]
                
                # Insert Image Node
                try:
                    cur.execute("""
                        INSERT INTO nodes (id, workspace, label, type, status)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (workspace, id) DO NOTHING
                    """, (filename, workspace, filename, 'image_evidence', 'verified'))
                    if cur.rowcount > 0:
                        inserted_nodes += 1
                except Exception as e:
                    print(f"Node insert failed: {e}")
                
                # Edge zwischen Text-Knoten und Foto ziehen!
                edge_id = str(uuid.uuid4())
                try:
                    cur.execute("""
                        INSERT INTO edges (id, workspace, source, target, quote, file, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (workspace, id) DO NOTHING
                    """, (
                        edge_id,
                        workspace,
                        entity["id"],
                        filename,
                        f"Visueller Beweis (CLIP Score: {score:.3f})",
                        img["label"],
                        "suggested"
                    ))
                    if cur.rowcount > 0:
                        inserted_edges += 1
                except Exception as e:
                    print(f"Edge insert failed: {e}")

    conn.commit()
    cur.close()
    conn.close()
    
    print("\n==============================================")
    print(f"🏁 Multimodales Moodboard fertiggestellt!")
    print(f"{inserted_nodes} Bilder als Knoten in die Galaxie injiziert.")
    print(f"{inserted_edges} visuelle Verbindungen durch CLIP Schwerkraft entdeckt.")

if __name__ == "__main__":
    run_vision_lgnn()
