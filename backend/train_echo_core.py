import torch
import torch.nn as nn
import torch.optim as optim
import os
import fitz  # PyMuPDF
from sentence_transformers import SentenceTransformer
import requests
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("Echo-Ouroboros")

from echo_lgnn_tensor import EchoProphitNet, liquid_entropy_loss

# Config
PDF_PATH = "/home/nikahrlyn/Downloads/arthistoricum-1219-978-3-98501-203-9.pdf"
WEIGHTS_PATH = "/home/nikahrlyn/auratic-systems-prime/backend/lgnn/weights/echo_tensor_core_v1.pth"
MET_SEARCH_URL = "https://collectionapi.metmuseum.org/public/collection/v1/search"
MET_OBJECT_URL = "https://collectionapi.metmuseum.org/public/collection/v1/objects/"

logger.info("Booting NLP Encoder...")
nlp_model = SentenceTransformer('all-MiniLM-L6-v2')
logger.info("Booting LGNN Tensor Core...")
lgnn_model = EchoProphitNet(embedding_dim=384)
optimizer = optim.Adam(lgnn_model.parameters(), lr=0.005)

def extract_seed_data(pdf_path, max_pages=150):
    logger.info(f"Extracting seed data from {pdf_path}...")
    positive_texts = []
    
    try:
        doc = fitz.open(pdf_path)
        for i in range(min(max_pages, len(doc))):
            text = doc[i].get_text("text").lower()
            sentences = text.replace('\n', ' ').split('.')
            for s in sentences:
                if any(kw in s for kw in ["strafexpedition", "raub", "looted", "punitive", "colonial", "kriegsbeute", "entwendet", "erobert", "beute"]):
                    if len(s) > 30:
                        positive_texts.append(s.strip())
        logger.info(f"Extracted {len(positive_texts)} seed sentences from PDF.")
    except Exception as e:
        logger.error(f"Could not read PDF: {e}")
        positive_texts = [
            "the artifact was looted during the punitive expedition of 1897 in benin.",
            "this mask was taken as spoils of war by colonial officers.",
            "kriegsbeute aus der kolonialzeit in kamerun.",
            "raubkunst entwendet während der strafexpedition."
        ]
        
    negative_texts = [
        "a beautiful roman coin from the 2nd century.",
        "byzantine mosaic fragment showing geometric patterns.",
        "a landscape painting from the dutch golden age.",
        "modernist sculpture created in paris in 1920."
    ]
    
    return positive_texts, negative_texts

def train_step(texts, labels, epochs=10):
    lgnn_model.train()
    if not texts:
        return
        
    logger.info(f"Encoding {len(texts)} samples into latent tensors...")
    vectors = nlp_model.encode(texts, convert_to_tensor=True).clone().detach()
    labels_tensor = torch.tensor(labels, dtype=torch.float32)
    
    loss_val = 0.0
    for epoch in range(epochs):
        optimizer.zero_grad()
        predictions = lgnn_model(vectors)
        loss = liquid_entropy_loss(predictions, labels_tensor)
        loss.backward()
        optimizer.step()
        loss_val = loss.item()
        
    logger.info(f"Training step complete. Final Loss: {loss_val:.4f}")
    return loss_val

def autonomous_hunter():
    logger.info("Autonomous Hunter fetching unlabelled artifacts from The Met...")
    try:
        resp = requests.get(f"{MET_SEARCH_URL}?q=africa&hasImages=true")
        search_resp = resp.json() if resp.status_code == 200 else {}
    except Exception:
        search_resp = {}
    object_ids = search_resp.get("objectIDs", [])[:40]
    
    new_texts = []
    new_labels = []
    lgnn_model.eval()
    
    for oid in object_ids:
        try:
            obj = requests.get(f"{MET_OBJECT_URL}{oid}").json()
            metadata = f"{obj.get('title','')} {obj.get('culture','')} {obj.get('provenance','')} {obj.get('country','')} {obj.get('creditLine','')}".lower()
            if len(metadata) < 10: continue
            
            vec = nlp_model.encode(metadata, convert_to_tensor=True).unsqueeze(0)
            with torch.no_grad():
                pred = lgnn_model(vec)
                confidence = pred[0][0].item()
                
                if confidence > 0.85:
                    logger.info(f"High confidence ({confidence*100:.1f}%) pseudo-label [POSITIVE]: {obj.get('title')}")
                    new_texts.append(metadata)
                    new_labels.append([1.0, 1.0, 1.0])
                elif confidence < 0.15:
                    new_texts.append(metadata)
                    new_labels.append([0.0, 0.0, 0.0])
                    
            time.sleep(0.1) # Be nice to API
        except Exception as e:
            pass
            
    return new_texts, new_labels

if __name__ == "__main__":
    os.makedirs(os.path.dirname(WEIGHTS_PATH), exist_ok=True)
    
    pos, neg = extract_seed_data(PDF_PATH)
    
    # Balance classes slightly if we got too many from the PDF
    if len(pos) > 50:
        pos = pos[:50]
        
    texts = pos + neg
    labels = [[1.0, 1.0, 1.0]] * len(pos) + [[0.0, 0.0, 0.0]] * len(neg)
    
    logger.info("Starting Phase 1: Seed Training from Atlas der Abwesenheit...")
    train_step(texts, labels, epochs=40)
    
    logger.info("Starting Phase 2: Autonomous Ouroboros Loop...")
    for cycle in range(3):
        logger.info(f"--- Ouroboros Cycle {cycle+1} ---")
        new_t, new_l = autonomous_hunter()
        if new_t:
            logger.info(f"Hunter acquired {len(new_t)} new training samples.")
            texts.extend(new_t)
            labels.extend(new_l)
            train_step(texts, labels, epochs=20) # Train on the aggregated dataset to avoid catastrophic forgetting
        else:
            logger.info("No confident pseudo-labels found in this cycle. Model needs more diverse seeds.")
            
    torch.save(lgnn_model.state_dict(), WEIGHTS_PATH)
    logger.info(f"Ouroboros Training Complete. Neural Weights saved to {WEIGHTS_PATH}")
