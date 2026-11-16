#!/usr/bin/env python3
"""
PROJECT ECHO: DUAL-ENGINE FASTAPI PROVENANCE GRAPH BRIDGE (v2.3.0)
Unterstuetzt wahlweise einen laufenden Neo4j-Knowledge-Graph (bolt://localhost:7687)
oder nahtlos den eingebauten Zero-Docker Embedded Provenance Store (`seed_graph.json.gz`:
2.223 Knoten, 6.628 Relationen) inklusive PyMuPDF/ReportLab Restitutionsdossier-Engine.
"""

import base64
import ctypes
import ctypes.util
import hashlib
import hmac
import json
import os
import re
import socket
import sys
import time
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from neo4j import GraphDatabase
except ImportError:
    GraphDatabase = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.embedded_graph import EMBEDDED_STORE
from enrich_contested_multigraph import enrich_contested
from extract_provenance_triples import BatchProvenancePipeline
from generate_restitution_dossier import generate_pdf_dossier, query_object_provenance

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
FORCE_EMBEDDED = os.getenv("ECHO_FORCE_EMBEDDED", "0") == "1"
DOSSIER_DIR = os.path.join(BASE_DIR, "dossiers")
DROPZONE_DIR = os.path.join(BASE_DIR, "shadow-museum-atlas", "data_dropzone", "verified_research")
LAYOUT_FILE = os.path.join(DROPZONE_DIR, "graph_layout.json")
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "shadow-museum-atlas", "dist")

os.makedirs(DOSSIER_DIR, exist_ok=True)
os.makedirs(DROPZONE_DIR, exist_ok=True)

app = FastAPI(
    title="Project Echo Provenance API",
    description="Dual-Engine REST Bridge for Colonial Provenance Forensics & Restitution Dossiers",
    version="2.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_db_driver = None
_neo4j_probe_ts = 0.0
_neo4j_online = False


def is_neo4j_available() -> bool:
    """Prueft schnell per TCP-Probe, ob ein lokaler/externer Neo4j-Bolt-Server erreichbar ist."""
    global _neo4j_probe_ts, _neo4j_online, _db_driver
    if FORCE_EMBEDDED or GraphDatabase is None:
        return False
    now = time.monotonic()
    if now - _neo4j_probe_ts < 5.0:
        return _neo4j_online

    _neo4j_probe_ts = now
    try:
        parsed = urlparse(NEO4J_URI)
        host = parsed.hostname or "localhost"
        port = parsed.port or 7687
        with socket.create_connection((host, port), timeout=0.2):
            pass
        if _db_driver is None:
            _db_driver = GraphDatabase.driver(NEO4J_URI, auth=None)
        _neo4j_online = True
    except Exception:
        _neo4j_online = False
    return _neo4j_online


def get_db_driver():
    global _db_driver
    if _db_driver is None and GraphDatabase is not None:
        _db_driver = GraphDatabase.driver(NEO4J_URI, auth=None)
    return _db_driver


# ==========================================================
# 0. AUTHENTICATION & RESEARCHER GATE (Dual-Mode Session)
# ==========================================================
HTPASSWD_FILE = os.getenv("HTPASSWD_FILE", os.path.join(BASE_DIR, ".htpasswd_echo"))
ECHO_RESEARCHER_KEY = os.getenv("ECHO_RESEARCHER_KEY", "").strip()
DEFAULT_RESEARCHER_USER = os.getenv("ECHO_RESEARCHER_USER", "marianne").strip()

_libcrypt = None
_libcrypt_checked = False


def _posix_crypt(password: str, salt_or_hash: str) -> Optional[str]:
    """Resolves POSIX crypt() across Python <3.13 (stdlib crypt) and Python 3.13+ (libcrypt.so via ctypes)."""
    try:
        import crypt as _std_crypt  # type: ignore

        return _std_crypt.crypt(password, salt_or_hash)
    except ModuleNotFoundError:
        pass

    global _libcrypt, _libcrypt_checked
    if not _libcrypt_checked:
        _libcrypt_checked = True
        libname = ctypes.util.find_library("crypt")
        if libname:
            try:
                lib = ctypes.CDLL(libname)
                lib.crypt.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
                lib.crypt.restype = ctypes.c_char_p
                _libcrypt = lib
            except OSError:
                _libcrypt = None

    if _libcrypt is not None:
        res = _libcrypt.crypt(password.encode("utf-8"), salt_or_hash.encode("utf-8"))
        if res:
            return res.decode("utf-8", errors="replace")
    return None


def _verify_htpasswd_hash(password: str, stored_hash: str) -> bool:
    """Verifies an Apache/Nginx .htpasswd password entry ({SHA}, sha256$, or POSIX crypt $6$/$5$/$y$)."""
    if not password or not stored_hash:
        return False
    if stored_hash.startswith("{SHA}"):
        digest = base64.b64encode(hashlib.sha1(password.encode("utf-8")).digest()).decode("ascii")
        return hmac.compare_digest(f"{{SHA}}{digest}", stored_hash)
    if stored_hash.startswith("sha256$"):
        parts = stored_hash.split("$", 2)
        if len(parts) == 3:
            _, salt, expected_hex = parts
            calc = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
            return hmac.compare_digest(calc, expected_hex)
        return False
    computed = _posix_crypt(password, stored_hash)
    if computed is not None:
        return hmac.compare_digest(computed, stored_hash)
    return False


def check_credentials(username: str, password: str) -> bool:
    if not password:
        return False
    if ECHO_RESEARCHER_KEY and hmac.compare_digest(password, ECHO_RESEARCHER_KEY):
        return True

    ht_paths = [
        HTPASSWD_FILE,
        "/etc/nginx/.htpasswd_echo",
        os.path.join(os.path.dirname(BASE_DIR), ".htpasswd_echo"),
        os.path.join(BASE_DIR, ".htpasswd_echo"),
    ]
    for p in ht_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split(":", 1)
                        if len(parts) == 2:
                            u, h = parts[0].strip(), parts[1].strip()
                            if username.lower() == u.lower() and _verify_htpasswd_hash(password, h):
                                return True
            except OSError:
                pass
    return False


def _resolve_authenticated_user(token: str) -> Optional[str]:
    if not token:
        return None
    if ":" in token:
        u, p = token.split(":", 1)
        if check_credentials(u, p):
            return u
    if check_credentials(DEFAULT_RESEARCHER_USER, token):
        return DEFAULT_RESEARCHER_USER
    return None


def require_researcher(request: Request):
    token = request.headers.get("X-Researcher-Key") or ""
    if not token and "authorization" in request.headers:
        auth_hdr = request.headers.get("authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr[7:].strip()
        elif auth_hdr.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_hdr[6:]).decode("utf-8")
                u, p = decoded.split(":", 1)
                if check_credentials(u, p):
                    return True
            except Exception:
                pass

    if _resolve_authenticated_user(token):
        return True

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Schreiboperation verweigert: Diese Aktion erfordert Forscher-Authentifizierung. Im Gast-Modus sind alle Lese- und Analysefunktionen frei verfuegbar.",
    )


class LoginRequest(BaseModel):
    username: Optional[str] = "researcher"
    password: str


class DossierRequest(BaseModel):
    inventarnummer: str


class BatchDossierRequest(BaseModel):
    entity_type: str  # 'actor' | 'institution' | 'gaps' | 'list'
    entity_name: str
    limit: Optional[int] = 300
    inventarnummern: Optional[List[str]] = None


class PetitionRequest(BaseModel):
    institution: str
    community: str


class LLMPetitionRequest(BaseModel):
    institution: str
    community: Optional[str] = None
    actor: Optional[str] = None


class AnnotationRequest(BaseModel):
    author: str = "Marianne"
    role: Optional[str] = "Researcher"
    tags: List[str] = []
    notes: str
    confidence: Optional[str] = "HIGH"


class EdgeCreateRequest(BaseModel):
    source_id: str
    target_id: str
    rel_type: str
    props: Dict[str, Any]


class EdgeDeleteRequest(BaseModel):
    source_id: str
    target_id: str
    rel_type: str


ALLOWED_RELS = {
    "RAUBTE",
    "SCHENKTE",
    "LAGERT_IN",
    "VERKAUFTE_AN",
    "UEBERGAB_AN",
    "ENTEIGNETE",
    "EIGNETE_SICH_AN",
    "VERDACHT_AUF",
    "WAR_BETEILIGT_AN",
}


