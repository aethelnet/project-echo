"""
PROJECT ECHO // ZERO-DEPENDENCY DIN-A4 PDF RENDERER (PyMuPDF / fitz)
Erzeugt gerichtsverwertbare Restitutionsdossiers und diplomatische HLKO-Ersuchen
direkt ueber PyMuPDF (`fitz`), sobald `reportlab` nicht installiert ist.
"""

import hashlib
import os
import textwrap
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF


A4_W, A4_H = 595.0, 842.0
MARGIN_X = 48.0
CONTENT_W = A4_W - 2 * MARGIN_X


class _FitzA4Builder:
    def __init__(self, doc_subtitle: str = "FORENSISCHER BEWEISBERICHT"):
        self.doc = fitz.open()
        self.subtitle = doc_subtitle
        self.y = 0.0
        self.new_page()

    def new_page(self) -> fitz.Page:
        p = self.doc.new_page(width=A4_W, height=A4_H)
        self.y = 66.0
        return p

    @property
    def page(self) -> fitz.Page:
        return self.doc[-1]

    def ensure_space(self, height: float) -> None:
        if self.y + height > A4_H - 58.0:
            self.new_page()

    def add_heading(self, text: str, size: float = 15.0, color=(0.08, 0.16, 0.30), gap_after: float = 6.0) -> None:
        self.ensure_space(size + 14.0)
        self.page.insert_text(
            fitz.Point(MARGIN_X, self.y + size),
            text,
            fontname="hebo",
            fontsize=size,
            color=color,
        )
        self.y += size + gap_after

    def add_paragraph(
        self,
        text: str,
        size: float = 9.5,
        bold: bool = False,
        italic: bool = False,
        color=(0.12, 0.16, 0.22),
        indent: float = 0.0,
        gap_after: float = 5.0,
    ) -> None:
        fname = "hebo" if bold else ("tiit" if italic else "helv")
        max_chars = max(35, int((CONTENT_W - indent) / (size * 0.50)))
        lines: List[str] = []
        for raw_line in str(text or "").splitlines() or [""]:
            wrapped = textwrap.wrap(raw_line, width=max_chars) or [""]
            lines.extend(wrapped)

        line_h = size * 1.38
        for ln in lines:
            self.ensure_space(line_h + 2.0)
            self.page.insert_text(
                fitz.Point(MARGIN_X + indent, self.y + size),
                ln,
                fontname=fname,
                fontsize=size,
                color=color,
            )
            self.y += line_h
        self.y += gap_after

    def add_box(self, title: str, lines: List[str], border_color=(0.12, 0.16, 0.22), fill=(0.97, 0.98, 0.99)) -> None:
        wrapped_all: List[str] = []
        for ln in lines:
            wrapped_all.extend(textwrap.wrap(str(ln), width=88) or [""])
        box_h = 22.0 + len(wrapped_all) * 12.5 + 8.0
        self.ensure_space(box_h + 8.0)

        rect = fitz.Rect(MARGIN_X, self.y, A4_W - MARGIN_X, self.y + box_h)
        self.page.draw_rect(rect, color=border_color, fill=fill, width=1.0)
        self.page.insert_text(
            fitz.Point(MARGIN_X + 10.0, self.y + 14.0),
            title,
            fontname="hebo",
            fontsize=9.0,
            color=border_color,
        )
        cy = self.y + 28.0
        for ln in wrapped_all:
            self.page.insert_text(
                fitz.Point(MARGIN_X + 10.0, cy),
                ln,
                fontname="helv",
                fontsize=8.5,
                color=(0.12, 0.16, 0.22),
            )
            cy += 12.5
        self.y += box_h + 8.0

    def add_rule(self) -> None:
        self.ensure_space(10.0)
        self.page.draw_line(
            fitz.Point(MARGIN_X, self.y),
            fitz.Point(A4_W - MARGIN_X, self.y),
            color=(0.78, 0.82, 0.87),
            width=0.7,
        )
        self.y += 8.0

    def save(self, output_path: str) -> str:
        total = len(self.doc)
        for idx in range(total):
            p = self.doc[idx]
            page_num = idx + 1
            p.insert_text(
                fitz.Point(MARGIN_X, 34.0),
                "PROJECT ECHO  |  PROVENIENZFORSCHUNG & RESTITUTIONS-DOKUMENTATION",
                fontname="helv",
                fontsize=7.5,
                color=(0.35, 0.40, 0.47),
            )
            p.insert_text(
                fitz.Point(A4_W - MARGIN_X - 135.0, 34.0),
                self.subtitle,
                fontname="hebo",
                fontsize=7.5,
                color=(0.35, 0.40, 0.47),
            )
            p.draw_line(fitz.Point(MARGIN_X, 40.0), fitz.Point(A4_W - MARGIN_X, 40.0), color=(0.80, 0.83, 0.88), width=0.6)

            p.draw_line(
                fitz.Point(MARGIN_X, A4_H - 40.0),
                fitz.Point(A4_W - MARGIN_X, A4_H - 40.0),
                color=(0.80, 0.83, 0.88),
                width=0.6,
            )
            p.insert_text(
                fitz.Point(MARGIN_X, A4_H - 27.0),
                "Zur Vorlage in Restitutionsverfahren gem. HLKO (Art. 46, 47, 56) & Washingtoner Prinzipien",
                fontname="helv",
                fontsize=7.5,
                color=(0.35, 0.40, 0.47),
            )
            p.insert_text(
                fitz.Point(A4_W - MARGIN_X - 62.0, A4_H - 27.0),
                f"Seite {page_num} von {total}",
                fontname="helv",
                fontsize=7.5,
                color=(0.35, 0.40, 0.47),
            )

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        self.doc.save(output_path)
        self.doc.close()
        return output_path


