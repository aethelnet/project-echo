"""
PROJECT ECHO // EMBEDDED GRAPH ENGINE (Zero-Docker Native Provenance Store)
Laedt `seed_graph.json.gz` (2.223 Knoten, 6.628 Relationen) direkt in indizierte
Speicherstrukturen und bildet alle Cypher-Operationen aus `serve_graph_api.py`
deterministisch ab, sobald kein externer Neo4j-Bolt-Server erreichbar ist.
"""

import gzip
import json
import os
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SEED_PATH = os.path.join(BASE_DIR, "seed_graph.json.gz")

LOOT_RELS = {"RAUBTE", "ENTEIGNETE", "EIGNETE_SICH_AN"}
LEGIT_CLAIM_RELS = {"SCHENKTE", "VERKAUFTE_AN"}
PROVENANCE_IN_RELS = {"RAUBTE", "SCHENKTE", "VERKAUFTE_AN", "ENTEIGNETE", "EIGNETE_SICH_AN", "UEBERGAB_AN"}


def _node_canonical_id(labels: Set[str], props: Dict[str, Any]) -> Optional[str]:
    if "Objekt" in labels or "Subjekt" in labels:
        return props.get("inventarnummer") or props.get("id") or props.get("name")
    if "Publikation" in labels:
        return props.get("id") or props.get("name")
    if "Annotation" in labels:
        return props.get("id")
    return props.get("name") or props.get("inventarnummer") or props.get("id")