@app.post("/api/auth/login")
def auth_login(req: LoginRequest):
    u = (req.username or DEFAULT_RESEARCHER_USER).strip()
    if check_credentials(u, req.password):
        token = req.password if u.lower() == DEFAULT_RESEARCHER_USER.lower() else f"{u}:{req.password}"
        return {
            "success": True,
            "role": "RESEARCHER",
            "name": u.capitalize(),
            "token": token,
            "message": f"Willkommen, {u.capitalize()}. Forscher-Vollzugriff autorisiert.",
        }
    raise HTTPException(status_code=401, detail="Ungueltige Anmeldedaten. Bitte Forscher-Passwort ueberpruefen.")


@app.get("/api/auth/session")
def auth_session(request: Request):
    token = request.headers.get("X-Researcher-Key") or ""
    if "authorization" in request.headers:
        auth_hdr = request.headers.get("authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr[7:].strip()

    user = _resolve_authenticated_user(token)
    if user:
        return {"authenticated": True, "role": "RESEARCHER", "name": user.capitalize()}
    return {"authenticated": False, "role": "GUEST", "name": "Gast-Forscher"}


def _inject_saved_layout(nodes_dict: Dict[str, Dict[str, Any]], links: Optional[List[Dict[str, Any]]] = None) -> None:
    """
    Berechnet zuerst ein luftiges, deterministisches Architektur-Konstellationslayout
    (Museums-Ring aussen, Akteurs-Sektoren innen, Fibonacci-Spiralwolken fuer Subjekte,
    damit 2.200+ Knoten niemals zu einem unlesbaren Knaeuel kollabieren) und ueberschreibt
    anschliessend nur individuell gespeicherte Drag-&-Drop-Positionen aus `graph_layout.json`.
    """
    import math
    from collections import defaultdict

    inst_ids = sorted([nid for nid, n in nodes_dict.items() if n.get("type") == "Institution"])
    actor_ids = sorted([nid for nid, n in nodes_dict.items() if n.get("type") == "Akteur"])
    subj_ids = sorted([nid for nid, n in nodes_dict.items() if n.get("type") not in ("Institution", "Akteur")])

    # 1. Institutionen auf weitem Aussenring (R = 1150 px)
    inst_pos: Dict[str, tuple[float, float]] = {}
    n_inst = max(1, len(inst_ids))
    r_inst = 1150.0
    for idx, iid in enumerate(inst_ids):
        ang = (2.0 * math.pi * idx) / n_inst - math.pi / 2.0
        x = round(r_inst * math.cos(ang), 1)
        y = round(r_inst * math.sin(ang), 1)
        inst_pos[iid] = (x, y)
        nodes_dict[iid]["x"] = x
        nodes_dict[iid]["y"] = y
        nodes_dict[iid]["fx"] = x
        nodes_dict[iid]["fy"] = y

    # Nachbarschaften aus Links ableiten
    subj_to_inst: Dict[str, str] = {}
    subj_to_actor: Dict[str, str] = {}
    actor_inst_weights: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for lk in links or []:
        s = str(lk.get("source"))
        t = str(lk.get("target"))
        lt = lk.get("type")
        if lt == "LAGERT_IN" and t in inst_pos:
            subj_to_inst[s] = t
        elif s in nodes_dict and nodes_dict[s].get("type") == "Akteur" and t in nodes_dict:
            if nodes_dict[t].get("type") == "Institution" and t in inst_pos:
                actor_inst_weights[s][t] += 2
            else:
                subj_to_actor.setdefault(t, s)

    for sid, aid in subj_to_actor.items():
        iid = subj_to_inst.get(sid)
        if iid and iid in inst_pos:
            actor_inst_weights[aid][iid] += 1

    # 2. Akteure auf mittlerem Ring (R = 460..620 px), orientiert zu ihren Haupt-Depots
    actor_pos: Dict[str, tuple[float, float]] = {}
    n_act = max(1, len(actor_ids))
    for idx, aid in enumerate(actor_ids):
        weights = actor_inst_weights.get(aid)
        if weights:
            wx = sum(inst_pos[i][0] * w for i, w in weights.items())
            wy = sum(inst_pos[i][1] * w for i, w in weights.items())
            base_ang = math.atan2(wy, wx) + ((idx % 7) - 3) * 0.085
        else:
            base_ang = (2.0 * math.pi * idx) / n_act
        r_act = 430.0 + (idx % 4) * 58.0
        x = round(r_act * math.cos(base_ang), 1)
        y = round(r_act * math.sin(base_ang), 1)
        actor_pos[aid] = (x, y)
        nodes_dict[aid]["x"] = x
        nodes_dict[aid]["y"] = y
        nodes_dict[aid]["fx"] = x
        nodes_dict[aid]["fy"] = y

    # 3. Subjekte in luftigen Phyllotaxis-Spiralclustern zwischen Akteur und Depot
    clusters: Dict[tuple[str, str], List[str]] = defaultdict(list)
    for sid in subj_ids:
        clusters[(subj_to_actor.get(sid, ""), subj_to_inst.get(sid, ""))].append(sid)

    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    for (aid, iid), members in clusters.items():
        if aid in actor_pos and iid in inst_pos:
            ax, ay = actor_pos[aid]
            ix, iy = inst_pos[iid]
            cx, cy = 0.38 * ax + 0.62 * ix, 0.38 * ay + 0.62 * iy
        elif iid in inst_pos:
            ix, iy = inst_pos[iid]
            cx, cy = ix * 1.18, iy * 1.18
        elif aid in actor_pos:
            ax, ay = actor_pos[aid]
            cx, cy = ax * 0.65, ay * 0.65
        else:
            cx, cy = 0.0, 0.0

        spacing = 17.5
        for k, sid in enumerate(members):
            rad = spacing * math.sqrt(k + 0.5)
            theta = k * golden_angle
            x = round(cx + rad * math.cos(theta), 1)
            y = round(cy + rad * math.sin(theta), 1)
            nodes_dict[sid]["x"] = x
            nodes_dict[sid]["y"] = y
            nodes_dict[sid]["fx"] = x
            nodes_dict[sid]["fy"] = y

    # 4. Optionale manuelle Forscher-Pins aus `graph_layout.json` darueberlegen
    if os.path.exists(LAYOUT_FILE):
        try:
            with open(LAYOUT_FILE, "r", encoding="utf-8") as f:
                layout = json.load(f)
            for node in nodes_dict.values():
                coords = layout.get(node["id"]) or layout.get(node.get("label"))
                if coords and isinstance(coords, dict) and "x" in coords and "y" in coords:
                    node["fx"] = coords["x"]
                    node["fy"] = coords["y"]
                    node["x"] = coords["x"]
                    node["y"] = coords["y"]
        except Exception:
            pass


# ==========================================================
# 1. GRAPH NETWORK ENDPOINTS (/api/graph, /api/graph/macro)
# ==========================================================
@app.get("/api/graph")
def get_graph(
    limit: int = Query(8000, description="Maximale Anzahl an Kanten"),
    search: Optional[str] = Query(None, description="Filter nach Akteur, Museum, Bezeichnung oder Inventarnummer"),
    publications: Optional[str] = Query(None, description="Kommagetrennte Liste aktiver Publikations-IDs"),
):
    pub_list = [p.strip() for p in publications.split(",") if p.strip()] if publications and publications.strip() else None

    if not is_neo4j_available():
        nodes_dict, links = EMBEDDED_STORE.get_graph(limit=limit, search=search, pub_list=pub_list)
        _inject_saved_layout(nodes_dict, links)
        return {
            "success": True,
            "engine": "embedded_seed",
            "nodes": list(nodes_dict.values()),
            "links": links,
            "total_nodes": len(nodes_dict),
            "total_links": len(links),
        }

    driver = get_db_driver()
    nodes_dict: Dict[str, Any] = {}
    links: List[Dict[str, Any]] = []
    where_conditions = []
    params: Dict[str, Any] = {"limit": limit}

    if search and search.strip():
        where_conditions.append(
            "(toLower(coalesce(s.name, '')) CONTAINS toLower($q) OR toLower(coalesce(s.inventarnummer, '')) CONTAINS toLower($q) "
            "OR toLower(coalesce(s.bezeichnung, '')) CONTAINS toLower($q) "
            "OR toLower(coalesce(t.name, '')) CONTAINS toLower($q) OR toLower(coalesce(t.inventarnummer, '')) CONTAINS toLower($q) "
            "OR toLower(coalesce(t.bezeichnung, '')) CONTAINS toLower($q))"
        )
        params["q"] = search.strip()

    if pub_list:
        where_conditions.append("r.publikation IN $pub_list")
        params["pub_list"] = pub_list

    where_clause = ("WHERE " + " AND ".join(where_conditions)) if where_conditions else ""
    cypher = f"""
    MATCH (s)-[r]->(t)
    {where_clause}
    WITH s, r, t
    ORDER BY CASE WHEN type(r) = 'VERDACHT_AUF' THEN 0 WHEN r.kollision THEN 1 ELSE 2 END
    LIMIT $limit
    RETURN s.name AS s_name, s.inventarnummer AS s_inv, labels(s)[0] AS s_label, s.bezeichnung AS s_bez, s.rolle AS s_rolle, s.contested AS s_contested,
           type(r) AS rel_type, r.beleg AS rel_beleg, r.jahr AS rel_jahr, r.delikt AS rel_delikt, r.expedition AS rel_exp,
           r.narrativ AS rel_narrativ, r.behauptung AS rel_behauptung, r.kollision AS rel_kollision, r.publikation AS rel_pub,
           r.confidence AS rel_confidence, r.begruendung AS rel_begruendung, r.zitat AS rel_zitat, r.zeit AS rel_zeit,
           t.name AS t_name, t.inventarnummer AS t_inv, labels(t)[0] AS t_label, t.bezeichnung AS t_bez, t.stadt AS t_stadt, t.contested AS t_contested
    """
    with driver.session() as session:
        rows = session.run(cypher, params).data()
        for row in rows:
            s_id = row["s_inv"] or row["s_name"]
            t_id = row["t_inv"] or row["t_name"]
            if not s_id or not t_id:
                continue
            s_type = "Subjekt" if row["s_label"] in ["Objekt", "Subjekt"] else (row["s_label"] or "Entity")
            t_type = "Subjekt" if row["t_label"] in ["Objekt", "Subjekt"] else (row["t_label"] or "Entity")

            if s_id not in nodes_dict:
                nodes_dict[s_id] = {
                    "id": s_id,
                    "label": row["s_name"] or row["s_inv"],
                    "type": s_type,
                    "desc": row["s_bez"] or row["s_rolle"] or "",
                    "contested": bool(row.get("s_contested")),
                }
            if t_id not in nodes_dict:
                nodes_dict[t_id] = {
                    "id": t_id,
                    "label": row["t_name"] or row["t_inv"],
                    "type": t_type,
                    "desc": row["t_bez"] or row["t_stadt"] or "",
                    "contested": bool(row.get("t_contested")),
                }

            links.append(
                {
                    "source": s_id,
                    "target": t_id,
                    "type": row["rel_type"],
                    "beleg": row["rel_beleg"] or "",
                    "jahr": row["rel_jahr"] or row.get("rel_zeit"),
                    "delikt": row["rel_delikt"] or row["rel_type"],
                    "expedition": row.get("rel_exp"),
                    "narrativ": row.get("rel_narrativ")
                    or ("MUSEUMS_NARRATIV" if row["rel_type"] in ["SCHENKTE", "VERKAUFTE_AN"] else "FORENSISCHE_REALITAET"),
                    "behauptung": row.get("rel_behauptung") or "",
                    "kollision": bool(row.get("rel_kollision")),
                    "publikation": row.get("rel_pub") or "unbekannt",
                    "confidence": row.get("rel_confidence"),
                    "begruendung": row.get("rel_begruendung") or "",
                    "zitat": row.get("rel_zitat") or "",
                    "source_label": row["s_name"] or row["s_inv"],
                    "source_type": s_type,
                    "source_desc": row["s_bez"] or row["s_rolle"] or "",
                    "source_inv": row["s_inv"],
                    "target_label": row["t_name"] or row["t_inv"],
                    "target_type": t_type,
                    "target_desc": row["t_bez"] or row["t_stadt"] or "",
                    "target_inv": row["t_inv"],
                }
            )

    _inject_saved_layout(nodes_dict, links)
    return {
        "success": True,
        "engine": "neo4j",
        "nodes": list(nodes_dict.values()),
        "links": links,
        "total_nodes": len(nodes_dict),
        "total_links": len(links),
    }


@app.get("/api/graph/macro")
def get_macro_graph():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_macro_graph()

    driver = get_db_driver()
    nodes_dict = {}
    links = []
    cypher_inst = """
    MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN i.name AS name, i.stadt AS stadt, count(s) AS count, sum(CASE WHEN s.contested THEN 1 ELSE 0 END) AS contested_count
    """
    cypher_actors = """
    MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN a.name AS actor_name, a.rolle AS actor_rolle, i.name AS inst_name, count(r) AS raub_count
    """
    with driver.session() as session:
        for row in session.run(cypher_inst).data():
            inst_id = row["name"]
            if inst_id:
                nodes_dict[inst_id] = {
                    "id": inst_id,
                    "label": inst_id,
                    "type": "Institution_Cluster",
                    "desc": f"{row['count']} Objekte ({row['contested_count']} umstritten)",
                    "size": min(50, max(10, row["count"] / 100)),
                    "count": row["count"],
                }
        for row in session.run(cypher_actors).data():
            actor_id = row["actor_name"]
            if actor_id:
                if actor_id not in nodes_dict:
                    nodes_dict[actor_id] = {
                        "id": actor_id,
                        "label": actor_id,
                        "type": "Akteur",
                        "desc": row["actor_rolle"] or "Kolonialakteur",
                        "size": 15,
                        "count": 0,
                    }
                if row["inst_name"] in nodes_dict:
                    links.append(
                        {
                            "source": actor_id,
                            "target": row["inst_name"],
                            "type": "RAUBTE_MASSE",
                            "beleg": f"{row['raub_count']} Objekte identifiziert",
                            "count": row["raub_count"],
                        }
                    )
    return {
        "success": True,
        "nodes": list(nodes_dict.values()),
        "links": links,
        "total_nodes": len(nodes_dict),
        "total_links": len(links),
    }


@app.delete("/api/admin/reset")
def reset_database(request: Request):
    require_researcher(request)
    if not is_neo4j_available():
        EMBEDDED_STORE.reset_database()
        return {"success": True, "message": "Embedded-Wissensgraph wurde formatiert. Blank Canvas bereit."}
    driver = get_db_driver()
    with driver.session() as session:
        session.run("MATCH (n) DETACH DELETE n")
    return {"success": True, "message": "Datenbank wurde vollstaendig formatiert. Blank Canvas bereit."}


@app.post("/api/admin/restore_seed")
def restore_seed_database(request: Request):
    require_researcher(request)
    EMBEDDED_STORE.load_seed()
    return {"success": True, "message": "Referenz-Wissensgraph aus seed_graph.json.gz wiederhergestellt."}


# ==========================================================
# 2. PUBLICATIONS & SOURCE UPLOAD
# ==========================================================
@app.get("/api/publications")
def get_publications():
    if not is_neo4j_available():
        pubs = EMBEDDED_STORE.get_publications()
        return {"success": True, "publications": pubs, "total": len(pubs)}

    driver = get_db_driver()
    pubs = []
    cypher = """
    MATCH (pub:Publikation)
    OPTIONAL MATCH ()-[r]->() WHERE r.publikation = pub.id
    RETURN pub.id AS id, pub.name AS name, pub.kuerzel AS kuerzel, pub.typ AS typ, pub.jahr AS jahr,
           pub.beschreibung AS beschreibung, count(r) AS edge_count
    ORDER BY edge_count DESC
    """
    with driver.session() as session:
        for r in session.run(cypher).data():
            pubs.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "kuerzel": r["kuerzel"] or r["id"].upper()[:8],
                    "typ": r["typ"] or "Dokument",
                    "jahr": r.get("jahr"),
                    "beschreibung": r.get("beschreibung") or "",
                    "edge_count": r["edge_count"],
                }
            )
    return {"success": True, "publications": pubs, "total": len(pubs)}


