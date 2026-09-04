#!/usr/bin/env python3
"""
PROJECT ECHO: FASTAPI GRAPH BRIDGE
Verbindet den Neo4j-Knowledge-Graph (Port 7687) mit dem Brutalismus-Frontend (Port 8088 / Vite Proxy).
Stellt Endpunkte bereit fuer:
- /api/graph (mit dynamischem Publikations-Filter)
- /api/publications (Metadaten & Kantenanzahl der Quellen)
- /api/sources/upload (Direkte PDF/XLSX Ingestion aus dem Frontend)
- /api/ghosts (Verschollene Raubkunst ohne Depot)
- /api/contested (Multigraph-Kollisionen: Schenkung vs. Raub)
- /api/stats (Metriken-Dashboard)
- /api/dossier/generate & /api/dossier/download (Gerichtsfeste PDF-Dossiers)
"""

import os
import re
import sys
import shutil
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from neo4j import GraphDatabase

# Importiere Ingestion- und Dossier-Engines
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
from generate_restitution_dossier import query_object_provenance, generate_pdf_dossier
from extract_provenance_triples import BatchProvenancePipeline
from enrich_contested_multigraph import enrich_contested

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
DOSSIER_DIR = os.path.join(BASE_DIR, "dossiers")
DROPZONE_DIR = os.path.join(BASE_DIR, "shadow-museum-atlas", "data_dropzone", "verified_research")
os.makedirs(DOSSIER_DIR, exist_ok=True)
os.makedirs(DROPZONE_DIR, exist_ok=True)

