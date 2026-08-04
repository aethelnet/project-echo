import asyncio
import logging
import requests
import torch
from sentence_transformers import SentenceTransformer
import sys
import os

# Ensure backend modules can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from backend.services.echo_lgnn_tensor import EchoProphitNet

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("Echo-OSINT")

class EchoOsintHarvester:
    def __init__(self):
        self.europe_pmc_api = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
        
    def hunt_restitution_papers(self, query):
        logger.info(f"[OSINT] Hunting for restitution papers on '{query}'...")
        params = {
            "query": f'("{query}" AND "restitution" AND "colonial")',
            "format": "json",
            "resultType": "lite"
        }
        try:
            resp = requests.get(self.europe_pmc_api, params=params, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("resultList", {}).get("result", [])
                logger.info(f"[OSINT] Found {len(results)} scientific papers for '{query}'.")
                return results
        except Exception as e:
            logger.error(f"EuropePMC API failed: {e}")
        return []

async def run_osint_swarm():
    harvester = EchoOsintHarvester()
    
    logger.info("Initializing NLP Oracle & LGNN Tensor Core for OSINT...")
    nlp_model = SentenceTransformer('all-MiniLM-L6-v2')
    lgnn_model = EchoProphitNet(embedding_dim=384)
    lgnn_model.eval()
    
    while True:
        # Example queries for the hunter
        queries = ["Benin Bronze", "Ngonnso", "Kuba Ndop"]
        for q in queries:
            papers = harvester.hunt_restitution_papers(q)
            for p in papers[:3]:
                # Combine title and abstract for the Tensor Embedding
                paper_text = f"{p.get('title', '')} {p.get('abstractText', '')}".lower()
                
                if len(paper_text) > 20:
                    vector = nlp_model.encode(paper_text, convert_to_tensor=True)
                    with torch.no_grad():
                        prediction = lgnn_model(vector.unsqueeze(0))
                        confidence = prediction[0][0].item() * 100.0
                else:
                    confidence = 0.0
                
                # Only inject high-confidence vectors into the graph
                if confidence > 65.0:
                    logger.info(f"💥 [PROVENANCE NODE AQUIRED] Conf: {confidence:.1f}% | {p.get('title')} | Journal: {p.get('journalTitle')}")
                else:
                    logger.info(f"👻 [NOISE FILTERED] Conf: {confidence:.1f}% | {p.get('title')[:40]}...")
                    
        logger.info("[OSINT] Swarm returning to sleep (300s)...")
        await asyncio.sleep(300)

if __name__ == "__main__":
    print("🕸️ Starting Project Echo OSINT Swarm")
    asyncio.run(run_osint_swarm())