@app.post("/api/sources/upload")
async def upload_source(request: Request, file: UploadFile = File(...)):
    require_researcher(request)
    filename = file.filename or "upload.txt"
    clean_name = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(filename))
    target_path = os.path.join(DROPZONE_DIR, clean_name)

    content = await file.read()
    with open(target_path, "wb") as f:
        f.write(content)

    ext = os.path.splitext(clean_name)[1].lower()
    pipeline = BatchProvenancePipeline()
    try:
        if ext == ".txt":
            triples = pipeline.parse_txt_file(target_path)
        elif ext == ".pdf":
            triples = pipeline.parse_pdf_file(target_path)
        elif ext in [".xlsx", ".xls"]:
            triples = pipeline.parse_excel_expeditions(target_path)
        elif ext in [".csv", ".tsv"]:
            triples = pipeline.parse_csv_file(target_path)
        else:
            raise HTTPException(status_code=400, detail="Nicht unterstuetztes Format. Erlaubt sind .pdf, .xlsx, .xls, .csv, .txt")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Parsen der Datei: {e}")

    pub_id = re.sub(r"[^a-z0-9_]", "", clean_name.lower().replace(".", "_"))
    for t in triples:
        t["rel_props"]["publikation"] = pub_id

    ddb_triples = []
    seen_objs = set()
    for t in triples:
        obj_node = None
        if t["source"].get("label", t["source"].get("type")) == "Objekt":
            obj_node = t["source"]
        elif t["target"].get("label", t["target"].get("type")) == "Objekt":
            obj_node = t["target"]

        if obj_node and obj_node["id"] not in seen_objs:
            seen_objs.add(obj_node["id"])
            bez = obj_node["props"].get("bezeichnung", "")
            inv_nr = obj_node["props"].get("inventarnummer", "").strip()
            inferred = pipeline._infer_depot_from_inventory_prefix(inv_nr)
            museum = None
            if inferred:
                museum = {"name": inferred[0], "stadt": inferred[1]}
            elif any(k in bez.lower() for k in ("thron", "mandu", "nso")):
                museum = {"name": "Ethnologisches Museum Berlin", "stadt": "Berlin"}

            if museum:
                ddb_triples.append(
                    {
                        "source": obj_node,
                        "target": {
                            "id": museum["name"],
                            "label": "Institution",
                            "type": "Institution",
                            "props": {"name": museum["name"], "stadt": museum["stadt"]},
                        },
                        "type": "LAGERT_IN",
                        "rel_props": {
                            "beleg": "DDB/Museum-Digital API Match",
                            "confidence": 0.95,
                            "zeit": "Heute",
                            "publikation": pub_id,
                        },
                    }
                )

    triples.extend(ddb_triples)

    if not is_neo4j_available():
        EMBEDDED_STORE.ingest_publication_and_triples(
            pub_id=pub_id,
            filename=clean_name,
            kuerzel=clean_name[:10].upper(),
            ext=ext.upper().replace(".", ""),
            triples=triples,
        )
    else:
        driver = get_db_driver()
        with driver.session() as session:
            session.run(
                """
                MERGE (pub:Publikation {id: $pub_id})
                SET pub.name = $filename,
                    pub.kuerzel = $kuerzel,
                    pub.typ = 'Benutzer-Upload (' + $ext + ')',
                    pub.dateipfad = $clean_name,
                    pub.hochgeladen_am = datetime()
                """,
                {
                    "pub_id": pub_id,
                    "filename": filename,
                    "kuerzel": clean_name[:10].upper(),
                    "ext": ext.upper().replace(".", ""),
                    "clean_name": clean_name,
                },
            )
        if triples:
            from extract_provenance_triples import ProvenanceGraphClient

            client = ProvenanceGraphClient()
            if client.connect():
                client.ingest_triples(triples)
                client.close()
            try:
                enrich_contested()
            except Exception:
                pass

    return {
        "success": True,
        "filename": filename,
        "publication_id": pub_id,
        "triples_extracted": len(triples),
        "message": f"Quelle '{filename}' erfolgreich verarbeitet. {len(triples)} Relationen in den Graphen integriert.",
    }


