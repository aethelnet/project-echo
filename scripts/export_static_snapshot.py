#!/usr/bin/env python3
"""
Export real Project Echo v2.3 API responses & flagship court-ready PDF/ZIP artifacts
in-process via FastAPI TestClient into shadow-museum-atlas/public/static_snapshot/
so GitHub Pages (echo.aethelburg.network) runs 100% serverlessly in the browser.
"""
import json
import os
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["ECHO_FORCE_EMBEDDED"] = "1"

from fastapi.testclient import TestClient
from serve_graph_api import app

OUT_DIR = ROOT / "shadow-museum-atlas" / "public" / "static_snapshot"
DOSSIERS_DIR = OUT_DIR / "dossiers"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DOSSIERS_DIR.mkdir(parents=True, exist_ok=True)

    client = TestClient(app)

    def get_json(path: str):
        r = client.get(path)
        r.raise_for_status()
        return r.json()

    def post_json(path: str, payload: dict):
        r = client.post(path, json=payload)
        r.raise_for_status()
        return r.json()

    publications = get_json("/api/publications")
    filters_entities = get_json("/api/filters/entities")
    stats = get_json("/api/stats")
    ghosts = get_json("/api/ghosts")
    contested = get_json("/api/contested")
    gaps = get_json("/api/gaps")
    suspicions = get_json("/api/suspicions")
    geodata = get_json("/api/geodata")
    graph = get_json("/api/graph?limit=8000")

    actor_summaries = {}
    for actor in filters_entities.get("actors", []):
        name = actor["name"] if isinstance(actor, dict) else str(actor)
        res = get_json(f"/api/actors/{urllib.parse.quote(name, safe='')}/summary")
        actor_summaries[name] = res
        actor_summaries[name.lower()] = res

    for n in graph.get("nodes", []):
        if n.get("type") == "Akteur":
            lbl = n.get("label") or n.get("id")
            if lbl and lbl.lower() not in actor_summaries:
                res = get_json(f"/api/actors/{urllib.parse.quote(lbl, safe='')}/summary")
                actor_summaries[lbl] = res
                actor_summaries[lbl.lower()] = res

    institution_summaries = {}
    for inst in filters_entities.get("institutions", []):
        name = inst["name"] if isinstance(inst, dict) else str(inst)
        res = get_json(f"/api/institutions/{urllib.parse.quote(name, safe='')}/summary")
        institution_summaries[name] = res
        institution_summaries[name.lower()] = res

    for n in graph.get("nodes", []):
        if n.get("type") == "Institution":
            lbl = n.get("label") or n.get("id")
            if lbl and lbl.lower() not in institution_summaries:
                res = get_json(f"/api/institutions/{urllib.parse.quote(lbl, safe='')}/summary")
                institution_summaries[lbl] = res
                institution_summaries[lbl.lower()] = res

    flagship_invs = ["AS 1574", "033513", "C 20681", "InvNr. 7087"]
    exported_dossiers = {}
    for inv in flagship_invs:
        dres = post_json("/api/dossier/generate", {"inventarnummer": inv})
        if dres.get("success") and dres.get("filename"):
            fname = dres["filename"]
            src_pdf = ROOT / "dossiers" / fname
            if src_pdf.exists():
                shutil.copy2(src_pdf, DOSSIERS_DIR / fname)
                exported_dossiers[inv] = f"./static_snapshot/dossiers/{fname}"

    exported_petition_zip = None
    pres = post_json(
        "/api/petition/generate_llm",
        {"institution": "Ethnologisches Museum Berlin", "community": None},
    )
    job_id = pres.get("job_id")
    if job_id:
        for _ in range(30):
            sres = get_json(f"/api/petition/status/{job_id}")
            if sres.get("status") == "completed":
                zname = sres.get("result", {}).get("zip_filename")
                if zname:
                    src_zip = ROOT / "dossiers" / zname
                    if src_zip.exists():
                        target_name = "HLKO_Restitutionspaket_Ethnologisches_Museum_Berlin.zip"
                        shutil.copy2(src_zip, DOSSIERS_DIR / target_name)
                        exported_petition_zip = {
                            "zip_filename": target_name,
                            "download_zip_url": f"./static_snapshot/dossiers/{target_name}",
                            "counts": sres.get("result", {}).get("counts", {"total_extracted": 320}),
                        }
                break
            time.sleep(0.1)

    bundle = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "publications": publications,
        "filters_entities": filters_entities,
        "stats": stats,
        "ghosts": ghosts,
        "contested": contested,
        "gaps": gaps,
        "suspicions": suspicions,
        "geodata": geodata,
        "graph": graph,
        "actor_summaries": actor_summaries,
        "institution_summaries": institution_summaries,
        "flagship_dossiers": exported_dossiers,
        "flagship_petition": exported_petition_zip,
    }

    bundle_path = OUT_DIR / "bundle.json"
    bundle_path.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    visual_demo = get_json("/api/visual/demo_case")
    visual_path = OUT_DIR / "visual_demo.json"
    visual_path.write_text(json.dumps(visual_demo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(
        f"[OK] Exported bundle.json ({bundle_path.stat().st_size / 1024:.1f} KB), "
        f"visual_demo.json ({visual_path.stat().st_size / 1024:.1f} KB), "
        f"{len(exported_dossiers)} PDFs, petition_zip={bool(exported_petition_zip)}"
    )


if __name__ == "__main__":
    main()
