# Project Echo // Shadow Museum Provenance Atlas

[![Live Demo](https://img.shields.io/badge/Live_Demo-echo.aethelburg.network-16a34a.svg)](https://echo.aethelburg.network)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Architecture](https://img.shields.io/badge/Engine-FastAPI%20%2B%20Embedded%20Graph%20%7C%20Neo4j-black)](#)
[![Legal Basis](https://img.shields.io/badge/Forensics-Hague%20IV%20Art.%2056%20%7C%20Washington%20Principles-991b1b)](#)

> **Serverless Live Demo (instant in-browser, no login or install required — trilingual EN / DE / FR):** **[https://echo.aethelburg.network](https://echo.aethelburg.network)**

**Project Echo (`Shadow Museum Provenance Atlas`)** is a forensic knowledge-graph, geospatial, and visual-provenance research environment for reconstructing colonial provenance networks (Cameroon 1884–1916), surfacing museum narrative collisions (*"donation"* vs. *military looting raid*), and generating court-ready PDF restitution dossiers.

---

## Core Capabilities

1. **Dual-Engine Knowledge Graph (Zero-Docker Embedded Store + Optional Neo4j Bolt)**:
   - Launches **instantly without Docker** directly from the verified research snapshot `seed_graph.json.gz` (**`2,223` nodes**, **`6,628` sourced relations**, `2,148` cultural-heritage objects, `60` colonial actors, `8` German museum depots, `7` primary publications).
   - Automatically connects to a local or remote **Neo4j 5 instance** (`bolt://localhost:7687`) whenever available (scaling to > 40,000 objects in macro-cluster mode).

2. **Multigraph Dissonance & Forensic Filters**:
   - **Contested Narratives (`1,999` collisions)**: Juxtaposes official museum inventory claims (`SCHENKTE` / *donated*, `VERKAUFTE_AN` / *sold*) directly against primary military sources (`RAUBTE` / *looted*, `ENTEIGNETE` / *confiscated*, with page-level citations including the *Atlas der Abwesenheit*).
   - **Provenance Gaps (`83` depot holdings without an acquisition chain)** including a one-click Freedom-of-Information (`FOIA` / German `IFG`) accession-ledger inquiry generator.
   - **Ghost Objects & Probabilistic Suspicion Edges (`VERDACHT_AUF`)**: Surfaces missing looted artifacts with no confirmed current depot alongside spatio-temporal military expedition correlations.

3. **Geospatial Restitution Map (`[GEO-MAP (RESTITUTION)]`) & Key-Object Case Board (`POIs`)**:
   - Interactive projection of `48` historical Cameroonian polities/districts, `243` documented military and punitive expeditions, and `71` depot transfer vectors to Europe, paired with a curatable **Key Objects watchlist (`POIs`)** for targeted restitution casework.

4. **Visual Photo-Chain Forensics (`[VISUAL FORENSICS (PHOTO-CHAIN)]`)**:
   - Reconstructs object biographies **without continuous inventory numbers** solely across dated historical photo series (*1902 glass-plate field photograph* $\rightarrow$ *1908 dealer sales catalog* $\rightarrow$ *contemporary depot digitization*).
   - **Culturally respectful structural geometry instead of generic style AI**: Illumination-invariant `RootSIFT-128D` microstructure descriptors paired with strict **6-DOF Affine RANSAC** and calibrated **Shannon entropy $H(p)$** cleanly reject stylistically related carvings from the same culture as non-identical, committing candidate chains to the knowledge graph only after **Human-in-the-Loop** specialist approval.

5. **Multilingual Source Ingestion (`EN / DE / FR`) & Hague Convention Restitution Packages**:
   - Recognizes German (`III C`, `VK`) and international inventory formats (`British Museum Af1897,...`, `Musée du quai Branly 71.1892...`, `AfricaMuseum Tervuren EO.0.0...`), international museums, communities of origin (including *Benin/Edo, Asante, Dahomey, Nso, Bamum, Ovaherero/Nama, Maji-Maji, Maqdala, Rapa Nui*), and dynamically titled historical actors across PDF, TXT, CSV, and XLSX sources.
   - One-click generation of print-ready **individual restitution dossiers (PDF)**, **route/actor batch archives (ZIP)**, and asynchronous **international-law restitution packages citing Hague Convention IV (HLKO) Arts. 46, 47, and 56**.

---

## Quick Start (Zero-Docker)

```bash
# 1. Install Python dependencies & build the frontend bundle once
pip install -r requirements.txt
cd shadow-museum-atlas && npm install && npm run build && cd ..

# 2. Launch the complete system (API + compiled Shadow Museum frontend) on port 8088
python3 serve_graph_api.py
```

Open in your browser:
**[http://localhost:8088](http://localhost:8088)**

*(For write operations such as annotations, manual edges, or document uploads, set `ECHO_RESEARCHER_KEY`, e.g. `ECHO_RESEARCHER_KEY=my-secret-key python3 serve_graph_api.py`.)*

### Optional: Frontend Dev Mode & Neo4j Scaling
```bash
# Optional Neo4j backend via Docker:
docker run -d --name project-echo-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=none neo4j:5
python3 import_seed.py

# Rebuild frontend:
cd shadow-museum-atlas && npm install && npm run build
```

---

## Integrity & Security Test Suite

```bash
python3 -m unittest discover tests -v
```
Verifies authentication (`{SHA}`, `sha256$`, POSIX `$6$` crypt, guest/researcher isolation), all embedded-graph API endpoints, PDF/ZIP/HLKO dossier generation, path-traversal hardening, and Shannon-entropy calibration invariants (`backend/echo_lgnn_tensor.py`).
