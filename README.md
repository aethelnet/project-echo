# Project Echo: Algorithmic Provenance & Restitution Engine

**Forensische Wissensgraph-Architektur zur Aufdeckung kolonialer Raubnetzwerke und institutioneller Dissonanzen.**

Project Echo ist ein evidenzbasiertes Ermittlungs- und Restitutionswerkzeug für Provenienzforscher, Historiker und Herkunftsgesellschaften (u. a. für Marianne Njioh, Richard Tsogang Fossi und Forschungsgruppen der TU Berlin). Es transformiert fragmentierte koloniale Militärregister, Auktionskataloge, Archivakten und Museumsinventare in einen multidimensionalen gerichtsfesten Wissensgraphen.

---

## 1. Kern-Architektur & Forensische Methodik

### A. Multigraph-Dissonanz-Erkennung (Whitewashing vs. Realität)
Klassische Datenbanken versagen bei widersprüchlichen historischen Narrativen. Project Echo modelliert widersprüchliche Überlieferungen als parallele Kanten zwischen denselben Knoten:
* **[:RAUBTE] / [:ENTEIGNETE]** (Blutrot `#DC2626`): Belegte koloniale Gewaltakte, Strafexpeditionen und Plünderungen (z. B. Hans Glauning, Curt von Pavel, Oltwig von Kamptz).
* **[:SCHENKTE] / [:UEBERGAB_AN]** (Blau `#2563EB`): Offizielle institutionelle Schutzbehauptungen und Schenkungsnarrative der aufnehmenden Museen.
* **Geometrische Doppel-Ellipsen**: Das UI rendert Widersprüche als gegenläufig gekrümmte Kantenpaare (`curvature: ±0.22`), sodass institutionelle Verschleierung auf Pixelebene unmittelbar sichtbar wird.

### B. Autonomer Provenance Hunter (Heuristische Rekonstruktion)
Das System identifiziert systematisch Provenienzlücken (Subjekte mit reinem `[:LAGERT_IN]` ohne dokumentierten Erwerbsakt) und schließt sie automatisiert über 3-Stufen-Inferenz:
1. **Tier 1 (95 % Konfidenz)**: Direkter Inventarnummern-Abgleich gegen historische Strafexpeditionsregister (z. B. TU Berlin Cameroon Expeditions Dataset).
2. **Tier 2 (85–90 % Konfidenz)**: Sequenzielle Zugangs-Batches und Akteurs-Korrelationen.
3. **Tier 3 (85 % Konfidenz)**: Kontextuelle Zuordnungen (z. B. Mandu-Yenu-Prachtthron gekoppelt an Glaunings Nso-Feldzug 1906 und Bundesarchiv-Akten).
* Verdachtsfälle werden im Graphen als gestrichelte Kanten `[:VERDACHT_AUF]` (Cyan `#0891B2`) mit explizitem Konfidenzwert und Aktennachweis visualisiert.

### C. Juristischer Dossier- & IFG-Generator
* **2-Seiten Restitutions-Gutachten (PDF)**: 1-Klick-Generierung gerichtsverwertbarer Dossiers mit Washingtoner-Prinzipien-Schutzklausel, Beweiskette und Primärquellenbelegen.
* **Batch-Export (ZIP)**: Schnürt hunderte Gutachten eines Täters oder Museums in ein gebündeltes ZIP-Archiv.
* **IFG-Auskunftsersuchen**: Generiert für ungelöste Museums-Blackboxes formelle Anträge nach dem Informationsfreiheitsgesetz auf Herausgabe der historischen handschriftlichen Zugangsbücher (1884–1916).

### D. Klinisches Brutalismus-Frontend
* **Reinweiß-Ästhetik (`#FFFFFF`)**: Verzicht auf Schmuckelemente und Emojis zugunsten juristischer Nüchternheit.
* **Ontologische Präzision**: Konsequente Klassifikation als `Subjekte` statt passiver Objekte (Würdigung lebendiger Entitäten wie *Ngonnso*).
* **Interaktive Metrik-Toggles & Schnellfilter-Drawer**: Direkte Isolation der Top-Akteure und Depots.
* **Ausstellungs-Kiosk-Modus**: Autonome Kameraführung zwischen signifikanten Dissonanz-Knoten für Museums- und Tagungspräsentationen.

---

## 2. Repository-Struktur

```text
project-echo/
├── docker-compose.yml              # Multi-Container-Orchestrierung (Neo4j, API, Web)
├── Dockerfile.api                  # Python 3.11 FastAPI Backend mit PDF-Engine
├── Dockerfile.web                  # Multi-Stage Build: Vite React -> Caddy v2
├── Caddyfile                       # Automatisches Let's Encrypt SSL & Basic Auth
├── docker-entrypoint.sh            # Healthcheck & Cold-Start Initialisierung
├── import_seed.py                  # Schneller Cypher-Seed-Importer (<6s Restore)
├── seed_graph.json.gz              # Komprimierter initialer Graph (2.200+ Knoten, 6.600+ Kanten)
├── serve_graph_api.py              # FastAPI REST-Brücke (Filter, Lücken, Dossier-API)
├── autonomous_provenance_hunter.py # Heuristische Inferenz-Pipeline für Provenienzlücken
├── generate_restitution_dossier.py # ReportLab PDF-Generator für Washingtoner Prinzipien
├── extract_provenance_triples.py   # Multi-Format Ingestion Engine (PDF, XLSX, TXT)
├── enrich_contested_multigraph.py  # Dissonanz- und Konflikt-Berechnung
├── DEPLOYMENT.md                   # Vollständige Produktions- und Server-Dokumentation
└── shadow-museum-atlas/            # React + Vite + TypeScript Frontend
    ├── src/
    │   ├── App.tsx                 # ForceGraph2D Canvas, Drawer, Inspektor & Kiosk
    │   └── ...
    └── package.json
```

---

## 3. Schnellanleitung: Lokale Entwicklung

### Voraussetzungen
* Docker & Docker Compose (oder Podman)
* Alternativ: Node.js 18+, Python 3.10+, laufende Neo4j-Instanz (Port 7687)

### Start via Docker Compose
```bash
cp .env.example .env
docker compose up -d --build
```
Die Anwendung ist anschließend unter `http://localhost:80` bzw. `http://localhost:5173` erreichbar.

---

## 4. Lizenz & Ethik

Dieses Projekt steht unter der GNU Affero General Public License v3.0 (AGPL-3.0). Siehe [LICENSE](LICENSE).

Daten und Beweisketten dienen ausschließlich der historischen Aufklärung, Restitutionsbegründung und Rückführung geraubter Kulturgüter an ihre rechtmäßigen Herkunftsgemeinschaften.
