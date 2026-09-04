#!/usr/bin/env python3
"""
PROJECT ECHO: DETERMINISTIC GRAPH SEED IMPORTER
Importiert den vollstaendigen Restitutions-Graphen aus seed_graph.json.gz nach Neo4j.
Idempotent, transaktional gebatcht und blitzschnell (< 5 Sekunden) ueber UNIQUE Indexes.
"""

import os
import gzip
import json
import time
from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
SEED_FILE = os.getenv("SEED_FILE", os.path.join(os.path.dirname(__file__), "seed_graph.json.gz"))

def run_import():
    if not os.path.exists(SEED_FILE):
        print(f"[!] Seed-Datei nicht gefunden: {SEED_FILE}")
        return False

    print(f"[*] Verbinde mit Neo4j unter {NEO4J_URI}...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=None)
    
    # 1. Constraints anlegen
    constraints = [
        "CREATE CONSTRAINT IF NOT EXISTS FOR (o:Objekt) REQUIRE o.inventarnummer IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (s:Subjekt) REQUIRE s.inventarnummer IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (a:Akteur) REQUIRE a.name IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (i:Institution) REQUIRE i.name IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Publikation) REQUIRE p.id IS UNIQUE"
    ]
    
    with driver.session() as session:
        for c in constraints:
            session.run(c)
    
    # 2. Daten laden
    print(f"[*] Entpacke und lade {SEED_FILE}...")
    t0 = time.time()
    with gzip.open(SEED_FILE, "rt", encoding="utf-8") as f:
        data = json.load(f)
    
    nodes = data.get("nodes", [])
    rels = data.get("relationships", [])
    print(f"[+] {len(nodes)} Knoten und {len(rels)} Relationen geladen.")

    # 3. Knoten importieren
    nodes_by_label = {}
    for n in nodes:
        lbl = n["labels"][0] if n["labels"] else "Entity"
        nodes_by_label.setdefault(lbl, []).append(n)

    with driver.session() as session:
        for lbl, n_list in nodes_by_label.items():
            if lbl in ["Objekt", "Subjekt"]:
                cypher = f"""
                UNWIND $batch AS item
                MERGE (n:{lbl} {{inventarnummer: item.props.inventarnummer}})
                SET n += item.props
                """
            elif lbl == "Publikation":
                cypher = f"""
                UNWIND $batch AS item
                MERGE (n:Publikation {{id: item.props.id}})
                SET n += item.props
                """
            else:
                cypher = f"""
                UNWIND $batch AS item
                MERGE (n:{lbl} {{name: item.props.name}})
                SET n += item.props
                """
            
            for i in range(0, len(n_list), 1000):
                chunk = n_list[i:i+1000]
                session.run(cypher, {"batch": chunk})
            print(f"  -> {len(n_list)} :{lbl}-Knoten initialisiert.")

    # 4. Kanten importieren ueber indexierte Labels und Properties
    grouped_rels = {}
    for r in rels:
        s_lbl = r.get("s_label") or "Entity"
        t_lbl = r.get("t_label") or "Entity"
        s_prop = "inventarnummer" if r.get("s_inv") else "name"
        t_prop = "inventarnummer" if r.get("t_inv") else "name"
        s_val = r.get("s_inv") or r.get("s_name")
        t_val = r.get("t_inv") or r.get("t_name")
        if not s_val or not t_val:
            continue
        
        group_key = (r["type"], s_lbl, s_prop, t_lbl, t_prop)
        grouped_rels.setdefault(group_key, []).append({
            "s_val": s_val,
            "t_val": t_val,
            "props": r.get("props", {})
        })

    with driver.session() as session:
        for (r_type, s_lbl, s_prop, t_lbl, t_prop), items in grouped_rels.items():
            cypher = f"""
            UNWIND $batch AS r
            MATCH (s:{s_lbl} {{{s_prop}: r.s_val}})
            MATCH (t:{t_lbl} {{{t_prop}: r.t_val}})
            MERGE (s)-[rel:{r_type}]->(t)
            SET rel += r.props
            """
            for i in range(0, len(items), 2000):
                chunk = items[i:i+2000]
                session.run(cypher, {"batch": chunk})
            print(f"  -> {len(items)} (:{s_lbl})-[:{r_type}]->(:{t_lbl}) Relationen injiziert.")

    driver.close()
    t1 = time.time()
    print(f"[+] Import erfolgreich abgeschlossen in {t1 - t0:.2f} Sekunden.")
    return True

if __name__ == "__main__":
    run_import()