# ==========================================================
# 4. FORENSIC ANALYTICS ENDPOINTS
# ==========================================================
@app.get("/api/ghosts")
def get_ghost_nodes():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_ghosts()

    driver = get_db_driver()
    ghost_objects = []
    ghost_ids = set()
    cypher = """
    MATCH (a:Akteur)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(o:Objekt)
    WHERE NOT (o)-[:LAGERT_IN]->(:Institution)
    RETURN a.name AS akteur, a.rolle AS rolle,
           type(r) AS delikt, r.beleg AS beleg, r.jahr AS jahr, r.expedition AS expedition,
           o.inventarnummer AS inv, o.bezeichnung AS bezeichnung
    """
    with driver.session() as session:
        for r in session.run(cypher).data():
            inv_id = r["inv"]
            ghost_ids.add(inv_id)
            ghost_objects.append(
                {
                    "id": inv_id,
                    "inventarnummer": inv_id,
                    "bezeichnung": r["bezeichnung"] or "Verschollenes Kulturgut",
                    "akteur": r["akteur"],
                    "akteur_rolle": r["rolle"],
                    "delikt": r["delikt"],
                    "jahr": r["jahr"],
                    "beleg": r["beleg"],
                    "expedition": r.get("expedition"),
                    "status": "VERSCHOLLEN / KEIN DEPOTBELEG",
                }
            )
    return {"success": True, "ghost_count": len(ghost_objects), "ghost_ids": list(ghost_ids), "ghosts": ghost_objects}


@app.get("/api/contested")
def get_contested_objects():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_contested()

    driver = get_db_driver()
    contested_items = []
    contested_ids = set()
    cypher = """
    MATCH (o:Objekt)<-[r_legit:SCHENKTE|VERKAUFTE_AN]-(a:Akteur), (o)<-[r_raub:RAUBTE|ENTEIGNETE]-(b:Akteur)
    OPTIONAL MATCH (o)-[:LAGERT_IN]->(i:Institution)
    WITH o, i, a, r_legit, b, r_raub
    RETURN o.inventarnummer AS inv, o.bezeichnung AS bezeichnung,
           coalesce(i.name, 'Unbekannt') AS institution,
           coalesce(i.stadt, 'Deutschland') AS stadt,
           collect(DISTINCT {
               akteur: a.name,
               rel: type(r_legit),
               beleg: r_legit.beleg,
               claim: coalesce(r_legit.behauptung, 'Offizielles Museumsinventar: Uneigennuetzige Schenkung/Erwerb'),
               jahr: r_legit.jahr,
               kategorie: coalesce(r_legit.kategorie, 'WHITEWASHING')
           }) AS museum_narratives,
           collect(DISTINCT {
               akteur: b.name,
               rel: type(r_raub),
               beleg: r_raub.beleg,
               claim: coalesce(r_raub.forensik_behauptung, r_raub.delikt, 'Militaerischer Raubzug / Brandschatzung'),
               jahr: r_raub.jahr,
               kategorie: coalesce(r_raub.kategorie, 'MILITAERISCHER_RAUB')
           }) AS forensic_realities
    LIMIT 2500
    """
    with driver.session() as session:
        for r in session.run(cypher).data():
            inv = r["inv"]
            contested_ids.add(inv)
            contested_items.append(
                {
                    "id": inv,
                    "inventarnummer": inv,
                    "bezeichnung": r["bezeichnung"] or "Koloniales Kulturgut",
                    "institution": r["institution"],
                    "stadt": r["stadt"],
                    "dissonance_type": "SCHENKUNG_VS_RAUB",
                    "museum_narratives": r["museum_narratives"],
                    "forensic_realities": r["forensic_realities"],
                }
            )
    return {
        "success": True,
        "contested_count": len(contested_items),
        "contested_ids": list(contested_ids),
        "items": contested_items,
    }


