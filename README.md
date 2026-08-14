# Project Echo (Aethelnet Forge App)

**Algorithmic Restitution Framework for Stolen Heritage**

Project Echo is an advanced analytical engine designed to cross-reference colonial archives, historic flight/shipping routes, and oral histories. By utilizing a **Liquid Graph Neural Network (LGNN)**, Echo discovers non-obvious topological connections between museum inventories and lost cultural artifacts.

---

## Overview
This repository contains the standalone, decoupled engine and presentation layer for Project Echo, structured as a certified **Aethelnet OS Forge Application**. It is designed to be easily deployed by researchers, historians, and restitution organizations (e.g., Masoso e.V.).

### Key Features
- **LGNN Tensor Core**: PyTorch-based neural engine trained on multi-modal historic provenance data to calculate loot probability and semantic cosine similarity.
- **Wikidata SPARQL Crawler (`echo_hunter.py`)**: Bypasses museum WAFs by querying decentralized knowledge graphs directly.
- **Social Engineering / Psyop Dispatcher (`echo_psyop_twitter.py`)**: Automatically generates demand-for-restitution campaigns based on validated high-confidence discoveries.
- **Cinematic 3D Force Graph UI**: A glassmorphic dark-mode web interface for visualizing provenance network topologies in real-time.
- **Forge App Native**: Includes standard `forge-app.json` manifest, systemd service units, and one-click launch scripts.

---

## Project Structure
```text
project-echo/
├── forge-app.json              # Aethelnet Forge Application Manifest
├── pyproject.toml              # Standard Python packaging
├── requirements.txt            # Python dependencies
├── backend/
│   ├── echo_engine.py          # Main Flask API and Graph Router (Port 5000)
│   ├── echo_hunter.py          # Background Wikidata SPARQL Crawler Daemon
│   ├── echo_lgnn_tensor.py     # PyTorch LGNN Neural Tensor Architecture
│   ├── echo_psyop_twitter.py   # Restitution Tweet Dispatcher
│   ├── echo_topology.py        # 3D Graph Topology Generator
│   ├── hunter_database.json    # Verified Looted Artifacts Database
│   ├── psyop_drafts.json       # Generated Restitution Campaigns
│   └── topology_graph.json     # 3D Force-Graph Data
├── frontend/
│   ├── index.html              # Cinematic UI (Dark Mode + 3D Force Graph)
│   └── prototype.html          # Legacy minimal UI
├── model/
│   └── echo_tensor_core_v1.pth # Pre-trained LGNN weights
├── scripts/
│   └── run.sh                  # One-click startup script for all services
└── systemd/
    └── aethelnet-echo.service  # Systemd service unit for 24/7 background operation
```

---

## Getting Started

### 1. One-Click Launch (Recommended)
```bash
./scripts/run.sh
```
* **API Server:** `http://localhost:5000`
* **Web UI:** `http://localhost:8089`

### 2. Run with Systemd (Persistent Daemon)
```bash
systemctl --user enable --now aethelnet-echo.service
```

---

## License
This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for details.

---
*Built with precision and purpose by the Aethelnet Team for Masoso e.V.*
