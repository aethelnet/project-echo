import json
import time
from transformers import pipeline

print("=============================================")
print("🤖 PHASE 29: ZERO-SHOT SEMANTIC TAGGER")
print("=============================================")

print("Lade mehrsprachiges Zero-Shot-Modell (mDeBERTa-v3-base)...")
start = time.time()
classifier = pipeline("zero-shot-classification", model="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
print(f"✅ Modell geladen in {time.time() - start:.2f}s\n")

LABELS = ["Gewalt", "Widerstand", "Handel", "Raub", "Diplomatie", "Alltag"]

print("Lade src/data.json...")
with open("src/data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

edges = data.get("edges", [])
unique_quotes = list(set(edge.get("quote", "") for edge in edges if len(edge.get("quote", "")) > 10))
print(f"Gefunden: {len(edges)} Kanten, aber nur {len(unique_quotes)} einzigartige Sätze.")

demo_quotes = unique_quotes[:50]
print(f"Starte Zero-Shot Inference für ein Test-Sample von {len(demo_quotes)} Sätzen...\n")

quote_to_tags = {}
for i, quote in enumerate(demo_quotes):
    try:
        res = classifier(quote, LABELS, multi_label=True)
        tags = [label for label, score in zip(res['labels'], res['scores']) if score > 0.6]
        quote_to_tags[quote] = tags
        if tags:
            print(f"[{','.join(tags)}] -> {quote[:80]}...")
    except Exception as e:
        print(f"Fehler bei Satz {i+1}: {e}")