@app.get("/api/stats")
def get_stats():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_stats()

    driver = get_db_driver()
    with driver.session() as s:
        subjekt_count = s.run("MATCH (s:Subjekt) RETURN count(s) AS c;").single()["c"]
        act_count = s.run("MATCH (a:Akteur) RETURN count(a) AS c;").single()["c"]
        inst_count = s.run("MATCH (i:Institution) RETURN count(i) AS c;").single()["c"]
        pub_count = s.run("MATCH (p:Publikation) RETURN count(p) AS c;").single()["c"]
        raub_count = s.run("MATCH ()-[r:RAUBTE]->() RETURN count(r) AS c;").single()["c"]
        schenk_count = s.run("MATCH ()-[r:SCHENKTE]->() RETURN count(r) AS c;").single()["c"]
        total_edges = s.run("MATCH ()-[r]->() RETURN count(r) AS c;").single()["c"]
        contested_count = s.run(
            "MATCH (o:Subjekt)<-[:SCHENKTE|VERKAUFTE_AN]-(a), (o)<-[:RAUBTE|ENTEIGNETE]-(b) RETURN count(DISTINCT o) AS c;"
        ).single()["c"]
        gaps_count = s.run(
            "MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution) "
            "WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s) "
            "RETURN count(DISTINCT s) AS c;"
        ).single()["c"]
        verdacht_count = s.run("MATCH ()-[r:VERDACHT_AUF]->() RETURN count(r) AS c;").single()["c"]

    return {
        "success": True,
        "subjekte": subjekt_count,
        "objekte": subjekt_count,
        "akteure": act_count,
        "institutionen": inst_count,
        "publikationen": pub_count,
        "raub_kanten": raub_count,
        "schenk_kanten": schenk_count,
        "verdacht_kanten": verdacht_count,
        "gesamt_kanten": total_edges,
        "contested_objekte": contested_count,
        "provenienz_luecken": gaps_count,
    }


_GEODATA_CACHE = None


@app.get("/api/geodata")
def get_geodata(force_refresh: bool = False):
    global _GEODATA_CACHE
    if _GEODATA_CACHE is not None and not force_refresh:
        return _GEODATA_CACHE

    geodata_file = os.path.join(BASE_DIR, "shadow-museum-atlas", "src", "geodata.json")
    if os.path.exists(geodata_file):
        with open(geodata_file, "r", encoding="utf-8") as f:
            _GEODATA_CACHE = json.load(f)
        return _GEODATA_CACHE

    raise HTTPException(status_code=404, detail="Geodata-Datei (geodata.json) nicht gefunden.")


@app.get("/api/suspicions")
def get_suspicions():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_suspicions()

    driver = get_db_driver()
    items = []
    cypher = """
    MATCH (a:Akteur)-[r:VERDACHT_AUF]->(s:Subjekt)-[:LAGERT_IN]->(i:Institution)
    RETURN a.name AS akteur, s.inventarnummer AS inv, s.bezeichnung AS bez, i.name AS museum,
           r.confidence AS confidence, r.begruendung AS begruendung, r.beleg AS beleg,
           r.expedition AS expedition, r.expedition_num AS exp_num, r.zeit AS zeit, r.zitat AS zitat
    ORDER BY r.confidence DESC, s.inventarnummer ASC
    """
    with driver.session() as s:
        for row in s.run(cypher).data():
            items.append(
                {
                    "akteur": row["akteur"],
                    "inv": row["inv"],
                    "bezeichnung": row["bez"] or "Koloniales Kulturgut",
                    "museum": row["museum"],
                    "confidence": row["confidence"],
                    "begruendung": row["begruendung"],
                    "beleg": row["beleg"],
                    "expedition": row["expedition"],
                    "expedition_num": row["exp_num"],
                    "zeit": row["zeit"],
                    "zitat": row["zitat"],
                }
            )
    return {"success": True, "total": len(items), "suspicions": items}


@app.get("/api/gaps")
def get_provenance_gaps():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_gaps()

    driver = get_db_driver()
    gaps = []
    cypher = """
    MATCH (s:Subjekt)-[r:LAGERT_IN]->(i:Institution)
    WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s)
    RETURN s.inventarnummer AS inv, s.name AS name, s.bezeichnung AS bezeichnung,
           i.name AS institution, i.stadt AS stadt, r.beleg AS beleg
    ORDER BY i.name, s.inventarnummer
    """
    with driver.session() as session:
        for row in session.run(cypher).data():
            gaps.append(
                {
                    "id": row["inv"] or row["name"],
                    "inventarnummer": row["inv"] or "",
                    "bezeichnung": row["bezeichnung"] or "Koloniales Kulturgut (Altersbestand)",
                    "institution": row["institution"],
                    "stadt": row.get("stadt") or "",
                    "beleg": row.get("beleg") or "Kein historischer Erwerbsnachweis dokumentiert",
                }
            )
    return {"success": True, "total_gaps": len(gaps), "gap_ids": [g["id"] for g in gaps], "items": gaps}


@app.get("/api/filters/entities")
def get_filter_entities():
    if not is_neo4j_available():
        return EMBEDDED_STORE.get_filter_entities()

    driver = get_db_driver()
    actors = []
    institutions = []
    actor_cypher = """
    MATCH (a:Akteur)
    OPTIONAL MATCH (a)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)
    WITH a, count(r) AS raub_count
    WHERE raub_count > 0
    ORDER BY raub_count DESC
    LIMIT 25
    OPTIONAL MATCH (a)-[rs:SCHENKTE]->(:Subjekt)
    WITH a, raub_count, count(rs) AS schenk_count
    OPTIONAL MATCH (a)-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(:Subjekt)-[:LAGERT_IN]->(i:Institution)
    WITH a, raub_count, schenk_count, collect(DISTINCT i.name)[..3] AS top_depots
    RETURN a.name AS name, a.rolle AS rolle, raub_count, schenk_count, top_depots
    ORDER BY raub_count DESC
    """
    inst_cypher = """
    MATCH (i:Institution)
    OPTIONAL MATCH (s:Subjekt)-[r:LAGERT_IN]->(i)
    WITH i, count(DISTINCT s) AS count
    OPTIONAL MATCH (s_cont:Subjekt)-[:LAGERT_IN]->(i)
    WHERE s_cont.contested = true
    WITH i, count, count(DISTINCT s_cont) AS contested_count
    RETURN i.name AS name, i.stadt AS stadt, count, contested_count
    ORDER BY count DESC
    """
    with driver.session() as s:
        for r in s.run(actor_cypher).data():
            actors.append(
                {
                    "name": r["name"],
                    "rolle": r.get("rolle") or "Kolonialoffizier / Militaer",
                    "raub_count": r["raub_count"],
                    "schenk_count": r["schenk_count"],
                    "top_depots": r.get("top_depots") or [],
                }
            )
        for r in s.run(inst_cypher).data():
            institutions.append(
                {
                    "name": r["name"],
                    "stadt": r.get("stadt") or "",
                    "count": r["count"],
                    "contested_count": r["contested_count"],
                }
            )
    return {"success": True, "actors": actors, "institutions": institutions}


@app.get("/api/actors/{actor_name}/summary")
def get_actor_summary(actor_name: str):
    if not is_neo4j_available():
        summary = EMBEDDED_STORE.get_actor_summary(actor_name)
        if not summary:
            raise HTTPException(status_code=404, detail=f"Akteur '{actor_name}' nicht gefunden.")
        return {"success": True, "summary": summary}

    driver = get_db_driver()
    cypher = """
    MATCH (a:Akteur {name: $name})
    OPTIONAL MATCH (a)-[r:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)
    OPTIONAL MATCH (s)-[:LAGERT_IN]->(i:Institution)
    OPTIONAL MATCH (a)-[rs:SCHENKTE]->(s2:Subjekt)
    WITH a, count(DISTINCT r) AS raub_count, count(DISTINCT rs) AS schenk_count,
         collect(DISTINCT i.name) AS depots,
         collect(DISTINCT r.expedition)[..5] AS expeditionen,
         collect(DISTINCT r.beleg)[..5] AS belege,
         collect(DISTINCT s.bezeichnung)[..10] AS beute_beispiele
    RETURN a.name AS name, a.rolle AS rolle, raub_count, schenk_count, depots, expeditionen, belege, beute_beispiele
    """
    with driver.session() as s:
        res = s.run(cypher, name=actor_name).single()
        if not res or not res["name"]:
            raise HTTPException(status_code=404, detail=f"Akteur '{actor_name}' nicht gefunden.")
        return {"success": True, "summary": dict(res)}