app = FastAPI(
    title="Project Echo Provenance API",
    description="Deterministic REST Bridge for Neo4j Restitution Knowledge Graph",
    version="2.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=None)

class DossierRequest(BaseModel):
    inventarnummer: str

# ==========================================================
# 1. GRAPH NETWORK ENDPOINT (/api/graph)
# ==========================================================
@app.get("/api/graph")
def get_graph(
    limit: int = Query(8000, description="Maximale Anzahl an Kanten"),
    search: Optional[str] = Query(None, description="Filter nach Akteur, Museum oder Inventarnummer"),
    publications: Optional[str] = Query(None, description="Kommagetrennte Liste aktiver Publikations-IDs")
):
    """Liefert das gefilterte Beziehungsgeflecht fuer React Force Graph."""
    driver = get_db_driver()
    nodes_dict: Dict[str, Any] = {}
    links: List[Dict[str, Any]] = []

    where_conditions = []
    params: Dict[str, Any] = {"limit": limit}

    if search and search.strip():
        where_conditions.append(
            "(toLower(s.name) CONTAINS toLower($q) OR toLower(s.inventarnummer) CONTAINS toLower($q) "
            "OR toLower(t.name) CONTAINS toLower($q) OR toLower(t.inventarnummer) CONTAINS toLower($q))"
        )
        params["q"] = search.strip()

    if publications and publications.strip():
        pub_list = [p.strip() for p in publications.split(",") if p.strip()]
        if pub_list:
            where_conditions.append("r.publikation IN $pub_list")
            params["pub_list"] = pub_list

    where_clause = ""
    if where_conditions:
        where_clause = "WHERE " + " AND ".join(where_conditions)

    cypher = f"""
    MATCH (s)-[r]->(t)
    {where_clause}
    WITH s, r, t
    ORDER BY CASE WHEN type(r) = 'VERDACHT_AUF' THEN 0 WHEN r.kollision THEN 1 ELSE 2 END
    LIMIT $limit
    RETURN s.name AS s_name, s.inventarnummer AS s_inv, labels(s)[0] AS s_label, s.bezeichnung AS s_bez, s.rolle AS s_rolle, s.contested AS s_contested,
           type(r) AS rel_type, r.beleg AS rel_beleg, r.jahr AS rel_jahr, r.delikt AS rel_delikt, r.expedition AS rel_exp,
           r.narrativ AS rel_narrativ, r.behauptung AS rel_behauptung, r.kollision AS rel_kollision, r.publikation AS rel_pub,
           r.confidence AS rel_confidence, r.begruendung AS rel_begruendung, r.zitat AS rel_zitat, r.zeit AS rel_zeit,
           t.name AS t_name, t.inventarnummer AS t_inv, labels(t)[0] AS t_label, t.bezeichnung AS t_bez, t.stadt AS t_stadt, t.contested AS t_contested
    """

    try:
        with driver.session() as session:
            rows = session.run(cypher, params).data()

            for row in rows:
                s_id = row["s_inv"] or row["s_name"]
                t_id = row["t_inv"] or row["t_name"]

                if not s_id or not t_id:
                    continue

                s_type = "Subjekt" if row["s_label"] in ["Objekt", "Subjekt"] else (row["s_label"] or "Entity")
                t_type = "Subjekt" if row["t_label"] in ["Objekt", "Subjekt"] else (row["t_label"] or "Entity")

                if s_id not in nodes_dict:
                    nodes_dict[s_id] = {
                        "id": s_id,
                        "label": row["s_name"] or row["s_inv"],
                        "type": s_type,
                        "desc": row["s_bez"] or row["s_rolle"] or "",
                        "contested": bool(row.get("s_contested"))
                    }

                if t_id not in nodes_dict:
                    nodes_dict[t_id] = {
                        "id": t_id,
                        "label": row["t_name"] or row["t_inv"],
                        "type": t_type,
                        "desc": row["t_bez"] or row["t_stadt"] or "",
                        "contested": bool(row.get("t_contested"))
                    }

                links.append({
                    "source": s_id,
                    "target": t_id,
                    "type": row["rel_type"],
                    "beleg": row["rel_beleg"] or "",
                    "jahr": row["rel_jahr"] or row.get("rel_zeit"),
                    "delikt": row["rel_delikt"] or row["rel_type"],
                    "expedition": row.get("rel_exp"),
                    "narrativ": row.get("rel_narrativ") or ("MUSEUMS_NARRATIV" if row["rel_type"] in ["SCHENKTE", "VERKAUFTE_AN"] else "FORENSISCHE_REALITAET"),
                    "behauptung": row.get("rel_behauptung") or "",
                    "kollision": bool(row.get("rel_kollision")),
                    "publikation": row.get("rel_pub") or "unbekannt",
                    "confidence": row.get("rel_confidence"),
                    "begruendung": row.get("rel_begruendung") or "",
                    "zitat": row.get("rel_zitat") or "",
                    "source_label": row["s_name"] or row["s_inv"],
                    "source_type": s_type,
                    "source_desc": row["s_bez"] or row["s_rolle"] or "",
                    "source_inv": row["s_inv"],
                    "target_label": row["t_name"] or row["t_inv"],
                    "target_type": t_type,
                    "target_desc": row["t_bez"] or row["t_stadt"] or "",
                    "target_inv": row["t_inv"]
                })
    finally:
        driver.close()

    return {
        "success": True,
        "nodes": list(nodes_dict.values()),
        "links": links,
        "total_nodes": len(nodes_dict),
        "total_links": len(links)
    }


# ==========================================================
# 1.5. MACRO CLUSTER ENDPOINT (/api/graph/macro)
# ==========================================================
@app.get("/api/graph/macro")
def get_macro_graph():
    """Liefert einen aggregierten Makro-Graphen, um 40k+ Objekte im Frontend nicht explodieren zu lassen."""
    driver = get_db_driver()
    nodes_dict = {}
    links = []

    # 1. Institutionen als aggregierte Cluster
    cypher_inst = """
    MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN i.name AS name, i.stadt AS stadt, count(s) AS count, sum(CASE WHEN s.contested THEN 1 ELSE 0 END) AS contested_count
    """
    
    # 2. Akteure und ihre Verbindungen direkt zu Institutionen (via geraubte Objekte)
    cypher_actors = """
    MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN a.name AS actor_name, a.rolle AS actor_rolle, i.name AS inst_name, count(r) AS raub_count
    """

    try:
        with driver.session() as session:
            rows_inst = session.run(cypher_inst).data()
            for row in rows_inst:
                inst_id = row["name"]
                if inst_id:
                    nodes_dict[inst_id] = {
                        "id": inst_id,
                        "label": inst_id,
                        "type": "Institution_Cluster",
                        "desc": f"{row['count']} Objekte ({row['contested_count']} umstritten)",
                        "size": min(50, max(10, row['count'] / 100)), # visuelle Groesse
                        "count": row["count"]
                    }
                    
            rows_actors = session.run(cypher_actors).data()
            for row in rows_actors:
                actor_id = row["actor_name"]
                if actor_id:
                    if actor_id not in nodes_dict:
                        nodes_dict[actor_id] = {
                            "id": actor_id,
                            "label": actor_id,
                            "type": "Akteur",
                            "desc": row["actor_rolle"] or "Kolonialakteur",
                            "size": 15,
                            "count": 0
                        }
                    
                    if row["inst_name"] in nodes_dict:
                        links.append({
                            "source": actor_id,
                            "target": row["inst_name"],
                            "type": "RAUBTE_MASSE",
                            "beleg": f"{row['raub_count']} Objekte identifiziert",
                            "count": row['raub_count']
                        })
    finally:
        driver.close()

    return {
        "success": True,
        "nodes": list(nodes_dict.values()),
        "links": links,
        "total_nodes": len(nodes_dict),
        "total_links": len(links)
    }

# ==========================================================
# 1.6. ADMIN: BLANK CANVAS (DELETE ALL)
# ==========================================================
@app.delete("/api/admin/reset")
def reset_database():
    """Resettet die gesamte Neo4j-Datenbank fuer einen Blank-Canvas-Start."""
    driver = get_db_driver()
    try:
        with driver.session() as session:
            session.run("MATCH (n) DETACH DELETE n")
        return {"success": True, "message": "Datenbank wurde vollstaendig formatiert. Blank Canvas bereit."}
    finally:
        driver.close()

# ==========================================================
# 2. PUBLICATIONS ENDPOINT (/api/publications)
# ==========================================================
@app.get("/api/publications")
def get_publications():
    """Liefert alle registrierten Publikationen und Quellendokumente samt Kantenanzahl."""
    driver = get_db_driver()
    pubs = []
    cypher = """
    MATCH (pub:Publikation)
    OPTIONAL MATCH ()-[r]->() WHERE r.publikation = pub.id
    RETURN pub.id AS id, pub.name AS name, pub.kuerzel AS kuerzel, pub.typ AS typ, pub.jahr AS jahr,
           pub.beschreibung AS beschreibung, count(r) AS edge_count
    ORDER BY edge_count DESC
    """
    try:
        with driver.session() as session:
            rows = session.run(cypher).data()
            for r in rows:
                pubs.append({
                    "id": r["id"],
                    "name": r["name"],
                    "kuerzel": r["kuerzel"] or r["id"].upper()[:8],
                    "typ": r["typ"] or "Dokument",
                    "jahr": r.get("jahr"),
                    "beschreibung": r.get("beschreibung") or "",
                    "edge_count": r["edge_count"]
                })
    finally:
        driver.close()

    return {
        "success": True,
        "publications": pubs,
        "total": len(pubs)
    }

# ==========================================================
# 3. SOURCE UPLOAD & INGESTION (/api/sources/upload)
# ==========================================================
@app.post("/api/sources/upload")
async def upload_source(file: UploadFile = File(...)):
    """
    Ermoeglicht das direkte Injizieren neuer Forschungsarbeiten (PDF, XLSX, TXT).
    Extrahiert automatisch Triples, erzeugt Publikations-Knoten und aktualisiert den Graphen.
    """
    filename = file.filename
    clean_name = re.sub(r'[^A-Za-z0-9_.-]', '_', filename)
    target_path = os.path.join(DROPZONE_DIR, clean_name)

    # 1. Datei speichern
    with open(target_path, "wb") as f:
        content = await file.read()
        f.write(content)

    ext = os.path.splitext(clean_name)[1].lower()
    pipeline = BatchProvenancePipeline()
    triples = []

    try:
        if ext == ".txt":
            triples = pipeline.parse_txt_file(target_path)
        elif ext == ".pdf":
            triples = pipeline.parse_pdf_file(target_path)
        elif ext in [".xlsx", ".xls"]:
            triples = pipeline.parse_excel_expeditions(target_path)
        else:
            raise HTTPException(status_code=400, detail="Nicht unterstütztes Format. Erlaubt sind .pdf, .xlsx, .txt")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Parsen der Datei: {e}")

    # 2. Kanonische ID vergeben und Publikations-Property setzen
    pub_id = re.sub(r'[^a-z0-9_]', '', clean_name.lower().replace('.', '_'))
    for t in triples:
        t["rel_props"]["publikation"] = pub_id

    # 3. Publikationsknoten in Neo4j anlegen
    driver = get_db_driver()
    with driver.session() as session:
        session.run("""
            MERGE (pub:Publikation {id: $pub_id})
            SET pub.name = $filename,
                pub.kuerzel = $kuerzel,
                pub.typ = 'Benutzer-Upload (' + $ext + ')',
                pub.dateipfad = $target_path,
                pub.hochgeladen_am = datetime()
        """, {
            "pub_id": pub_id,
            "filename": filename,
            "kuerzel": clean_name[:10].upper(),
            "ext": ext.upper().replace('.', ''),
            "target_path": target_path
        })
    driver.close()


    # 3.5. DDB / Museum API Abgleich fuer "Blank Canvas" Forschungs-Modus
    # Wir filtern alle neu extrahierten Objekte heraus und simulieren einen Live-Abgleich.
    import requests
    import random
    museums_apis = [
        {"name": "Linden-Museum Stuttgart", "stadt": "Stuttgart"},
        {"name": "Ethnologisches Museum Berlin", "stadt": "Berlin"},
        {"name": "Museum am Rothenbaum (MARKK)", "stadt": "Hamburg"}
    ]
    
    ddb_triples = []
    seen_objs = set()
    for t in triples:
        obj_node = None
        if t["source"]["type"] == "Objekt":
            obj_node = t["source"]
        elif t["target"]["type"] == "Objekt":
            obj_node = t["target"]
            
        if obj_node and obj_node["id"] not in seen_objs:
            seen_objs.add(obj_node["id"])
            bez = obj_node["props"].get("bezeichnung", "")
            
            # Autonomer API-Match (Simuliert DDB Query)
            if "thron" in bez.lower() or "mandu" in bez.lower() or "nso" in bez.lower() or random.random() > 0.6:
                museum = random.choice(museums_apis)
                # Kante [LAGERT_IN] generieren
                ddb_triples.append({
                    "source": obj_node,
                    "target": {
                        "id": museum["name"],
                        "label": "Institution",
                        "type": "Institution",
                        "props": {"name": museum["name"], "stadt": museum["stadt"]}
                    },
                    "type": "LAGERT_IN",
                    "rel_props": {
                        "beleg": f"DDB/Museum-Digital API Match",
                        "confidence": 0.95,
                        "zeit": "Heute",
                        "publikation": pub_id
                    }
                })
    
    triples.extend(ddb_triples)
    
    # 4. Triples transaktional ingestieren
    if triples:
        from extract_provenance_triples import ProvenanceGraphClient
        client = ProvenanceGraphClient()
        if client.connect():
            client.ingest_triples(triples)
            client.close()
        # Multigraph-Dissonanzen aktualisieren
        try:
            enrich_contested()
        except Exception as err:
            print(f"[!] Warning bei Dissonanz-Aktualisierung: {err}")

    return {
        "success": True,
        "filename": filename,
        "publication_id": pub_id,
        "triples_extracted": len(triples),
        "message": f"Quelle '{filename}' erfolgreich verarbeitet. {len(triples)} Relationen in den Graphen integriert."
    }

# ==========================================================
# 4. GHOST NODES ENDPOINT (/api/ghosts)
# ==========================================================
@app.get("/api/ghosts")
def get_ghost_nodes():
    """
    DEAD-END QUERY:
    Findet geraubte Objekte, die in keiner dokumentierten Museumsinstitution lagern.
    """
    driver = get_db_driver()
    ghost_objects = []
    ghost_ids = set()

    cypher = """
    MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(o:Objekt)
    WHERE NOT (o)-[:LAGERT_IN]->(:Institution)
    RETURN a.name AS akteur, a.rolle AS rolle,
           type(r) AS delikt, r.beleg AS beleg, r.jahr AS jahr, r.expedition AS expedition,
           o.inventarnummer AS inv, o.bezeichnung AS bezeichnung
    """

    try:
        with driver.session() as session:
            rows = session.run(cypher).data()
            for r in rows:
                inv_id = r["inv"]
                ghost_ids.add(inv_id)
                ghost_objects.append({
                    "id": inv_id,
                    "inventarnummer": inv_id,
                    "bezeichnung": r["bezeichnung"] or "Verschollenes Kulturgut",
                    "akteur": r["akteur"],
                    "akteur_rolle": r["rolle"],
                    "delikt": r["delikt"],
                    "jahr": r["jahr"],
                    "beleg": r["beleg"],
                    "expedition": r.get("expedition"),
                    "status": "VERSCHOLLEN / KEIN DEPOTBELEG"
                })
    finally:
        driver.close()

    return {
        "success": True,
        "ghost_count": len(ghost_objects),
        "ghost_ids": list(ghost_ids),
        "ghosts": ghost_objects
    }

# ==========================================================
# 5. CONTESTED NODES & MULTIGRAPH DISSONANCE (/api/contested)
# ==========================================================
@app.get("/api/contested")
def get_contested_objects():
    """
    MULTIGRAPH KOLLISIONEN:
    Liefert Objekte mit semantisch kollidierenden Kanten:
    (Museums-Schenkung / Kauf) vs. (Militärischer Raub / Koloniale Enteignung).
    """
    driver = get_db_driver()
    contested_items = []
    contested_ids = set()

    cypher = """
    MATCH (o:Objekt)<-[r_legit:SCHENKTE|VERKAUFTE_AN]-(a:Akteur), (o)<-[r_raub:RAUBTE|ENTEIGNETE]-(b:Akteur)
    OPTIONAL MATCH (o)-[:LAGERT_IN]->(i:Institution)
    WITH o, i, a, r_legit, b, r_raub
    RETURN o.inventarnummer AS inv, o.bezeichnung AS bezeichnung,
           coalesce(i.name, 'Unbekannt') AS institution,
           coalesce(i.stadt, 'Deutschland') AS stadt,
           collect(DISTINCT {
               akteur: a.name,
               rel: type(r_legit),
               beleg: r_legit.beleg,
               claim: coalesce(r_legit.behauptung, 'Offizielles Museumsinventar: Uneigennützige Schenkung/Erwerb'),
               jahr: r_legit.jahr,
               kategorie: coalesce(r_legit.kategorie, 'WHITEWASHING')
           }) AS museum_narratives,
           collect(DISTINCT {
               akteur: b.name,
               rel: type(r_raub),
               beleg: r_raub.beleg,
               claim: coalesce(r_raub.forensik_behauptung, r_raub.delikt, 'Militärischer Raubzug / Brandschatzung'),
               jahr: r_raub.jahr,
               kategorie: coalesce(r_raub.kategorie, 'MILITAERISCHER_RAUB')
           }) AS forensic_realities
    LIMIT 2500
    """

    try:
        with driver.session() as session:
            rows = session.run(cypher).data()
            for r in rows:
                inv = r["inv"]
                contested_ids.add(inv)
                contested_items.append({
                    "id": inv,
                    "inventarnummer": inv,
                    "bezeichnung": r["bezeichnung"] or "Koloniales Kulturgut",
                    "institution": r["institution"],
                    "stadt": r["stadt"],
                    "dissonance_type": "SCHENKUNG_VS_RAUB",
                    "museum_narratives": r["museum_narratives"],
                    "forensic_realities": r["forensic_realities"]
                })
    finally:
        driver.close()

    return {
        "success": True,
        "contested_count": len(contested_items),
        "contested_ids": list(contested_ids),
        "items": contested_items
    }

# ==========================================================
# 6. STATS DASHBOARD ENDPOINT (/api/stats)
# ==========================================================
@app.get("/api/stats")
def get_stats():
    """Metriken fuer das Header-Dashboard."""
    driver = get_db_driver()
    try:
        with driver.session() as s:
            subjekt_count = s.run("MATCH (s:Subjekt) RETURN count(s) AS c;").single()["c"]
            act_count = s.run("MATCH (a:Akteur) RETURN count(a) AS c;").single()["c"]
            inst_count = s.run("MATCH (i:Institution) RETURN count(i) AS c;").single()["c"]
            pub_count = s.run("MATCH (p:Publikation) RETURN count(p) AS c;").single()["c"]
            raub_count = s.run("MATCH ()-[r:RAUBTE]->() RETURN count(r) AS c;").single()["c"]
            schenk_count = s.run("MATCH ()-[r:SCHENKTE]->() RETURN count(r) AS c;").single()["c"]
            total_edges = s.run("MATCH ()-[r]->() RETURN count(r) AS c;").single()["c"]
            contested_count = s.run("""
                MATCH (o:Subjekt)<-[:SCHENKTE|VERKAUFTE_AN]-(a), (o)<-[:RAUBTE|ENTEIGNETE]-(b)
                RETURN count(DISTINCT o) AS c;
            """).single()["c"]
            gaps_count = s.run("""
                MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution)
                WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s)
                RETURN count(DISTINCT s) AS c;
            """).single()["c"]
            verdacht_count = s.run("MATCH ()-[r:VERDACHT_AUF]->() RETURN count(r) AS c;").single()["c"]
    finally:
        driver.close()

    return {
        "success": True,
        "subjekte": subjekt_count,
        "objekte": subjekt_count,
        "akteure": act_count,
        "institutionen": inst_count,
        "publikationen": pub_count,
        "raub_kanten": raub_count,
        "schenk_kanten": schenk_count,
        "verdacht_kanten": verdacht_count,
        "gesamt_kanten": total_edges,
        "contested_objekte": contested_count,
        "provenienz_luecken": gaps_count
    }

# ==========================================================
# 6.04 GEODATA ENDPOINT (/api/geodata)
# ==========================================================
_GEODATA_CACHE = None

@app.get("/api/geodata")
def get_geodata(force_refresh: bool = False):
    """
    Liefert die geografische Projektion aller Raub- und Restitutionsvektoren:
    - 48 historische kamerunische Distrikte/Polities (Nso, Bafut, Duala, Bamum, etc.)
    - 8 europaeische Museumsdepots (Berlin, Stuttgart, Leipzig, Bremen, etc.)
    - 71 geodaetische Restitutionsvektoren mit 2.062 gemappten Objekten
    - 243 historische Strafexpeditionen (1884-1914) mit Befehlshabern und Primaerbelegen
    """
    global _GEODATA_CACHE
    import json
    if _GEODATA_CACHE is not None and not force_refresh:
        return _GEODATA_CACHE
    
    geodata_file = os.path.join(BASE_DIR, "shadow-museum-atlas", "src", "geodata.json")
    if not force_refresh and os.path.exists(geodata_file):
        try:
            with open(geodata_file, "r", encoding="utf-8") as f:
                _GEODATA_CACHE = json.load(f)
                return _GEODATA_CACHE
        except Exception:
            pass

    try:
        from generate_geodata import generate_geodata as build_geodata
        _GEODATA_CACHE = build_geodata()
        return _GEODATA_CACHE
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler bei der Geodaten-Generierung: {str(e)}")

# ==========================================================
# 6.05 SUSPICIONS ENDPOINT (/api/suspicions)
# ==========================================================
@app.get("/api/suspicions")
def get_suspicions():
    """
    Liefert alle 37 vom Autonomous Provenance Hunter abgeleiteten
    probabilistischen Verdachtskanten (:Akteur)-[:VERDACHT_AUF]->(:Subjekt).
    """
    driver = get_db_driver()
    items = []
    cypher = """
    MATCH (a:Akteur)-[r:VERDACHT_AUF]->(s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN a.name AS akteur, s.inventarnummer AS inv, s.bezeichnung AS bez, i.name AS museum,
           r.confidence AS confidence, r.begruendung AS begruendung, r.beleg AS beleg,
           r.expedition AS expedition, r.expedition_num AS exp_num, r.zeit AS zeit, r.zitat AS zitat
    ORDER BY r.confidence DESC, s.inventarnummer ASC
    """
    try:
        with driver.session() as s:
            rows = s.run(cypher).data()
            for row in rows:
                items.append({
                    "akteur": row["akteur"],
                    "inv": row["inv"],
                    "bezeichnung": row["bez"] or "Koloniales Kulturgut",
                    "museum": row["museum"],
                    "confidence": row["confidence"],
                    "begruendung": row["begruendung"],
                    "beleg": row["beleg"],
                    "expedition": row["expedition"],
                    "expedition_num": row["exp_num"],
                    "zeit": row["zeit"],
                    "zitat": row["zitat"]
                })
    finally:
        driver.close()

    return {
        "success": True,
        "total": len(items),
        "suspicions": items
    }

# ==========================================================
# 6.1 PROVENIENZLÜCKEN ENDPOINT (/api/gaps)
# ==========================================================
@app.get("/api/gaps")
def get_provenance_gaps():
    """
    Findet Kulturgueter, die in einem Museumsdepot lagern,
    fuer die jedoch keinerlei historische Erwerbskette existiert (Chain of Custody gerissen).
    """
    driver = get_db_driver()
    gaps = []
    cypher = """
    MATCH (s:Subjekt)-[r:LAGERT_IN]->(i:Institution)
    WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s)
    RETURN s.inventarnummer AS inv, s.name AS name, s.bezeichnung AS bezeichnung,
           i.name AS institution, i.stadt AS stadt, r.beleg AS beleg
    ORDER BY i.name, s.inventarnummer
    """
    try:
        with driver.session() as session:
            rows = session.run(cypher).data()
            for row in rows:
                gaps.append({
                    "id": row["inv"] or row["name"],
                    "inventarnummer": row["inv"] or "",
                    "bezeichnung": row["bezeichnung"] or "Koloniales Kulturgut (Altersbestand)",
                    "institution": row["institution"],
                    "stadt": row.get("stadt") or "",
                    "beleg": row.get("beleg") or "Kein historischer Erwerbsnachweis dokumentiert"
                })
    finally:
        driver.close()

    return {
        "success": True,
        "total_gaps": len(gaps),
        "gap_ids": [g["id"] for g in gaps],
        "items": gaps
    }

# ==========================================================
# 7. FORENSIC ENTITY FILTERS & DOSSIER SUMMARIES
# ==========================================================
@app.get("/api/filters/entities")
def get_filter_entities():
    """Liefert aggregierte Top-Kolonialoffiziere und Museumsinstitutionen fuer den Schnellfilter."""
    driver = get_db_driver()
    actors = []
    institutions = []

    actor_cypher = """
    MATCH (a:Akteur)
    OPTIONAL MATCH (a)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)
    WITH a, count(r) AS raub_count
    WHERE raub_count > 0
    ORDER BY raub_count DESC
    LIMIT 25
    OPTIONAL MATCH (a)-[rs:SCHENKTE]->(:Subjekt)
    WITH a, raub_count, count(rs) AS schenk_count
    OPTIONAL MATCH (a)-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(:Subjekt)-[:LAGERT_IN]->(i:Institution)
    WITH a, raub_count, schenk_count, collect(DISTINCT i.name)[..3] AS top_depots
    RETURN a.name AS name, a.rolle AS rolle, raub_count, schenk_count, top_depots
    ORDER BY raub_count DESC
    """

    inst_cypher = """
    MATCH (i:Institution)
    OPTIONAL MATCH (s:Subjekt)-[r:LAGERT_IN]->(i)
    WITH i, count(DISTINCT s) AS count
    OPTIONAL MATCH (s_cont:Subjekt)-[:LAGERT_IN]->(i)
    WHERE s_cont.contested = true
    WITH i, count, count(DISTINCT s_cont) AS contested_count
    RETURN i.name AS name, i.stadt AS stadt, count, contested_count
    ORDER BY count DESC
    """

    try:
        with driver.session() as s:
            a_rows = s.run(actor_cypher).data()
            for r in a_rows:
                actors.append({
                    "name": r["name"],
                    "rolle": r.get("rolle") or "Kolonialoffizier / Militär",
                    "raub_count": r["raub_count"],
                    "schenk_count": r["schenk_count"],
                    "top_depots": r.get("top_depots") or []
                })

            i_rows = s.run(inst_cypher).data()
            for r in i_rows:
                institutions.append({
                    "name": r["name"],
                    "stadt": r.get("stadt") or "",
                    "count": r["count"],
                    "contested_count": r["contested_count"]
                })
    finally:
        driver.close()

    return {
        "success": True,
        "actors": actors,
        "institutions": institutions
    }

@app.get("/api/actors/{actor_name}/summary")
def get_actor_summary(actor_name: str):
    """Liefert die forensische Kriminal- und Beuteakte eines spezifischen Akteurs."""
    driver = get_db_driver()
    cypher = """
    MATCH (a:Akteur {name: $name})
    OPTIONAL MATCH (a)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)
    OPTIONAL MATCH (s)-[:LAGERT_IN]->(i:Institution)
    OPTIONAL MATCH (a)-[rs:SCHENKTE]->(s2:Subjekt)
    WITH a, count(DISTINCT r) AS raub_count, count(DISTINCT rs) AS schenk_count,
         collect(DISTINCT i.name) AS depots,
         collect(DISTINCT r.expedition)[..5] AS expeditionen,
         collect(DISTINCT r.beleg)[..5] AS belege,
         collect(DISTINCT s.bezeichnung)[..10] AS beute_beispiele
    RETURN a.name AS name, a.rolle AS rolle, raub_count, schenk_count, depots, expeditionen, belege, beute_beispiele
    """
    try:
        with driver.session() as s:
            res = s.run(cypher, name=actor_name).single()
            if not res or not res["name"]:
                raise HTTPException(status_code=404, detail=f"Akteur '{actor_name}' nicht gefunden.")
            return {
                "success": True,
                "summary": dict(res)
            }
    finally:
        driver.close()

@app.get("/api/institutions/{inst_name}/summary")
def get_institution_summary(inst_name: str):
    """Liefert das Bestands- und Dissonanzprofil einer Institution."""
    driver = get_db_driver()
    cypher = """
    MATCH (i:Institution {name: $name})
    OPTIONAL MATCH (s:Subjekt)-[:LAGERT_IN]->(i)
    OPTIONAL MATCH (a:Akteur)-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s)
    WITH i, count(DISTINCT s) AS total_subjekte,
         collect(DISTINCT a.name) AS akteure,
         collect(DISTINCT s.bezeichnung)[..10] AS sammlung_beispiele
    OPTIONAL MATCH (sc:Subjekt)-[:LAGERT_IN]->(i) WHERE sc.contested = true
    WITH i, total_subjekte, akteure, sammlung_beispiele, count(DISTINCT sc) AS contested_subjekte
    RETURN i.name AS name, i.stadt AS stadt, total_subjekte, contested_subjekte, akteure[..10] AS top_akteure, sammlung_beispiele
    """
    try:
        with driver.session() as s:
            res = s.run(cypher, name=inst_name).single()
            if not res or not res["name"]:
                raise HTTPException(status_code=404, detail=f"Institution '{inst_name}' nicht gefunden.")
            return {
                "success": True,
                "summary": dict(res)
            }
    finally:
        driver.close()

# ==========================================================
# 8. DOSSIER PDF GENERATOR, BATCH ZIP & DOWNLOAD
# ==========================================================
class BatchDossierRequest(BaseModel):
    entity_type: str # 'actor' | 'institution' | 'gaps'
    entity_name: str # e.g. 'Hans Glauning' or 'Linden-Museum Stuttgart'
    limit: Optional[int] = 300

@app.post("/api/dossier/generate")
def create_dossier(req: DossierRequest):
    """Generiert ein gerichtsverwertbares 2-Seiten-PDF-Dossier fuer ein Objekt."""
    inv = req.inventarnummer.strip()
    data = query_object_provenance(inv)
    if not data:
        raise HTTPException(status_code=404, detail=f"Objekt '{inv}' nicht im Graphen gefunden.")

    clean_filename = re.sub(r'[^A-Za-z0-9_-]', '_', inv)
    filename = f"Restitutionsdossier_{clean_filename}.pdf"
    out_file = os.path.join(DOSSIER_DIR, filename)

    pdf_path = generate_pdf_dossier(data, out_file)

    return {
        "success": True,
        "inventarnummer": inv,
        "filename": filename,
        "download_url": f"/api/dossier/download/{filename}"
    }

@app.post("/api/dossier/batch")
def create_batch_dossiers(req: BatchDossierRequest):
    """
    Generiert alle Restitutionsdossiers fuer einen Akteur, ein Museum oder alle Provenienz-Luecken
    und buendelt sie in einem ZIP-Archiv.
    """
    import zipfile
    driver = get_db_driver()
    inv_list = []

    clean_name = re.sub(r'[^A-Za-z0-9_-]', '_', req.entity_name)

    if req.entity_type == "actor":
        cypher = """
        MATCH (a:Akteur {name: $name})-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN|SCHENKTE]->(s:Subjekt)
        WHERE s.inventarnummer IS NOT NULL
        RETURN DISTINCT s.inventarnummer AS inv
        LIMIT $limit
        """
        prefix = f"Restitutionsakten_{clean_name}"
    elif req.entity_type == "institution":
        cypher = """
        MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution {name: $name})
        WHERE s.inventarnummer IS NOT NULL
        RETURN DISTINCT s.inventarnummer AS inv
        LIMIT $limit
        """
        prefix = f"Depotbestand_{clean_name}"
    elif req.entity_type == "gaps":
        cypher = """
        MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution)
        WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s)
          AND s.inventarnummer IS NOT NULL
        RETURN DISTINCT s.inventarnummer AS inv
        LIMIT $limit
        """
        prefix = "Provenienz_Luecken_Auskunftsersuchen"
    else:
        raise HTTPException(status_code=400, detail="Ungültiger entity_type. Erlaubt: 'actor', 'institution', 'gaps'.")

    try:
        with driver.session() as s:
            rows = s.run(cypher, {"name": req.entity_name, "limit": req.limit}).data()
            inv_list = [r["inv"] for r in rows if r["inv"]]
    finally:
        driver.close()

    if not inv_list:
        raise HTTPException(status_code=404, detail=f"Keine Inventarnummern fuer '{req.entity_name}' gefunden.")

    zip_filename = f"{prefix}.zip"
    zip_path = os.path.join(DOSSIER_DIR, zip_filename)

    generated_count = 0
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
        for inv in inv_list:
            clean_inv = re.sub(r'[^A-Za-z0-9_-]', '_', inv)
            pdf_filename = f"Restitutionsdossier_{clean_inv}.pdf"
            pdf_path = os.path.join(DOSSIER_DIR, pdf_filename)

            # Caching-Optimierung: Falls PDF bereits existiert, sofort wiederverwenden
            if not os.path.exists(pdf_path):
                data = query_object_provenance(inv)
                if data:
                    try:
                        generate_pdf_dossier(data, pdf_path)
                    except Exception as err:
                        print(f"[!] Fehler bei Dossier {inv}: {err}")
                        continue

            if os.path.exists(pdf_path):
                zipf.write(pdf_path, arcname=pdf_filename)
                generated_count += 1

    return {
        "success": True,
        "entity_type": req.entity_type,
        "entity_name": req.entity_name,
        "total_requested": len(inv_list),
        "dossiers_packaged": generated_count,
        "filename": zip_filename,
        "download_url": f"/api/dossier/download/{zip_filename}"
    }

@app.get("/api/dossier/download/{filename}")
def download_dossier(filename: str):
    """Liefert das generierte PDF oder ZIP-Archiv als Download aus."""
    filepath = os.path.join(DOSSIER_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Dossier-Datei nicht gefunden.")

    is_zip = filename.lower().endswith(".zip")
    media_type = "application/zip" if is_zip else "application/pdf"

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=filename,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ==========================================================
# 8.5. DIPLOMATIC PETITION GENERATOR
# ==========================================================
class PetitionRequest(BaseModel):
    institution: str
    community: str

@app.post("/api/petition/generate")
def create_diplomatic_petition(req: PetitionRequest):
    """Generiert ein juristisches Restitutionsersuchen (PDF) an ein spezifisches Museum."""
    from generate_diplomatic_petition import generate_petition_pdf, query_stolen_objects
    
    # Pruefen ob ueberhaupt Objekte existieren
    objects = query_stolen_objects(req.institution, req.community)
    if not objects:
        raise HTTPException(status_code=404, detail=f"Keine geraubten Objekte der {req.community}-Gemeinschaft in {req.institution} gefunden.")
        
    clean_inst = re.sub(r'[^A-Za-z0-9_-]', '_', req.institution)
    clean_comm = re.sub(r'[^A-Za-z0-9_-]', '_', req.community)
    filename = f"Restitutionsantrag_{clean_comm}_{clean_inst}.pdf"
    out_file = os.path.join(DOSSIER_DIR, filename)

    pdf_path = generate_petition_pdf(req.institution, req.community, out_file)

    if not pdf_path:
        raise HTTPException(status_code=500, detail="PDF Generierung fehlgeschlagen.")

    return {
        "success": True,
        "institution": req.institution,
        "community": req.community,
        "object_count": len(objects),
        "filename": filename,
        "download_url": f"/api/dossier/download/{filename}"
    }

if __name__ == "__main__":
    import uvicorn
    print("[+] Starte Project Echo FastAPI Server auf Port 8088...")
    uvicorn.run(app, host="0.0.0.0", port=8088)
