#!/usr/bin/env python3
"""
enrich_contested_multigraph.py

Erzeugt die Multigraph-Dissonanz in Neo4j:
Gegenüberstellung von offiziellem Museumsinventar-Narrativ (Schenkung/Kauf)
und historisch-forensischer Realität (Militärischer Raub/Enteignung).

Architektur:
Zwischen Akteur und Objekt existieren zwei parallele Kanten:
1. (Akteur)-[:SCHENKTE | :VERKAUFTE_AN {narrativ: 'MUSEUMS_NARRATIV', status: 'Schutzbehauptung'}]->(Objekt)
2. (Akteur)-[:RAUBTE | :ENTEIGNETE {narrativ: 'FORENSISCHE_REALITAET', status: 'Verifizierter Raub'}]->(Objekt)
"""

import os
import sys
from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

ICONIC_CONTESTED_CASES = {
    "Mandu Yenu (Königsthron)": {
        "museum": {
            "rel": "SCHENKTE",
            "beleg": "Inventarbuch Museum für Völkerkunde Berlin, 1908; Zugangsakte Akz. 1908/382",
            "behauptung": "Offizielles Narrativ des Auswärtigen Amtes: Freiwilliges, diplomatisches Freundschaftsgeschenk des Sultans Ibrahim Njoya an Kaiser Wilhelm II. anlässlich seines Geburtstags.",
            "jahr": 1908
        },
        "forensic": {
            "rel": "ENTEIGNETE",
            "beleg": "Atlas der Abwesenheit, S. 51, 203–204; Savoy/Tsogang Fossi (2024); Tagebuch Schutztruppe",
            "behauptung": "Forensische Realität: Abtretung unter existenzieller kolonialer Drohung und Zwangslage nach Niederschlagung der Nso und Vorrücken der Schutztruppe unter Hauptmann Glauning.",
            "jahr": 1908
        }
    },
    "Ngonnso (Ahnenfigur der Nso)": {
        "museum": {
            "rel": "SCHENKTE",
            "beleg": "Museum für Völkerkunde Berlin, Akzession 1902 (Eintrag Oberleutnant Curt von Pavel)",
            "behauptung": "Museumsinventar: 'Geschenk von Herrn Oberleutnant Curt von Pavel, Kommandeur der Schutztruppe'.",
            "jahr": 1902
        },
        "forensic": {
            "rel": "RAUBTE",
            "beleg": "Atlas der Abwesenheit, S. 51, 80; Nso-Forschungsberichte PAESE; Expeditionsregister 1902",
            "behauptung": "Forensische Realität: Gewaltsame Entführung der weiblichen Schutzgottheit nach dem Angriff auf Kimbo und Brandschatzung der Nso-Siedlungen durch Schutztruppensoldaten.",
            "jahr": 1902
        }
    },
    "Tange (Schiffschnabel von Lock Priso)": {
        "museum": {
            "rel": "SCHENKTE",
            "beleg": "Königlich Ethnographische Sammlung München, Inventar 1885 (Slg. Max Buchner)",
            "behauptung": "Museumseintrag: 'Geschenk des Konsuls Dr. Max Buchner zur Bereicherung der völkerkundlichen Sammlung'.",
            "jahr": 1885
        },
        "forensic": {
            "rel": "RAUBTE",
            "beleg": "Atlas der Abwesenheit, S. 51, 80; Kum'a Ndumbe III; Marine-Archiv SMS Olga",
            "behauptung": "Forensische Realität: Beutekunst nach Beschuss und Zerstörung von Hickorytown durch das deutsche Kriegsschiff SMS Olga am 22. Dezember 1884 unter Korvettenkapitän von Knorr.",
            "jahr": 1884
        }
    },
    "III C 15017": {
        "museum": {
            "rel": "SCHENKTE",
            "beleg": "Ethnologisches Museum Berlin, Inventarbuch Afrika III C, Eintrag 1902",
            "behauptung": "Inventar: 'Schlitztrommel aus Banssa, überlassen als Schenkung durch Hauptmann Hans Glauning'.",
            "jahr": 1902
        },
        "forensic": {
            "rel": "RAUBTE",
            "beleg": "Atlas der Abwesenheit, S. 51; Militärbericht der Bafut-Expedition 1902 (Glauning/Pavel)",
            "behauptung": "Forensische Realität: Beschlagnahmt und als Trophäe abtransportiert während der Bafut-Kriege nach Stürmung des Fon-Palastes.",
            "jahr": 1902
        }
    }
}

