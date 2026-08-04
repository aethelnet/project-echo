# Project Echo 🏺🔍

**Algorithmic Restitution Framework for Stolen Heritage**

Project Echo is an advanced analytical engine designed to cross-reference colonial archives, historic flight/shipping routes, and oral histories. By utilizing a **Liquid Graph Neural Network (LGNN)**, Echo discovers non-obvious topological connections between museum inventories and lost cultural artifacts.

## Overview
This repository contains the standalone, decoupled engine and presentation layer for Project Echo, originally forked from the Aethelnet ecosystem. It is designed to be easily deployed by researchers, historians, and restitution organizations (e.g., Masoso e.V.).

### Key Features
- **LGNN Tensor Core**: A PyTorch-based neural engine trained on multi-modal historic data to find semantic and temporal matches.
- **OSINT Crawler**: Automatically ingests and indexes open-source historical archives, news snippets, and digitization APIs.
- **Cinematic UI**: A modern, glassmorphic dark-mode web interface for visualizing network topologies and matches in real-time using D3.js.

## Project Structure
```text
project-echo/
├── backend/
│   ├── echo_engine.py          # Main Flask API and Router
│   ├── echo_lgnn_tensor.py     # PyTorch Network Architecture
│   ├── echo_osint.py           # Archive Intelligence Gatherer
│   └── echo_crawler.py         # Web Scraper for historic context
├── frontend/
│   ├── index.html              # Cinematic UI (Dark Mode + Glassmorphism)
│   └── prototype.html          # Legacy minimal UI
└── model/
    └── echo_tensor_core_v1.pth # Pre-trained LGNN weights
```

## Getting Started

### Prerequisites
- Python 3.10+
- PyTorch
- Flask

### Installation & Execution
1. Clone the repository:
   ```bash
   git clone git@github.com:aethelnet/project-echo.git
   cd project-echo
   ```
2. Install dependencies:
   ```bash
   pip install torch flask sentence-transformers
   ```
3. Run the backend engine:
   ```bash
   python3 backend/echo_engine.py
   ```
4. Open the interface:
   Simply double-click `frontend/index.html` in your browser.

## Philosophy
Project Echo treats history not as a static list of events, but as a fluid, interconnected graph. By mapping the movement of artifacts against the movement of people and capital, the engine highlights discrepancies and surfaces evidence of illicit transfer.

## License
This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for details.

---
*Built with precision and purpose by the Aethelnet Team for Masoso e.V.*
