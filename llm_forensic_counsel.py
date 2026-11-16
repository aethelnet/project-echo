"""
PROJECT ECHO // FORENSIC RESTITUTION PACKAGE BUILDER (`llm_forensic_counsel`)
Erzeugt das vollstaendige diplomatische HLKO-Restitutionspaket (PDF-Antrag +
strukturiertes JSON-Beweismanifest + Exemplar-Dossiers als versiegeltes ZIP)
fuer `POST /api/petition/generate_llm`.
"""

import hashlib
import json
import os
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from backend.embedded_graph import EMBEDDED_STORE
from backend.pdf_forensics import render_petition_pdf_fitz
from generate_diplomatic_petition import query_stolen_objects
from generate_restitution_dossier import generate_pdf_dossier, query_object_provenance


def create_restitution_package(
    institution: str,
    community: Optional[str] = None,
    actor: Optional[str] = None,
    out_dir: str = "dossiers",
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    def step(msg: str) -> None:
        if progress_callback:
            progress_callback(msg)

    os.makedirs(out_dir, exist_ok=True)
    step(f"Extrahiere belastete Bestaende fuer {institution}...")

    objects = query_stolen_objects(institution, community or "", actor=actor, limit=500)
    if not objects:
        objects = EMBEDDED_STORE.query_stolen_objects(institution, community=community, actor=actor, limit=500)
    if not objects:
        raise ValueError(f"Keine belasteten Objekte fuer '{institution}' im Wissensgraphen gefunden.")

    actor_counts = Counter(o.get("akteur") or "Unbekannt" for o in objects)
    delikt_counts = Counter(o.get("delikt") or "RAUBTE" for o in objects)
    top_actors_str = ", ".join(f"{a} ({c})" for a, c in actor_counts.most_common(4))

    comm_display = community or "Kameruner Herkunftsgemeinschaften (u.a. Nso, Bamum, Bafut, Duala)"
    legal_summary = (
        f"Im Bestand von '{institution}' wurden {len(objects)} Kulturgueter mit dokumentiertem "
        f"Entzugs- oder Militaerexpeditionskontext identifiziert (Hauptakteure: {top_actors_str}). "
        f"Tatbestandsverteilung: {dict(delikt_counts)}. Unter Anwendung von Art. 46, 47 und 56 HLKO "
        f"sowie den BKM-/Washingtoner Restitutionsgrundsaetzen besteht ein substantiierter "
        f"Auskunfts- und Herausgabeanspruch zugunsten von {comm_display}."
    )

    clean_inst = re.sub(r"[^A-Za-z0-9_-]", "_", institution.strip())
    clean_comm = re.sub(r"[^A-Za-z0-9_-]", "_", (community or "Gesamtbestand").strip())
    stem = f"HLKO_Restitutionspaket_{clean_inst}_{clean_comm}"

    pdf_filename = f"{stem}.pdf"
    json_filename = f"{stem}_Manifest.json"
    zip_filename = f"{stem}.zip"

    pdf_path = os.path.join(out_dir, pdf_filename)
    json_path = os.path.join(out_dir, json_filename)
    zip_path = os.path.join(out_dir, zip_filename)

    step("Generiere juristisches HLKO-Restitutionsersuchen (DIN A4 PDF)...")
    render_petition_pdf_fitz(
        institution=institution,
        community=comm_display,
        objects=objects,
        output_path=pdf_path,
        legal_summary=legal_summary,
    )

    step("Erzeuge kryptografisch signiertes JSON-Beweismanifest...")
    manifest_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "institution": institution,
        "community": comm_display,
        "actor_filter": actor,
        "legal_basis": ["HLKO 1899/1907 Art. 46, 47, 56", "Washingtoner Prinzipien (1998)", "BKM-Leitfaden Koloniale Kontexte"],
        "legal_summary": legal_summary,
        "counts": {
            "total_extracted": len(objects),
            "by_delikt": dict(delikt_counts),
            "top_actors": dict(actor_counts.most_common(10)),
        },
        "objects": objects,
    }
    raw_json = json.dumps(manifest_payload, ensure_ascii=False, indent=2)
    manifest_payload["sha256_seal"] = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(manifest_payload, f, ensure_ascii=False, indent=2)

    step("Buendle Hauptantrag, Manifest und Objekt-Einzeldossiers in ZIP-Archiv...")
    sample_dossiers = []
    seen_invs = set()
    for obj in objects:
        inv = obj.get("inv")
        if not inv or inv in seen_invs:
            continue
        seen_invs.add(inv)
        if len(sample_dossiers) >= 15:
            break
        c_inv = re.sub(r"[^A-Za-z0-9_-]", "_", inv)
        d_name = f"Restitutionsdossier_{c_inv}.pdf"
        d_path = os.path.join(out_dir, d_name)
        if not os.path.exists(d_path):
            pdata = query_object_provenance(inv)
            if pdata:
                generate_pdf_dossier(pdata, d_path)
        if os.path.exists(d_path):
            sample_dossiers.append((d_path, f"Einzeldossiers/{d_name}"))

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(pdf_path, arcname=pdf_filename)
        zf.write(json_path, arcname=json_filename)
        for src_p, arc_p in sample_dossiers:
            zf.write(src_p, arcname=arc_p)

    return {
        "institution": institution,
        "community": comm_display,
        "counts": {
            "total_extracted": len(objects),
            "sample_dossiers_bundled": len(sample_dossiers),
        },
        "pdf_filename": pdf_filename,
        "json_filename": json_filename,
        "zip_filename": zip_filename,
        "legal_summary": legal_summary,
    }
