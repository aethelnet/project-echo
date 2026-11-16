#!/usr/bin/env python3
"""
PROJECT ECHO: DIPLOMATISCHE PETITIONS-PIPELINE (RESTITUTION ANTRAG GENERATOR)
Baut aus dem Graph-Netzwerk automatisch unterschriftsreife juristische Restitutionsanträge,
gestützt auf die Haager Landkriegsordnung (HLKO 1899/1907) und die Washingtoner Prinzipien.
"""

import os
from datetime import datetime
from typing import Optional

try:
    from neo4j import GraphDatabase
except ImportError:
    GraphDatabase = None

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    _HAS_REPORTLAB = True
except ImportError:
    _HAS_REPORTLAB = False

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOSSIER_DIR = os.getenv("DOSSIER_DIR", os.path.join(BASE_DIR, "shadow-museum-atlas", "data_dropzone", "dossiers"))

def query_stolen_objects(institution: str, community: str = "Nso", actor: Optional[str] = None, limit: int = 200):
    """
    Holt alle geraubten Objekte fuer eine Institution (optional gefiltert nach Community / Akteur).
    """
    if GraphDatabase is not None:
        try:
            driver = GraphDatabase.driver(NEO4J_URI, auth=None, connection_timeout=0.5)
            cypher = """
            MATCH (a:Akteur)-[r:RAUBTE|VERDACHT_AUF|ENTEIGNETE|EIGNETE_SICH_AN]->(s:Subjekt)-[:LAGERT_IN]->(i:Institution)
            WHERE toLower(i.name) CONTAINS toLower($inst)
              AND ($comm = '' OR toLower(coalesce(s.bezeichnung, '')) CONTAINS toLower($comm)
                   OR toLower(coalesce(r.begruendung, '')) CONTAINS toLower($comm)
                   OR toLower(coalesce(r.zitat, '')) CONTAINS toLower($comm))
              AND ($actor = '' OR toLower(a.name) CONTAINS toLower($actor))
            RETURN s.inventarnummer AS inv, s.bezeichnung AS bez, a.name AS akteur, type(r) AS delikt,
                   r.beleg AS beleg, coalesce(r.jahr, r.zeit) AS zeit, r.expedition AS exp, r.zitat AS zitat
            ORDER BY s.inventarnummer
            LIMIT $limit
            """
            with driver.session() as s:
                result = s.run(cypher, {"inst": institution, "comm": community or "", "actor": actor or "", "limit": limit}).data()
            driver.close()
            if result:
                return result
        except Exception:
            pass

    from backend.embedded_graph import EMBEDDED_STORE
    return EMBEDDED_STORE.query_stolen_objects(institution, community=community, actor=actor, limit=limit)

