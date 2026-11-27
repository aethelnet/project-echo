# Project Echo: Production Deployment Guide (Oracle Cloud / VPS / Docker)

Complete guide for deploying the **Shadow Museum Provenance Atlas** on an **Oracle Cloud Always Free (Ampere A1 ARM64)** instance or any Linux server with automatic HTTPS certificates (Caddy) and HTTP Basic Auth.

---

## 1. Server Prerequisites

- **Operating System:** Ubuntu 22.04 / 24.04 LTS or Oracle Linux 8 / 9 (`x86_64` or `aarch64` / ARM64 Ampere).
- **Recommended Resources:** At least 4 GB RAM (Oracle Cloud Ampere A1 offers up to 4 OCPU and 24 GB RAM in the free tier).
- **Installed Software:** `docker` and `docker compose` (Docker Compose v2 plugin).

Install Docker if not already present:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Oracle Cloud Firewall (Security Lists & iptables)

Allow inbound web traffic in the Oracle Cloud web console:
1. **Virtual Cloud Network (VCN)** &rarr; **Security Lists** &rarr; **Default Security List**.
2. **Add Ingress Rules**:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** `TCP`
   - **Destination Port Range:** `80,443`
3. Open ports 80 and 443 in `iptables` / `ufw` on the Linux instance itself:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. Configure DNS

Create an **A record** with your domain registrar:
- **Host / Name:** e.g. `echo` or `@`
- **Type:** `A`
- **Target (Value):** The public IP address of your server instance
- **Example FQDN:** `echo.yourdomain.org`

---

## 4. Clone Repository & Configure Environment

```bash
git clone <YOUR_GITHUB_REPO_URL> project-echo
cd project-echo
cp .env.example .env
```

Edit `.env`:
```bash
nano .env
```

Set your domain name and credentials:
```ini
DOMAIN_NAME=echo.yourdomain.org
AUTH_USER=marianne
AUTH_HASH=
```

---

## 5. Enable Password Protection (HTTP Basic Auth)

To protect the upload dropzone and atlas from crawlers or unauthorized access, generate a bcrypt password hash with Caddy:

```bash
docker compose run --rm web caddy hash-password --plaintext "YourStrongResearcherPassword"
```

Copy the resulting hash (e.g. `JDJhJDEwJE9u...`) into `.env`:
```ini
AUTH_HASH=JDJhJDEwJE9u...
```

Enable the `basicauth` block inside [`Caddyfile`](Caddyfile):
```caddyfile
    basicauth / {
        {$AUTH_USER:marianne} {$AUTH_HASH}
    }
```

---

## 6. Launch the Stack (One-Command Deployment)

```bash
docker compose up -d --build
```

### What happens automatically in the background:
1. **Neo4j Container (`echo_neo4j`):** Starts with 4 GB Java Heap and 2 GB page cache.
2. **FastAPI Container (`echo_api`):**
   - Waits for Bolt port `7687`.
   - Detects an empty database and imports all 2,223 nodes and 6,628 relations from [`seed_graph.json.gz`](seed_graph.json.gz) in **under 6 seconds**.
   - Starts the API server on port `8088`.
3. **Web Container (`echo_web` — Caddy):**
   - Builds the React/Vite frontend in a multi-stage container build.
   - Automatically provisions an official **Let's Encrypt TLS certificate** for your domain.
   - Proxies `/api/*` transparently to FastAPI and serves the static frontend bundle.

---

## 7. Inspect Status & Logs

Monitor the seed import and API startup:
```bash
docker compose logs -f api
```
Expected output:
```text
[+] Neo4j ist erreichbar und bereit.
[*] Neo4j ist noch unbefuellt (0 Knoten). Starte automatischen Seed-Import...
[+] 2223 Knoten und 6628 Relationen geladen.
...
[+] Import erfolgreich abgeschlossen in 5.95 Sekunden.
[+] Starte FastAPI Uvicorn Server auf Port 8088...
```

Check Caddy and TLS certificate status:
```bash
docker compose logs -f web
```

Check overall container health:
```bash
docker compose ps
```

---

## 8. Local Workstation Deployment (Research Groups)

For researchers running the full Docker stack locally without a public domain:

1. In `.env`:
   ```ini
   DOMAIN_NAME=localhost
   ```
2. Start the stack:
   ```bash
   docker compose up -d
   ```
3. Open locally in your browser:
   - **Frontend:** `http://localhost`
   - **FastAPI Docs:** `http://localhost/api/docs`
   - **Neo4j Cypher Console:** Available if port `7474` is exposed in `docker-compose.yml`.
