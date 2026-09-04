#!/usr/bin/env bash
set -e

echo "[+] Project Echo API Container starting..."

# Warte auf Neo4j Bolt-Verbindung
echo "[*] Warte auf Neo4j (bolt://${NEO4J_HOST:-neo4j}:7687)..."
python3 - << 'EOF'
import os, time, sys
from neo4j import GraphDatabase

uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
max_retries = 30
for i in range(max_retries):
    try:
        driver = GraphDatabase.driver(uri, auth=None)
        with driver.session() as s:
            s.run("RETURN 1").single()
        driver.close()
        print("[+] Neo4j ist erreichbar und bereit.")
        sys.exit(0)
    except Exception as e:
        time.sleep(2)

print("[!] Timeout beim Warten auf Neo4j.")
sys.exit(1)
EOF

# Pruefe ob Datenbank leer ist -> wenn ja, Seed importieren
python3 - << 'EOF'
import os, sys
from neo4j import GraphDatabase

uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
driver = GraphDatabase.driver(uri, auth=None)
with driver.session() as s:
    count = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
driver.close()

if count == 0:
    print(f"[*] Neo4j ist noch unbefuellt (0 Knoten). Starte automatischen Seed-Import...")
    import import_seed
    import_seed.run_import()
else:
    print(f"[+] Neo4j enthaelt bereits {count} Knoten. Ueberspringe Initial-Seed.")
EOF

echo "[+] Starte FastAPI Uvicorn Server auf Port 8088..."
exec uvicorn serve_graph_api:app --host 0.0.0.0 --port 8088
