// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';

interface FrameItem {
  id: string;
  label: string;
  year: number | string;
  location: string;
  source: string;
  is_control: boolean;
  data_url: string;
}

interface VisualForensicsProps {
  isResearcher: boolean;
  getAuthHeaders: () => Record<string, string>;
  onRequestLogin: () => void;
  onChainCommitted: () => void;
}

export default function VisualForensicsView({
  isResearcher,
  getAuthHeaders,
  onRequestLogin,
  onChainCommitted,
}: VisualForensicsProps) {
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [selectedPairIdx, setSelectedPairIdx] = useState<number>(0);
  const [showOutliers, setShowOutliers] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Human-in-the-loop Graph Commit State
  const [commitInv, setCommitInv] = useState<string>('FOTO-KIMBO-1902-01');
  const [commitBez, setCommitBez] = useState<string>('Geschnitzte Ahnenfigur (Foto-Kette 1902-2024)');
  const [commitComm, setCommitComm] = useState<string>('Nso (Kamerun)');
  const [commitActor, setCommitActor] = useState<string>('J.F.G. Umlauff');
  const [commitDepot, setCommitDepot] = useState<string>('Ethnologisches Museum Berlin');
  const [commitStatus, setCommitStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const loadDemoSeries = useCallback(async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setCommitStatus(null);
    try {
      const res = await fetch('/api/visual/demo_case');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Konnte Referenz-Bildreihe nicht laden.');
      }
      setFrames(data.frames_with_previews || []);
      setAnalysis(data);
      setSelectedPairIdx(0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Fehler beim Laden der Referenz-Bildreihe.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    loadDemoSeries();
  }, [loadDemoSeries]);

  const runCustomAnalysis = async (targetFrames?: FrameItem[]) => {
    const list = targetFrames || frames;
    if (list.length < 2) {
      setErrorMsg('Mindestens 2 Aufnahmen fuer einen paarweisen Geometrie-Abgleich erforderlich.');
      return;
    }
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const payload = list.map((f, i) => ({
        id: f.id || `frame_${i}`,
        label: f.label || `Aufnahme #${i + 1}`,
        year: f.year ? Number(f.year) : null,
        location: f.location || '',
        source: f.source || '',
        is_control: Boolean(f.is_control),
        data_url: f.data_url,
      }));
      const res = await fetch('/api/visual/analyze_chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Bildanalyse fehlgeschlagen.');
      }
      setAnalysis(data);
      setSelectedPairIdx(0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Netzwerkfehler bei der Bildanalyse.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUploadImages = async (e: any) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const readAsDataUrl = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });

    try {
      const added: FrameItem[] = [];
      for (const file of files) {
        const durl = await readAsDataUrl(file);
        const yearMatch = file.name.match(/\b(18\d\d|19\d\d|20\d\d)\b/);
        added.push({
          id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: file.name.replace(/\.[^.]+$/, ''),
          year: yearMatch ? Number(yearMatch[1]) : '',
          location: '',
          source: 'Benutzer-Upload',
          is_control: false,
          data_url: durl,
        });
      }
      const next = [...frames, ...added].slice(0, 10);
      setFrames(next);
      if (next.length >= 2) {
        await runCustomAnalysis(next);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const updateFrameField = (idx: number, field: keyof FrameItem, val: any) => {
    setFrames((prev) => prev.map((f, i) => (i === idx ? { ...f, [field]: val } : f)));
  };

  const removeFrame = (idx: number) => {
    const next = frames.filter((_, i) => i !== idx);
    setFrames(next);
    setAnalysis(null);
  };

  // Draw Side-by-Side RANSAC Correspondence Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analysis || !analysis.pairs || analysis.pairs.length === 0) return;
    const pair = analysis.pairs[selectedPairIdx] || analysis.pairs[0];
    if (!pair) return;

    const frameA = frames[pair.index_a];
    const frameB = frames[pair.index_b];
    if (!frameA || !frameB) return;

    let cancelled = false;
    const imgA = new Image();
    const imgB = new Image();

    const tryRender = () => {
      if (cancelled || !imgA.complete || !imgB.complete) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.parentElement?.clientWidth || 780;
      const cssH = 390;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, cssW, cssH);

      const gap = 28;
      const pad = 14;
      const topBar = 28;
      const availW = (cssW - 2 * pad - gap) / 2;
      const availH = cssH - topBar - pad - 8;

      const fitRect = (img: HTMLImageElement, offsetX: number) => {
        const aspect = (img.naturalWidth || 1) / (img.naturalHeight || 1);
        let rw = availW;
        let rh = rw / aspect;
        if (rh > availH) {
          rh = availH;
          rw = rh * aspect;
        }
        const rx = offsetX + (availW - rw) / 2;
        const ry = topBar + (availH - rh) / 2;
        return { x: rx, y: ry, w: rw, h: rh };
      };

      const rA = fitRect(imgA, pad);
      const rB = fitRect(imgB, pad + availW + gap);

      // Titles above frames
      ctx.font = 'bold 10px Space Mono, monospace';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(`[A] ${frameA.label} (${frameA.year || 'o.J.'})`, rA.x, 18);
      ctx.fillText(`[B] ${frameB.label} (${frameB.year || 'o.J.'})`, rB.x, 18);

      ctx.drawImage(imgA, rA.x, rA.y, rA.w, rA.h);
      ctx.drawImage(imgB, rB.x, rB.y, rB.w, rB.h);

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rA.x, rA.y, rA.w, rA.h);
      ctx.strokeRect(rB.x, rB.y, rB.w, rB.h);

      const matches = pair.matches || [];
      // 1. Optional outliers (dashed red)
      if (showOutliers) {
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.50)';
        ctx.lineWidth = 1.0;
        ctx.setLineDash([4, 4]);
        for (const m of matches) {
          if (m.inlier) continue;
          const x1 = rA.x + m.x1 * rA.w;
          const y1 = rA.y + m.y1 * rA.h;
          const x2 = rB.x + m.x2 * rB.w;
          const y2 = rB.y + m.y2 * rB.h;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // 2. Verified 2D-Affine RANSAC Inliers (emerald vectors)
      for (const m of matches) {
        if (!m.inlier) continue;
        const x1 = rA.x + m.x1 * rA.w;
        const y1 = rA.y + m.y1 * rA.h;
        const x2 = rB.x + m.x2 * rB.w;
        const y2 = rB.y + m.y2 * rB.h;

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.78)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        ctx.arc(x1, y1, 2.8, 0, Math.PI * 2);
        ctx.arc(x2, y2, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    imgA.onload = tryRender;
    imgB.onload = tryRender;
    imgA.src = frameA.data_url;
    imgB.src = frameB.data_url;

    window.addEventListener('resize', tryRender);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', tryRender);
    };
  }, [analysis, frames, selectedPairIdx, showOutliers]);

  const handleCommitToGraph = async () => {
    if (!isResearcher) {
      onRequestLogin();
      return;
    }
    if (!analysis) return;
    const activePair = analysis.pairs?.[selectedPairIdx] || analysis.pairs?.[0];
    const summary = activePair
      ? `Foto-Ketten-Re-ID (${frames.filter(f => !f.is_control).map(f => `${f.year || '?'} ${f.location || f.label}`).join(' -> ')}): ${activePair.inliers} geometrische RANSAC-Inliers (RMSE ${activePair.reprojection_rmse_px ?? '-'} px, H=${activePair.shannon_entropy}).`
      : 'Manuell gepruefte Foto-Kette.';

    try {
      const res = await fetch('/api/visual/commit_chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          inventarnummer: commitInv,
          bezeichnung: commitBez,
          community: commitComm,
          actor: commitActor,
          institution: commitDepot,
          evidence_summary: summary,
          confidence: activePair?.confidence || 0.85,
        }),
      });
      if (res.status === 401) {
        onRequestLogin();
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setCommitStatus(`[VERANKERT: ${data.inventarnummer} (${data.triples_committed} KANTEN IM GRAPHEN)]`);
        onChainCommitted();
      } else {
        setCommitStatus(`[FEHLER: ${data.detail || 'Konnte Spur nicht speichern'}]`);
      }
    } catch (e: any) {
      setCommitStatus(`[FEHLER: ${e.message}]`);
    }
  };

  const activePair = analysis?.pairs?.[selectedPairIdx] || analysis?.pairs?.[0] || null;
  const nonControlFrames = frames
    .filter((f) => !f.is_control)
    .slice()
    .sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', backgroundColor: '#F8FAFC', padding: '16px', boxSizing: 'border-box', fontFamily: "'Space Mono', monospace" }}>
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleUploadImages}
        style={{ display: 'none' }}
      />

      {/* TOP METHODIK & ETHIK BANNER */}
      <div style={{ backgroundColor: '#FFFFFF', border: '3px solid #000000', boxShadow: '4px 4px 0px #000000', padding: '12px 16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ maxWidth: '760px' }}>
          <div style={{ fontSize: '9px', fontWeight: 900, color: '#DC2626', letterSpacing: '0.5px' }}>
            [VISUELLE PROVENIENZ-FORENSIK // OBJEKT-REKONSTRUKTION OHNE INVENTARNUMMER]
          </div>
          <div style={{ fontSize: '13px', fontWeight: 900, color: '#000000', marginTop: '2px' }}>
            Geometrische Einzelobjekt-Verfolgung ueber historische Bildreihen (RootSIFT-128D + 6-DOF Affin-RANSAC)
          </div>
          <div style={{ fontSize: '9.5px', color: '#334155', marginTop: '4px', lineHeight: 1.45 }}>
            <strong>Wissenschaftliche Schutzschranke:</strong> Keine kulturell pauschalisierende Stil-KI. Geprueft wird ausschliesslich, ob individuelle Schnitzkerben, Bruchkanten und Proportionen unter starrer 2D-Projektionsgeometrie deckungsgleich sind — verwandte Objekte derselben Kultur werden sauber als Nicht-Identisch abgewiesen.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={loadDemoSeries}
            disabled={isAnalyzing}
            style={{ padding: '7px 11px', backgroundColor: '#000000', color: '#FFFFFF', border: '2px solid #000000', fontSize: '9px', fontWeight: 900, cursor: 'pointer', boxShadow: '2px 2px 0px #CA8A04' }}
          >
            [REFERENZ-FALLREIHE LADEN (1902-2024 + KONTROLLE)]
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            style={{ padding: '7px 11px', backgroundColor: '#FFFFFF', color: '#000000', border: '2px solid #000000', fontSize: '9px', fontWeight: 900, cursor: 'pointer', boxShadow: '2px 2px 0px #000000' }}
          >
            [+ EIGENE FOTOS HINZUFUEGEN]
          </button>
          <button
            onClick={() => { setFrames([]); setAnalysis(null); setErrorMsg(null); }}
            style={{ padding: '7px 11px', backgroundColor: '#FEF2F2', color: '#991B1B', border: '2px solid #991B1B', fontSize: '9px', fontWeight: 900, cursor: 'pointer' }}
          >
            [LEEREN]
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', border: '2px solid #DC2626', color: '#991B1B', fontSize: '10px', fontWeight: 'bold', marginBottom: '14px' }}>
          [ANALYSE-HINWEIS]: {errorMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 370px) 1fr', gap: '16px', alignItems: 'start' }}>
        {/* LEFT COLUMN: PHOTO PLATES & METADATA */}
        <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #000000', boxShadow: '3px 3px 0px #000000', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', paddingBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 900 }}>BILDREIHE ({frames.length} AUFNAHMEN)</span>
            <button
              onClick={() => runCustomAnalysis()}
              disabled={isAnalyzing || frames.length < 2}
              style={{ padding: '4px 8px', backgroundColor: '#16A34A', color: '#FFFFFF', border: '1.5px solid #000000', fontSize: '8.5px', fontWeight: 900, cursor: frames.length < 2 ? 'not-allowed' : 'pointer' }}
            >
              {isAnalyzing ? '[PRUEFE...]' : '[NEU BERECHNEN]'}
            </button>
          </div>

          {frames.map((f, idx) => (
            <div
              key={f.id}
              style={{
                border: f.is_control ? '2px dashed #64748B' : '1.5px solid #000000',
                backgroundColor: f.is_control ? '#F8FAFC' : '#FFFFFF',
                padding: '8px',
                display: 'flex',
                gap: '8px',
              }}
            >
              <img
                src={f.data_url}
                alt={f.label}
                style={{ width: '64px', height: '72px', objectFit: 'cover', border: '1px solid #000000', flexShrink: 0 }}
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                  <input
                    type="text"
                    value={f.label}
                    onChange={(e) => updateFrameField(idx, 'label', e.target.value)}
                    placeholder="Titel / Tafel..."
                    style={{ width: '100%', fontSize: '9px', fontWeight: 'bold', border: '1px solid #CBD5E1', padding: '2px 4px', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={() => removeFrame(idx)}
                    style={{ border: '1px solid #000', backgroundColor: '#FFF', fontSize: '8px', fontWeight: 'bold', cursor: 'pointer', padding: '0 4px' }}
                    title="Aufnahme entfernen"
                  >
                    [X]
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    value={f.year}
                    onChange={(e) => updateFrameField(idx, 'year', e.target.value)}
                    placeholder="Jahr"
                    style={{ width: '68px', fontSize: '8.5px', border: '1px solid #CBD5E1', padding: '2px 4px', fontFamily: 'inherit' }}
                  />
                  <input
                    type="text"
                    value={f.location}
                    onChange={(e) => updateFrameField(idx, 'location', e.target.value)}
                    placeholder="Ort (z.B. Kimbo / Hamburg)"
                    style={{ flex: 1, fontSize: '8.5px', border: '1px solid #CBD5E1', padding: '2px 4px', fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '8px', color: '#475569' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={f.is_control}
                      onChange={(e) => updateFrameField(idx, 'is_control', e.target.checked)}
                    />
                    Negativprobe (anderes Objekt)
                  </label>
                  {analysis?.frame_summaries?.[idx] && (
                    <span>{analysis.frame_summaries[idx].keypoint_count} Merkmalspunkte</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Chronological Station Chain */}
          {nonControlFrames.length >= 2 && (
            <div style={{ borderTop: '2px solid #000000', paddingTop: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '9px', fontWeight: 900, marginBottom: '6px' }}>
                REKONSTRUIERTE ORT-ZEIT-KETTE:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '8.5px' }}>
                {nonControlFrames.map((nf, i) => (
                  <div key={nf.id} style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', borderLeft: '3px solid #000000' }}>
                    <strong>{i + 1}. {nf.year || 'o.J.'}</strong> — {nf.location || 'Ort unbekannt'}
                    <div style={{ color: '#64748B', fontSize: '7.5px' }}>{nf.source || nf.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT STAGE: GEOMETRIC CORRESPONDENCE CANVAS & VERDICT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #000000', boxShadow: '3px 3px 0px #000000', padding: '12px' }}>
            {/* Pair Selector Tabs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(analysis?.pairs || []).map((p: any, idx: number) => {
                  const isSel = idx === selectedPairIdx;
                  const pass = p.inliers >= 7;
                  return (
                    <button
                      key={p.pair_id}
                      onClick={() => setSelectedPairIdx(idx)}
                      style={{
                        padding: '5px 8px',
                        fontSize: '8.5px',
                        fontWeight: 900,
                        cursor: 'pointer',
                        border: '2px solid #000000',
                        backgroundColor: isSel ? '#000000' : (pass ? '#F0FDF4' : '#FEF2F2'),
                        color: isSel ? '#FFFFFF' : (pass ? '#166534' : '#991B1B'),
                      }}
                    >
                      [{p.index_a + 1} &harr; {p.index_b + 1}] {p.inliers} INLIERS
                    </button>
                  );
                })}
              </div>

              <label style={{ fontSize: '8.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                <input type="checkbox" checked={showOutliers} onChange={(e) => setShowOutliers(e.target.checked)} />
                Abgelehnte Ausreisser zeigen (rot gestrichelt)
              </label>
            </div>

            {/* Side-by-Side Canvas */}
            <div style={{ width: '100%', border: '2px solid #000000', overflow: 'hidden', backgroundColor: '#0F172A' }}>
              <canvas ref={canvasRef} />
            </div>

            {/* Quantitative Forensic Metrics */}
            {activePair && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '8px', marginTop: '10px' }}>
                <div style={{ padding: '8px', border: '1.5px solid #000000', backgroundColor: activePair.inliers >= 10 ? '#F0FDF4' : '#FEF2F2' }}>
                  <div style={{ fontSize: '8px', color: '#475569', fontWeight: 'bold' }}>FORENSISCHER BEFUND</div>
                  <div style={{ fontSize: '9.5px', fontWeight: 900, color: activePair.inliers >= 10 ? '#15803D' : '#B91C1C', marginTop: '2px' }}>
                    {activePair.verdict}
                  </div>
                </div>
                <div style={{ padding: '8px', border: '1.5px solid #000000', backgroundColor: '#F8FAFC' }}>
                  <div style={{ fontSize: '8px', color: '#475569', fontWeight: 'bold' }}>RANSAC GEOMETRIE-INLIERS</div>
                  <div style={{ fontSize: '12px', fontWeight: 900, marginTop: '2px' }}>
                    {activePair.inliers} / {activePair.putative_matches} ({Math.round(activePair.inlier_ratio * 100)}%)
                  </div>
                </div>
                <div style={{ padding: '8px', border: '1.5px solid #000000', backgroundColor: '#F8FAFC' }}>
                  <div style={{ fontSize: '8px', color: '#475569', fontWeight: 'bold' }}>RUECKPROJEKTIONS-RMSE</div>
                  <div style={{ fontSize: '12px', fontWeight: 900, marginTop: '2px' }}>
                    {activePair.reprojection_rmse_px !== null ? `${activePair.reprojection_rmse_px} px` : 'Kein Modell'}
                  </div>
                </div>
                <div style={{ padding: '8px', border: '1.5px solid #000000', backgroundColor: '#F8FAFC' }}>
                  <div style={{ fontSize: '8px', color: '#475569', fontWeight: 'bold' }}>SHANNON-ENTROPIE H(p)</div>
                  <div style={{ fontSize: '12px', fontWeight: 900, marginTop: '2px' }}>
                    {activePair.shannon_entropy} (Konf.: {Math.round(activePair.confidence * 100)}%)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* HUMAN-IN-THE-LOOP GRAPH ANCHORING PANEL */}
          <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #000000', boxShadow: '3px 3px 0px #000000', padding: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 900, marginBottom: '8px', borderBottom: '1.5px solid #000000', paddingBottom: '6px' }}>
              [HUMAN-IN-THE-LOOP FREIGABE // GEPRUEFTE FOTO-KETTE IM WISSENSGRAPHEN VERANKERN]
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '10px' }}>
              <input value={commitInv} onChange={(e) => setCommitInv(e.target.value)} placeholder="Arbeits-ID / Inventarnummer" style={{ padding: '6px', fontSize: '9px', border: '1px solid #000', fontFamily: 'inherit' }} />
              <input value={commitBez} onChange={(e) => setCommitBez(e.target.value)} placeholder="Objektbezeichnung" style={{ padding: '6px', fontSize: '9px', border: '1px solid #000', fontFamily: 'inherit' }} />
              <input value={commitComm} onChange={(e) => setCommitComm(e.target.value)} placeholder="Herkunftsgemeinschaft (z.B. Nso / Benin)" style={{ padding: '6px', fontSize: '9px', border: '1px solid #000', fontFamily: 'inherit' }} />
              <input value={commitActor} onChange={(e) => setCommitActor(e.target.value)} placeholder="Beteiligter Akteur / Haendler" style={{ padding: '6px', fontSize: '9px', border: '1px solid #000', fontFamily: 'inherit' }} />
              <input value={commitDepot} onChange={(e) => setCommitDepot(e.target.value)} placeholder="Heutiges Depot / Institution" style={{ padding: '6px', fontSize: '9px', border: '1px solid #000', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={handleCommitToGraph}
                style={{ padding: '8px 14px', backgroundColor: '#000000', color: '#FFFFFF', border: '2px solid #000000', boxShadow: '2px 2px 0px #16A34A', fontSize: '9.5px', fontWeight: 900, cursor: 'pointer' }}
              >
                [GEPRUEFTE FOTO-SPUR ALS HYPOTHESE IN GRAPH SPEICHERN]
              </button>
              {commitStatus && (
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#15803D' }}>{commitStatus}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
