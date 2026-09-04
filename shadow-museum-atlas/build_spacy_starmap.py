import json
import spacy
import re
import os
import glob
from collections import defaultdict

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

# Lade das deutsche NLP Modell
nlp = spacy.load("de_core_news_sm")
nlp.max_length = 2000000 

DROPZONE_DIR = os.environ.get("DROPZONE_DIR", "data_dropzone/verified_research")
OUTPUT_FILE = os.environ.get("OUTPUT_FILE", "src/data.json")

def process_corpus():
    print("==============================================")
    print("   SHADOW MUSEUM - SPACY NLP ENGINE           ")
    print("==============================================\n")
    
    pages = []
    
    processed_str = os.environ.get("PROCESSED_FILES", "")
    processed_files = set(processed_str.split(",")) if processed_str else set()
    
    # helper func to filter
    def get_unprocessed(pattern):
        return [f for f in glob.glob(os.path.join(DROPZONE_DIR, pattern)) if os.path.basename(f) not in processed_files]

    pdf_files = get_unprocessed("*.pdf")
    xlsx_files = get_unprocessed("*.xlsx")
    csv_files = get_unprocessed("*.csv")
    docx_files = get_unprocessed("*.docx")
    txt_files = get_unprocessed("*.txt")
    
    processed_this_run = [os.path.basename(f) for f in pdf_files + xlsx_files + csv_files + docx_files + txt_files]
    
    if txt_files:
        print(f"📝 {len(txt_files)} Text-Datei(en) gefunden! Lese Text...")
        for txt_file in txt_files:
            filename = os.path.basename(txt_file)
            try:
                with open(txt_file, 'r', encoding='utf-8') as f:
                    text = f.read()
                    for p in text.split('\n\n'):
                        if len(p.strip()) > 10:
                            pages.append((p, 1, filename))
            except Exception as e:
                print(f"Fehler beim Lesen von {filename}: {e}")
                
    if HAS_DOCX and docx_files:
        print(f"📄 {len(docx_files)} Word(.docx) Datei(en) gefunden! Lese Absätze...")
        for docx_file in docx_files:
            filename = os.path.basename(docx_file)
            try:
                doc = docx.Document(docx_file)
                for i, para in enumerate(doc.paragraphs):
                    if len(para.text.strip()) > 10:
                        pages.append((para.text, i + 1, filename))
            except Exception as e:
                print(f"Fehler beim Lesen von {filename}: {e}")

    if HAS_PYPDF and pdf_files:
        print(f"📑 {len(pdf_files)} PDF(s) gefunden! Lese Seiten aus...")
        for pdf_file in pdf_files:
            filename = os.path.basename(pdf_file)
            try:
                reader = pypdf.PdfReader(pdf_file)
                for i, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    for p in text.split('\n\n'):
                        if len(p.strip()) > 10:
                            pages.append((p, i + 1, filename))
            except Exception as e:
                print(f"Fehler beim Lesen von {filename}: {e}")
    
    if HAS_PANDAS and xlsx_files:
        print(f"📊 {len(xlsx_files)} Excel(.xlsx) Datei(en) gefunden! Lese Zeilen aus...")
        for xlsx_file in xlsx_files:
            filename = os.path.basename(xlsx_file)
            try:
                df = pd.read_excel(xlsx_file)
                for i, row in df.iterrows():
                    row_text = " | ".join([str(val) for val in row.values if pd.notna(val)])
                    if len(row_text.strip()) > 10:
                        pages.append((row_text, i + 1, filename))
            except Exception as e:
                print(f"Fehler beim Lesen von {filename}: {e}")

    if HAS_PANDAS and csv_files:
        print(f"📊 {len(csv_files)} CSV Datei(en) gefunden! Lese Zeilen aus...")
        for csv_file in csv_files:
            filename = os.path.basename(csv_file)
            try:
                df = pd.read_csv(csv_file)
                for i, row in df.iterrows():
                    row_text = " | ".join([str(val) for val in row.values if pd.notna(val)])
                    if len(row_text.strip()) > 10:
                        pages.append((row_text, i + 1, filename))
            except Exception as e:
                print(f"Fehler beim Lesen von {filename}: {e}")
                
    if not pages:
        print("⚠️ Keine verarbeitbaren Dokumente gefunden.")
        return
            
    print(f"📖 {len(pages)} Abschnitte geladen. Starte SpaCy Pipeline...")
    
    page_texts = [p[0] for p in pages]
    page_nums = [p[1] for p in pages]
    file_names = [p[2] for p in pages]
    
    sentences_with_context = []
    # nlp.pipe is highly RAM efficient
    for doc, page_num, fname in zip(nlp.pipe(page_texts, batch_size=50), page_nums, file_names):
        for sent in doc.sents:
            sentences_with_context.append((sent, page_num, fname))
            
    print(f"✅ {len(sentences_with_context)} Sätze mit SpaCy NLP extrahiert.")
    print("🧠 Analysiere Entitäten und Zeitstempel...")

    nodes_dict = {}
    edges_list = []
    edge_set = set()
    
    year_regex = re.compile(r'\b(18\d{2}|19\d{2})\b')
    
    # TWO-PASS ENTITY EXTRACTION: First pass to find full names for Coreference Resolution
    full_person_names = set()
    for sent, _, _ in sentences_with_context:
        for ent in sent.ents:
            if ent.label_ == "PER":
                name = re.sub(r'^[^\w]+|[^\w]+$', '', ent.text.strip())
                if len(name.split()) > 1:
                    full_person_names.add(name)
                    
    def resolve_coreference(label, e_type):
        if e_type == "person" and len(label.split()) == 1:
            for full_name in full_person_names:
                if label in full_name:
                    return full_name
        return label

    for i, (sent, page_num, fname) in enumerate(sentences_with_context):
        if i % 1000 == 0 and i > 0:
            print(f"   ... {i}/{len(sentences_with_context)} Sätze verarbeitet")
            
        sent_text = sent.text.strip()
        if not sent_text:
            continue
            
        entities = []
        for ent in sent.ents:
            if ent.label_ in ["PER", "LOC", "ORG"]:
                label = ent.text.strip()
                label = re.sub(r'^[^\w]+|[^\w]+$', '', label)
                
                if len(label) < 3: continue
                
                e_type = "uncategorized"
                if ent.label_ == "PER": e_type = "person"
                elif ent.label_ == "LOC": e_type = "location"
                elif ent.label_ == "ORG": e_type = "archive"
                
                if "Ngonnso" in label or "Thron" in label or "Statue" in label:
                    e_type = "artifact"
                    
                # Coreference Resolution: "Glauning" -> "Hans Glauning"
                label = resolve_coreference(label, e_type)
                    
                entities.append({"id": label, "type": e_type})
                
                if label not in nodes_dict:
                    nodes_dict[label] = {
                        "id": label,
                        "label": label,
                        "types": defaultdict(int),
                        "status": "verified"
                    }
                nodes_dict[label]["types"][e_type] += 1

        match = year_regex.search(sent_text)
        year = int(match.group(1)) if match else None

        for idx in range(len(entities)):
            for j in range(idx + 1, len(entities)):
                s = entities[idx]["id"]
                t = entities[j]["id"]
                if s == t: continue
                
                s, t = min(s, t), max(s, t)
                edge_id = f"{s}_{t}_{year}"
                
                if edge_id not in edge_set:
                    edge_set.add(edge_id)
                    edges_list.append({
                        "id": edge_id,
                        "source": s,
                        "target": t,
                        "year": year,
                        "page": page_num,
                        "quote": sent_text,
                        "status": "verified",
                        "file": fname
                    })

    # Vote for the most frequent type for each node to fix SpaCy misclassifications
    for label, node in nodes_dict.items():
        if len(node["types"]) > 1 and "uncategorized" in node["types"]:
            del node["types"]["uncategorized"]
        
        if "Ngonnso" in label or "Thron" in label or "Statue" in label:
            node["type"] = "artifact"
        else:
            best_type = max(node["types"].items(), key=lambda x: x[1])[0]
            node["type"] = best_type
        
        del node["types"]


    # Noise Filter: Wir behalten nur Knoten, die mindestens 2 Kanten haben, um den Graphen sofort nutzbar zu machen.
    degree = defaultdict(int)
    for edge in edges_list:
        degree[edge["source"]] += 1
        degree[edge["target"]] += 1
        
    kept_nodes = [n for n in nodes_dict.values() if degree[n["id"]] >= 2 or n["id"] == "Kumbo"]
    kept_node_ids = {n["id"] for n in kept_nodes}
    
    kept_edges = [e for e in edges_list if e["source"] in kept_node_ids and e["target"] in kept_node_ids]

    # Speichern
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "nodes": kept_nodes, 
            "edges": kept_edges,
            "processed_files": processed_this_run
        }, f, indent=2, ensure_ascii=False)

    print(f"\n🚀 SPACY ENGINE FERTIG!")
    print(f"Knoten (gefiltert): {len(kept_nodes)}")
    print(f"Kanten: {len(kept_edges)}")
    print("Das Fundament ist jetzt extrem sauber und enthält Zeitstempel (Jahreszahlen)!")

if __name__ == "__main__":
    process_corpus()
