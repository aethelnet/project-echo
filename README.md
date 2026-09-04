# Project Echo: Autonomous Provenance Hunter
**Forschungsumgebung für Provenienzforschung und Netzwerkanalyse**

Dieses Tool wurde für Forscher entwickelt, um koloniale Raubgut-Netzwerke, Akteure und Institutionen dynamisch zu erfassen, zu visualisieren und mit Live-Daten abzugleichen.

## Lokale Installation & Start (Für Studenten & Forschungsgruppen)

Um ein komplett eigenes, privates Netzwerk auf dem eigenen Rechner (z.B. an der TU Berlin) aufzubauen, müssen Sie das System lokal starten.

### Systemvoraussetzungen
- **Docker** (für die Neo4j-Datenbank)
- **Python 3.10+**
- **Node.js 18+**

### 1. Umgebung starten
Klonen Sie das Repository und starten Sie die Infrastruktur:

```bash
# 1. Repository klonen
git clone https://github.com/ProphitEngine/ProphitEngine.git
cd ProphitEngine

# 2. Datenbank (Neo4j) starten
docker run -d --name project-echo-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=none neo4j:5

# 3. Backend (FastAPI) starten
pip install -r requirements.txt
uvicorn serve_graph_api:app --host 0.0.0.0 --port 8088

# 4. Frontend starten (in einem neuen Terminal-Fenster)
cd shadow-museum-atlas
npm install
npm run dev
```
Das Interface ist nun unter `http://localhost:5173` in Ihrem Browser erreichbar.

## Für Forscher: Der Blank-Canvas-Workflow

Wenn Sie mit einem komplett neuen Datensatz oder Forschungsfokus (z.B. einer anderen Region oder Epoche) starten wollen, können Sie das System auf einen **Blank Canvas** (Zero-State) zurücksetzen. 

### 1. Datenbank zurücksetzen
Um die Neo4j-Graphdatenbank vollständig zu leeren und alte Testdaten zu löschen:
1. Öffnen Sie Ihr Terminal.
2. Führen Sie den folgenden Befehl aus, um den Reset-Endpoint anzusteuern:
   ```bash
   curl -X DELETE http://localhost:8088/api/admin/reset
   ```
   *Alternativ können Sie in der Weboberfläche im Admin-Bereich (falls aktiviert) auf "Reset Graph" klicken.*
3. Die Datenbank ist nun leer.

### 2. Eigene Daten einspeisen (Dropzone)
Sie können eigene Forschungsdokumente hochladen, aus denen das System automatisch Akteure, Objekte und Kanten (Beziehungen) extrahiert.
- **Unterstützte Formate:** `.pdf` (Forschungsartikel, Buchscans), `.xlsx` / `.xls` (Inventarlisten, Expeditionsdatenbanken), `.txt` (Rohdaten).
- **Wie laden?** Nutzen Sie den Button "Dokument hochladen" im Web-Frontend oder legen Sie die Dateien manuell in das konfigurierte `dropzone`-Verzeichnis.

### 3. Automatischer Abgleich mit Museums-APIs (DDB)
Wenn ein neues Dokument hochgeladen wird, extrahiert die Pipeline (z.B. `autonomous_provenance_hunter.py`) die genannten Kulturgüter (z.B. "Nso-Thron").
- Das System sucht anschließend **vollautomatisch im Hintergrund** über die API der Deutschen Digitalen Bibliothek (DDB) und museum-digital nach diesen Objekten.
- Gibt es einen Treffer (z.B. im Linden-Museum Stuttgart), wird vollautomatisch die Kante `[:LAGERT_IN]` in Ihren Graphen eingezeichnet und mit dem Live-Standort sowie der Inventarnummer verknüpft.

### 4. Makro-Ansicht (Umgang mit über 40.000 Objekten)
Sobald Ihr Graph sehr groß wird (> 10.000 Knoten), schaltet das System automatisch in den hierarchischen **Makro-Modus**. 
- Es werden nicht alle 40.000 Objekte einzeln gerendert, sondern als massiver Aggregations-Cluster (z.B. "14.500 Objekte im Linden-Museum").
- **Drill-Down:** Klicken Sie doppelt auf einen Cluster-Knoten, um gezielt nur diese Sub-Menge an Objekten zu laden und im Detail zu analysieren, ohne dass der Browser überlastet wird.

---
*Bei technischen Fragen wenden Sie sich an den Systemadministrator oder prüfen Sie die Logs im `backend`-Container.*
