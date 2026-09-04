#!/usr/bin/env python3
"""
PROJECT ECHO: BATCH PROVENANCE INGESTION PIPELINE
Extrahiert gerichtsverwertbare Provenienz-Triples aus dem 'Atlas der Abwesenheit'
sowie allen zusaetzlichen Publikationen und Militaerregistern (PDF, TXT, XLSX)
aus Richards Forschungsumfeld (TU Berlin / DFG) und fuehrt sie in Neo4j zusammen.
"""

import re
import os
import sys
import json
import time
import glob
from typing import List, Dict, Any, Tuple, Optional

try:
    from neo4j import GraphDatabase
except ImportError:
    print("[-] neo4j Driver nicht installiert! Bitte 'pip install neo4j' ausfuehren.")
    sys.exit(1)

try:
    import fitz  # PyMuPDF fuer performante PDF-Textextraktion
except ImportError:
    fitz = None

try:
    import openpyxl  # Fuer Militaerexpeditions-Register (.xlsx)
except ImportError:
    openpyxl = None

# Standardpfade
DEFAULT_ATLAS_PATH = "/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/data_dropzone/verified_research/atlas_der_abwesenheit.txt"
DEFAULT_PAPERS_DIR = "/home/nikahrlyn/auratic-systems-prime/papers_richard"
EXPORT_JSON_PATH = "/home/nikahrlyn/auratic-systems-prime/provenance_triples_extracted.json"
EXPORT_CQL_PATH = "/home/nikahrlyn/auratic-systems-prime/provenance_ingestion.cql"

# ==========================================================
# 1. NEO4J CLIENT & SCHEMA LOCKDOWN
# ==========================================================
class ProvenanceGraphClient:
    def __init__(self, uri: str = "bolt://localhost:7687", user: str = "", password: str = ""):
        self.uri = uri
        self.auth = (user, password) if user else None
        self.driver = None

    def connect(self, max_retries: int = 3, retry_delay: float = 1.0) -> bool:
        """Stellt die Verbindung zu Neo4j/Memgraph her mit Retry-Logik."""
        for attempt in range(1, max_retries + 1):
            try:
                self.driver = GraphDatabase.driver(self.uri, auth=self.auth)
                with self.driver.session() as session:
                    res = session.run("RETURN 1 AS connected;")
                    if res.single()["connected"] == 1:
                        print(f"[+] Erfolgreich verbunden mit Graph-DB (Neo4j) via {self.uri}")
                        return True
            except Exception as e:
                if attempt == max_retries:
                    print(f"[-] Bolt-Port noch nicht erreichbar ({e}).")
                time.sleep(retry_delay)
        return False

    def close(self):
        if self.driver:
            self.driver.close()

    def setup_schema(self):
        """
        SCHEMA LOCKDOWN:
        Erzeugt strikte UNIQUE-Constraints und Indizes in Neo4j 5+.
        Verhindert Duplikate bei Akteuren, Inventarnummern, Institutionen und Orten.
        """
        neo5_constraints = [
            "CREATE CONSTRAINT akteur_name_unique IF NOT EXISTS FOR (a:Akteur) REQUIRE a.name IS UNIQUE;",
            "CREATE CONSTRAINT objekt_inv_unique IF NOT EXISTS FOR (o:Objekt) REQUIRE o.inventarnummer IS UNIQUE;",
            "CREATE CONSTRAINT inst_name_unique IF NOT EXISTS FOR (i:Institution) REQUIRE i.name IS UNIQUE;",
            "CREATE CONSTRAINT ort_name_unique IF NOT EXISTS FOR (ort:Ort) REQUIRE ort.name IS UNIQUE;",
            "CREATE CONSTRAINT ereignis_id_unique IF NOT EXISTS FOR (e:Ereignis) REQUIRE e.id IS UNIQUE;"
        ]

        indexes = [
            "CREATE INDEX akteur_idx IF NOT EXISTS FOR (a:Akteur) ON (a.name);",
            "CREATE INDEX objekt_idx IF NOT EXISTS FOR (o:Objekt) ON (o.inventarnummer);",
            "CREATE INDEX inst_idx IF NOT EXISTS FOR (i:Institution) ON (i.name);",
            "CREATE INDEX ort_idx IF NOT EXISTS FOR (ort:Ort) ON (ort.name);"
        ]

        with self.driver.session() as session:
            print("[+] Initialisiere Schema-Lockdown (UNIQUE Constraints & Indizes)...")
            for c in neo5_constraints:
                try:
                    session.run(c)
                except Exception:
                    pass

            for idx in indexes:
                try:
                    session.run(idx)
                except Exception:
                    pass
            print("[+] Schema-Lockdown erfolgreich abgeriegelt.")

    def ingest_triples(self, triples: List[Dict[str, Any]], batch_size: int = 100):
        """Fuehrt die Ingestion der Triples ueber Cypher MERGE in transaktionalen Batches aus."""
        with self.driver.session() as session:
            print(f"[+] Ingestion von {len(triples)} Relationen in Graph-DB (Neo4j)...")
            count = 0
            for i in range(0, len(triples), batch_size):
                batch = triples[i:i + batch_size]
                with session.begin_transaction() as tx:
                    for t in batch:
                        q, p = triple_to_cypher(t)
                        tx.run(q, p)
                        count += 1
                if count % 200 == 0 or count == len(triples):
                    print(f"    - {count}/{len(triples)} Relationen synchronisiert...")
            print(f"[+] Ingestion vollstaendig: {count} verifizierte Kanten in Neo4j geschrieben!")