@app.get("/api/institutions/{inst_name}/summary")
def get_institution_summary(inst_name: str):
    if not is_neo4j_available():
        summary = EMBEDDED_STORE.get_institution_summary(inst_name)
        if not summary:
            raise HTTPException(status_code=404, detail=f"Institution '{inst_name}' nicht gefunden.")
        return {"success": True, "summary": summary}

    driver = get_db_driver()
    cypher = """
    MATCH (i:Institution {name: $name})
    OPTIONAL MATCH (s:Subjekt)-[:LAGERT_IN]->(i)
    OPTIONAL MATCH (a:Akteur)-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN]->(s)
    WITH i, count(DISTINCT s) AS total_subjekte,
         collect(DISTINCT a.name) AS akteure,
         collect(DISTINCT s.bezeichnung)[..10] AS sammlung_beispiele
    OPTIONAL MATCH (sc:Subjekt)-[:LAGERT_IN]->(i) WHERE sc.contested = true
    WITH i, total_subjekte, akteure, sammlung_beispiele, count(DISTINCT sc) AS contested_subjekte
    RETURN i.name AS name, i.stadt AS stadt, total_subjekte, contested_subjekte, akteure[..10] AS top_akteure, sammlung_beispiele
    """
    with driver.session() as s:
        res = s.run(cypher, name=inst_name).single()
        if not res or not res["name"]:
            raise HTTPException(status_code=404, detail=f"Institution '{inst_name}' nicht gefunden.")
        return {"success": True, "summary": dict(res)}


# ==========================================================
# 8. DOSSIER PDF GENERATOR, BATCH ZIP, PETITIONS & DOWNLOAD
# ==========================================================
@app.post("/api/dossier/generate")
def create_dossier(req: DossierRequest):
    inv = req.inventarnummer.strip()
    data = query_object_provenance(inv)
    if not data:
        raise HTTPException(status_code=404, detail=f"Objekt '{inv}' nicht im Graphen gefunden.")

    clean_filename = re.sub(r"[^A-Za-z0-9_-]", "_", inv)
    filename = f"Restitutionsdossier_{clean_filename}.pdf"
    out_file = os.path.join(DOSSIER_DIR, filename)
    generate_pdf_dossier(data, out_file)

    return {
        "success": True,
        "inventarnummer": inv,
        "filename": filename,
        "download_url": f"/api/dossier/download/{filename}",
    }


@app.post("/api/dossier/batch")
def create_batch_dossiers(req: BatchDossierRequest):
    limit = max(1, min(int(req.limit or 300), 500))
    clean_name = re.sub(r"[^A-Za-z0-9_-]", "_", req.entity_name or "Auswahl")

    if req.entity_type == "actor":
        prefix = f"Restitutionsakten_{clean_name}"
    elif req.entity_type == "institution":
        prefix = f"Depotbestand_{clean_name}"
    elif req.entity_type == "gaps":
        prefix = "Provenienz_Luecken_Auskunftsersuchen"
    elif req.entity_type == "list":
        prefix = f"Routenbestand_{clean_name}"
    else:
        raise HTTPException(status_code=400, detail="Ungueltiger entity_type. Erlaubt: 'actor', 'institution', 'gaps', 'list'.")

    if not is_neo4j_available() or req.entity_type == "list":
        inv_list = EMBEDDED_STORE.get_batch_inventories(
            req.entity_type,
            req.entity_name,
            limit=limit,
            explicit_invs=req.inventarnummern,
        )
    else:
        driver = get_db_driver()
        if req.entity_type == "actor":
            cypher = "MATCH (a:Akteur {name: $name})-[:RAUBTE|ENTEIGNETE|EIGNETE_SICH_AN|SCHENKTE]->(s:Subjekt) WHERE s.inventarnummer IS NOT NULL RETURN DISTINCT s.inventarnummer AS inv LIMIT $limit"
        elif req.entity_type == "institution":
            cypher = "MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution {name: $name}) WHERE s.inventarnummer IS NOT NULL RETURN DISTINCT s.inventarnummer AS inv LIMIT $limit"
        else:
            cypher = "MATCH (s:Subjekt)-[:LAGERT_IN]->(i:Institution) WHERE NOT ()-[:RAUBTE|SCHENKTE|VERKAUFTE_AN|ENTEIGNETE|EIGNETE_SICH_AN|UEBERGAB_AN]->(s) AND s.inventarnummer IS NOT NULL RETURN DISTINCT s.inventarnummer AS inv LIMIT $limit"
        with driver.session() as s:
            inv_list = [r["inv"] for r in s.run(cypher, {"name": req.entity_name, "limit": limit}).data() if r["inv"]]

    if not inv_list:
        raise HTTPException(status_code=404, detail=f"Keine Inventarnummern fuer '{req.entity_name}' gefunden.")

    zip_filename = f"{prefix}.zip"
    zip_path = os.path.join(DOSSIER_DIR, zip_filename)
    generated_count = 0

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
        for inv in inv_list:
            clean_inv = re.sub(r"[^A-Za-z0-9_-]", "_", inv)
            pdf_filename = f"Restitutionsdossier_{clean_inv}.pdf"
            pdf_path = os.path.join(DOSSIER_DIR, pdf_filename)
            if not os.path.exists(pdf_path):
                pdata = query_object_provenance(inv)
                if pdata:
                    try:
                        generate_pdf_dossier(pdata, pdf_path)
                    except Exception:
                        continue
            if os.path.exists(pdf_path):
                zipf.write(pdf_path, arcname=pdf_filename)
                generated_count += 1

    return {
        "success": True,
        "entity_type": req.entity_type,
        "entity_name": req.entity_name,
        "total_requested": len(inv_list),
        "dossiers_packaged": generated_count,
        "filename": zip_filename,
        "download_url": f"/api/dossier/download/{zip_filename}",
    }


@app.get("/api/dossier/download/{filename}")
def download_dossier(filename: str):
    """Liefert ein generiertes PDF-, JSON- oder ZIP-Archiv gegen Pfad-Traversal geschuetzt aus."""
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ungueltiger Dateiname.")

    real_dir = os.path.realpath(DOSSIER_DIR)
    filepath = os.path.realpath(os.path.join(real_dir, safe_name))
    if not filepath.startswith(real_dir + os.sep) or not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Dossier-Datei nicht gefunden.")

    lower = safe_name.lower()
    if lower.endswith(".zip"):
        media_type = "application/zip"
    elif lower.endswith(".json"):
        media_type = "application/json"
    else:
        media_type = "application/pdf"

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=safe_name,
        headers={"Content-Disposition": f"attachment; filename={safe_name}"},
    )


@app.post("/api/petition/generate")
def create_diplomatic_petition(req: PetitionRequest):
    from generate_diplomatic_petition import generate_petition_pdf, query_stolen_objects

    objects = query_stolen_objects(req.institution, req.community)
    if not objects:
        raise HTTPException(
            status_code=404,
            detail=f"Keine geraubten Objekte der {req.community}-Gemeinschaft in {req.institution} gefunden.",
        )

    clean_inst = re.sub(r"[^A-Za-z0-9_-]", "_", req.institution)
    clean_comm = re.sub(r"[^A-Za-z0-9_-]", "_", req.community)
    filename = f"Restitutionsantrag_{clean_comm}_{clean_inst}.pdf"
    out_file = os.path.join(DOSSIER_DIR, filename)

    pdf_path = generate_petition_pdf(req.institution, req.community, out_file)
    if not pdf_path:
        raise HTTPException(status_code=500, detail="PDF-Generierung fehlgeschlagen.")

    return {
        "success": True,
        "institution": req.institution,
        "community": req.community,
        "object_count": len(objects),
        "filename": filename,
        "download_url": f"/api/dossier/download/{filename}",
    }


LLM_PETITION_JOBS: Dict[str, Dict[str, Any]] = {}


