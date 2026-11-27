// @ts-nocheck
import { useState, useMemo, useRef } from 'react';
import { useLang, relLabel } from './i18n';
import {
  parseSourceTextInBrowser,
  highlightArchivalText,
  SAMPLE_ARCHIVAL_EXCERPTS,
} from './browserSourceParser';

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

function HighlightedPassage({ text }: { text: string }) {
  const spans = useMemo(() => highlightArchivalText(text), [text]);
  return (
    <>
      {spans.map((sp, i) =>
        sp.kind ? (
          <mark key={i} className={`doc-hl doc-hl-${sp.kind}`}>
            {sp.text}
          </mark>
        ) : (
          <span key={i}>{sp.text}</span>
        )
      )}
    </>
  );
}

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

  // Live Archival Extraction Workbench state
  const [draftFilename, setDraftFilename] = useState<string>('Archival_Excerpt.txt');
  const [draftText, setDraftText] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitFeedback, setCommitFeedback] = useState<{ ok: boolean; msg: string; pubId?: string } | null>(null);
  const fileUploadRef = useRef<HTMLInputElement | null>(null);

  // Document Reader State (shows exact source passage + inline highlights for any tag/relation)
  const [readerState, setReaderState] = useState<{
    mode: 'fulltext' | 'citation';
    title: string;
    subtitle: string;
    fullText?: string;
    activeParagraphIdx?: number;
    activeLink?: any;
    activeTriple?: any;
  } | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

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

  const scrollToReader = () => {
    setTimeout(() => {
      readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  };

  const openPublicationInReader = (pub: any) => {
    if (pub.source_text) {
      setReaderState({
        mode: 'fulltext',
        title: pub.name,
        subtitle: `${pub.kuerzel} · ${pub.typ || ''}`,
        fullText: pub.source_text,
        activeParagraphIdx: 0,
      });
      scrollToReader();
      return;
    }
    const firstWithQuote = graphLinks.find((l) => l.publikation === pub.id && (l.zitat || l.behauptung || l.beleg));
    setReaderState({
      mode: 'citation',
      title: pub.name,
      subtitle: `${pub.kuerzel}${pub.jahr ? ` (${pub.jahr})` : ''}${pub.typ ? ` · ${pub.typ}` : ''}`,
      activeLink: firstWithQuote || null,
    });
    scrollToReader();
  };

  const openLinkInReader = (link: any) => {
    const pub = publications.find((p) => p.id === link.publikation);
    if (pub?.source_text) {
      setReaderState({
        mode: 'fulltext',
        title: pub.name,
        subtitle: `${pub.kuerzel} · ${link.beleg || ''}`,
        fullText: pub.source_text,
        activeParagraphIdx: typeof link.paragraph_index === 'number' ? link.paragraph_index : 0,
        activeLink: link,
      });
    } else if (link.source_excerpt) {
      setReaderState({
        mode: 'fulltext',
        title: pub?.name || link.publikation || t('Archival Excerpt', 'Archivauszug', "Extrait d'archive"),
        subtitle: link.beleg || '',
        fullText: link.source_excerpt,
        activeParagraphIdx: 0,
        activeLink: link,
      });
    } else {
      setReaderState({
        mode: 'citation',
        title: pub?.name || link.publikation || t('Indexed Archival Record', 'Indizierter Archivbeleg', 'Notice archivistique indexée'),
        subtitle: `${pub?.kuerzel || link.publikation || ''}${link.jahr ? ` · ${link.jahr}` : ''}`,
        activeLink: link,
      });
    }
    scrollToReader();
  };

  const openDraftTripleInReader = (trItem: any) => {
    setReaderState({
      mode: 'fulltext',
      title: draftFilename || t('Draft Archival Document', 'Entwurf Archivdokument', "Brouillon d'archive"),
      subtitle: trItem.beleg || t('Live Extraction Trace', 'Live-Extraktionsspur', "Trace d'extraction en direct"),
      fullText: draftText,
      activeParagraphIdx: typeof trItem.paragraph_index === 'number' ? trItem.paragraph_index : 0,
      activeTriple: trItem,
    });
    scrollToReader();
  };

  const handleLoadSample = (sample: (typeof SAMPLE_ARCHIVAL_EXCERPTS)[number]) => {
    setDraftFilename(sample.filename);
    setDraftText(sample.text);
    setCommitFeedback(null);
    setReaderState({
      mode: 'fulltext',
      title: sample.filename,
      subtitle: `${sample.lang} · ${sample.title}`,
      fullText: sample.text,
      activeParagraphIdx: 0,
    });
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
      setReaderState({
        mode: 'fulltext',
        title: file.name,
        subtitle: t('Loaded text source — live highlight preview', 'Geladene Textquelle — Live-Markierungsvorschau', 'Source texte chargée — aperçu surligné'),
        fullText: content,
        activeParagraphIdx: 0,
      });
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

  const readerParagraphs = useMemo(() => {
    if (!readerState?.fullText) return [];
    const blocks = readerState.fullText
      .split(/\f|\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    return blocks.length > 0 ? blocks : [readerState.fullText];
  }, [readerState?.fullText]);

  // Sibling citations sharing the same archival signature/publication for corpus citation mode
  const relatedCorpusCitations = useMemo(() => {
    if (!readerState || readerState.mode !== 'citation' || !readerState.activeLink) return [];
    const targetPub = readerState.activeLink.publikation;
    const targetBeleg = readerState.activeLink.beleg;
    return graphLinks
      .filter((l) => l !== readerState.activeLink && l.publikation === targetPub && (!targetBeleg || l.beleg === targetBeleg))
      .slice(0, 6);
  }, [readerState, graphLinks]);

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
              'Archival Source Corpus, Reader & Extraction Audit · DE / EN / FR',
              'Archiv-Quellenkorpus, Document Reader & Extraktions-Audit · DE / EN / FR',
              'Corpus archivistique, lecteur de sources & audit d’extraction · DE / EN / FR'
            )}
          </div>
          <h2 className="serif" style={{ fontSize: '19px', fontWeight: 700, color: '#141413', margin: '4px 0 6px 0' }}>
            {t(
              'Primary Literature, Inline Evidence Reader & Live Triple Extraction',
              'Primärliteratur, Dokumenten-Reader mit Beleg-Markierung & Live-Extraktion',
              'Sources primaires, lecteur avec surlignage des preuves et extraction en direct'
            )}
          </h2>
          <p style={{ fontSize: '12px', color: '#52514C', margin: 0, lineHeight: 1.55 }}>
            {t(
              'Inspect every publication powering the Shadow Museum Atlas, open passages in the Document Reader to verify exactly where each object, actor, and loot/donation tag was extracted from, or paste archival excerpts / drop .txt or .csv ledgers.',
              'Prüfe jede Publikation hinter dem Shadow Museum Atlas, öffne Textstellen im Dokumenten-Reader um exakt zu sehen, aus welchem Satz ein Objekt-, Akteur- oder Raub-/Schenkungs-Tag gelesen wurde, oder füge eigene Aktenauszüge (.txt / .csv) ein.',
              "Inspectez chaque publication de l'Atlas, ouvrez les passages dans le lecteur de sources pour vérifier exactement d'où provient chaque balise (objet, acteur, pillage ou don), ou importez vos propres extraits (.txt / .csv)."
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
                      {pub.source_text && (
                        <span style={{ fontSize: '9.5px', color: '#166534', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', padding: '0 5px', fontWeight: 600 }}>
                          {t('Full text', 'Volltext', 'Texte intégral')}
                        </span>
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

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '9px', gap: '6px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
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
                        ? t('✓ Active', '✓ Aktiv', '✓ Actif')
                        : t('○ Enable', '○ Aktivieren', '○ Activer')}
                    </button>
                    <button
                      type="button"
                      data-testid={`docs-read-pub-${pub.id}`}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedPubId(pub.id); openPublicationInReader(pub); }}
                      className="archival-btn"
                      style={{ padding: '3px 8px', fontSize: '10.5px' }}
                    >
                      {t('Open Reader', 'Im Reader öffnen', 'Ouvrir lecteur')}
                    </button>
                  </div>

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

        {/* RIGHT COLUMN: DOCUMENT READER + LIVE WORKBENCH + CITATION EXPLORER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>

          {/* ARCHIVAL DOCUMENT READER (INLINE SOURCE HIGHLIGHTING) */}
          {readerState && (
            <div
              ref={readerRef}
              data-testid="doc-reader-panel"
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #1C1B19',
                borderTop: '3px solid #92400E',
                padding: '16px 18px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px', marginBottom: '12px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: '9.5px', fontWeight: 700, padding: '2px 6px', backgroundColor: readerState.mode === 'fulltext' ? '#F0FDF4' : '#FFFBEB', color: readerState.mode === 'fulltext' ? '#166534' : '#92400E', border: `1px solid ${readerState.mode === 'fulltext' ? '#BBF7D0' : '#EBD7A0'}` }}>
                      {readerState.mode === 'fulltext'
                        ? t('DOCUMENT READER · FULL SOURCE TEXT', 'DOKUMENTEN-READER · VOLLTEXT', 'LECTEUR · TEXTE INTÉGRAL')
                        : t('DOCUMENT READER · INDEXED CORPUS PASSAGE', 'DOKUMENTEN-READER · INDIZIERTER KORPUS-BELEG', 'LECTEUR · PASSAGE INDEXÉ DU CORPUS')}
                    </span>
                    <span className="mono" style={{ fontSize: '10px', color: '#78766F' }}>{readerState.subtitle}</span>
                  </div>
                  <h3 className="serif" style={{ fontSize: '17px', fontWeight: 700, margin: '6px 0 0 0', color: '#141413' }}>
                    {readerState.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReaderState(null)}
                  className="archival-btn"
                  style={{ padding: '3px 9px', fontSize: '11px' }}
                >
                  ✕
                </button>
              </div>

              {/* Inline Tag Color Legend */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px', fontSize: '10.5px', color: '#52514C' }}>
                <span style={{ fontWeight: 600 }}>{t('Detected spans:', 'Erkannte Textstellen:', 'Segments détectés :')}</span>
                <span className="doc-hl doc-hl-object">{t('Inventory / Object', 'Inventarnr. / Objekt', 'Inventaire / Objet')}</span>
                <span className="doc-hl doc-hl-actor">{t('Actor', 'Akteur', 'Acteur')}</span>
                <span className="doc-hl doc-hl-loot">{t('Loot / Seizure signal', 'Raub-Signalwort', 'Signal de pillage')}</span>
                <span className="doc-hl doc-hl-donation">{t('Donation / Sale claim', 'Schenkung / Kauf', 'Don / Vente allégué')}</span>
                <span className="doc-hl doc-hl-depot">{t('Depot / Museum', 'Depot / Museum', 'Dépôt / Musée')}</span>
                <span className="doc-hl doc-hl-community">{t('Origin', 'Herkunft', 'Origine')}</span>
              </div>

              {readerState.mode === 'fulltext' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                  {readerParagraphs.map((para, pIdx) => {
                    const isFocused = readerState.activeParagraphIdx === pIdx;
                    return (
                      <div
                        key={pIdx}
                        style={{
                          padding: '12px 14px',
                          backgroundColor: isFocused ? '#FFFDF5' : '#F7F6F2',
                          border: isFocused ? '1px solid #D97706' : '1px solid #E5E2DA',
                          borderLeft: isFocused ? '3px solid #92400E' : '3px solid #C8C4BA',
                        }}
                      >
                        <div className="mono" style={{ fontSize: '9.5px', color: '#78766F', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>¶ {pIdx + 1}</span>
                          {isFocused && (
                            <span style={{ color: '#92400E', fontWeight: 700 }}>
                              {t('Extracted passage', 'Extrahierte Textstelle', 'Passage extrait')}
                            </span>
                          )}
                        </div>
                        <div className="serif" style={{ fontSize: '14px', lineHeight: 1.72, color: '#141413' }}>
                          <HighlightedPassage text={para} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {readerState.activeLink ? (
                    <div style={{ padding: '14px 16px', backgroundColor: '#FFFDF5', border: '1px solid #E5D4A1', borderLeft: '3px solid #92400E' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#141413' }}>
                          {readerState.activeLink.source_label || readerState.activeLink.source?.id || readerState.activeLink.source}{' '}
                          <span className="mono" style={{ fontSize: '10px', padding: '1px 5px', backgroundColor: '#141413', color: '#FFFFFF', margin: '0 4px' }}>
                            {relLabel(readerState.activeLink.type, lang)}
                          </span>{' '}
                          {readerState.activeLink.target_label || readerState.activeLink.target?.id || readerState.activeLink.target}
                        </div>
                        <button
                          type="button"
                          onClick={() => onJumpToLink(readerState.activeLink)}
                          className="archival-btn"
                          style={{ padding: '3px 8px', fontSize: '10px' }}
                        >
                          {t('Inspect edge in Graph →', 'Kante im Graphen prüfen →', 'Inspecter dans le graphe →')}
                        </button>
                      </div>

                      {readerState.activeLink.beleg && (
                        <div style={{ fontSize: '12px', color: '#3F3E3A', marginBottom: '8px' }}>
                          <strong>{t('Archival signature / location:', 'Archivsignatur / Fundstelle:', "Cote d'archive / localisation :")}</strong>{' '}
                          <span className="mono" style={{ fontSize: '11px' }}>
                            <HighlightedPassage text={String(readerState.activeLink.beleg)} />
                          </span>
                        </div>
                      )}

                      {readerState.activeLink.zitat && (
                        <blockquote className="serif" style={{ margin: '0 0 8px 0', padding: '10px 14px', backgroundColor: '#FFFFFF', borderLeft: '3px solid #141413', fontSize: '14px', lineHeight: 1.7, fontStyle: 'italic', color: '#141413' }}>
                          “<HighlightedPassage text={String(readerState.activeLink.zitat)} />”
                        </blockquote>
                      )}

                      {readerState.activeLink.behauptung && (
                        <div style={{ fontSize: '12.5px', lineHeight: 1.6, padding: '8px 12px', backgroundColor: '#FFFFFF', border: '1px solid #E5E2DA' }}>
                          <strong style={{ fontSize: '10.5px', color: '#52514C', display: 'block', marginBottom: '2px' }}>
                            {t('Recorded statement / context:', 'Dokumentierte Aussage / Kontext:', 'Énoncé / contexte documenté :')}
                          </strong>
                          <span className="serif" style={{ fontSize: '13.5px' }}>
                            <HighlightedPassage text={String(readerState.activeLink.behauptung)} />
                          </span>
                        </div>
                      )}

                      {readerState.activeLink.begruendung && (
                        <div style={{ fontSize: '11.5px', color: '#155E75', marginTop: '8px' }}>
                          <strong>{t('Forensic derivation:', 'Forensische Herleitung:', 'Dérivation forensique :')}</strong>{' '}
                          <HighlightedPassage text={String(readerState.activeLink.begruendung)} />
                        </div>
                      )}

                      <div style={{ fontSize: '10.5px', color: '#78766F', marginTop: '10px' }}>
                        {t(
                          'Note: Copyrighted monograph full texts are not redistributed in the static web snapshot; exact archival citations and primary quotes extracted from the source are displayed above.',
                          'Hinweis: Urheberrechtlich geschützte Monografie-Volltexte werden im statischen Web-Snapshot nicht gespiegelt; angezeigt werden die exakt indizierten Fundstellen, Archivsignaturen und Originalzitate.',
                          "Remarque : les textes intégraux sous droits d'auteur ne sont pas redistribués dans l'instantané statique ; seules les cotes d'archives et citations primaires indexées sont affichées."
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#78766F', padding: '12px', backgroundColor: '#F7F6F2' }}>
                      {t('Select any citation below to inspect its exact archival passage.', 'Wähle unten einen Beleg aus, um die genaue Textstelle im Reader zu prüfen.', 'Sélectionnez une citation ci-dessous pour afficher le passage exact.')}
                    </div>
                  )}

                  {relatedCorpusCitations.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#52514C' }}>
                      <strong style={{ display: 'block', marginBottom: '5px' }}>
                        {t('Other tags extracted from this same reference:', 'Weitere Tags aus derselben Fundstelle:', 'Autres relations extraites de la même référence :')}
                      </strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {relatedCorpusCitations.map((rl, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => openLinkInReader(rl)}
                            className="archival-btn"
                            style={{ padding: '3px 8px', fontSize: '10.5px' }}
                          >
                            {rl.source_label || rl.source?.id || rl.source} → {rl.target_label || rl.target?.id || rl.target}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
                    'Paste colonial archival excerpts (DE / EN / FR) or load a .txt / .csv / .pdf / .xlsx file to inspect highlighted extractions before committing to the graph.',
                    'Füge Archivauszüge (DE / EN / FR) ein oder lade eine .txt / .csv / .pdf / .xlsx-Datei, um alle markierten Extraktionen im Reader zu prüfen und in den Graphen zu übernehmen.',
                    "Collez un extrait d'archive (DE / EN / FR) ou importez un fichier .txt / .csv / .pdf / .xlsx pour inspecter les extractions surlignées avant de les ancrer."
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
                            <button
                              type="button"
                              onClick={() => openDraftTripleInReader(trItem)}
                              className="archival-btn"
                              style={{ padding: '2px 7px', fontSize: '9.5px' }}
                            >
                              {t('Show in text', 'Im Text zeigen', 'Voir dans le texte')}
                            </button>
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

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
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
                          onClick={() => openLinkInReader(link)}
                          className="archival-btn"
                          style={{ padding: '2px 8px', fontSize: '10px', borderColor: '#B45309', color: '#92400E', backgroundColor: '#FFFDF5' }}
                        >
                          {t('Show in Source', 'Fundstelle lesen', 'Lire la source')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onJumpToLink(link)}
                          className="archival-btn"
                          style={{ padding: '2px 8px', fontSize: '10px' }}
                        >
                          {t('Graph →', 'Graph →', 'Graphe →')}
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
                      <div className="serif" style={{ fontSize: '12.5px', color: '#52514C', fontStyle: 'italic', marginTop: '4px', borderLeft: '2px solid #C8C4BA', paddingLeft: '8px', lineHeight: 1.55 }}>
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