def generate_petition_pdf(institution: str, community: str, output_path: str):
    objects = query_stolen_objects(institution, community)
    if not objects:
        return None
    if not _HAS_REPORTLAB:
        from backend.pdf_forensics import render_petition_pdf_fitz
        return render_petition_pdf_fitz(institution, community, objects, output_path)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=25 * mm,
        rightMargin=25 * mm,
        topMargin=25 * mm,
        bottomMargin=25 * mm
    )

    styles = getSampleStyleSheet()
    
    style_normal = ParagraphStyle('Normal', parent=styles['Normal'], fontSize=11, leading=16, fontName='Helvetica')
    style_title = ParagraphStyle('Title', parent=styles['Title'], fontSize=16, leading=22, fontName='Helvetica-Bold', spaceAfter=15)
    style_subtitle = ParagraphStyle('Subtitle', parent=styles['Heading2'], fontSize=13, fontName='Helvetica-Bold', spaceAfter=10)
    
    elements = []
    
    # Adresskopf
    date_str = datetime.now().strftime("%d. %B %Y")
    elements.append(Paragraph(f"An die Direktion<br/>{institution}<br/>", style_normal))
    elements.append(Spacer(1, 10 * mm))
    elements.append(Paragraph(f"<b>Datum:</b> {date_str}", style_normal))
    elements.append(Spacer(1, 15 * mm))
    
    # Betreff
    betreff = f"Formelles Auskunfts- und Restitutionsersuchen betreffend Kulturgüter der {community}-Gemeinschaft"
    elements.append(Paragraph(betreff, style_title))
    elements.append(Spacer(1, 10 * mm))
    
    # Einleitungstext
    text = f"""
    Sehr geehrte Damen und Herren,<br/><br/>
    im Namen der legitimen Rechtsnachfolger der <b>{community}</b>-Gemeinschaft fordern wir hiermit formell Auskunft und die unverzügliche Restitution der in Ihrem Gewahrsam befindlichen Kulturgüter, welche im Kontext asymmetrischer kolonialer Gewalt und Plünderung entwendet wurden.
    <br/><br/>
    Wir berufen uns hierbei auf die historischen und völkerrechtlichen Prinzipien der <b>Haager Landkriegsordnung (HLKO von 1899 und 1907)</b>, welche die Plünderung privaten und religiösen Eigentums ausdrücklich untersagt (Artikel 46, 47, 56), sowie auf die moralisch bindenden <b>Washingtoner Prinzipien (1998)</b> in ihrer Ausweitung auf koloniale Unrechtskontexte.
    <br/><br/>
    Unsere forensische Graphen- und Provenienzanalyse hat <b>{len(objects)}</b> spezifische Objekte in Ihren Beständen identifiziert, für die erdrückende Beweise (Militärakten, Primärzitate) eines Unrechtskontexts vorliegen:
    """
    elements.append(Paragraph(text, style_normal))
    elements.append(Spacer(1, 10 * mm))
    
    # Tabelle der Beweise
    table_data = [["Inv.-Nr.", "Bezeichnung", "Akteur (Täter)", "Beweislage / Expedition"]]
    for obj in objects:
        inv = obj.get("inv") or "Unbekannt"
        bez = obj.get("bez") or ""
        if len(bez) > 40: bez = bez[:37] + "..."
        akteur = obj.get("akteur") or "Unbekannt"
        
        # Build strict evidence quote
        beleg_str = obj.get("beleg") or ""
        zitat_str = obj.get("zitat") or ""
        if len(zitat_str) > 200:
            zitat_str = zitat_str[:197] + "..."
            
        evidence = ""
        if zitat_str:
            evidence = f"Fundstelle: {beleg_str}\n<font color='#475569'>\"{zitat_str}\"</font>"
        else:
            exp = obj.get("exp") or obj.get("zeit") or ""
            evidence = f"Fundstelle: {beleg_str}\n<font color='#475569'>{exp}</font>"
            
        table_data.append([inv, bez, akteur, Paragraph(evidence, style_normal)])
        
    t = Table(table_data, colWidths=[30*mm, 50*mm, 40*mm, 40*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1E293B")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('BOTTOMPADDING', (0,0), (-1,0), 8),
        ('BACKGROUND', (0,1), (-1,-1), colors.HexColor("#F8FAFC")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#CBD5E1")),
        ('FONTSIZE', (0,1), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    
    elements.append(t)
    elements.append(Spacer(1, 15 * mm))
    
    # Schlussformel
    text_end = """
    Wir fordern Sie auf, die Provenienz dieser Objekte binnen einer Frist von 60 Tagen lückenlos offenzulegen und proaktiv Verhandlungen über eine bedingungslose Restitution aufzunehmen. Sollten diese Bestände bereits Teil eines Deakzessionsprozesses sein, bitten wir um umgehende Einsicht in die Verfahrensakten.<br/><br/>
    Mit Nachdruck,<br/><br/>
    [Unterschrift / Legitime Vertretung]
    """
    elements.append(Paragraph(text_end, style_normal))
    
    doc.build(elements)
    return output_path

if __name__ == "__main__":
    generate_petition_pdf("Linden-Museum Stuttgart", "Nso", "/tmp/petition.pdf")
    print("Petition generated.")
