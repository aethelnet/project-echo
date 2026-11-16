# Project Echo // Shadow Museum Provenance Atlas

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Architecture](https://img.shields.io/badge/Engine-FastAPI%20%2B%20Embedded%20Graph%20%7C%20Neo4j-black)](#)
[![Legal Basis](https://img.shields.io/badge/Forensics-HLKO%20Art.%2056%20%7C%20Washington%20Principles-991b1b)](#)

**Project Echo (`Shadow Museum Provenance Atlas`)** ist eine forensische Graph- und Geodaten-Forschungsumgebung zur Rekonstruktion kolonialer Provenienz-Netzwerke (Kamerun 1884–1916), zur Aufdeckung musealer Narrativ-Kollisionen (*"Schenkung"* vs. *Militärischer Raubzug*) und zur automatisierten Erstellung gerichtsverwertbarer PDF-Restitutionsdossiers.

---

## Kernfunktionen

1. **Dual-Engine Wissensgraph (Zero-Docker Embedded Store + optionales Neo4j Bolt)**:
   - Startet **sofort ohne Docker** direkt aus dem verifizierten Forschungs-Snapshot `seed_graph.json.gz` (**`2.223` Knoten**, **`6.628` belegte Relationen**, `2.148` Kulturgut-Subjekte, `60` koloniale Akteure, `8` deutsche Museumsdepots, `7` Primärpublikationen).
   - Verbindet sich automatisch mit einer lokalen oder externen **Neo4j-5-Instanz** (`bolt://localhost:7687`), sobald diese verfügbar ist (für > 40.000 Objekte im Makro-Cluster-Modus).

2. **Multigraph-Dissonanz & Forensische Spezialfilter**:
   - **Contested Narratives (`1.999` Kollisionen)**: Stellt offizielle Museumsinventar-Einträge (`SCHENKTE` / `VERKAUFTE_AN`) unmittelbar den militärischen Primärquellen (`RAUBTE` / `ENTEIGNETE` mit Seitenzahl-Belegen u. a. aus dem *Atlas der Abwesenheit*) gegenüber.
   - **Provenienzlücken (`83` Depots ohne Erwerbskette)** inklusive Ein-Klick-Generator für Auskunftsersuchen nach dem Informationsfreiheitsgesetz (IFG).
   - **Ghost-Subjekte & Probabilistische Verdachtskanten (`VERDACHT_AUF`)**: Identifiziert verschollene Beutekunst ohne heutigen Depotnachweis sowie zeitlich-räumliche Expeditions-Korrelationen.

3. **Geodätische Restitutions-Karte (`[GEO-KARTE (RESTITUTION)]`) & POI-Fallakte**:
   - Interaktive Projektion von `48` historischen Polities/Distrikten Kameruns, `243` dokumentierten Militär- und Strafexpeditionen und `71` Depot-Transfervektoren nach Europa sowie ein kuratierbares **Leitobjekt-Pinboard (`POIs`)** für gezielte Einzelfall-Restitutionen.

4. **Visuelle Foto-Ketten-Forensik (`[BILD-FORENSIK (FOTO-KETTE)]`)**:
   - Rekonstruiert Objektbiografien **ohne durchgängige Inventarnummer** allein über datierte historische Bildreihen (*Feldaufnahme Glasplatte 1902* $\rightarrow$ *Händlerkatalog 1908* $\rightarrow$ *heutige Depotaufnahme*).
   - **Kulturell respektvolle Strukturgeometrie statt Pauschal-Stil-KI**: Beleuchtungsinvariante `RootSIFT-128D` Mikrostruktur-Deskriptoren kombiniert mit striktem **6-DOF Affin-RANSAC** und kalibrierter **Shannon-Entropie $H(p)$** weisen verwandte Schnitzwerke derselben Kultur sauber als Nicht-Identisch zurück und geben Spuren erst nach **Human-in-the-Loop-Fachprüfung** in den Wissensgraphen frei.

5. **Globale Mehrsprachige Quellen-Ingestion (`DE / EN / FR`) & HLKO-Restitutionspakete**:
   - Erkennt neben deutschen Sammlungen (`III C`, `VK`) weltweit Inventarformate (`British Museum Af1897,...`, `Musée du quai Branly 71.1892...`, `AfricaMuseum Tervuren EO.0.0...`), internationale Museen, Herkunftsgemeinschaften (u. a. *Benin/Edo, Asante, Dahomey, Nso, Bamum, Ovaherero/Nama, Maji-Maji, Maqdala, Rapa Nui*) sowie dynamisch betitelte historische Akteure in PDF-, TXT-, CSV- und XLSX-Quellen.
   - Erzeugt per Klick druckreife **Einzel-Restitutionsdossiers (PDF)**, **Routen-/Akteurs-Sammelarchive (ZIP)** sowie asynchrone **völkerrechtliche Restitutionsersuchen nach Art. 46, 47, 56 HLKO**.

---

## Schnelleinstieg (Zero-Docker)

```bash
# 1. Python-Abhängigkeiten & Frontend-Bundle einmalig bauen
pip install -r requirements.txt
cd shadow-museum-atlas && npm install && npm run build && cd ..

# 2. Komplettes System (API + kompiliertes Shadow-Museum-Frontend) auf Port 8088 starten
python3 serve_graph_api.py
```

Im Browser öffnen:
**[http://localhost:8088](http://localhost:8088)**

*(Für Schreiboperationen wie Annotationen, manuelle Kanten oder Dokument-Uploads `ECHO_RESEARCHER_KEY` setzen, z. B. `ECHO_RESEARCHER_KEY=mein-schluessel python3 serve_graph_api.py`.)*

### Optional: Frontend-Entwicklungsmodus & Neo4j-Skalierung
```bash
# Optionales Neo4j-Backend via Docker:
docker run -d --name project-echo-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=none neo4j:5
python3 import_seed.py

# Frontend neu bauen:
cd shadow-museum-atlas && npm install && npm run build
```

---

## Integritäts- & Sicherheits-Testsuite

```bash
python3 -m unittest discover tests -v
```
Prüft Authentifizierung (`{SHA}`, `sha256$`, POSIX `$6$` crypt, Gast-/Forscher-Isolierung), alle Embedded-Graph-Endpunkte, PDF-/ZIP-/HLKO-Generierung, Pfad-Traversal-Schutz sowie die Shannon-Entropie-Invarianten (`backend/echo_lgnn_tensor.py`).
