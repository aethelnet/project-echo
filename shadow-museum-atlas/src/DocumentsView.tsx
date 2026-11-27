// @ts-nocheck
import { useState, useMemo, useRef } from 'react';
import { useLang, relLabel } from './i18n';
import { parseSourceTextInBrowser, SAMPLE_ARCHIVAL_EXCERPTS } from './browserSourceParser';

interface DocumentsViewProps {
  publications: any[];
  selectedPubs: Set<string>;
  onTogglePublication: (pubId: string) => void;
  onDeletePublication: (pubId: string) => void;
  graphLinks: any[];
  isResearcher: boolean;
  isStaticMode: boolean;
  onJumpToNode: (nodeId: string) => void;
  onJumpToLink: (link: any) => void;
  onSourceIngested: (newPubId?: string) => void;
  onRequestLogin: () => void;
  getAuthHeaders: () => Record<string, string>;
}

const REL_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  RAUBTE: { bg: '#FEF2F2', fg: '#991B1B', border: '#DC2626' },
  ENTEIGNETE: { bg: '#FEF2F2', fg: '#991B1B', border: '#DC2626' },
  SCHENKTE: { bg: '#EFF6FF', fg: '#1E40AF', border: '#2563EB' },
  VERKAUFTE_AN: { bg: '#EFF6FF', fg: '#1E40AF', border: '#2563EB' },
  VERDACHT_AUF: { bg: '#ECFEFF', fg: '#155E75', border: '#0E7490' },
  LAGERT_IN: { bg: '#F7F6F2', fg: '#3F3E3A', border: '#8C8A82' },
};