def render_object_dossier_fitz(
    data: Dict[str, Any],
    output_path: str,
    primary_excerpt: Optional[str] = None,
) -> str:
    b = _FitzA4Builder("FORENSISCHES DOSSIER")
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    inv = str(data.get("inventarnummer") or "UNBEKANNT")
    bez = str(data.get("bezeichnung") or "Koloniales Kulturgut")
    sig_hash = hashlib.sha256(f"{inv}|{bez}|{len(data.get('akteure', []))}".encode("utf-8")).hexdigest()[:16].upper()

    b.add_heading("FORENSISCHES RESTITUTIONS-DOSSIER", size=17.0)
    b.add_paragraph(
        "BEWEISKETTE UNRECHTMAESSIGER ENTZIEHUNG IM KOLONIALEN KONTEXT (KAMERUN 1884-1916)",
        size=8.8,
        color=(0.38, 0.44, 0.52),
        gap_after=8.0,
    )
    b.add_rule()

    insts = data.get("institutionen") or []
    depot_str = ", ".join(f"{i.get('name')} ({i.get('stadt') or 'DE'})" for i in insts) or "Kein dokumentiertes Depot (Ghost-Status)"
    b.add_box(
        "1. IDENTIFIKATION & OBJEKT-STAMMDATEN",
        [
            f"Inventarnummer:   {inv}",
            f"Bezeichnung:      {bez}",
            f"Aktuelles Depot:  {depot_str}",
            f"Zeitstempel:      {now_utc}   |   Evidenz-Hash: SHA256-{sig_hash}",
        ],
    )

    b.add_heading("2. AKTEURS- & PROVENIENZKETTE (MULTIGRAPH-ANALYSE)", size=11.5)
    akteure = data.get("akteure") or []
    if not akteure:
        b.add_paragraph(
            "Keine dokumentierte Erwerbs- oder Einlieferungskette vorhanden (Provenienzluecke / gerissene Chain of Custody).",
            size=9.2,
            color=(0.60, 0.12, 0.12),
        )
    else:
        for akt in akteure:
            action = str(akt.get("aktion") or "RELATION")
            is_loot = action in ("RAUBTE", "ENTEIGNETE", "EIGNETE_SICH_AN", "VERDACHT_AUF")
            border = (0.65, 0.11, 0.11) if is_loot else (0.18, 0.25, 0.36)
            fill = (1.0, 0.96, 0.96) if is_loot else (0.96, 0.98, 1.0)
            label_tag = "FORENSISCHE REALITAET (UNRECHTSKONTEXT)" if is_loot else "MUSEALES INVENTAR-NARRATIV"
            lines = [
                f"Akteur:   {akt.get('name')} ({akt.get('rolle') or 'Kolonialakteur'})",
                f"Vorgang:  [{action}]  |  Jahr/Zeitraum: {akt.get('jahr') or 'k.A.'}",
                f"Beleg:    {akt.get('beleg') or 'Primaerquelle im Wissensgraphen'}",
            ]
            if akt.get("behauptung"):
                lines.append(f"Befund:   {akt.get('behauptung')}")
            b.add_box(label_tag, lines, border_color=border, fill=fill)

    if primary_excerpt:
        b.add_heading("3. PRIMAERQUELLEN-AUSZUG (ATLAS DER ABWESENHEIT)", size=11.5)
        b.add_paragraph(f'"{primary_excerpt}"', size=8.8, italic=True, indent=8.0)

    b.add_heading("4. VOELKER- UND RESTITUTIONSRECHTLICHE WUERDIGUNG", size=11.5)
    b.add_paragraph(
        "Gemaess Artikel 46, 47 und 56 der Haager Landkriegsordnung (HLKO 1899/1907) sowie den auf koloniale "
        "Unrechtskontexte angewandten Grundsaetzen der BKM-Leitfaden- und Washingtoner Prinzipien begründet eine "
        "Aneignung im Rahmen militaerischer Strafexpeditionen oder kolonialer Zwangslagen keinen rechtmaessigen "
        "Eigentumserwerb. Eine deklaratorische Verbuchung als 'Schenkung' im Museumsinventar heilt den "
        "ursprünglichen Entzugstatbestand nicht.",
        size=9.0,
    )
    return b.save(output_path)