class EmbeddedProvenanceGraph:
    def __init__(self, seed_path: str = DEFAULT_SEED_PATH):
        self.seed_path = seed_path
        self._lock = threading.RLock()
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, Any]] = []
        self.annotations_by_inv: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.load_seed()

    def load_seed(self) -> None:
        with self._lock:
            self.nodes.clear()
            self.edges.clear()
            self.annotations_by_inv.clear()

            if not os.path.exists(self.seed_path):
                return

            with gzip.open(self.seed_path, "rt", encoding="utf-8") as f:
                raw = json.load(f)

            for item in raw.get("nodes", []):
                labels = set(item.get("labels") or [])
                if "Objekt" in labels or "Subjekt" in labels:
                    labels.update({"Objekt", "Subjekt"})
                props = dict(item.get("props") or {})
                if "dateipfad" in props and props["dateipfad"]:
                    props["dateipfad"] = os.path.basename(str(props["dateipfad"]))
                nid = _node_canonical_id(labels, props)
                if not nid:
                    continue
                self.nodes[str(nid)] = {"id": str(nid), "labels": labels, "props": props}

            for rel in raw.get("relationships", []):
                s_id = rel.get("s_inv") or rel.get("s_name")
                t_id = rel.get("t_inv") or rel.get("t_name")
                rtype = rel.get("type")
                if not s_id or not t_id or not rtype:
                    continue
                s_key = str(s_id)
                t_key = str(t_id)
                if s_key not in self.nodes:
                    s_lbl = {rel.get("s_label") or "Entity"}
                    if "Objekt" in s_lbl or "Subjekt" in s_lbl:
                        s_lbl.update({"Objekt", "Subjekt"})
                    s_props = {"inventarnummer": s_key} if "Objekt" in s_lbl else {"name": s_key}
                    self.nodes[s_key] = {"id": s_key, "labels": s_lbl, "props": s_props}
                if t_key not in self.nodes:
                    t_lbl = {rel.get("t_label") or "Entity"}
                    if "Objekt" in t_lbl or "Subjekt" in t_lbl:
                        t_lbl.update({"Objekt", "Subjekt"})
                    t_props = {"inventarnummer": t_key} if "Objekt" in t_lbl else {"name": t_key}
                    self.nodes[t_key] = {"id": t_key, "labels": t_lbl, "props": t_props}

                self.edges.append(
                    {
                        "source": s_key,
                        "target": t_key,
                        "type": str(rtype),
                        "props": dict(rel.get("props") or {}),
                    }
                )

            self.recompute_contested_flags()

    def recompute_contested_flags(self) -> None:
        with self._lock:
            legit_targets: Set[str] = set()
            loot_targets: Set[str] = set()
            for e in self.edges:
                t_node = self.nodes.get(e["target"])
                if not t_node or "Subjekt" not in t_node["labels"]:
                    continue
                if e["type"] in LEGIT_CLAIM_RELS:
                    legit_targets.add(e["target"])
                elif e["type"] in LOOT_RELS:
                    loot_targets.add(e["target"])

            contested_ids = legit_targets & loot_targets
            for nid, node in self.nodes.items():
                if "Subjekt" in node["labels"]:
                    if nid in contested_ids or node["props"].get("contested"):
                        node["props"]["contested"] = True
                        node["props"]["status"] = "CONTESTED_NARRATIVE"

            for e in self.edges:
                if e["target"] in contested_ids and e["type"] in (LEGIT_CLAIM_RELS | LOOT_RELS):
                    e["props"]["kollision"] = True
                    if "narrativ" not in e["props"] or not e["props"]["narrativ"]:
                        e["props"]["narrativ"] = (
                            "MUSEUMS_NARRATIV" if e["type"] in LEGIT_CLAIM_RELS else "FORENSISCHE_REALITAET"
                        )

    def reset_database(self) -> None:
        with self._lock:
            self.nodes.clear()
            self.edges.clear()
            self.annotations_by_inv.clear()

    def _resolve_node_key(self, raw_id: str) -> Optional[str]:
        if raw_id in self.nodes:
            return raw_id
        needle = raw_id.strip().lower()
        for k, n in self.nodes.items():
            p = n["props"]
            for candidate in (k, p.get("inventarnummer"), p.get("name"), p.get("id")):
                if candidate and str(candidate).strip().lower() == needle:
                    return k
        return None

    @staticmethod
    def _primary_ui_type(labels: Set[str]) -> str:
        if "Objekt" in labels or "Subjekt" in labels:
            return "Subjekt"
        for cand in ("Akteur", "Institution", "Publikation"):
            if cand in labels:
                return cand
        return next(iter(labels), "Entity")

    def get_graph(
        self,
        limit: int = 8000,
        search: Optional[str] = None,
        pub_list: Optional[List[str]] = None,
    ) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
        with self._lock:
            q = search.strip().lower() if search and search.strip() else None
            pubs = set(pub_list) if pub_list else None

            matched_edges = []
            for e in self.edges:
                if pubs is not None and e["props"].get("publikation") not in pubs:
                    continue
                s_node = self.nodes.get(e["source"])
                t_node = self.nodes.get(e["target"])
                if not s_node or not t_node:
                    continue
                if q:
                    sp = s_node["props"]
                    tp = t_node["props"]
                    hay = " ".join(
                        str(x or "")
                        for x in (
                            sp.get("name"),
                            sp.get("inventarnummer"),
                            sp.get("bezeichnung"),
                            tp.get("name"),
                            tp.get("inventarnummer"),
                            tp.get("bezeichnung"),
                        )
                    ).lower()
                    if q not in hay:
                        continue
                matched_edges.append(e)

            def _edge_priority(edge: Dict[str, Any]) -> int:
                if edge["type"] == "VERDACHT_AUF":
                    return 0
                if edge["props"].get("kollision"):
                    return 1
                return 2

            matched_edges.sort(key=_edge_priority)
            matched_edges = matched_edges[: max(1, int(limit))]

            nodes_dict: Dict[str, Dict[str, Any]] = {}
            links: List[Dict[str, Any]] = []

            for e in matched_edges:
                s_node = self.nodes[e["source"]]
                t_node = self.nodes[e["target"]]
                sp = s_node["props"]
                tp = t_node["props"]
                s_id = e["source"]
                t_id = e["target"]
                s_type = self._primary_ui_type(s_node["labels"])
                t_type = self._primary_ui_type(t_node["labels"])

                if s_id not in nodes_dict:
                    nodes_dict[s_id] = {
                        "id": s_id,
                        "label": sp.get("name") or sp.get("inventarnummer") or s_id,
                        "type": s_type,
                        "desc": sp.get("bezeichnung") or sp.get("rolle") or sp.get("stadt") or "",
                        "contested": bool(sp.get("contested")),
                    }
                if t_id not in nodes_dict:
                    nodes_dict[t_id] = {
                        "id": t_id,
                        "label": tp.get("name") or tp.get("inventarnummer") or t_id,
                        "type": t_type,
                        "desc": tp.get("bezeichnung") or tp.get("stadt") or tp.get("rolle") or "",
                        "contested": bool(tp.get("contested")),
                    }

                rp = e["props"]
                rtype = e["type"]
                links.append(
                    {
                        "source": s_id,
                        "target": t_id,
                        "type": rtype,
                        "beleg": rp.get("beleg") or "",
                        "jahr": rp.get("jahr") or rp.get("zeit"),
                        "delikt": rp.get("delikt") or rtype,
                        "expedition": rp.get("expedition"),
                        "narrativ": rp.get("narrativ")
                        or ("MUSEUMS_NARRATIV" if rtype in LEGIT_CLAIM_RELS else "FORENSISCHE_REALITAET"),
                        "behauptung": rp.get("behauptung") or "",
                        "kollision": bool(rp.get("kollision")),
                        "publikation": rp.get("publikation") or "unbekannt",
                        "confidence": rp.get("confidence"),
                        "begruendung": rp.get("begruendung") or "",
                        "zitat": rp.get("zitat") or "",
                        "source_label": nodes_dict[s_id]["label"],
                        "source_type": s_type,
                        "source_desc": nodes_dict[s_id]["desc"],
                        "source_inv": sp.get("inventarnummer"),
                        "target_label": nodes_dict[t_id]["label"],
                        "target_type": t_type,
                        "target_desc": nodes_dict[t_id]["desc"],
                        "target_inv": tp.get("inventarnummer"),
                    }
                )

            return nodes_dict, links

    def get_macro_graph(self) -> Dict[str, Any]:
        with self._lock:
            inst_objs: Dict[str, Set[str]] = defaultdict(set)
            obj_insts: Dict[str, Set[str]] = defaultdict(set)
            for e in self.edges:
                if e["type"] == "LAGERT_IN":
                    s_node = self.nodes.get(e["source"])
                    t_node = self.nodes.get(e["target"])
                    if s_node and t_node and "Subjekt" in s_node["labels"] and "Institution" in t_node["labels"]:
                        inst_objs[e["target"]].add(e["source"])
                        obj_insts[e["source"]].add(e["target"])

            nodes_dict: Dict[str, Dict[str, Any]] = {}
            for inst_id, obj_ids in inst_objs.items():
                contested_cnt = sum(1 for oid in obj_ids if self.nodes[oid]["props"].get("contested"))
                cnt = len(obj_ids)
                nodes_dict[inst_id] = {
                    "id": inst_id,
                    "label": inst_id,
                    "type": "Institution_Cluster",
                    "desc": f"{cnt} Objekte ({contested_cnt} umstritten)",
                    "size": min(50, max(10, cnt / 100.0)),
                    "count": cnt,
                }

            pair_counts: Dict[Tuple[str, str], int] = defaultdict(int)
            for e in self.edges:
                if e["type"] in LOOT_RELS:
                    a_node = self.nodes.get(e["source"])
                    if a_node and "Akteur" in a_node["labels"]:
                        for inst_id in obj_insts.get(e["target"], ()):
                            pair_counts[(e["source"], inst_id)] += 1

            links = []
            for (actor_id, inst_id), r_cnt in sorted(pair_counts.items(), key=lambda x: -x[1]):
                a_node = self.nodes[actor_id]
                if actor_id not in nodes_dict:
                    nodes_dict[actor_id] = {
                        "id": actor_id,
                        "label": actor_id,
                        "type": "Akteur",
                        "desc": a_node["props"].get("rolle") or "Kolonialakteur",
                        "size": 15,
                        "count": 0,
                    }
                if inst_id in nodes_dict:
                    links.append(
                        {
                            "source": actor_id,
                            "target": inst_id,
                            "type": "RAUBTE_MASSE",
                            "beleg": f"{r_cnt} Objekte identifiziert",
                            "count": r_cnt,
                        }
                    )

            return {
                "success": True,
                "nodes": list(nodes_dict.values()),
                "links": links,
                "total_nodes": len(nodes_dict),
                "total_links": len(links),
            }

    def get_publications(self) -> List[Dict[str, Any]]:
        with self._lock:
            edge_counts: Dict[str, int] = defaultdict(int)
            for e in self.edges:
                pub = e["props"].get("publikation")
                if pub:
                    edge_counts[str(pub)] += 1

            pubs = []
            for n in self.nodes.values():
                if "Publikation" not in n["labels"]:
                    continue
                p = n["props"]
                pid = str(p.get("id") or n["id"])
                pubs.append(
                    {
                        "id": pid,
                        "name": p.get("name") or pid,
                        "kuerzel": p.get("kuerzel") or pid.upper()[:8],
                        "typ": p.get("typ") or "Dokument",
                        "jahr": p.get("jahr"),
                        "beschreibung": p.get("beschreibung") or "",
                        "edge_count": edge_counts.get(pid, 0),
                    }
                )
            pubs.sort(key=lambda x: -x["edge_count"])
            return pubs

    def get_ghosts(self) -> Dict[str, Any]:
        with self._lock:
            has_depot: Set[str] = set()
            for e in self.edges:
                if e["type"] == "LAGERT_IN":
                    t_node = self.nodes.get(e["target"])
                    if t_node and "Institution" in t_node["labels"]:
                        has_depot.add(e["source"])

            ghost_objects = []
            ghost_ids: List[str] = []
            seen_ids: Set[str] = set()
            for e in self.edges:
                if e["type"] not in LOOT_RELS:
                    continue
                if e["target"] in has_depot:
                    continue
                a_node = self.nodes.get(e["source"])
                o_node = self.nodes.get(e["target"])
                if not a_node or not o_node or "Akteur" not in a_node["labels"] or "Objekt" not in o_node["labels"]:
                    continue
                inv_id = o_node["props"].get("inventarnummer") or o_node["id"]
                if inv_id not in seen_ids:
                    seen_ids.add(inv_id)
                    ghost_ids.append(inv_id)
                ghost_objects.append(
                    {
                        "id": inv_id,
                        "inventarnummer": inv_id,
                        "bezeichnung": o_node["props"].get("bezeichnung") or "Verschollenes Kulturgut",
                        "akteur": a_node["props"].get("name") or a_node["id"],
                        "akteur_rolle": a_node["props"].get("rolle"),
                        "delikt": e["type"],
                        "jahr": e["props"].get("jahr"),
                        "beleg": e["props"].get("beleg"),
                        "expedition": e["props"].get("expedition"),
                        "status": "VERSCHOLLEN / KEIN DEPOTBELEG",
                    }
                )

            return {
                "success": True,
                "ghost_count": len(ghost_objects),
                "ghost_ids": ghost_ids,
                "ghosts": ghost_objects,
            }

    def get_contested(self) -> Dict[str, Any]:
        with self._lock:
            legit_by_obj: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            raub_by_obj: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            depot_by_obj: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

            for e in self.edges:
                s_node = self.nodes.get(e["source"])
                t_node = self.nodes.get(e["target"])
                if not s_node or not t_node:
                    continue
                if e["type"] == "LAGERT_IN" and "Institution" in t_node["labels"]:
                    depot_by_obj[e["source"]].append(t_node["props"])
                elif "Akteur" in s_node["labels"] and "Objekt" in t_node["labels"]:
                    rp = e["props"]
                    actor_name = s_node["props"].get("name") or s_node["id"]
                    if e["type"] in LEGIT_CLAIM_RELS:
                        legit_by_obj[e["target"]].append(
                            {
                                "akteur": actor_name,
                                "rel": e["type"],
                                "beleg": rp.get("beleg"),
                                "claim": rp.get("behauptung")
                                or "Offizielles Museumsinventar: Uneigennuetzige Schenkung/Erwerb",
                                "jahr": rp.get("jahr"),
                                "kategorie": rp.get("kategorie") or "WHITEWASHING",
                            }
                        )
                    elif e["type"] in {"RAUBTE", "ENTEIGNETE"}:
                        raub_by_obj[e["target"]].append(
                            {
                                "akteur": actor_name,
                                "rel": e["type"],
                                "beleg": rp.get("beleg"),
                                "claim": rp.get("forensik_behauptung")
                                or rp.get("delikt")
                                or "Militaerischer Raubzug / Brandschatzung",
                                "jahr": rp.get("jahr"),
                                "kategorie": rp.get("kategorie") or "MILITAERISCHER_RAUB",
                            }
                        )

            contested_items = []
            contested_ids = []
            seen = set()
            for obj_id in sorted(set(legit_by_obj.keys()) & set(raub_by_obj.keys())):
                o_node = self.nodes.get(obj_id)
                if not o_node:
                    continue
                depots = depot_by_obj.get(obj_id) or [{"name": "Unbekannt", "stadt": "Deutschland"}]
                for dep in depots:
                    if len(contested_items) >= 2500:
                        break
                    inv = o_node["props"].get("inventarnummer") or obj_id
                    if inv not in seen:
                        seen.add(inv)
                        contested_ids.append(inv)
                    contested_items.append(
                        {
                            "id": inv,
                            "inventarnummer": inv,
                            "bezeichnung": o_node["props"].get("bezeichnung") or "Koloniales Kulturgut",
                            "institution": dep.get("name") or "Unbekannt",
                            "stadt": dep.get("stadt") or "Deutschland",
                            "dissonance_type": "SCHENKUNG_VS_RAUB",
                            "museum_narratives": legit_by_obj[obj_id],
                            "forensic_realities": raub_by_obj[obj_id],
                        }
                    )
                if len(contested_items) >= 2500:
                    break

            return {
                "success": True,
                "contested_count": len(contested_items),
                "contested_ids": contested_ids,
                "items": contested_items,
            }

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            subjekte = sum(1 for n in self.nodes.values() if "Subjekt" in n["labels"])
            akteure = sum(1 for n in self.nodes.values() if "Akteur" in n["labels"])
            institutionen = sum(1 for n in self.nodes.values() if "Institution" in n["labels"])
            publikationen = sum(1 for n in self.nodes.values() if "Publikation" in n["labels"])
            raub_kanten = sum(1 for e in self.edges if e["type"] == "RAUBTE")
            schenk_kanten = sum(1 for e in self.edges if e["type"] == "SCHENKTE")
            verdacht_kanten = sum(1 for e in self.edges if e["type"] == "VERDACHT_AUF")

            legit_objs: Set[str] = set()
            raub_objs: Set[str] = set()
            has_prov_in: Set[str] = set()
            in_depot: Set[str] = set()

            for e in self.edges:
                t_node = self.nodes.get(e["target"])
                s_node = self.nodes.get(e["source"])
                if e["type"] == "LAGERT_IN" and s_node and "Subjekt" in s_node["labels"] and t_node and "Institution" in t_node["labels"]:
                    in_depot.add(e["source"])
                if t_node and "Subjekt" in t_node["labels"]:
                    if e["type"] in LEGIT_CLAIM_RELS:
                        legit_objs.add(e["target"])
                    if e["type"] in {"RAUBTE", "ENTEIGNETE"}:
                        raub_objs.add(e["target"])
                    if e["type"] in PROVENANCE_IN_RELS:
                        has_prov_in.add(e["target"])

            return {
                "success": True,
                "subjekte": subjekte,
                "objekte": subjekte,
                "akteure": akteure,
                "institutionen": institutionen,
                "publikationen": publikationen,
                "raub_kanten": raub_kanten,
                "schenk_kanten": schenk_kanten,
                "verdacht_kanten": verdacht_kanten,
                "gesamt_kanten": len(self.edges),
                "contested_objekte": len(legit_objs & raub_objs),
                "provenienz_luecken": len(in_depot - has_prov_in),
            }

    def get_suspicions(self) -> Dict[str, Any]:
        with self._lock:
            depots_by_obj: Dict[str, List[str]] = defaultdict(list)
            for e in self.edges:
                if e["type"] == "LAGERT_IN" and e["target"] in self.nodes and "Institution" in self.nodes[e["target"]]["labels"]:
                    depots_by_obj[e["source"]].append(self.nodes[e["target"]]["props"].get("name") or e["target"])

            items = []
            for e in self.edges:
                if e["type"] != "VERDACHT_AUF":
                    continue
                a_node = self.nodes.get(e["source"])
                s_node = self.nodes.get(e["target"])
                if not a_node or not s_node or "Akteur" not in a_node["labels"] or "Subjekt" not in s_node["labels"]:
                    continue
                rp = e["props"]
                inv = s_node["props"].get("inventarnummer") or s_node["id"]
                for museum in depots_by_obj.get(e["target"], []):
                    items.append(
                        {
                            "akteur": a_node["props"].get("name") or a_node["id"],
                            "inv": inv,
                            "bezeichnung": s_node["props"].get("bezeichnung") or "Koloniales Kulturgut",
                            "museum": museum,
                            "confidence": rp.get("confidence") or 0.0,
                            "begruendung": rp.get("begruendung"),
                            "beleg": rp.get("beleg"),
                            "expedition": rp.get("expedition"),
                            "expedition_num": rp.get("expedition_num"),
                            "zeit": rp.get("zeit"),
                            "zitat": rp.get("zitat"),
                        }
                    )

            items.sort(key=lambda r: (-(r["confidence"] or 0.0), str(r["inv"])))
            return {"success": True, "total": len(items), "suspicions": items}

    def get_gaps(self) -> Dict[str, Any]:
        with self._lock:
            has_prov_in: Set[str] = set()
            for e in self.edges:
                if e["type"] in PROVENANCE_IN_RELS:
                    has_prov_in.add(e["target"])

            gaps = []
            for e in self.edges:
                if e["type"] != "LAGERT_IN" or e["source"] in has_prov_in:
                    continue
                s_node = self.nodes.get(e["source"])
                i_node = self.nodes.get(e["target"])
                if not s_node or not i_node or "Subjekt" not in s_node["labels"] or "Institution" not in i_node["labels"]:
                    continue
                sp = s_node["props"]
                ip = i_node["props"]
                inv = sp.get("inventarnummer") or sp.get("name") or s_node["id"]
                gaps.append(
                    {
                        "id": inv,
                        "inventarnummer": sp.get("inventarnummer") or "",
                        "bezeichnung": sp.get("bezeichnung") or "Koloniales Kulturgut (Altersbestand)",
                        "institution": ip.get("name") or i_node["id"],
                        "stadt": ip.get("stadt") or "",
                        "beleg": e["props"].get("beleg") or "Kein historischer Erwerbsnachweis dokumentiert",
                    }
                )

            gaps.sort(key=lambda g: (g["institution"], g["inventarnummer"]))
            return {
                "success": True,
                "total_gaps": len(gaps),
                "gap_ids": [g["id"] for g in gaps],
                "items": gaps,
            }

    def get_filter_entities(self) -> Dict[str, Any]:
        with self._lock:
            obj_depots: Dict[str, Set[str]] = defaultdict(set)
            inst_objs: Dict[str, Set[str]] = defaultdict(set)
            for e in self.edges:
                if e["type"] == "LAGERT_IN":
                    s_node = self.nodes.get(e["source"])
                    i_node = self.nodes.get(e["target"])
                    if s_node and i_node and "Subjekt" in s_node["labels"] and "Institution" in i_node["labels"]:
                        iname = i_node["props"].get("name") or i_node["id"]
                        obj_depots[e["source"]].add(iname)
                        inst_objs[e["target"]].add(e["source"])

            raub_cnt: Dict[str, int] = defaultdict(int)
            schenk_cnt: Dict[str, int] = defaultdict(int)
            actor_depots: Dict[str, List[str]] = defaultdict(list)

            for e in self.edges:
                a_node = self.nodes.get(e["source"])
                t_node = self.nodes.get(e["target"])
                if not a_node or not t_node or "Akteur" not in a_node["labels"] or "Subjekt" not in t_node["labels"]:
                    continue
                aid = e["source"]
                if e["type"] in LOOT_RELS:
                    raub_cnt[aid] += 1
                    for dep in obj_depots.get(e["target"], ()):
                        if dep not in actor_depots[aid]:
                            actor_depots[aid].append(dep)
                elif e["type"] == "SCHENKTE":
                    schenk_cnt[aid] += 1

            actors = []
            for aid, r_c in sorted(raub_cnt.items(), key=lambda x: -x[1])[:25]:
                ap = self.nodes[aid]["props"]
                actors.append(
                    {
                        "name": ap.get("name") or aid,
                        "rolle": ap.get("rolle") or "Kolonialoffizier / Militaer",
                        "raub_count": r_c,
                        "schenk_count": schenk_cnt.get(aid, 0),
                        "top_depots": actor_depots.get(aid, [])[:3],
                    }
                )

            institutions = []
            for nid, node in self.nodes.items():
                if "Institution" not in node["labels"]:
                    continue
                objs = inst_objs.get(nid, set())
                c_cnt = sum(1 for oid in objs if self.nodes[oid]["props"].get("contested"))
                institutions.append(
                    {
                        "name": node["props"].get("name") or nid,
                        "stadt": node["props"].get("stadt") or "",
                        "count": len(objs),
                        "contested_count": c_cnt,
                    }
                )
            institutions.sort(key=lambda x: -x["count"])
            return {"success": True, "actors": actors, "institutions": institutions}

    def get_actor_summary(self, actor_name: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            aid = self._resolve_node_key(actor_name)
            if not aid or "Akteur" not in self.nodes[aid]["labels"]:
                return None
            ap = self.nodes[aid]["props"]

            obj_depots: Dict[str, List[str]] = defaultdict(list)
            for e in self.edges:
                if e["type"] == "LAGERT_IN" and e["target"] in self.nodes and "Institution" in self.nodes[e["target"]]["labels"]:
                    obj_depots[e["source"]].append(self.nodes[e["target"]]["props"].get("name") or e["target"])

            raub_count = 0
            schenk_count = 0
            depots: List[str] = []
            expeditionen: List[str] = []
            belege: List[str] = []
            beute_beispiele: List[str] = []

            for e in self.edges:
                if e["source"] != aid:
                    continue
                t_node = self.nodes.get(e["target"])
                if not t_node or "Subjekt" not in t_node["labels"]:
                    continue
                if e["type"] in LOOT_RELS:
                    raub_count += 1
                    for d in obj_depots.get(e["target"], ()):
                        if d not in depots:
                            depots.append(d)
                    exp = e["props"].get("expedition")
                    if exp and exp not in expeditionen and len(expeditionen) < 5:
                        expeditionen.append(exp)
                    bel = e["props"].get("beleg")
                    if bel and bel not in belege and len(belege) < 5:
                        belege.append(bel)
                    bez = t_node["props"].get("bezeichnung")
                    if bez and bez not in beute_beispiele and len(beute_beispiele) < 10:
                        beute_beispiele.append(bez)
                elif e["type"] == "SCHENKTE":
                    schenk_count += 1

            return {
                "name": ap.get("name") or aid,
                "rolle": ap.get("rolle") or "Kolonialakteur",
                "raub_count": raub_count,
                "schenk_count": schenk_count,
                "depots": depots,
                "expeditionen": expeditionen,
                "belege": belege,
                "beute_beispiele": beute_beispiele,
            }

    def get_institution_summary(self, inst_name: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            iid = self._resolve_node_key(inst_name)
            if not iid or "Institution" not in self.nodes[iid]["labels"]:
                return None
            ip = self.nodes[iid]["props"]

            obj_ids: Set[str] = set()
            for e in self.edges:
                if e["type"] == "LAGERT_IN" and e["target"] == iid and e["source"] in self.nodes and "Subjekt" in self.nodes[e["source"]]["labels"]:
                    obj_ids.add(e["source"])

            akteure: List[str] = []
            for e in self.edges:
                if e["type"] in LOOT_RELS and e["target"] in obj_ids:
                    a_node = self.nodes.get(e["source"])
                    if a_node and "Akteur" in a_node["labels"]:
                        aname = a_node["props"].get("name") or a_node["id"]
                        if aname not in akteure:
                            akteure.append(aname)

            sammlung_beispiele: List[str] = []
            contested_subjekte = 0
            for oid in sorted(obj_ids):
                op = self.nodes[oid]["props"]
                if op.get("contested"):
                    contested_subjekte += 1
                bez = op.get("bezeichnung")
                if bez and bez not in sammlung_beispiele and len(sammlung_beispiele) < 10:
                    sammlung_beispiele.append(bez)

            return {
                "name": ip.get("name") or iid,
                "stadt": ip.get("stadt") or "",
                "total_subjekte": len(obj_ids),
                "contested_subjekte": contested_subjekte,
                "top_akteure": akteure[:10],
                "sammlung_beispiele": sammlung_beispiele,
            }

    def query_object_provenance(self, inv_number: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            needle = inv_number.strip().lower()
            target_id = None
            for nid, node in self.nodes.items():
                if "Objekt" not in node["labels"]:
                    continue
                inv_val = str(node["props"].get("inventarnummer") or nid)
                if inv_val.lower() == needle:
                    target_id = nid
                    break
            if not target_id:
                for nid, node in self.nodes.items():
                    if "Objekt" not in node["labels"]:
                        continue
                    inv_val = str(node["props"].get("inventarnummer") or nid)
                    if needle in inv_val.lower():
                        target_id = nid
                        break
            if not target_id:
                return None

            o_node = self.nodes[target_id]
            akteure = []
            actor_ids: Set[str] = set()
            institutionen = []
            inst_ids: Set[str] = set()

            for e in self.edges:
                if e["target"] == target_id and e["source"] in self.nodes and "Akteur" in self.nodes[e["source"]]["labels"]:
                    ap = self.nodes[e["source"]]["props"]
                    actor_ids.add(e["source"])
                    entry = {
                        "name": ap.get("name") or e["source"],
                        "rolle": ap.get("rolle"),
                        "lebensdaten": ap.get("lebensdaten"),
                        "aktion": e["type"],
                        "jahr": e["props"].get("jahr") or e["props"].get("zeit"),
                        "beleg": e["props"].get("beleg"),
                        "behauptung": e["props"].get("behauptung") or e["props"].get("forensik_behauptung"),
                    }
                    if entry not in akteure:
                        akteure.append(entry)
                elif e["source"] == target_id and e["type"] == "LAGERT_IN" and e["target"] in self.nodes and "Institution" in self.nodes[e["target"]]["labels"]:
                    ip = self.nodes[e["target"]]["props"]
                    inst_ids.add(e["target"])
                    entry = {
                        "name": ip.get("name") or e["target"],
                        "stadt": ip.get("stadt"),
                        "status": e["props"].get("status"),
                        "beleg": e["props"].get("beleg"),
                    }
                    if entry not in institutionen:
                        institutionen.append(entry)

            transfers = []
            for e in self.edges:
                if e["source"] in actor_ids and e["target"] in inst_ids:
                    entry = {
                        "akteur": self.nodes[e["source"]]["props"].get("name") or e["source"],
                        "institution": self.nodes[e["target"]]["props"].get("name") or e["target"],
                        "transfer_art": e["type"],
                        "beleg": e["props"].get("beleg"),
                    }
                    if entry not in transfers:
                        transfers.append(entry)

            return {
                "inventarnummer": o_node["props"].get("inventarnummer") or target_id,
                "bezeichnung": o_node["props"].get("bezeichnung") or "Koloniales Kulturgut",
                "akteure": akteure,
                "institutionen": institutionen,
                "transfers": transfers,
            }

    def get_batch_inventories(
        self,
        entity_type: str,
        entity_name: str,
        limit: int = 300,
        explicit_invs: Optional[List[str]] = None,
    ) -> List[str]:
        with self._lock:
            if entity_type == "list" and explicit_invs:
                found = []
                for inv in explicit_invs:
                    rk = self._resolve_node_key(inv)
                    if rk and "Subjekt" in self.nodes[rk]["labels"]:
                        val = self.nodes[rk]["props"].get("inventarnummer") or rk
                        if val not in found:
                            found.append(val)
                    if len(found) >= limit:
                        break
                return found

            if entity_type == "actor":
                aid = self._resolve_node_key(entity_name)
                if not aid:
                    return []
                out: List[str] = []
                for e in self.edges:
                    if e["source"] == aid and e["type"] in (LOOT_RELS | {"SCHENKTE"}):
                        t_node = self.nodes.get(e["target"])
                        if t_node and "Subjekt" in t_node["labels"]:
                            inv = t_node["props"].get("inventarnummer")
                            if inv and inv not in out:
                                out.append(inv)
                                if len(out) >= limit:
                                    break
                return out

            if entity_type == "institution":
                iid = self._resolve_node_key(entity_name)
                if not iid:
                    return []
                out = []
                for e in self.edges:
                    if e["type"] == "LAGERT_IN" and e["target"] == iid:
                        s_node = self.nodes.get(e["source"])
                        if s_node and "Subjekt" in s_node["labels"]:
                            inv = s_node["props"].get("inventarnummer")
                            if inv and inv not in out:
                                out.append(inv)
                                if len(out) >= limit:
                                    break
                return out

            if entity_type == "gaps":
                gaps = self.get_gaps()["items"]
                out = []
                for g in gaps:
                    inv = g.get("inventarnummer")
                    if inv and inv not in out:
                        out.append(inv)
                        if len(out) >= limit:
                            break
                return out

            return []

    def query_stolen_objects(
        self,
        institution: str,
        community: Optional[str] = None,
        actor: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            inst_q = (institution or "").strip().lower()
            comm_q = (community or "").strip().lower()
            actor_q = (actor or "").strip().lower()

            depot_insts: Dict[str, List[str]] = defaultdict(list)
            for e in self.edges:
                if e["type"] == "LAGERT_IN" and e["target"] in self.nodes and "Institution" in self.nodes[e["target"]]["labels"]:
                    iname = self.nodes[e["target"]]["props"].get("name") or e["target"]
                    if not inst_q or inst_q in iname.lower():
                        depot_insts[e["source"]].append(iname)

            results = []
            seen_pairs: Set[Tuple[str, str, str]] = set()
            target_rels = LOOT_RELS | {"VERDACHT_AUF"}
            for e in self.edges:
                if e["type"] not in target_rels:
                    continue
                if e["target"] not in depot_insts:
                    continue
                a_node = self.nodes.get(e["source"])
                s_node = self.nodes.get(e["target"])
                if not a_node or not s_node or "Akteur" not in a_node["labels"] or "Subjekt" not in s_node["labels"]:
                    continue
                aname = a_node["props"].get("name") or a_node["id"]
                if actor_q and actor_q not in aname.lower():
                    continue
                sp = s_node["props"]
                rp = e["props"]
                bez = str(sp.get("bezeichnung") or "")
                begr = str(rp.get("begruendung") or "")
                zitat = str(rp.get("zitat") or "")
                exp = str(rp.get("expedition") or "")
                if comm_q and not any(comm_q in txt.lower() for txt in (bez, begr, zitat, exp)):
                    continue

                inv = str(sp.get("inventarnummer") or s_node["id"])
                sig = (inv, aname, e["type"])
                if sig in seen_pairs:
                    continue
                seen_pairs.add(sig)
                results.append(
                    {
                        "inv": inv,
                        "bez": bez or "Koloniales Kulturgut",
                        "akteur": aname,
                        "delikt": e["type"],
                        "beleg": rp.get("beleg") or "",
                        "zeit": rp.get("jahr") or rp.get("zeit") or "",
                        "exp": exp,
                        "zitat": zitat,
                        "institution": depot_insts[e["target"]][0],
                    }
                )

            results.sort(key=lambda r: r["inv"])
            return results[:limit]

    def ingest_publication_and_triples(
        self,
        pub_id: str,
        filename: str,
        kuerzel: str,
        ext: str,
        triples: List[Dict[str, Any]],
    ) -> None:
        with self._lock:
            self.nodes[pub_id] = {
                "id": pub_id,
                "labels": {"Publikation"},
                "props": {
                    "id": pub_id,
                    "name": filename,
                    "kuerzel": kuerzel,
                    "typ": f"Benutzer-Upload ({ext})",
                    "hochgeladen_am": datetime.now(timezone.utc).isoformat(),
                },
            }
            for t in triples:
                src = t.get("source") or {}
                tgt = t.get("target") or {}
                rtype = t.get("type")
                if not src.get("id") or not tgt.get("id") or not rtype:
                    continue
                for endpoint in (src, tgt):
                    eid = str(endpoint["id"])
                    lbl = str(endpoint.get("label") or endpoint.get("type") or "Entity")
                    labels = {lbl}
                    if lbl in ("Objekt", "Subjekt"):
                        labels.update({"Objekt", "Subjekt"})
                    props = dict(endpoint.get("props") or {})
                    if eid in self.nodes:
                        self.nodes[eid]["labels"].update(labels)
                        self.nodes[eid]["props"].update(props)
                    else:
                        self.nodes[eid] = {"id": eid, "labels": labels, "props": props}

                self.edges.append(
                    {
                        "source": str(src["id"]),
                        "target": str(tgt["id"]),
                        "type": str(rtype),
                        "props": dict(t.get("rel_props") or {}),
                    }
                )
            self.recompute_contested_flags()

    def add_annotation(
        self,
        inventarnummer: str,
        author: str,
        role: Optional[str],
        tags: List[str],
        notes: str,
        confidence: Optional[str],
    ) -> Optional[Tuple[str, str]]:
        with self._lock:
            rk = self._resolve_node_key(inventarnummer)
            if not rk or "Subjekt" not in self.nodes[rk]["labels"]:
                return None
            canonical_inv = str(self.nodes[rk]["props"].get("inventarnummer") or rk)
            ann_id = str(uuid.uuid4())
            entry = {
                "id": ann_id,
                "author": author,
                "role": role,
                "tags": list(tags),
                "notes": notes,
                "confidence": confidence,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.annotations_by_inv[canonical_inv].insert(0, entry)
            return ann_id, canonical_inv

    def get_annotations(self, inventarnummer: str) -> List[Dict[str, Any]]:
        with self._lock:
            rk = self._resolve_node_key(inventarnummer)
            key = str(self.nodes[rk]["props"].get("inventarnummer") or rk) if rk else inventarnummer
            return list(self.annotations_by_inv.get(key, []))

    def delete_annotation(self, annotation_id: str) -> int:
        with self._lock:
            deleted = 0
            for inv, anns in list(self.annotations_by_inv.items()):
                before = len(anns)
                self.annotations_by_inv[inv] = [a for a in anns if a["id"] != annotation_id]
                deleted += before - len(self.annotations_by_inv[inv])
            return deleted

    def delete_publication(self, pub_id: str) -> None:
        with self._lock:
            self.edges = [e for e in self.edges if e["props"].get("publikation") != pub_id]
            if pub_id in self.nodes and "Publikation" in self.nodes[pub_id]["labels"]:
                del self.nodes[pub_id]
            self.recompute_contested_flags()

    def create_edge(self, source_id: str, target_id: str, rel_type: str, props: Dict[str, Any]) -> bool:
        with self._lock:
            sk = self._resolve_node_key(source_id)
            tk = self._resolve_node_key(target_id)
            if not sk or not tk:
                return False
            for e in self.edges:
                if e["source"] == sk and e["target"] == tk and e["type"] == rel_type:
                    e["props"].update(props)
                    e["props"]["manuell_erstellt"] = True
                    e["props"]["created_at"] = datetime.now(timezone.utc).isoformat()
                    self.recompute_contested_flags()
                    return True
            new_props = dict(props)
            new_props["manuell_erstellt"] = True
            new_props["created_at"] = datetime.now(timezone.utc).isoformat()
            self.edges.append({"source": sk, "target": tk, "type": rel_type, "props": new_props})
            self.recompute_contested_flags()
            return True

    def delete_edge(self, source_id: str, target_id: str, rel_type: str) -> int:
        with self._lock:
            sk = self._resolve_node_key(source_id)
            tk = self._resolve_node_key(target_id)
            if not sk or not tk:
                return 0
            before = len(self.edges)
            self.edges = [
                e for e in self.edges if not (e["source"] == sk and e["target"] == tk and e["type"] == rel_type)
            ]
            self.recompute_contested_flags()
            return before - len(self.edges)


EMBEDDED_STORE = EmbeddedProvenanceGraph()
