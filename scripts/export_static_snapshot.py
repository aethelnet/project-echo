#!/usr/bin/env python3
"""
Export real Project Echo v2.3 API responses & flagship court-ready PDF/ZIP artifacts
into shadow-museum-atlas/public/static_snapshot/ so GitHub Pages (echo.aethelburg.network)
functions 100% serverlessly in the browser when no FastAPI backend is reachable.
"""
import json
import os
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "shadow-museum-atlas" / "public" / "static_snapshot"
DOSSIERS_DIR = OUT_DIR / "dossiers"
BASE_URL = os.environ.get("ECHO_EXPORT_API", "http://127.0.0.1:8088")


def get_json(path: str):
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(path: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DOSSIERS_DIR.mkdir(parents=True, exist_ok=True)

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

    # Export flagship PDF dossiers & HLKO diplomatic ZIP
    flagship_invs = ["AS 1574", "033513", "C 20681", "InvNr. 7087"]
    exported_dossiers = {}
    for inv in flagship_invs:
        try:
            dres = post_json("/api/dossier/generate", {"inventarnummer": inv})
            if dres.get("success") and dres.get("filename"):
                fname = dres["filename"]
                src_pdf = ROOT / "dossiers" / fname
                if src_pdf.exists():
                    shutil.copy2(src_pdf, DOSSIERS_DIR / fname)
                    exported_dossiers[inv] = f"./static_snapshot/dossiers/{fname}"
        except Exception as exc:
            print(f"[WARN] Could not export flagship dossier {inv}: {exc}")

    # Export one real HLKO Diplomatic Restitution Package ZIP
    exported_petition_zip = None
    try:
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
                time.sleep(0.25)
    except Exception as exc:
        print(f"[WARN] Could not export flagship HLKO zip: {exc}")

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

    # Export Visual Photo-Chain Re-ID benchmark (RootSIFT-128D + 6-DOF Affine RANSAC)
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
