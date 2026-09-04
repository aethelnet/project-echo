# Project Echo: Production Deployment Guide (Oracle Cloud / VPS / Docker)

Vollständige Anleitung zur Bereitstellung des **Shadow Museum Atlas** auf einer **Oracle Cloud Always Free (Ampere A1 ARM64)** Instanz oder einem beliebigen Linux-Server mit automatischer SSL-Verschlüsselung (Caddy) und HTTP Basic Auth.

---

## 1. Voraussetzungen auf der Server-Instanz

- **Betriebssystem:** Ubuntu 22.04 / 24.04 LTS oder Oracle Linux 8 / 9 (x86_64 oder aarch64 / ARM64 Ampere).
- **Ressourcen-Empfehlung:** Mindestens 4 GB RAM (Die Oracle Cloud Ampere A1 bietet bis zu 4 OCPU und 24 GB RAM kostenlos).
- **Installierte Software:** `docker` und `docker compose` (Docker Compose v2 Plugin).

Installation von Docker falls noch nicht vorhanden:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Oracle Cloud Firewall (Security Lists & iptables)

In der Oracle Cloud Web-Konsole müssen die Ports für Web-Traffic freigegeben werden:
1. **Virtual Cloud Network (VCN)** &rarr; **Security Lists** &rarr; **Default Security List**.
2. **Add Ingress Rules**:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** `TCP`
   - **Destination Port Range:** `80,443`
3. Auf der Linux-Instanz selbst muss iptables/ufw den Port öffnen:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. DNS-Eintrag setzen

Setze bei deinem Domain-Registrar einen **A-Record**:
- **Host / Name:** z. B. `echo` oder `@`
- **Typ:** `A`
- **Ziel (Value):** Die öffentliche IP-Adresse deiner Oracle Cloud Instanz
- **Beispiel-FQDN:** `echo.deinedomain.de`

---

## 4. Repository Clonen & Konfigurieren

```bash
git clone <DEIN_GITHUB_REPO_URL> project-echo
cd project-echo
cp .env.example .env
```

Passe die `.env` an:
```bash
nano .env
```

Trage deinen Domainnamen ein:
```ini
DOMAIN_NAME=echo.deinedomain.de
AUTH_USER=marianne
AUTH_HASH=
```

---

## 5. Passwort-Schutz (HTTP Basic Auth) einrichten

Um die Dropzone und den Atlas vor Crawlern und unerwünschten Zugriffen zu schützen, wird ein Passwort-Hash generiert:

```bash
docker compose run --rm web caddy hash-password --plaintext "WunschPasswortFuerMarianne"
```

Kopiere den ausgegebenen Hash (z. B. `JDJhJDEwJE9u...`) und trage ihn in `.env` ein:
```ini
AUTH_HASH=JDJhJDEwJE9u...
```

Aktiviere in [`Caddyfile`](file:///home/nikahrlyn/auratic-systems-prime/Caddyfile) den `basicauth`-Block:
```caddyfile
    basicauth / {
        {$AUTH_USER:marianne} {$AUTH_HASH}
    }
```

---

## 6. Stack starten (One-Command Deployment)

```bash
docker compose up -d --build
```

### Was im Hintergrund autonom passiert:
1. **Neo4j Container (`echo_neo4j`):** Startet mit 4 GB Java Heap und 2 GB Pagecache.
2. **FastAPI Container (`echo_api`):**
   - Wartet auf den Bolt-Port `7687`.
   - Erkennt eine leere Datenbank und importiert in **unter 6 Sekunden** die 2.223 Knoten und 6.628 Relationen aus [`seed_graph.json.gz`](file:///home/nikahrlyn/auratic-systems-prime/seed_graph.json.gz).
   - Startet den API-Server auf Port `8088`.
3. **Web Container (`echo_web` - Caddy):**
   - Kompiliert das React/Vite Frontend im Multi-Stage-Build.
   - Fordert **vollautomatisch ein offizielles Let's Encrypt SSL-Zertifikat** für deine Domain an.
   - Leitet `/api/*` transparent an FastAPI weiter und liefert das Frontend aus.

---

## 7. Status & Logs prüfen

Seed-Import & API-Status überwachen:
```bash
docker compose logs -f api
```
Erwartete Ausgabe:
```text
[+] Neo4j ist erreichbar und bereit.
[*] Neo4j ist noch unbefuellt (0 Knoten). Starte automatischen Seed-Import...
[+] 2223 Knoten und 6628 Relationen geladen.
...
[+] Import erfolgreich abgeschlossen in 5.95 Sekunden.
[+] Starte FastAPI Uvicorn Server auf Port 8088...
```

Caddy & SSL-Zertifikatsstatus:
```bash
docker compose logs -f web
```

Container-Gesamtstatus:
```bash
docker compose ps
```

---

## 8. Lokale Ausführung für Richard (TU Berlin Forschungsgruppe)

Für Forscher, die den Stack lokal auf dem eigenen Rechner ohne Domain betreiben wollen:

1. In `.env`:
   ```ini
   DOMAIN_NAME=localhost
   ```
2. Starten:
   ```bash
   docker compose up -d
   ```
3. Zugriff im lokalen Browser:
   - **Frontend:** `http://localhost`
   - **FastAPI Docs:** `http://localhost/api/docs`
   - **Neo4j Cypher Console:** Falls Port 7474 im docker-compose freigegeben wird.