def render_petition_pdf_fitz(
    institution: str,
    community: Optional[str],
    objects: List[Dict[str, Any]],
    output_path: str,
    legal_summary: Optional[str] = None,
) -> str:
    b = _FitzA4Builder("HLKO RESTITUTIONSERSUCHEN")
    date_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    comm_label = community or "betroffenen Herkunftsgemeinschaften Kameruns"

    b.add_paragraph(f"An die Direktion / Stiftungstraeger\n{institution}", size=10.0, bold=True)
    b.add_paragraph(f"Datum: {date_str}", size=9.0, gap_after=10.0)
    b.add_heading(
        f"Formelles Auskunfts- und Restitutionsersuchen ({comm_label})",
        size=13.5,
    )
    b.add_paragraph(
        f"Sehr geehrte Damen und Herren,\n\n"
        f"gestuetzt auf die forensische Multigraph-Auswertung von Project Echo ersuchen wir um vollstaendige "
        f"Offenlegung der Erwerbsakten sowie um Aufnahme proaktiver Restitutionsverhandlungen fuer {len(objects)} "
        f"in Ihrem Bestand nachgewiesene Kulturgueter mit dokumentiertem kolonialem Gewalt- oder Pluenderungsbezug.",
        size=9.5,
    )
    if legal_summary:
        b.add_box("VOELKERRECHTLICHE SUBSUMTION (HLKO ART. 46, 47, 56)", [legal_summary], border_color=(0.60, 0.12, 0.12), fill=(1.0, 0.97, 0.97))

    b.add_heading(f"BEWEISLISTE DER IDENTIFIZIERTEN SUBJEKTE ({len(objects)} EINTRÄGE)", size=11.0)
    for idx, obj in enumerate(objects[:120], start=1):
        line = (
            f"[{idx:03d}] Inv.-Nr. {obj.get('inv')} — {obj.get('bez')} | "
            f"Akteur: {obj.get('akteur')} [{obj.get('delikt')}] | "
            f"Beleg: {obj.get('beleg') or obj.get('exp') or 'Archivbeleg'}"
        )
        b.add_paragraph(line, size=8.3, gap_after=2.5)

    if len(objects) > 120:
        b.add_paragraph(
            f"... sowie {len(objects) - 120} weitere Subjekte (vollstaendig enthalten im beigefuegten JSON-Manifest).",
            size=8.5,
            italic=True,
        )

    b.add_rule()
    b.add_paragraph(
        "Wir bitten um Eingangsbestaetigung und Uebermittlung der ungeschwaerzten Zugangs- und Sammlerakten "
        "binnen 60 Tagen.\n\nProject Echo // Forensische Provenienzforschung",
        size=9.0,
    )
    return b.save(output_path)