def run_llm_petition_background_job(job_id: str, institution: str, community: Optional[str], actor: Optional[str]):
    from llm_forensic_counsel import create_restitution_package

    def update_progress(step_msg: str):
        if job_id in LLM_PETITION_JOBS:
            LLM_PETITION_JOBS[job_id]["step"] = step_msg

    try:
        LLM_PETITION_JOBS[job_id]["status"] = "processing"
        res = create_restitution_package(
            institution=institution,
            community=community,
            actor=actor,
            out_dir=DOSSIER_DIR,
            progress_callback=update_progress,
        )
        LLM_PETITION_JOBS[job_id]["status"] = "completed"
        LLM_PETITION_JOBS[job_id]["step"] = "Fertiggestellt & versiegelt"
        LLM_PETITION_JOBS[job_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
        LLM_PETITION_JOBS[job_id]["result"] = {
            "institution": res["institution"],
            "community": res["community"],
            "counts": res["counts"],
            "pdf_filename": res["pdf_filename"],
            "json_filename": res["json_filename"],
            "zip_filename": res["zip_filename"],
            "download_pdf_url": f"/api/dossier/download/{res['pdf_filename']}",
            "download_zip_url": f"/api/dossier/download/{res['zip_filename']}",
            "legal_summary": res.get("legal_summary", ""),
        }
    except Exception as err:
        LLM_PETITION_JOBS[job_id]["status"] = "failed"
        LLM_PETITION_JOBS[job_id]["step"] = "Fehlgeschlagen"
        LLM_PETITION_JOBS[job_id]["error"] = str(err)


@app.post("/api/petition/generate_llm", status_code=status.HTTP_202_ACCEPTED)
def create_llm_restitution_petition(req: LLMPetitionRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    LLM_PETITION_JOBS[job_id] = {
        "job_id": job_id,
        "institution": req.institution,
        "community": req.community,
        "actor": req.actor,
        "status": "processing",
        "step": "Starte forensische Analyse...",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    background_tasks.add_task(run_llm_petition_background_job, job_id, req.institution, req.community, req.actor)
    return {
        "success": True,
        "job_id": job_id,
        "status": "processing",
        "step": "Starte forensische Analyse...",
        "message": f"HLKO-Restitutionspaket fuer '{req.institution}' wird im Hintergrund generiert.",
        "status_url": f"/api/petition/status/{job_id}",
    }


@app.get("/api/petition/status/{job_id}")
def get_petition_status(job_id: str):
    job = LLM_PETITION_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job-ID nicht gefunden.")
    return job


# ==========================================================
# 9. ANNOTATIONS, LAYOUT & MANUAL EDGES
# ==========================================================
@app.post("/api/objects/{inventarnummer:path}/annotations")
def add_object_annotation(inventarnummer: str, req: AnnotationRequest, request: Request):
    require_researcher(request)
    if not is_neo4j_available():
        added = EMBEDDED_STORE.add_annotation(
            inventarnummer=inventarnummer,
            author=req.author,
            role=req.role,
            tags=req.tags,
            notes=req.notes,
            confidence=req.confidence,
        )
        if not added:
            raise HTTPException(status_code=404, detail=f"Objekt mit Inventarnummer '{inventarnummer}' nicht gefunden.")
        ann_id, canonical_inv = added
        return {
            "success": True,
            "annotation_id": ann_id,
            "inventarnummer": canonical_inv,
            "message": "Annotation erfolgreich im Graphen verankert.",
        }

    driver = get_db_driver()
    annotation_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    cypher = """
    MATCH (s:Subjekt)
    WHERE s.inventarnummer = $inv OR toLower(trim(s.inventarnummer)) = toLower(trim($inv))
    WITH s LIMIT 1
    CREATE (a:Annotation {
        id: $id, author: $author, role: $role, tags: $tags,
        notes: $notes, confidence: $confidence, created_at: $created_at
    })
    CREATE (s)-[:HAS_ANNOTATION]->(a)
    RETURN a.id AS id, s.inventarnummer AS inv
    """
    with driver.session() as session:
        res = session.run(
            cypher,
            {
                "inv": inventarnummer,
                "id": annotation_id,
                "author": req.author,
                "role": req.role,
                "tags": req.tags,
                "notes": req.notes,
                "confidence": req.confidence,
                "created_at": created_at,
            },
        ).single()
    if not res:
        raise HTTPException(status_code=404, detail=f"Objekt mit Inventarnummer '{inventarnummer}' nicht gefunden.")
    return {
        "success": True,
        "annotation_id": annotation_id,
        "inventarnummer": res["inv"],
        "message": "Annotation erfolgreich persistent im Graphen verankert.",
    }


@app.get("/api/objects/{inventarnummer:path}/annotations")
def get_object_annotations(inventarnummer: str):
    if not is_neo4j_available():
        records = EMBEDDED_STORE.get_annotations(inventarnummer)
        return {"inventarnummer": inventarnummer, "count": len(records), "annotations": records}

    driver = get_db_driver()
    cypher = """
    MATCH (s:Subjekt)-[:HAS_ANNOTATION]->(a:Annotation)
    WHERE s.inventarnummer = $inv OR toLower(trim(s.inventarnummer)) = toLower(trim($inv))
    RETURN a.id AS id, a.author AS author, a.role AS role,
           a.tags AS tags, a.notes AS notes, a.confidence AS confidence,
           a.created_at AS created_at
    ORDER BY a.created_at DESC
    """
    with driver.session() as session:
        records = session.run(cypher, {"inv": inventarnummer}).data()
    return {"inventarnummer": inventarnummer, "count": len(records), "annotations": records}


@app.delete("/api/annotations/{annotation_id}")
def delete_annotation(annotation_id: str, request: Request):
    require_researcher(request)
    if not is_neo4j_available():
        deleted = EMBEDDED_STORE.delete_annotation(annotation_id)
        if deleted == 0:
            raise HTTPException(status_code=404, detail=f"Annotation mit ID '{annotation_id}' nicht gefunden.")
        return {"success": True, "deleted_id": annotation_id}

    driver = get_db_driver()
    with driver.session() as session:
        res = session.run("MATCH (a:Annotation {id: $id}) DETACH DELETE a RETURN count(a) AS deleted", {"id": annotation_id}).single()
        deleted = res["deleted"] if res else 0
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Annotation mit ID '{annotation_id}' nicht gefunden.")
    return {"success": True, "deleted_id": annotation_id}


@app.delete("/api/publications/{pub_id}")
def delete_publication(pub_id: str, request: Request):
    require_researcher(request)
    if not is_neo4j_available():
        EMBEDDED_STORE.delete_publication(pub_id)
        return {"success": True, "message": f"Publikation {pub_id} und zugehoerige Kanten geloescht."}

    driver = get_db_driver()
    with driver.session() as session:
        session.run(
            "MATCH (pub:Publikation {id: $pub_id}) OPTIONAL MATCH ()-[r]->() WHERE r.publikation = pub.id DELETE r DELETE pub",
            {"pub_id": pub_id},
        )
    try:
        enrich_contested()
    except Exception:
        pass
    return {"success": True, "message": f"Publikation {pub_id} und zugehoerige Kanten geloescht."}


@app.post("/api/graph/layout")
async def save_layout(request: Request):
    require_researcher(request)
    try:
        new_layout = await request.json()
        layout = {}
        if os.path.exists(LAYOUT_FILE):
            try:
                with open(LAYOUT_FILE, "r", encoding="utf-8") as f:
                    layout = json.load(f)
            except Exception:
                pass
        layout.update(new_layout)
        with open(LAYOUT_FILE, "w", encoding="utf-8") as f:
            json.dump(layout, f)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.delete("/api/graph/layout")
def reset_layout(request: Request):
    require_researcher(request)
    if os.path.exists(LAYOUT_FILE):
        os.remove(LAYOUT_FILE)
    return {"success": True}


@app.post("/api/graph/edges")
def create_edge(req: EdgeCreateRequest, request: Request):
    require_researcher(request)
    if req.rel_type not in ALLOWED_RELS:
        raise HTTPException(status_code=400, detail="Ungueltiger Relationstyp")

    if not is_neo4j_available():
        ok = EMBEDDED_STORE.create_edge(req.source_id, req.target_id, req.rel_type, req.props)
        if not ok:
            raise HTTPException(status_code=404, detail="Source oder Target nicht gefunden")
        return {"success": True}

    driver = get_db_driver()
    cypher = f"""
    MATCH (s), (t)
    WHERE (toLower(trim(coalesce(s.inventarnummer, ''))) = toLower(trim($source_id))
        OR toLower(trim(coalesce(s.name, ''))) = toLower(trim($source_id))
        OR toLower(trim(coalesce(s.id, ''))) = toLower(trim($source_id)))
      AND (toLower(trim(coalesce(t.inventarnummer, ''))) = toLower(trim($target_id))
        OR toLower(trim(coalesce(t.name, ''))) = toLower(trim($target_id))
        OR toLower(trim(coalesce(t.id, ''))) = toLower(trim($target_id)))
    MERGE (s)-[r:{req.rel_type}]->(t)
    SET r += $props
    SET r.manuell_erstellt = true
    SET r.created_at = datetime()
    RETURN type(r)
    """
    with driver.session() as session:
        res = session.run(cypher, {"source_id": req.source_id, "target_id": req.target_id, "props": req.props}).single()
        if not res:
            raise HTTPException(status_code=404, detail="Source oder Target nicht gefunden")
    try:
        enrich_contested()
    except Exception:
        pass
    return {"success": True}


@app.delete("/api/graph/edges")
def delete_edge(req: EdgeDeleteRequest, request: Request):
    require_researcher(request)
    if req.rel_type not in ALLOWED_RELS:
        raise HTTPException(status_code=400, detail="Ungueltiger Relationstyp")

    if not is_neo4j_available():
        deleted = EMBEDDED_STORE.delete_edge(req.source_id, req.target_id, req.rel_type)
        return {"success": True, "deleted": deleted}

    driver = get_db_driver()
    cypher = f"""
    MATCH (s)-[r:{req.rel_type}]->(t)
    WHERE (toLower(trim(coalesce(s.inventarnummer, ''))) = toLower(trim($source_id))
        OR toLower(trim(coalesce(s.name, ''))) = toLower(trim($source_id))
        OR toLower(trim(coalesce(s.id, ''))) = toLower(trim($source_id)))
      AND (toLower(trim(coalesce(t.inventarnummer, ''))) = toLower(trim($target_id))
        OR toLower(trim(coalesce(t.name, ''))) = toLower(trim($target_id))
        OR toLower(trim(coalesce(t.id, ''))) = toLower(trim($target_id)))
    DELETE r
    RETURN count(r) AS deleted
    """
    with driver.session() as session:
        res = session.run(cypher, {"source_id": req.source_id, "target_id": req.target_id}).single()
    try:
        enrich_contested()
    except Exception:
        pass
    return {"success": True, "deleted": res["deleted"] if res else 0}


# ==========================================================
# 10. VISUAL PHOTO-CHAIN PROVENANCE FORENSICS ENDPOINTS
# ==========================================================
class VisualFrameInput(BaseModel):
    id: Optional[str] = None
    label: str
    year: Optional[int] = None
    location: Optional[str] = ""
    source: Optional[str] = ""
    is_control: bool = False
    data_url: str


class VisualChainAnalyzeRequest(BaseModel):
    frames: List[VisualFrameInput]


class VisualChainCommitRequest(BaseModel):
    inventarnummer: Optional[str] = None
    bezeichnung: str
    community: Optional[str] = ""
    actor: Optional[str] = ""
    institution: Optional[str] = ""
    evidence_summary: str
    confidence: float = 0.85


@app.get("/api/visual/demo_case")
def get_visual_forensics_demo_case():
    """Liefert die 4-teilige forensische Referenz-Fotoserie (1902 -> 1908 -> 2024 + Negativprobe) inkl. RANSAC-Analyse."""
    from backend.visual_provenance import analyze_photo_chain, get_or_create_demo_photo_series

    demo_dir = os.path.join(DROPZONE_DIR, "photo_forensics_demo")
    frames = get_or_create_demo_photo_series(demo_dir)
    analysis = analyze_photo_chain(frames)
    analysis["frames_with_previews"] = [
        {
            "id": f["id"],
            "label": f["label"],
            "year": f["year"],
            "location": f["location"],
            "source": f["source"],
            "is_control": f["is_control"],
            "data_url": f["data_url"],
        }
        for f in frames
    ]
    return analysis


@app.post("/api/visual/analyze_chain")
def analyze_uploaded_visual_chain(req: VisualChainAnalyzeRequest):
    """Analysiert 2..12 hochgeladene Fotografien auf geometrische Einzelobjekt-Identitaet (RootSIFT + 6-DOF RANSAC)."""
    from backend.visual_provenance import analyze_photo_chain

    if len(req.frames) < 2 or len(req.frames) > 12:
        raise HTTPException(status_code=400, detail="Bitte zwischen 2 und 12 Aufnahmen fuer eine Foto-Kette uebergeben.")

    decoded_frames = []
    for idx, item in enumerate(req.frames):
        raw_b64 = item.data_url.split(",", 1)[-1] if "," in item.data_url else item.data_url
        try:
            img_bytes = base64.b64decode(raw_b64)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Ungueltige Bilddaten bei '{item.label}'.")
        decoded_frames.append(
            {
                "id": item.id or f"upload_{idx}",
                "label": item.label,
                "year": item.year,
                "location": item.location or "",
                "source": item.source or "",
                "is_control": item.is_control,
                "image_bytes": img_bytes,
            }
        )

    return analyze_photo_chain(decoded_frames)


@app.post("/api/visual/commit_chain")
def commit_verified_visual_chain(req: VisualChainCommitRequest, request: Request):
    """Verankert eine vom Forscher gepruefte Foto-Kette als nachvollziehbare Hypothesen-Spur im Wissensgraphen."""
    require_researcher(request)
    inv = (req.inventarnummer or "").strip() or f"FOTO-SPUR-{uuid.uuid4().hex[:6].upper()}"
    pub_id = f"visual_chain_{re.sub(r'[^a-z0-9_]', '', inv.lower())}"
    bez = f"{req.bezeichnung.strip()} ({req.community.strip()})" if req.community and req.community.strip() else req.bezeichnung.strip()

    triples = []
    obj_node = {
        "label": "Objekt",
        "id": inv,
        "props": {"inventarnummer": inv, "bezeichnung": bez, "herkunft": req.community or ""},
    }
    if req.actor and req.actor.strip():
        act = req.actor.strip()
        triples.append(
            {
                "type": "VERDACHT_AUF",
                "source": {"label": "Akteur", "id": act, "props": {"name": act, "rolle": "Aus Foto-Kette rekonstruierter Akteur"}},
                "target": obj_node,
                "rel_props": {
                    "publikation": pub_id,
                    "confidence": round(float(req.confidence), 3),
                    "begruendung": req.evidence_summary,
                    "beleg": "Visuelle Foto-Ketten-Forensik (RANSAC geometrisch geprueft, Human-in-the-Loop)",
                    "delikt": "VERDACHT_AUF",
                },
            }
        )
    if req.institution and req.institution.strip():
        inst = req.institution.strip()
        triples.append(
            {
                "type": "LAGERT_IN",
                "source": obj_node,
                "target": {"label": "Institution", "id": inst, "props": {"name": inst}},
                "rel_props": {
                    "publikation": pub_id,
                    "status": "Durch Foto-Kette zugeordneter Bestand",
                    "beleg": req.evidence_summary,
                },
            }
        )

    if not triples:
        raise HTTPException(status_code=400, detail="Bitte mindestens einen Akteur oder eine Ziel-Institution fuer die Graph-Verknuepfung angeben.")

    if not is_neo4j_available():
        EMBEDDED_STORE.ingest_publication_and_triples(
            pub_id=pub_id,
            filename=f"Foto-Kette {inv}",
            kuerzel="FOTO-REID",
            ext="VISION",
            triples=triples,
        )
    else:
        from extract_provenance_triples import ProvenanceGraphClient

        client = ProvenanceGraphClient()
        if client.connect():
            client.ingest_triples(triples)
            client.close()

    return {
        "success": True,
        "inventarnummer": inv,
        "publication_id": pub_id,
        "triples_committed": len(triples),
        "message": f"Foto-Ketten-Spur '{inv}' erfolgreich im Wissensgraphen verankert.",
    }


if os.path.isdir(FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="atlas-ui")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8088"))
    mode = "Neo4j Bolt" if is_neo4j_available() else "Zero-Docker Embedded Seed Graph"
    print(f"[+] Starte Project Echo ({mode}) auf http://{host}:{port} ...")
    uvicorn.run(app, host=host, port=port)