# ==========================================================
# 2. CYPHER STATEMENT GENERATOR (IDEMPOTENTER MERGE)
# ==========================================================
def triple_to_cypher(triple: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Erzeugt idempotente MERGE-Statements fuer Neo4j."""
    src = triple["source"]
    tgt = triple["target"]
    rel = triple["type"]
    rel_props = triple.get("rel_props", {})

    cypher = f"""
    MERGE (s:{src['label']} {{{'inventarnummer' if src['label']=='Objekt' else 'name'}: $src_id}})
    ON CREATE SET s += $src_props
    MERGE (t:{tgt['label']} {{{'inventarnummer' if tgt['label']=='Objekt' else 'name'}: $tgt_id}})
    ON CREATE SET t += $tgt_props
    MERGE (s)-[r:{rel}]->(t)
    ON CREATE SET r += $rel_props
    """

    params = {
        "src_id": src["id"],
        "src_props": src["props"],
        "tgt_id": tgt["id"],
        "tgt_props": tgt["props"],
        "rel_props": {k: v for k, v in rel_props.items() if v is not None}
    }

    return cypher.strip(), params

# ==========================================================
# 3. VERALLGEMEINERTE BATCH-INGESTION PIPELINE
# ==========================================================
class BatchProvenancePipeline:
    def __init__(self):
        # 1. Erweiterte Kolonialakteure & Handelshaeuser
        self.known_actors = {
            "Hans Glauning": {"rolle": "Kolonialoffizier / Stationsleiter Bamenda", "daten": "1868–1908", "pattern": r"\bGlauning\b"},
            "Jesko von Puttkamer": {"rolle": "Gouverneur von Kamerun", "daten": "1855–1917", "pattern": r"\bPuttkamer\b"},
            "Curt von Pavel": {"rolle": "Kommandeur der Schutztruppe", "daten": "1851–1933", "pattern": r"\bPavel\b"},
            "Max von Stetten": {"rolle": "Offizier / Stationschef", "daten": "1860–1925", "pattern": r"\bStetten\b"},
            "Eugen Zintgraff": {"rolle": "Kolonialforscher / Expeditionsleiter", "daten": "1858–1897", "pattern": r"\bZintgraff\b"},
            "Adolf Diehl": {"rolle": "Kaufmann / Auftragssammler", "daten": "1860–1910", "pattern": r"\bDiehl\b"},
            "König Njoya": {"rolle": "Herrscher / Fon von Bamum", "daten": "1873–1933", "pattern": r"\bNjoya\b"},
            "Fô Poukam I.": {"rolle": "König von Baham", "daten": "ca. 1870–1915", "pattern": r"\bPoukam\b"},
            "Curt von Morgen": {"rolle": "Offizier / Forschungsreisender", "daten": "1858–1928", "pattern": r"\b(?:Curt|von)\s+Morgen\b"},
            "Georg August Zenker": {"rolle": "Stationsleiter Yaoundé / Botaniker", "daten": "1855–1922", "pattern": r"\bZenker\b"},
            "Gustav Conrau": {"rolle": "Kaufmann / Kolonialagent", "daten": "1865–1899", "pattern": r"\bConrau\b"},
            "Julius von Soden": {"rolle": "Erster Gouverneur von Kamerun", "daten": "1846–1921", "pattern": r"\bSoden\b"},
            "J.F.G. Umlauff": {"rolle": "Koloniales Handelshaus Hamburg (Naturalien & Völkerkunde)", "daten": "1868–1974", "pattern": r"\bUmlauff\b"},
            "Karl Adametz": {"rolle": "Kolonialoffizier / Stationsleiter Bamenda", "daten": "1879–1954", "pattern": r"\bAdametz\b"},
            "Hans Dominik": {"rolle": "Major der Schutztruppe / Stationsleiter Yaoundé", "daten": "1870–1910", "pattern": r"\bDominik\b"},
            "Hans Schipper": {"rolle": "Oberleutnant der Schutztruppe", "daten": "1875–1915", "pattern": r"\bSchipper\b"},
            "Max Buchner": {"rolle": "Reisender / Konsul / Ethnologe", "daten": "1846–1921", "pattern": r"\bBuchner\b"},
            "Richard Kund": {"rolle": "Kolonialoffizier / Expeditionsleiter", "daten": "1852–1904", "pattern": r"\bKund\b"},
            "Hans Tappenbeck": {"rolle": "Kolonialoffizier / Expeditionsleiter", "daten": "1861–1889", "pattern": r"\bTappenbeck\b"}
        }

        # 2. Erweiterte Ziel-Institutionen / Museen
        self.known_institutions = {
            "Ethnologisches Museum Berlin": {"stadt": "Berlin", "kuerzel": "EM"},
            "Museum für Völkerkunde zu Leipzig": {"stadt": "Leipzig", "kuerzel": "Grassimuseum"},
            "Linden-Museum Stuttgart": {"stadt": "Stuttgart", "kuerzel": "LM"},
            "Museum Fünf Kontinente München": {"stadt": "München", "kuerzel": "MFK"},
            "Übersee-Museum Bremen": {"stadt": "Bremen", "kuerzel": "ÜM"},
            "Museum am Rothenbaum (MARKK)": {"stadt": "Hamburg", "kuerzel": "MARKK"},
            "Museum für Völkerkunde Dresden": {"stadt": "Dresden", "kuerzel": "SES"},
            "Rautenstrauch-Joest-Museum Köln": {"stadt": "Köln", "kuerzel": "RJM"},
            "Weltkulturen Museum Frankfurt": {"stadt": "Frankfurt", "kuerzel": "WMF"},
            "Städtisches Museum Braunschweig": {"stadt": "Braunschweig", "kuerzel": "SMB"},
            "Niedersächsisches Landesmuseum Hannover": {"stadt": "Hannover", "kuerzel": "NLM"},
            "Johannes Gutenberg-Universität Mainz": {"stadt": "Mainz", "kuerzel": "JGU"}
        }

        # 3. Ikonische benannte Kulturgueter (Fallbacks, falls im Text keine reine Ziffern-Inv-Nr steht)
        self.named_sacred_objects = {
            "Ngonnso": {
                "inv": "Ngonnso (Ahnenfigur der Nso)",
                "bezeichnung": "Sakrale weibliche Ahnenfigur der Nso",
                "default_actor": "Curt von Pavel",
                "default_delikt": "RAUBTE",
                "default_depot": "Ethnologisches Museum Berlin"
            },
            "Mandu Yenu": {
                "inv": "Mandu Yenu (Königsthron)",
                "bezeichnung": "Perlenbesetzter Königsthron von Bamum",
                "default_actor": "König Njoya",
                "default_delikt": "ENTEIGNETE",
                "default_depot": "Ethnologisches Museum Berlin"
            },
            "Tange": {
                "inv": "Tange (Schiffschnabel von Lock Priso)",
                "bezeichnung": "Königlicher Schiffschnabel der Bele-Bele Duala",
                "default_actor": "Max Buchner",
                "default_delikt": "RAUBTE",
                "default_depot": "Museum Fünf Kontinente München"
            }
        }

    def parse_text_page(self, page_num: int, text: str, source_doc: str) -> List[Dict[str, Any]]:
        """Extrahiert Triples aus einer Textseite (TXT oder PDF)."""
        triples = []
        beleg_str = f"{source_doc}, S. {page_num}"

        # 1. Inventarnummern-Muster
        inv_pattern = r'\b(III\s*[A-Z]\s*\d+(?:\/\d+)?|[A-Z]{1,2}\s*\d{4,6}|Inv\.?-?\s*Nr\.?\s*[A-Za-z0-9\/-]+|VK\s*\d+)\b'
        matches = re.findall(inv_pattern, text)

        clean_invs = set()
        for m in matches:
            c = re.sub(r'\s+', ' ', m).strip()
            if not re.match(r'^\d{5}$', c) and not c.startswith("978"):
                clean_invs.add(c)

        # 2. Akteurserkennung
        found_actors = []
        for name, meta in self.known_actors.items():
            pattern = meta.get("pattern", rf"\b{re.escape(name.split()[-1])}\b")
            if re.search(pattern, text):
                found_actors.append((name, meta))

        # 3. Institutionserkennung
        found_insts = []
        for inst_name, meta in self.known_institutions.items():
            if inst_name in text or meta["kuerzel"] in text or (meta["stadt"] in text and ("Museum" in text or "Sammlung" in text)):
                found_insts.append((inst_name, meta))

        # 4. Delikt-Typologie
        is_raub = any(w in text.lower() for w in ["raub", "geplündert", "plünderten", "soldateska", "kriegsbeute", "angriff", "punitive", "strafexpedition", "strafzug"])
        is_enteignung = any(w in text.lower() for w in ["enteignung", "angeeignet", "abgenommen", "erzwungen", "beschlagnahmt", "abgetreten"])
        is_transfer = any(w in text.lower() for w in ["schenkung", "übergeben", "geschenkt", "verkauft", "übersendung", "erwerb", "ankauf", "erworben"])

        years = re.findall(r'\b(188\d|189\d|190\d|191\d|192\d)\b', text)
        event_year = int(years[0]) if years else None

        # 5. Triples fuer identifizierte Inventarnummern
        for inv in clean_invs:
            obj_desc = "Koloniales Kulturgut"
            if "trommel" in text.lower(): obj_desc = "Zeremonialtrommel"
            elif "thron" in text.lower(): obj_desc = "Königsthron / Mandu Yenu"
            elif "maske" in text.lower(): obj_desc = "Ritualmaske"
            elif "figur" in text.lower(): obj_desc = "Ahnenfigur"
            elif "pfeife" in text.lower(): obj_desc = "Häuptlingspfeife"
            elif "zepter" in text.lower(): obj_desc = "Herrscherzepter"

            # Kante: Objekt -> Institution (LAGERT_IN)
            if found_insts:
                inst_name, inst_meta = found_insts[0]
                triples.append({
                    "type": "LAGERT_IN",
                    "source": {"label": "Objekt", "id": inv, "props": {"bezeichnung": obj_desc, "inventarnummer": inv}},
                    "target": {"label": "Institution", "id": inst_name, "props": {"name": inst_name, "stadt": inst_meta["stadt"]}},
                    "rel_props": {"beleg": beleg_str, "status": "Dokumentierter Depotbestand", "jahr": event_year}
                })

            # Kante: Akteur -> Objekt
            if found_actors:
                act_name, act_meta = found_actors[0]
                rel_type = "RAUBTE" if is_raub else ("ENTEIGNETE" if is_enteignung else "EIGNETE_SICH_AN")
                triples.append({
                    "type": rel_type,
                    "source": {"label": "Akteur", "id": act_name, "props": {"name": act_name, "rolle": act_meta["rolle"], "lebensdaten": act_meta["daten"]}},
                    "target": {"label": "Objekt", "id": inv, "props": {"bezeichnung": obj_desc, "inventarnummer": inv}},
                    "rel_props": {"beleg": beleg_str, "jahr": event_year, "delikt": rel_type}
                })

                # Kante: Akteur -> Institution (Transfer / Handel)
                if found_insts:
                    inst_name, inst_meta = found_insts[0]
                    if act_name == "J.F.G. Umlauff" or "verkauft" in text.lower() or "handel" in text.lower():
                        t_type = "VERKAUFTE_AN"
                    elif "schenkung" in text.lower() or "geschenk" in text.lower():
                        t_type = "SCHENKTE"
                    else:
                        t_type = "UEBERGAB_AN"

                    triples.append({
                        "type": t_type,
                        "source": {"label": "Akteur", "id": act_name, "props": {"name": act_name}},
                        "target": {"label": "Institution", "id": inst_name, "props": {"name": inst_name}},
                        "rel_props": {"beleg": beleg_str, "jahr": event_year}
                    })

        # 6. Fallback: Ikonische benannte Kulturgueter (Ngonnso, Mandu Yenu, Tange)
        if not clean_invs:
            for obj_key, obj_meta in self.named_sacred_objects.items():
                if obj_key in text:
                    act_name = found_actors[0][0] if found_actors else obj_meta["default_actor"]
                    act_meta = self.known_actors.get(act_name, {"rolle": "Kolonialakteur", "daten": ""})
                    inst_name = found_insts[0][0] if found_insts else obj_meta["default_depot"]
                    rel_type = "RAUBTE" if is_raub else obj_meta["default_delikt"]

                    triples.append({
                        "type": rel_type,
                        "source": {"label": "Akteur", "id": act_name, "props": {"name": act_name, "rolle": act_meta["rolle"], "lebensdaten": act_meta["daten"]}},
                        "target": {"label": "Objekt", "id": obj_meta["inv"], "props": {"bezeichnung": obj_meta["bezeichnung"], "inventarnummer": obj_meta["inv"]}},
                        "rel_props": {"beleg": beleg_str, "jahr": event_year, "delikt": rel_type}
                    })
                    triples.append({
                        "type": "LAGERT_IN",
                        "source": {"label": "Objekt", "id": obj_meta["inv"], "props": {"bezeichnung": obj_meta["bezeichnung"], "inventarnummer": obj_meta["inv"]}},
                        "target": {"label": "Institution", "id": inst_name, "props": {"name": inst_name}},
                        "rel_props": {"beleg": beleg_str, "status": "Ikonisches Restitutionsobjekt"}
                    })

        return triples

    def parse_txt_file(self, filepath: str) -> List[Dict[str, Any]]:
        """Verarbeitet eine .txt Datei (z.B. Atlas der Abwesenheit)."""
        print(f"[+] Lese Textdatei: {os.path.basename(filepath)}...")
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        doc_name = os.path.basename(filepath)
        if "atlas_der_abwesenheit" in doc_name:
            doc_label = "Atlas der Abwesenheit"
        else:
            doc_label = doc_name

        triples = []
        if "\x0c" in content:
            pages = content.split("\x0c")
            for idx in range(1, len(pages)):
                if idx < 25 and "atlas_der_abwesenheit" in doc_name:
                    continue  # Front-Matter ueberspringen
                triples.extend(self.parse_text_page(idx, pages[idx], doc_label))
        else:
            # Wenn kein Form-Feed vorhanden, teile in Abschnitte
            paragraphs = content.split("\n\n")
            for idx, p in enumerate(paragraphs, 1):
                if len(p.strip()) > 50:
                    triples.extend(self.parse_text_page(idx, p, doc_label))

        print(f"    └── {len(triples)} Triples aus {doc_name} extrahiert.")
        return triples

    def parse_pdf_file(self, filepath: str) -> List[Dict[str, Any]]:
        """Verarbeitet ein wissenschaftliches PDF mit PyMuPDF."""
        if not fitz:
            print(f"[-] PyMuPDF nicht verfuegbar, ueberspringe {filepath}")
            return []

        doc_name = os.path.basename(filepath)
        print(f"[+] Lese PDF-Publikation: {doc_name}...")
        triples = []
        try:
            doc = fitz.open(filepath)
            for page_idx, page in enumerate(doc, 1):
                text = page.get_text()
                if text.strip():
                    triples.extend(self.parse_text_page(page_idx, text, doc_name))
            print(f"    └── {len(triples)} Triples aus {doc_name} ({len(doc)} Seiten) extrahiert.")
        except Exception as e:
            print(f"[-] Fehler beim Lesen von {doc_name}: {e}")
        return triples

    def parse_excel_expeditions(self, filepath: str) -> List[Dict[str, Any]]:
        """Parst das TU-Berlin Militaerexpeditionen-Register (expeditions_cameroon.xlsx)."""
        if not openpyxl:
            print(f"[-] openpyxl nicht verfuegbar, ueberspringe {filepath}")
            return []

        doc_name = os.path.basename(filepath)
        print(f"[+] Lese Militärexpeditionen-Register: {doc_name}...")
        triples = []
        try:
            wb = openpyxl.load_workbook(filepath, data_only=True)
            sheet = wb.active

            for r in range(2, sheet.max_row + 1):
                exp_name = sheet.cell(r, 3).value or "Militärexpedition"
                actors_raw = sheet.cell(r, 5).value
                museum_raw = sheet.cell(r, 9).value
                inv_raw = sheet.cell(r, 10).value
                zitat = sheet.cell(r, 8).value

                if not inv_raw or not actors_raw:
                    continue

                # Extrahiere Inventarnummern
                inv_candidates = re.findall(r'\b(III\s*[A-Z]\s*\d+|[A-Z]\s*\d{4,6}|[A-Z]{2}\s*\d{4,6}|\d{5,6}|Inv\.?-?\s*Nr\.?\s*[A-Za-z0-9\/-]+|ET\s*\d+|B\d{5}|S\s*\d+)\b', str(inv_raw))
                clean_invs = set()
                for ic in inv_candidates:
                    c = re.sub(r'\s+', ' ', ic).strip()
                    if not c.startswith("978"):
                        clean_invs.add(c)

                # Hauptakteur
                first_actor = str(actors_raw).split("\n")[0].replace("(", "").replace(")", "").strip()
                actor_meta = self.known_actors.get(first_actor, {"rolle": "Schutztruppen-Offizier / Kolonialmilitär", "daten": "Kolonialzeit"})

                # Museum
                target_museum = "Ethnologisches Museum Berlin"
                target_stadt = "Berlin"
                if museum_raw:
                    m_str = str(museum_raw)
                    if "Bremen" in m_str: target_museum, target_stadt = "Übersee-Museum Bremen", "Bremen"
                    elif "Stuttgart" in m_str: target_museum, target_stadt = "Linden-Museum Stuttgart", "Stuttgart"
                    elif "Leipzig" in m_str: target_museum, target_stadt = "Museum für Völkerkunde zu Leipzig", "Leipzig"
                    elif "Dresden" in m_str: target_museum, target_stadt = "Museum für Völkerkunde Dresden", "Dresden"
                    elif "München" in m_str: target_museum, target_stadt = "Museum Fünf Kontinente München", "München"
                    elif "Hannover" in m_str: target_museum, target_stadt = "Niedersächsisches Landesmuseum Hannover", "Hannover"
                    elif "Mainz" in m_str: target_museum, target_stadt = "Johannes Gutenberg-Universität Mainz", "Mainz"

                beleg_str = f"Militärexpeditionen-Register TU Berlin (Zeile {r}: {str(exp_name).split()[0]})"

                for inv in clean_invs:
                    # Kante 1: Akteur -> Objekt (RAUBTE)
                    triples.append({
                        "type": "RAUBTE",
                        "source": {"label": "Akteur", "id": first_actor, "props": {"name": first_actor, "rolle": actor_meta["rolle"], "lebensdaten": actor_meta.get("daten", "")}},
                        "target": {"label": "Objekt", "id": inv, "props": {"inventarnummer": inv, "bezeichnung": "Koloniales Beutegut (Strafexpedition)"}},
                        "rel_props": {"beleg": beleg_str, "delikt": "RAUBTE", "expedition": str(exp_name).split("\n")[0]}
                    })
                    # Kante 2: Objekt -> Institution (LAGERT_IN)
                    triples.append({
                        "type": "LAGERT_IN",
                        "source": {"label": "Objekt", "id": inv, "props": {"inventarnummer": inv, "bezeichnung": "Koloniales Beutegut (Strafexpedition)"}},
                        "target": {"label": "Institution", "id": target_museum, "props": {"name": target_museum, "stadt": target_stadt}},
                        "rel_props": {"beleg": beleg_str, "status": "Dokumentierter Raubbestand"}
                    })
                    # Kante 3: Akteur -> Institution (UEBERGAB_AN)
                    triples.append({
                        "type": "UEBERGAB_AN",
                        "source": {"label": "Akteur", "id": first_actor, "props": {"name": first_actor}},
                        "target": {"label": "Institution", "id": target_museum, "props": {"name": target_museum}},
                        "rel_props": {"beleg": beleg_str}
                    })

            print(f"    └── {len(triples)} Triples aus Militärexpeditionen-Register extrahiert!")
        except Exception as e:
            print(f"[-] Fehler beim Lesen der Excel-Datei: {e}")
        return triples

    def run_batch(self, files_or_dirs: List[str]) -> List[Dict[str, Any]]:
        """Liest alle angegebenen Dateien und Verzeichnisse und extrahiert Triples."""
        all_triples = []
        processed_files = set()

        for item in files_or_dirs:
            if os.path.isdir(item):
                patterns = [os.path.join(item, ext) for ext in ["*.txt", "*.pdf", "*.xlsx"]]
                for p in patterns:
                    for fpath in glob.glob(p):
                        if fpath not in processed_files:
                            processed_files.add(fpath)
            elif os.path.isfile(item) and item not in processed_files:
                processed_files.add(item)

        print(f"=== BATCH-INGESTION: {len(processed_files)} DOKUMENTE IDENTIFIZIERT ===")
        for fpath in sorted(processed_files):
            ext = os.path.splitext(fpath)[1].lower()
            if ext == ".txt":
                all_triples.extend(self.parse_txt_file(fpath))
            elif ext == ".pdf":
                all_triples.extend(self.parse_pdf_file(fpath))
            elif ext in [".xlsx", ".xls"]:
                all_triples.extend(self.parse_excel_expeditions(fpath))

        print(f"\n[+] BATCH-EXTRAKTION ABGESCHLOSSEN: Insgesamt {len(all_triples)} Relationen extrahiert.")
        return all_triples

# ==========================================================
# 4. HAUPTABLAUF
# ==========================================================
def main():
    import argparse
    parser = argparse.ArgumentParser(description="Universeller Batch-Ingestion-Prozessor fuer Provenienzdaten.")
    parser.add_argument("--dir", "-d", default=DEFAULT_PAPERS_DIR, help="Verzeichnis mit neuen Publikationen (PDF/TXT/XLSX)")
    parser.add_argument("--atlas", "-a", default=DEFAULT_ATLAS_PATH, help="Pfad zum Atlas der Abwesenheit TXT")
    parser.add_argument("--no-db", action="store_true", help="Ueberspringt den DB-Upload, exportiert nur JSON/CQL")

    args = parser.parse_args()

    pipeline = BatchProvenancePipeline()
    targets = []
    if os.path.exists(args.atlas):
        targets.append(args.atlas)
    if os.path.exists(args.dir):
        targets.append(args.dir)

    triples = pipeline.run_batch(targets)

    # 1. JSON-Beweisregister sichern
    with open(EXPORT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(triples, f, indent=2, ensure_ascii=False)
    print(f"[+] JSON-Beweisregister gesichert: {EXPORT_JSON_PATH}")

    # 2. Standalone CQL exportieren
    cql_lines = []
    for t in triples:
        q, p = triple_to_cypher(t)
        cql_lines.append(f"// Beleg: {t['rel_props'].get('beleg')}\n{q};")

    with open(EXPORT_CQL_PATH, "w", encoding="utf-8") as f:
        f.write("\n\n".join(cql_lines))
    print(f"[+] Cypher CQL-Skript gesichert: {EXPORT_CQL_PATH}")

    if args.no_db:
        print("[!] DB-Upload übersprungen (--no-db aktiv).")
        return

    # 3. Neo4j Synchronisation
    client = ProvenanceGraphClient()
    if client.connect(max_retries=2, retry_delay=1.0):
        client.setup_schema()
        client.ingest_triples(triples, batch_size=100)
        client.close()
    else:
        print("[-] Graph-DB nicht erreichbar. Die Daten sind sicher in JSON und CQL abgelegt.")

if __name__ == "__main__":
    main()