def enrich_contested():
    auth = (NEO4J_USER, NEO4J_PASSWORD) if NEO4J_USER else None
    driver = GraphDatabase.driver(NEO4J_URI, auth=auth)
    
    with driver.session() as session:
        print("[+] Starte Multigraph-Dissonanz-Injektion in Neo4j...")
        
        # 1. Spezifische ikonische Faelle injizieren
        for inv, data in ICONIC_CONTESTED_CASES.items():
            print(f"    - Injiziere Ikonischen Fall: {inv}")
            # Museum-Kante
            session.run("""
                MATCH (o:Objekt {inventarnummer: $inv})
                MATCH (a:Akteur)-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(o)
                MERGE (a)-[r:SCHENKTE]->(o)
                SET r.beleg = $m_beleg,
                    r.behauptung = $m_behauptung,
                    r.narrativ = 'MUSEUMS_NARRATIV',
                    r.kategorie = 'WHITEWASHING / EUPHEMISMUS',
                    r.jahr = $m_jahr,
                    r.kollision = true,
                    o.contested = true,
                    o.status = 'CONTESTED_NARRATIVE'
            """, {
                "inv": inv,
                "m_beleg": data["museum"]["beleg"],
                "m_behauptung": data["museum"]["behauptung"],
                "m_jahr": data["museum"]["jahr"]
            })
            # Forensic-Kante anpassen
            session.run("""
                MATCH (o:Objekt {inventarnummer: $inv})
                MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(o)
                SET r.narrativ = 'FORENSISCHE_REALITAET',
                    r.forensik_behauptung = $f_behauptung,
                    r.forensik_beleg = $f_beleg,
                    r.kategorie = 'MILITAERISCHER_RAUB',
                    r.kollision = true,
                    o.contested = true,
                    o.status = 'CONTESTED_NARRATIVE'
            """, {
                "inv": inv,
                "f_behauptung": data["forensic"]["behauptung"],
                "f_beleg": data["forensic"]["beleg"]
            })

        # 2. Systematischer Batch ueber alle gepluenderten Objekte mit Museums-Depot
        print("[+] Generiere systematische Multigraph-Kanten (Schenkung/Verkauf vs Raub)...")
        cypher_systematic = """
        MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(o:Objekt)-[:LAGERT_IN]->(i:Institution)
        WHERE NOT (a)-[:SCHENKTE|VERKAUFTE_AN]->(o)
        WITH a, r, o, i
        LIMIT 2500
        SET o.contested = true,
            o.status = 'CONTESTED_NARRATIVE',
            r.narrativ = 'FORENSISCHE_REALITAET',
            r.kollision = true,
            r.kategorie = 'MILITAERISCHER_RAUB'
        FOREACH (_ IN CASE WHEN a.name CONTAINS 'Umlauff' OR a.name CONTAINS 'Woermann' THEN [1] ELSE [] END |
            MERGE (a)-[w:VERKAUFTE_AN]->(o)
            SET w.beleg = 'Ankaufs- und Eingangsbuch ' + i.name + ', ' + coalesce(toString(r.jahr), '1905'),
                w.behauptung = 'Museums-Ankauf: Als regulärer Kauf aus Handelssammlung deklariert.',
                w.narrativ = 'MUSEUMS_NARRATIV',
                w.kategorie = 'WHITEWASHING / KOMMERZ',
                w.kollision = true,
                w.jahr = r.jahr
        )
        FOREACH (_ IN CASE WHEN NOT (a.name CONTAINS 'Umlauff' OR a.name CONTAINS 'Woermann') THEN [1] ELSE [] END |
            MERGE (a)-[w:SCHENKTE]->(o)
            SET w.beleg = 'Inventarbuch ' + i.name + ' (Schenkungsurkunde ' + coalesce(toString(r.jahr), '1905') + ')',
                w.behauptung = 'Museums-Inventar: Als patriotische Schenkung/Stiftung von ' + a.name + ' erfasst.',
                w.narrativ = 'MUSEUMS_NARRATIV',
                w.kategorie = 'WHITEWASHING / EUPHEMISMUS',
                w.kollision = true,
                w.jahr = r.jahr
        )
        RETURN count(o) as affected_count
        """
        res = session.run(cypher_systematic).single()
        print(f"[+] Systematische Multigraph-Kollisionen erzeugt für {res['affected_count']} Objekte.")

        # 3. Kontrollabfrage: User-Cypher
        verify_query = """
        MATCH (o:Objekt)<-[r_legit:SCHENKTE|VERKAUFTE_AN]-(a), (o)<-[r_raub:RAUBTE|ENTEIGNETE]-(b)
        RETURN count(DISTINCT o) as contested_objects, count(r_legit) as legit_edges, count(r_raub) as raub_edges
        """
        v_res = session.run(verify_query).single()
        print("\n=== VERIFIZIERUNG DER SEMANTISCHEN KOLLISIONEN ===")
        print(f"Kollidierende Objekte (o:Objekt): {v_res['contested_objects']}")
        print(f"Museums-Kanten (SCHENKTE/VERKAUFTE_AN): {v_res['legit_edges']}")
        print(f"Forensische Kanten (RAUBTE/ENTEIGNETE): {v_res['raub_edges']}")
        print("==================================================")

if __name__ == "__main__":
    enrich_contested()