export default function DocumentsView({
  publications,
  selectedPubs,
  onTogglePublication,
  onDeletePublication,
  graphLinks,
  isResearcher,
  isStaticMode,
  onJumpToNode,
  onJumpToLink,
  onSourceIngested,
  onRequestLogin,
  getAuthHeaders,
}: DocumentsViewProps) {
  const { lang, t } = useLang();
  const [selectedPubId, setSelectedPubId] = useState<string>('__ALL__');
  const [relFilter, setRelFilter] = useState<'all' | 'loot' | 'donation' | 'collision' | 'suspicion'>('all');
  const [evidenceSearch, setEvidenceSearch] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(30);

  const [draftFilename, setDraftFilename] = useState<string>('Archival_Excerpt.txt');
  const [draftText, setDraftText] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitFeedback, setCommitFeedback] = useState<{ ok: boolean; msg: string; pubId?: string } | null>(null);
  const fileUploadRef = useRef<HTMLInputElement | null>(null);

  const pubBreakdown = useMemo(() => {
    const map: Record<string, { total: number; loot: number; donation: number; suspicion: number; collision: number; holding: number }> = {};
    for (const l of graphLinks) {
      const pid = l.publikation || 'UNBEKANNT';
      if (!map[pid]) map[pid] = { total: 0, loot: 0, donation: 0, suspicion: 0, collision: 0, holding: 0 };
      const st = map[pid];
      st.total++;
      if (l.type === 'RAUBTE' || l.type === 'ENTEIGNETE' || l.delikt === 'RAUBTE') st.loot++;
      else if (l.type === 'SCHENKTE' || l.type === 'VERKAUFTE_AN') st.donation++;
      else if (l.type === 'VERDACHT_AUF') st.suspicion++;
      else if (l.type === 'LAGERT_IN') st.holding++;
      if (l.kollision) st.collision++;
    }
    return map;
  }, [graphLinks]);

  const filteredCitations = useMemo(() => {
    const q = evidenceSearch.trim().toLowerCase();
    return graphLinks.filter((l) => {
      if (selectedPubId !== '__ALL__' && l.publikation !== selectedPubId) return false;
      if (relFilter === 'loot' && !(l.type === 'RAUBTE' || l.type === 'ENTEIGNETE' || l.delikt === 'RAUBTE')) return false;
      if (relFilter === 'donation' && !(l.type === 'SCHENKTE' || l.type === 'VERKAUFTE_AN')) return false;
      if (relFilter === 'collision' && !l.kollision) return false;
      if (relFilter === 'suspicion' && l.type !== 'VERDACHT_AUF') return false;
      if (!q) return true;
      const src = String(l.source_label || (typeof l.source === 'object' ? l.source.id : l.source) || '').toLowerCase();
      const tgt = String(l.target_label || (typeof l.target === 'object' ? l.target.id : l.target) || '').toLowerCase();
      const beleg = String(l.beleg || '').toLowerCase();
      const zitat = String(l.zitat || '').toLowerCase();
      const pub = String(l.publikation || '').toLowerCase();
      return src.includes(q) || tgt.includes(q) || beleg.includes(q) || zitat.includes(q) || pub.includes(q);
    });
  }, [graphLinks, selectedPubId, relFilter, evidenceSearch]);

  const livePreview = useMemo(() => {
    if (!draftText.trim()) return null;
    return parseSourceTextInBrowser(draftText, draftFilename || 'Archival_Excerpt.txt');
  }, [draftText, draftFilename]);

  const handleLoadSample = (sample: (typeof SAMPLE_ARCHIVAL_EXCERPTS)[number]) => {
    setDraftFilename(sample.filename);
    setDraftText(sample.text);
    setCommitFeedback(null);
  };

  const handleUploadFile = async (e: any) => {
    const file = e.target.files?.[0] as File | undefined;
    if (!file) return;
    setCommitFeedback(null);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'txt' || ext === 'csv' || ext === 'tsv' || ext === 'md') {
      const content = await file.text();
      setDraftFilename(file.name);
      setDraftText(content);
      if (fileUploadRef.current) fileUploadRef.current.value = '';
      return;
    }

    if (!isResearcher) {
      onRequestLogin();
      if (fileUploadRef.current) fileUploadRef.current.value = '';
      return;
    }
    setIsCommitting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: fd,
      });
      if (res.status === 401) {
        onRequestLogin();
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setCommitFeedback({
          ok: true,
          msg: data.message || t(`Injected ${data.triples_extracted} relations.`, `${data.triples_extracted} Relationen injiziert.`, `${data.triples_extracted} relations injectées.`),
          pubId: data.publication_id,
        });
        onSourceIngested(data.publication_id);
      } else {
        setCommitFeedback({ ok: false, msg: data.detail || t('Upload failed.', 'Upload fehlgeschlagen.', 'Échec du téléversement.') });
      }
    } catch (err: any) {
      setCommitFeedback({ ok: false, msg: err.message || 'Network error' });
    } finally {
      setIsCommitting(false);
      if (fileUploadRef.current) fileUploadRef.current.value = '';
    }
  };

  const handleCommitExtractedText = async () => {
    if (!draftText.trim()) return;
    if (!isResearcher) {
      onRequestLogin();
      return;
    }
    setIsCommitting(true);
    setCommitFeedback(null);
    try {
      const fname = (draftFilename || 'Archival_Excerpt.txt').trim();
      let res: Response;
      if (isStaticMode) {
        res = await fetch('/api/sources/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ filename: fname, text: draftText }),
        });
      } else {
        const fd = new FormData();
        const safeName = /\.(txt|csv|tsv|md)$/i.test(fname) ? fname : `${fname}.txt`;
        fd.append('file', new File([draftText], safeName, { type: 'text/plain;charset=utf-8' }));
        res = await fetch('/api/sources/upload', {
          method: 'POST',
          headers: { ...getAuthHeaders() },
          body: fd,
        });
      }

      if (res.status === 401) {
        onRequestLogin();
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setCommitFeedback({
          ok: true,
          msg:
            data.message ||
            t(
              `Committed: ${data.triples_extracted} relations added to graph.`,
              `Verankert: ${data.triples_extracted} Relationen in den Graphen übernommen.`,
              `Ancré : ${data.triples_extracted} relations ajoutées au graphe.`
            ),
          pubId: data.publication_id,
        });
        onSourceIngested(data.publication_id);
        if (data.publication_id) {
          setSelectedPubId(data.publication_id);
        }
      } else {
        setCommitFeedback({
          ok: false,
          msg: data.detail || t('Could not ingest document.', 'Quelle konnte nicht verarbeitet werden.', "Impossible d'ingérer le document."),
        });
      }
    } catch (err: any) {
      setCommitFeedback({ ok: false, msg: err.message || 'Network error' });
    } finally {
      setIsCommitting(false);
    }
  };

  const selectedPubObj = publications.find((p) => p.id === selectedPubId) || null;
  const totalCollisions = useMemo(() => graphLinks.filter((l) => l.kollision).length, [graphLinks]);

  return (
    <div className="docs-view">
      <input
        ref={fileUploadRef}
        type="file"
        accept=".txt,.csv,.tsv,.md,.pdf,.xlsx,.xls"
        onChange={handleUploadFile}
        style={{ display: 'none' }}
      />

      {/* TOP CORPUS HEADER */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', borderTop: '2px solid #141413', padding: '16px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ maxWidth: '780px', flex: '1 1 320px' }}>
          <div className="mono" style={{ fontSize: '10px', fontWeight: 700, color: '#1E40AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t(
              'Archival Source Corpus & Document Analysis · DE / EN / FR',
              'Archiv-Quellenkorpus & Dokumenten-Analyse · DE / EN / FR',
              'Corpus archivistique & analyse documentaire · DE / EN / FR'
            )}
          </div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#141413', margin: '4px 0 6px 0' }}>
            {t(
              'Primary Literature, Colonial Ledger Inspection & Live Triple Extraction',
              'Primärliteratur, historische Zugangsbücher & Live-Extraktion von Provenienz-Tripeln',
              'Sources primaires, inspection des registres coloniaux et extraction en direct'
            )}
          </h2>
          <p style={{ fontSize: '12px', color: '#52514C', margin: 0, lineHeight: 1.55 }}>
            {t(
              'Inspect every publication powering the Shadow Museum Atlas, search archival signatures and primary citations, or paste archival excerpts / drop .txt or .csv ledgers to extract and verify relations before committing them into the knowledge graph.',
              'Prüfe jede Publikation hinter dem Shadow Museum Atlas, durchsuche Archivsignaturen und Originalbelege oder füge Aktenauszüge / .txt- bzw. .csv-Zugangsbücher ein, um Provenienz-Relationen live zu extrahieren und vor dem Speichern zu verifizieren.',
              "Inspectez chaque publication alimentant l'Atlas, recherchez des cotes d'archives et citations primaires, ou collez des extraits / importez des registres .txt ou .csv pour extraire et vérifier des relations avant de les ancrer dans le graphe."
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid #D8D5CD', padding: '8px 12px', backgroundColor: '#F7F6F2', textAlign: 'center', minWidth: '76px' }}>
            <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600 }}>{t('Sources', 'Quellen', 'Sources')}</div>
            <div className="mono" style={{ fontSize: '15px', fontWeight: 700, marginTop: '2px' }}>{publications.length}</div>
          </div>
          <div style={{ border: '1px solid #D8D5CD', padding: '8px 12px', backgroundColor: '#F7F6F2', textAlign: 'center', minWidth: '88px' }}>
            <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600 }}>{t('Active Edges', 'Aktive Kanten', 'Arêtes actives')}</div>
            <div className="mono" style={{ fontSize: '15px', fontWeight: 700, marginTop: '2px' }}>{graphLinks.length.toLocaleString()}</div>
          </div>
          <div style={{ border: '1px solid #E5D4A1', padding: '8px 12px', backgroundColor: '#FFFBEB', textAlign: 'center', minWidth: '88px' }}>
            <div style={{ fontSize: '10px', color: '#92400E', fontWeight: 600 }}>{t('Collisions', 'Kollisionen', 'Collisions')}</div>
            <div className="mono" style={{ fontSize: '15px', fontWeight: 700, color: '#92400E', marginTop: '2px' }}>{totalCollisions.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="docs-grid">
        {/* LEFT COLUMN: SOURCE CORPUS INVENTORY */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#141413' }}>
              {t('Source Corpus', 'Quellenkorpus', 'Corpus des sources')}{' '}
              <span className="mono" style={{ fontSize: '11px', color: '#78766F', fontWeight: 400 }}>({publications.length})</span>
            </span>
            <button
              type="button"
              onClick={() => { setSelectedPubId('__ALL__'); setVisibleLimit(30); }}
              className={`archival-btn${selectedPubId === '__ALL__' ? ' archival-btn-primary' : ''}`}
              style={{ padding: '3px 8px', fontSize: '10.5px' }}
            >
              {t('All sources', 'Alle Quellen', 'Toutes')}
            </button>
          </div>

          {publications.map((pub: any) => {
            const isActive = selectedPubs.has(pub.id);
            const isSelected = selectedPubId === pub.id;
            const br = pubBreakdown[pub.id] || { total: pub.edge_count || 0, loot: 0, donation: 0, suspicion: 0, collision: 0, holding: 0 };
            return (
              <div
                key={pub.id}
                onClick={() => { setSelectedPubId(pub.id); setVisibleLimit(30); }}
                style={{
                  border: isSelected ? '1px solid #1E40AF' : '1px solid #D8D5CD',
                  borderLeft: isSelected ? '3px solid #1E40AF' : '1px solid #D8D5CD',
                  backgroundColor: isSelected ? '#F8FAFF' : (isActive ? '#FFFFFF' : '#F7F6F2'),
                  padding: '10px 12px',
                  cursor: 'pointer',
                  opacity: isActive ? 1 : 0.72,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className="mono" style={{ backgroundColor: '#141413', color: '#FFFFFF', fontSize: '9.5px', fontWeight: 700, padding: '1px 6px' }}>
                        {pub.kuerzel}
                      </span>
                      {pub.jahr && (
                        <span className="mono" style={{ fontSize: '10px', color: '#52514C' }}>{pub.jahr}</span>
                      )}
                      {pub.typ && (
                        <span style={{ fontSize: '10px', color: '#1E40AF', fontWeight: 600 }}>{pub.typ}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#141413', marginTop: '5px', wordBreak: 'break-word' }}>
                      {pub.name}
                    </div>
                  </div>

                  <span className="mono" style={{ fontSize: '10.5px', fontWeight: 700, backgroundColor: '#F7F6F2', border: '1px solid #D8D5CD', padding: '2px 6px', flexShrink: 0, color: '#141413' }}>
                    {(pub.edge_count ?? br.total).toLocaleString()}
                  </span>
                </div>

                {pub.beschreibung && (
                  <div style={{ fontSize: '11px', color: '#52514C', marginTop: '5px', lineHeight: 1.45 }}>
                    {pub.beschreibung}
                  </div>
                )}

                {isActive && br.total > 0 && (
                  <div className="mono" style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '7px', fontSize: '9.5px' }}>
                    {br.loot > 0 && (
                      <span style={{ padding: '1px 5px', backgroundColor: '#FEF2F2', color: '#991B1B', border: '1px solid #F3D1D1' }}>
                        {br.loot} {t('Loot', 'Raub', 'Pillage')}
                      </span>
                    )}
                    {br.donation > 0 && (
                      <span style={{ padding: '1px 5px', backgroundColor: '#EFF6FF', color: '#1E40AF', border: '1px solid #CBDDFB' }}>
                        {br.donation} {t('Donation', 'Schenkung', 'Don')}
                      </span>
                    )}
                    {br.collision > 0 && (
                      <span style={{ padding: '1px 5px', backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #EBD7A0' }}>
                        {br.collision} {t('Dissonance', 'Dissonanz', 'Dissonance')}
                      </span>
                    )}
                    {br.suspicion > 0 && (
                      <span style={{ padding: '1px 5px', backgroundColor: '#ECFEFF', color: '#155E75', border: '1px solid #BFE3EA' }}>
                        {br.suspicion} {t('Suspicion', 'Verdacht', 'Soupçon')}
                      </span>
                    )}
                    {br.holding > 0 && (
                      <span style={{ padding: '1px 5px', backgroundColor: '#F7F6F2', color: '#52514C', border: '1px solid #D8D5CD' }}>
                        {br.holding} {t('Depot', 'Depot', 'Dépôt')}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '9px', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={(ev) => { ev.stopPropagation(); onTogglePublication(pub.id); }}
                    style={{
                      padding: '3px 8px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      border: '1px solid #D8D5CD',
                      backgroundColor: isActive ? '#141413' : '#FFFFFF',
                      color: isActive ? '#FFFFFF' : '#52514C',
                      cursor: 'pointer',
                    }}
                  >
                    {isActive
                      ? t('✓ Active in graph', '✓ Im Graphen aktiv', '✓ Actif dans le graphe')
                      : t('○ Hidden — enable', '○ Aus — aktivieren', '○ Masqué — activer')}
                  </button>

                  {isResearcher && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onDeletePublication(pub.id); }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        border: '1px solid #E5B8B8',
                        backgroundColor: '#FEF2F2',
                        color: '#991B1B',
                        cursor: 'pointer',
                      }}
                    >
                      {t('Delete', 'Löschen', 'Supprimer')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT COLUMN: LIVE EXTRACTION WORKBENCH + CITATION EXPLORER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {/* PANEL 1: LIVE DOCUMENT EXTRACTION WORKBENCH */}
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#141413' }}>
                  {t(
                    'Live Document Parser & Archival Ingestion',
                    'Live Dokumenten-Parser & Archiv-Ingestion',
                    "Analyseur documentaire en direct & ingestion d'archives"
                  )}
                </div>
                <div style={{ fontSize: '11.5px', color: '#52514C', marginTop: '2px' }}>
                  {t(
                    'Paste colonial archival excerpts (DE / EN / FR) or load a .txt / .csv / .pdf / .xlsx file to extract inventory numbers, actors, depots & collisions in real time.',
                    'Füge Archivauszüge (DE / EN / FR) ein oder lade eine .txt / .csv / .pdf / .xlsx-Datei, um Inventarnummern, Akteure, Depots & Kollisionen in Echtzeit zu extrahieren.',
                    "Collez un extrait d'archive (DE / EN / FR) ou importez un fichier .txt / .csv / .pdf / .xlsx pour extraire numéros d'inventaire, acteurs, dépôts et collisions en temps réel."
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileUploadRef.current?.click()}
                className="archival-btn"
              >
                {t('+ Load file (.txt / .csv / .pdf)', '+ Datei laden (.txt / .csv / .pdf)', '+ Importer (.txt / .csv / .pdf)')}
              </button>
            </div>

            {/* 1-Click Multilingual Archival Samples */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#52514C' }}>
                {t('Sample excerpts:', 'Beispiel-Akten:', 'Extraits tests :')}
              </span>
              {SAMPLE_ARCHIVAL_EXCERPTS.map((sample) => {
                const isPicked = draftFilename === sample.filename;
                return (
                  <button
                    key={sample.id}
                    type="button"
                    data-testid={`docs-sample-${sample.id}`}
                    onClick={() => handleLoadSample(sample)}
                    style={{
                      padding: '4px 9px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      border: isPicked ? '1px solid #141413' : '1px solid #D8D5CD',
                      backgroundColor: isPicked ? '#141413' : '#F7F6F2',
                      color: isPicked ? '#FFFFFF' : '#141413',
                      cursor: 'pointer',
                    }}
                  >
                    <span className="mono" style={{ fontSize: '9.5px', opacity: 0.8 }}>{sample.lang}</span> · {sample.title}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                value={draftFilename}
                onChange={(e) => setDraftFilename(e.target.value)}
                placeholder={t('Source / Archive Reference Name…', 'Quellen- / Archivname…', 'Nom de la source / archive…')}
                style={{ padding: '7px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid #D8D5CD', boxSizing: 'border-box', width: '100%', color: '#141413' }}
              />
              <textarea
                data-testid="docs-extract-textarea"
                rows={4}
                value={draftText}
                onChange={(e) => { setDraftText(e.target.value); setCommitFeedback(null); }}
                placeholder={t(
                  'Paste an archival report, museum catalog entry, or expedition record here (e.g. Benin 1897, Dahomey 1892, Cameroon 1902)…',
                  'Archivbericht, Museumskatalog-Eintrag oder Expeditionsakte hier einfügen (z. B. Benin 1897, Dahomey 1892, Kamerun 1902)…',
                  "Collez ici un rapport d'archive, une notice de musée ou un récit d'expédition (ex. Bénin 1897, Dahomey 1892, Cameroun 1902)…"
                )}
                style={{ padding: '9px 10px', fontSize: '12px', border: '1px solid #D8D5CD', resize: 'vertical', boxSizing: 'border-box', width: '100%', lineHeight: 1.5, color: '#141413' }}
              />
            </div>

            {livePreview && (
              <div style={{ marginTop: '12px', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2', padding: '12px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px', fontSize: '11px', fontWeight: 600 }}>
                  <span style={{ backgroundColor: '#141413', color: '#FFFFFF', padding: '2px 7px', fontSize: '10px' }}>
                    {t('Live Preview', 'Live-Vorschau', 'Aperçu en direct')}
                  </span>
                  <span className="mono">{livePreview.inventories.length} {t('objects', 'Objekte', 'objets')}</span>
                  <span style={{ color: '#A3A097' }}>·</span>
                  <span className="mono">{livePreview.actors.length} {t('actors', 'Akteure', 'acteurs')}</span>
                  <span style={{ color: '#A3A097' }}>·</span>
                  <span className="mono">{livePreview.institutions.length} {t('depots', 'Depots', 'dépôts')}</span>
                  <span style={{ color: '#A3A097' }}>·</span>
                  <span className="mono" style={{ color: '#1E40AF' }}>{livePreview.triples.length} {t('relations', 'Relationen', 'relations')}</span>
                  {livePreview.collisions > 0 && (
                    <span style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #D97706', padding: '1px 7px', fontSize: '10.5px' }}>
                      {livePreview.collisions} {t('Multigraph Collision(s)', 'Multigraph-Kollision(en)', 'Collision(s) multigraphe')}
                    </span>
                  )}
                </div>

                {livePreview.triples.length > 0 ? (
                  <div style={{ maxHeight: '190px', overflowY: 'auto', border: '1px solid #D8D5CD', backgroundColor: '#FFFFFF' }}>
                    {livePreview.triples.map((trItem, i) => {
                      const col = REL_COLORS[trItem.type] || { bg: '#F7F6F2', fg: '#141413', border: '#8C8A82' };
                      return (
                        <div key={i} style={{ padding: '7px 10px', borderBottom: '1px solid #ECEAE4', fontSize: '11.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <strong>{trItem.source_label}</strong>
                            <span className="mono" style={{ backgroundColor: col.bg, color: col.fg, border: `1px solid ${col.border}`, padding: '1px 5px', fontSize: '9.5px', fontWeight: 700 }}>
                              {relLabel(trItem.type, lang)}
                            </span>
                            <strong className="mono" style={{ fontSize: '11px' }}>{trItem.target_label}</strong>
                            {trItem.herkunft ? <span style={{ color: '#78766F', fontSize: '11px' }}>({trItem.herkunft})</span> : null}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {trItem.jahr && <span className="mono" style={{ fontSize: '10.5px', color: '#52514C' }}>{trItem.jahr}</span>}
                            {trItem.kollision && (
                              <span style={{ fontSize: '9.5px', fontWeight: 700, backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #D97706', padding: '1px 5px' }}>
                                {t('Dissonance', 'Dissonanz', 'Dissonance')}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '11.5px', color: '#991B1B' }}>
                    {t(
                      'No inventory numbers or acquisition relations recognized yet. Include an inventory ID (e.g. Af1897,0511.1 or III C 15099) or actor + museum name.',
                      'Noch keine Inventarnummern oder Erwerbs-Relationen erkannt. Bitte Inventarnummer (z. B. III C 15099 oder Af1897,0511.1) oder Akteur + Museum angeben.',
                      "Aucun numéro d'inventaire ni relation d'acquisition reconnu. Ajoutez un numéro d'inventaire (ex. 71.1892.34.1) ou un acteur et un musée."
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button
                    type="button"
                    data-testid="docs-commit-btn"
                    onClick={handleCommitExtractedText}
                    disabled={isCommitting || livePreview.triples.length === 0}
                    className="archival-btn archival-btn-primary"
                    style={{ padding: '7px 14px' }}
                  >
                    {isCommitting
                      ? t('Committing…', 'Speichere…', 'Enregistrement…')
                      : t(
                          `Commit ${livePreview.triples.length} extracted relations to graph`,
                          `${livePreview.triples.length} extrahierte Relationen in Graph übernehmen`,
                          `Ancrer les ${livePreview.triples.length} relations dans le graphe`
                        )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDraftText(''); setCommitFeedback(null); }}
                    className="archival-btn"
                  >
                    {t('Clear', 'Leeren', 'Vider')}
                  </button>
                </div>
              </div>
            )}

            {commitFeedback && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '9px 12px',
                  border: `1px solid ${commitFeedback.ok ? '#166534' : '#991B1B'}`,
                  borderLeft: `3px solid ${commitFeedback.ok ? '#166534' : '#991B1B'}`,
                  backgroundColor: commitFeedback.ok ? '#F0FDF4' : '#FEF2F2',
                  color: commitFeedback.ok ? '#166534' : '#991B1B',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <span>{commitFeedback.msg}</span>
                {commitFeedback.ok && livePreview?.inventories?.[0] && (
                  <button
                    type="button"
                    onClick={() => onJumpToNode(livePreview.inventories[0])}
                    className="archival-btn"
                    style={{ backgroundColor: '#166534', color: '#FFFFFF', borderColor: '#166534', padding: '4px 10px' }}
                  >
                    {t('Open in Graph →', 'Im Graphen öffnen →', 'Ouvrir dans le graphe →')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* PANEL 2: CITATION & EVIDENCE EXPLORER */}
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#141413' }}>
                  {selectedPubObj
                    ? `${t('Citations in', 'Belege in', 'Citations dans')} ${selectedPubObj.kuerzel} — ${selectedPubObj.name}`
                    : t('Archival Citations & Evidence Ledger (All Active Sources)', 'Archivbelege & Quellenzitate (Alle aktiven Quellen)', "Citations d'archives & registre de preuves (Toutes sources)")}
                </div>
                <div style={{ fontSize: '11px', color: '#78766F', marginTop: '2px' }}>
                  <span className="mono">{filteredCitations.length.toLocaleString()}</span> {t('matching provenance relations', 'passende Provenienz-Relationen', 'relations de provenance correspondantes')}
                </div>
              </div>

              <input
                type="text"
                value={evidenceSearch}
                onChange={(e) => { setEvidenceSearch(e.target.value); setVisibleLimit(30); }}
                placeholder={t('Filter by archive signature, quote, object…', 'Nach Signatur, Zitat, Objekt filtern…', 'Filtrer par cote, citation, objet…')}
                style={{ padding: '6px 9px', fontSize: '11.5px', border: '1px solid #D8D5CD', width: '250px', maxWidth: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {([
                ['all', t('All', 'Alle', 'Tout'), '#141413'],
                ['loot', t('Loot / Seizure', 'Raub / Enteignung', 'Pillage / Saisie'), '#991B1B'],
                ['donation', t('Alleged Donation', 'Schenkung / Kauf', 'Don allégué'), '#1E40AF'],
                ['collision', t('Dissonance', 'Dissonanz', 'Dissonance'), '#92400E'],
                ['suspicion', t('Suspicion', 'Verdacht', 'Soupçon'), '#155E75'],
              ] as const).map(([key, label, col]) => {
                const active = relFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setRelFilter(key); setVisibleLimit(30); }}
                    style={{
                      padding: '4px 9px',
                      fontSize: '11px',
                      fontWeight: 600,
                      border: `1px solid ${active ? col : '#D8D5CD'}`,
                      backgroundColor: active ? col : '#FFFFFF',
                      color: active ? '#FFFFFF' : '#141413',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {!active && key !== 'all' && (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: col, display: 'inline-block' }} />
                    )}
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredCitations.slice(0, visibleLimit).map((link, idx) => {
                const srcId = typeof link.source === 'object' ? link.source.id : link.source;
                const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
                const srcLabel = link.source_label || srcId;
                const tgtLabel = link.target_label || tgtId;
                const col = REL_COLORS[link.type] || { bg: '#F7F6F2', fg: '#141413', border: '#8C8A82' };

                return (
                  <div
                    key={link.id || `${srcId}_${link.type}_${tgtId}_${idx}`}
                    style={{
                      border: '1px solid #E5E2DA',
                      borderLeft: `3px solid ${col.border}`,
                      padding: '9px 12px',
                      backgroundColor: link.kollision ? '#FFFDF5' : '#FFFFFF',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '12px' }}>
                        <button
                          type="button"
                          onClick={() => onJumpToNode(srcId)}
                          style={{ background: 'none', border: 'none', padding: 0, fontWeight: 700, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px', color: '#141413' }}
                        >
                          {srcLabel}
                        </button>
                        <span className="mono" style={{ backgroundColor: col.bg, color: col.fg, border: `1px solid ${col.border}`, padding: '1px 5px', fontSize: '9.5px', fontWeight: 700 }}>
                          {relLabel(link.type, lang)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onJumpToNode(tgtId)}
                          style={{ background: 'none', border: 'none', padding: 0, fontWeight: 700, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px', color: '#141413' }}
                        >
                          {tgtLabel}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {link.jahr && (
                          <span className="mono" style={{ fontSize: '10.5px', color: '#52514C' }}>{link.jahr}</span>
                        )}
                        {link.kollision && (
                          <span style={{ fontSize: '9.5px', fontWeight: 700, backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #D97706', padding: '1px 5px' }}>
                            {t('Dissonance', 'Dissonanz', 'Dissonance')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onJumpToLink(link)}
                          className="archival-btn"
                          style={{ padding: '2px 8px', fontSize: '10px' }}
                        >
                          {t('Inspect →', 'Prüfen →', 'Inspecter →')}
                        </button>
                      </div>
                    </div>

                    {link.beleg && (
                      <div style={{ fontSize: '11.5px', color: '#3F3E3A', marginTop: '5px', lineHeight: 1.45 }}>
                        <strong style={{ color: '#52514C' }}>{t('Source / Ref.:', 'Beleg / Signatur:', 'Cote / Source :')}</strong>{' '}
                        <span className="mono" style={{ fontSize: '10.5px' }}>{link.beleg}</span>
                      </div>
                    )}
                    {link.zitat && (
                      <div style={{ fontSize: '11.5px', color: '#52514C', fontStyle: 'italic', marginTop: '4px', borderLeft: '2px solid #C8C4BA', paddingLeft: '8px', lineHeight: 1.5 }}>
                        “{link.zitat}”
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredCitations.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#78766F', border: '1px dashed #D8D5CD' }}>
                  {t(
                    'No citations match the current filter. Ensure the publication is active in the graph on the left.',
                    'Keine Belege für den aktuellen Filter gefunden. Stelle sicher, dass die Publikation links im Graphen aktiviert ist.',
                    'Aucune citation ne correspond au filtre actuel. Vérifiez que la publication est active dans le graphe à gauche.'
                  )}
                </div>
              )}

              {filteredCitations.length > visibleLimit && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 40)}
                  className="archival-btn"
                  style={{ width: '100%', padding: '8px 12px', marginTop: '4px' }}
                >
                  {t(
                    `Load more (${filteredCitations.length - visibleLimit} remaining)`,
                    `Mehr laden (${filteredCitations.length - visibleLimit} weitere)`,
                    `Charger plus (${filteredCitations.length - visibleLimit} restantes)`
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
