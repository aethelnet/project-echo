// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang, translateVerdict, localizeDemoFrame } from './i18n';
import type { FrameROI } from './browserVisualForensics';

interface FrameItem {
  id: string;
  label: string;
  year: number | string;
  location: string;
  source: string;
  is_control: boolean;
  data_url: string;
  roi?: FrameROI | null;
}

interface VisualForensicsProps {
  isResearcher: boolean;
  getAuthHeaders: () => Record<string, string>;
  onRequestLogin: () => void;
  onChainCommitted: (newPubId?: string) => void;
  onJumpToObject?: (invId: string) => void;
}

const DEFAULT_BEZ: Record<'en' | 'de' | 'fr', string> = {
  en: 'Carved Ancestral Figure (Photo-Chain 1902–2024)',
  de: 'Geschnitzte Ahnenfigur (Foto-Kette 1902–2024)',
  fr: 'Figure ancestrale sculptée (Chaîne photo 1902–2024)',
};

const DEFAULT_COMM: Record<'en' | 'de' | 'fr', string> = {
  en: 'Nso (Cameroon)',
  de: 'Nso (Kamerun)',
  fr: 'Nso (Cameroun)',
};

function hasCustomRoi(roi?: FrameROI | null): boolean {
  if (!roi) return false;
  return roi.x > 0.005 || roi.y > 0.005 || roi.w < 0.995 || roi.h < 0.995;
}

export default function VisualForensicsView({
  isResearcher,
  getAuthHeaders,
  onRequestLogin,
  onChainCommitted,
  onJumpToObject,
}: VisualForensicsProps) {
  const { lang, t } = useLang();
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [selectedPairIdx, setSelectedPairIdx] = useState<number>(0);
  const [showOutliers, setShowOutliers] = useState<boolean>(false);
  const [compareMode, setCompareMode] = useState<'correspondence' | 'wipe'>('correspondence');
  const [wipePos, setWipePos] = useState<number>(50);
  const [overlayBlend, setOverlayBlend] = useState<number>(0);
  const [expandedCropIdx, setExpandedCropIdx] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Human-in-the-loop Graph Commit State
  const [commitInv, setCommitInv] = useState<string>('FOTO-KIMBO-1902-01');
  const [commitBez, setCommitBez] = useState<string>(() => DEFAULT_BEZ[lang]);
  const [commitComm, setCommitComm] = useState<string>(() => DEFAULT_COMM[lang]);
  const [commitActor, setCommitActor] = useState<string>('J.F.G. Umlauff');
  const [commitDepot, setCommitDepot] = useState<string>('Ethnologisches Museum Berlin');
  const [commitStatus, setCommitStatus] = useState<string | null>(null);
  const [committedInvId, setCommittedInvId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFrames((prev) => prev.map((f) => localizeDemoFrame(f, lang)));
    setCommitBez((prev) =>
      Object.values(DEFAULT_BEZ).includes(prev) ? DEFAULT_BEZ[lang] : prev
    );
    setCommitComm((prev) =>
      Object.values(DEFAULT_COMM).includes(prev) ? DEFAULT_COMM[lang] : prev
    );
  }, [lang]);

  const loadDemoSeries = useCallback(async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setCommitStatus(null);
    setCommittedInvId(null);
    setExpandedCropIdx(null);
    try {
      const res = await fetch('/api/visual/demo_case');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(
          data.detail ||
            t(
              'Could not load reference photo series.',
              'Konnte Referenz-Bildreihe nicht laden.',
              'Impossible de charger la série photographique de référence.'
            )
        );
      }
      setFrames(
        (data.frames_with_previews || []).map((f: FrameItem) => ({
          ...localizeDemoFrame(f, lang),
          roi: null,
        }))
      );
      setAnalysis(data);
      setSelectedPairIdx(0);
    } catch (err: any) {
      setErrorMsg(
        err.message ||
          t(
            'Failed to load reference photo series.',
            'Fehler beim Laden der Referenz-Bildreihe.',
            'Erreur lors du chargement de la série photographique de référence.'
          )
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [lang, t]);

  useEffect(() => {
    loadDemoSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCustomAnalysis = async (targetFrames?: FrameItem[]) => {
    const list = targetFrames || frames;
    if (list.length < 2) {
      setErrorMsg(
        t(
          'At least 2 photographs are required for pairwise geometric matching.',
          'Mindestens 2 Aufnahmen für einen paarweisen Geometrie-Abgleich erforderlich.',
          'Au moins 2 photographies sont requises pour un appariement géométrique par paires.'
        )
      );
      return;
    }
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const payload = list.map((f, i) => ({
        id: f.id || `frame_${i}`,
        label: f.label || t(`Photo #${i + 1}`, `Aufnahme #${i + 1}`, `Cliché n° ${i + 1}`),
        year: f.year ? Number(f.year) : null,
        location: f.location || '',
        source: f.source || '',
        is_control: Boolean(f.is_control),
        data_url: f.data_url,
        roi: hasCustomRoi(f.roi) ? f.roi : null,
      }));
      const res = await fetch('/api/visual/analyze_chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(
          data.detail ||
            t('Visual analysis failed.', 'Bildanalyse fehlgeschlagen.', "Échec de l'analyse visuelle.")
        );
      }
      setAnalysis(data);
      setSelectedPairIdx((prev) => Math.min(prev, Math.max(0, (data.pairs?.length || 1) - 1)));
    } catch (err: any) {
      setErrorMsg(
        err.message ||
          t(
            'Network error during visual analysis.',
            'Netzwerkfehler bei der Bildanalyse.',
            "Erreur réseau lors de l'analyse visuelle."
          )
      );
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
        reader.onerror = () =>
          reject(
            new Error(
              t(
                'Could not read image file.',
                'Datei konnte nicht gelesen werden.',
                'Impossible de lire le fichier image.'
              )
            )
          );
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
          source: t('User Upload', 'Benutzer-Upload', 'Téléversement utilisateur'),
          is_control: false,
          data_url: durl,
          roi: null,
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

  const updateFrameRoi = (idx: number, patch: Partial<FrameROI> | null) => {
    setFrames((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f;
        if (patch === null) return { ...f, roi: null };
        const base: FrameROI = f.roi || { x: 0, y: 0, w: 1, h: 1 };
        const next: FrameROI = { ...base, ...patch };
        next.x = Math.max(0, Math.min(0.85, next.x));
        next.y = Math.max(0, Math.min(0.85, next.y));
        next.w = Math.max(0.15, Math.min(1 - next.x, next.w));
        next.h = Math.max(0.15, Math.min(1 - next.y, next.h));
        return { ...f, roi: next };
      })
    );
  };

  const removeFrame = (idx: number) => {
    const next = frames.filter((_, i) => i !== idx);
    setFrames(next);
    setAnalysis(null);
    if (expandedCropIdx === idx) setExpandedCropIdx(null);
  };

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
    const ndLabel = lang === 'de' ? 'o.J.' : lang === 'fr' ? 's.d.' : 'n.d.';

    const drawRoiOverlay = (
      ctx: CanvasRenderingContext2D,
      rect: { x: number; y: number; w: number; h: number },
      roi?: FrameROI | null
    ) => {
      if (!hasCustomRoi(roi) || !roi) return;
      const rx = rect.x + roi.x * rect.w;
      const ry = rect.y + roi.y * rect.h;
      const rw = roi.w * rect.w;
      const rh = roi.h * rect.h;
      ctx.save();
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = '#D97706';
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.fillText('ROI', rx + 3, Math.max(rect.y + 10, ry - 4));
      ctx.restore();
    };

    const tryRender = () => {
      if (cancelled || !imgA.complete || !imgB.complete) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(260, canvas.parentElement?.clientWidth || 760);
      const cssH = cssW < 540 ? 280 : 395;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#141413';
      ctx.fillRect(0, 0, cssW, cssH);

      const pad = cssW < 540 ? 10 : 16;
      const topBar = 28;

      if (compareMode === 'wipe') {
        const availW = cssW - 2 * pad;
        const availH = cssH - topBar - pad - 6;
        const aspect = (imgA.naturalWidth || 1) / (imgA.naturalHeight || 1);
        let rw = availW;
        let rh = rw / aspect;
        if (rh > availH) {
          rh = availH;
          rw = rh * aspect;
        }
        const rx = pad + (availW - rw) / 2;
        const ry = topBar + (availH - rh) / 2;

        ctx.font = '600 10.5px Inter, sans-serif';
        ctx.fillStyle = '#E7E5E0';
        ctx.fillText(
          `A: ${frameA.label.slice(0, 28)} (${frameA.year || ndLabel})   ·   B: ${frameB.label.slice(0, 28)} (${frameB.year || ndLabel})`,
          pad,
          18
        );

        ctx.drawImage(imgA, rx, ry, rw, rh);

        if (overlayBlend > 0) {
          ctx.save();
          ctx.globalAlpha = overlayBlend / 100;
          ctx.drawImage(imgB, rx, ry, rw, rh);
          ctx.restore();
        } else {
          const splitX = rx + (wipePos / 100) * rw;
          ctx.save();
          ctx.beginPath();
          ctx.rect(splitX, ry, rx + rw - splitX, rh);
          ctx.clip();
          ctx.drawImage(imgB, rx, ry, rw, rh);
          ctx.restore();

          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 1.75;
          ctx.beginPath();
          ctx.moveTo(splitX, ry);
          ctx.lineTo(splitX, ry + rh);
          ctx.stroke();

          ctx.fillStyle = 'rgba(20,20,19,0.85)';
          ctx.fillRect(rx + 6, ry + 6, 24, 17);
          ctx.fillRect(rx + rw - 30, ry + 6, 24, 17);
          ctx.fillStyle = '#F7F6F2';
          ctx.font = 'bold 10px "IBM Plex Mono", monospace';
          ctx.fillText('A', rx + 14, ry + 18);
          ctx.fillText('B', rx + rw - 22, ry + 18);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
        return;
      }

      const gap = cssW < 540 ? 14 : 28;
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

      const maxChars = cssW < 540 ? 15 : 30;
      ctx.font = cssW < 540 ? '600 9px Inter, sans-serif' : '600 10.5px Inter, sans-serif';
      ctx.fillStyle = '#E7E5E0';
      ctx.fillText(`A · ${frameA.label.slice(0, maxChars)} (${frameA.year || ndLabel})`, rA.x, 18);
      ctx.fillText(`B · ${frameB.label.slice(0, maxChars)} (${frameB.year || ndLabel})`, rB.x, 18);

      ctx.drawImage(imgA, rA.x, rA.y, rA.w, rA.h);
      ctx.drawImage(imgB, rB.x, rB.y, rB.w, rB.h);

      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(rA.x, rA.y, rA.w, rA.h);
      ctx.strokeRect(rB.x, rB.y, rB.w, rB.h);

      drawRoiOverlay(ctx, rA, frameA.roi);
      drawRoiOverlay(ctx, rB, frameB.roi);

      const matches = pair.matches || [];
      if (showOutliers) {
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
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

      for (const m of matches) {
        if (!m.inlier) continue;
        const x1 = rA.x + m.x1 * rA.w;
        const y1 = rA.y + m.y1 * rA.h;
        const x2 = rB.x + m.x2 * rB.w;
        const y2 = rB.y + m.y2 * rB.h;

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.78)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        ctx.arc(x1, y1, 2.6, 0, Math.PI * 2);
        ctx.arc(x2, y2, 2.6, 0, Math.PI * 2);
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
  }, [analysis, frames, selectedPairIdx, showOutliers, compareMode, wipePos, overlayBlend, lang]);

  const handleCommitToGraph = async () => {
    if (!isResearcher) {
      onRequestLogin();
      return;
    }
    if (!analysis) return;
    const activePair = analysis.pairs?.[selectedPairIdx] || analysis.pairs?.[0];
    const chainStr = frames
      .filter((f) => !f.is_control)
      .map((f) => `${f.year || '?'} ${f.location || f.label}`)
      .join(' -> ');
    const summary = activePair
      ? t(
          `Photo-Chain Re-ID (${chainStr}): ${activePair.inliers} geometric RANSAC inliers (RMSE ${activePair.reprojection_rmse_px ?? '-'} px, H=${activePair.shannon_entropy}).`,
          `Foto-Ketten-Re-ID (${chainStr}): ${activePair.inliers} geometrische RANSAC-Inliers (RMSE ${activePair.reprojection_rmse_px ?? '-'} px, H=${activePair.shannon_entropy}).`,
          `Ré-ID chaîne photo (${chainStr}) : ${activePair.inliers} inliers géométriques RANSAC (RMSE ${activePair.reprojection_rmse_px ?? '-'} px, H=${activePair.shannon_entropy}).`
        )
      : t('Manually verified photo-chain.', 'Manuell geprüfte Foto-Kette.', 'Chaîne photographique vérifiée manuellement.');

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
        const inv = data.inventarnummer || commitInv;
        setCommittedInvId(inv);
        setCommitStatus(
          t(
            `Anchored: ${inv} (${data.triples_committed || 1} edge in graph)`,
            `Verankert: ${inv} (${data.triples_committed || 1} Kante im Graphen)`,
            `Ancré : ${inv} (${data.triples_committed || 1} arête dans le graphe)`
          )
        );
        onChainCommitted('VISUELLE_FORENSIK');
      } else {
        setCommitStatus(
          t(
            `Error: ${data.detail || 'Could not save visual trace'}`,
            `Fehler: ${data.detail || 'Konnte Spur nicht speichern'}`,
            `Erreur : ${data.detail || "Impossible d'enregistrer la trace visuelle"}`
          )
        );
      }
    } catch (e: any) {
      setCommitStatus(t(`Error: ${e.message}`, `Fehler: ${e.message}`, `Erreur : ${e.message}`));
    }
  };

  const activePair = analysis?.pairs?.[selectedPairIdx] || analysis?.pairs?.[0] || null;
  const nonControlFrames = frames
    .filter((f) => !f.is_control)
    .slice()
    .sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));

  return (
    <div className="vf-view">
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleUploadImages}
        style={{ display: 'none' }}
      />

      {/* TOP METHODOLOGY & ETHICS BANNER */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', borderTop: '2px solid #141413', padding: '16px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ maxWidth: '780px', flex: '1 1 320px' }}>
          <div className="mono" style={{ fontSize: '10px', fontWeight: 700, color: '#991B1B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t(
              'Visual Provenance Forensics · Object Tracking Without Inventory Number',
              'Visuelle Provenienz-Forensik · Objekt-Rekonstruktion ohne Inventarnummer',
              "Forensique visuelle de provenance · Reconstruction sans numéro d'inventaire"
            )}
          </div>
          <h2 className="serif" style={{ fontSize: '19px', fontWeight: 700, color: '#141413', margin: '4px 0 6px 0' }}>
            {t(
              'Geometric Single-Object Verification Across Historical Photo Series',
              'Geometrische Einzelobjekt-Verifikation über historische Bildreihen',
              'Vérification géométrique d’objet unique sur séries photographiques historiques'
            )}
          </h2>
          <p style={{ fontSize: '12px', color: '#52514C', margin: 0, lineHeight: 1.55 }}>
            <strong style={{ color: '#141413' }}>{t('Methodological safeguard:', 'Methodische Schutzschranke:', 'Garde-fou méthodologique :')}</strong>{' '}
            {t(
              'No culturally generalizing style AI. Verification relies strictly on RootSIFT-128D + 6-DOF affine RANSAC alignment of individual carving notches, fracture edges, and proportions — related objects from the same culture are rejected as non-identical. Executes directly in-browser or on the local Python engine.',
              'Keine kulturell pauschalisierende Stil-KI. Geprüft wird ausschließlich über RootSIFT-128D + 6-DOF Affin-RANSAC, ob individuelle Schnitzkerben, Bruchkanten und Proportionen unter starrer 2D-Projektionsgeometrie deckungsgleich sind — verwandte Objekte derselben Kultur werden als nicht identisch abgewiesen.',
              "Aucune IA stylistique généralisante. La vérification repose exclusivement sur RootSIFT-128D + RANSAC affine 6-DDL sur les entailles individuelles, fractures et proportions — des œuvres apparentées sont rejetées comme non identiques."
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={loadDemoSeries}
            disabled={isAnalyzing}
            className="archival-btn archival-btn-primary"
          >
            {t(
              'Load reference series (1902–2024)',
              'Referenz-Reihe laden (1902–2024)',
              'Charger série de référence (1902–2024)'
            )}
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="archival-btn"
          >
            {t('+ Add photos', '+ Eigene Fotos', '+ Ajouter des photos')}
          </button>
          <button
            onClick={() => { setFrames([]); setAnalysis(null); setErrorMsg(null); setExpandedCropIdx(null); }}
            className="archival-btn"
            style={{ color: '#991B1B', borderColor: '#E5B8B8' }}
          >
            {t('Clear', 'Leeren', 'Vider')}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #DC2626', borderLeft: '3px solid #991B1B', color: '#991B1B', fontSize: '12px', fontWeight: 500, marginBottom: '14px' }}>
          <strong>{t('Analysis notice:', 'Analyse-Hinweis:', "Avis d'analyse :")}</strong> {errorMsg}
        </div>
      )}

      <div className="vf-grid">
        {/* LEFT COLUMN: PHOTO PLATES, METADATA & ROI CROPPER */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#141413' }}>
              {t(`Photo Series`, `Bildreihe`, `Série photo`)}{' '}
              <span className="mono" style={{ fontSize: '11px', color: '#78766F', fontWeight: 400 }}>({frames.length})</span>
            </span>
            <button
              data-testid="vf-recompute-btn"
              onClick={() => runCustomAnalysis()}
              disabled={isAnalyzing || frames.length < 2}
              className="archival-btn"
              style={{ backgroundColor: '#166534', color: '#FFFFFF', borderColor: '#166534', padding: '4px 10px' }}
            >
              {isAnalyzing
                ? t('Computing…', 'Berechne…', 'Calcul…')
                : t('Recompute geometry', 'Neu berechnen', 'Recalculer')}
            </button>
          </div>

          {frames.map((f, idx) => {
            const roiActive = hasCustomRoi(f.roi);
            const cropOpen = expandedCropIdx === idx;
            const roi = f.roi || { x: 0, y: 0, w: 1, h: 1 };
            return (
              <div
                key={f.id}
                style={{
                  border: f.is_control ? '1px dashed #8C8A82' : '1px solid #D8D5CD',
                  backgroundColor: f.is_control ? '#F7F6F2' : '#FFFFFF',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '10px', minWidth: 0 }}>
                  <div style={{ position: 'relative', width: '60px', height: '68px', flexShrink: 0, border: '1px solid #D8D5CD', overflow: 'hidden', backgroundColor: '#141413' }}>
                    <img
                      src={f.data_url}
                      alt={f.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {roiActive && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${roi.x * 100}%`,
                          top: `${roi.y * 100}%`,
                          width: `${roi.w * 100}%`,
                          height: `${roi.h * 100}%`,
                          border: '1.5px solid #D97706',
                          boxSizing: 'border-box',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '5px' }}>
                      <input
                        type="text"
                        value={f.label}
                        onChange={(e) => updateFrameField(idx, 'label', e.target.value)}
                        placeholder={t('Title / Plate…', 'Titel / Tafel…', 'Titre / Planche…')}
                        style={{ width: '100%', minWidth: 0, fontSize: '11.5px', fontWeight: 600, border: '1px solid #D8D5CD', padding: '3px 6px', color: '#141413', backgroundColor: '#FFFFFF' }}
                      />
                      <button
                        onClick={() => removeFrame(idx)}
                        style={{ border: '1px solid #D8D5CD', backgroundColor: '#FFFFFF', color: '#52514C', fontSize: '10px', cursor: 'pointer', padding: '0 6px', flexShrink: 0 }}
                        title={t('Remove photo', 'Aufnahme entfernen', 'Supprimer le cliché')}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        value={f.year}
                        onChange={(e) => updateFrameField(idx, 'year', e.target.value)}
                        placeholder={t('Year', 'Jahr', 'Année')}
                        className="mono"
                        style={{ width: '66px', fontSize: '10.5px', border: '1px solid #D8D5CD', padding: '3px 5px', flexShrink: 0, backgroundColor: '#FFFFFF' }}
                      />
                      <input
                        type="text"
                        value={f.location}
                        onChange={(e) => updateFrameField(idx, 'location', e.target.value)}
                        placeholder={t('Location (e.g. Kumbo)', 'Ort (z. B. Kimbo)', 'Lieu (ex. Kumbo)')}
                        style={{ flex: 1, minWidth: 0, fontSize: '11px', border: '1px solid #D8D5CD', padding: '3px 6px', backgroundColor: '#FFFFFF' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', color: '#52514C', flexWrap: 'wrap', gap: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={f.is_control}
                          onChange={(e) => updateFrameField(idx, 'is_control', e.target.checked)}
                        />
                        {t('Negative control', 'Negativprobe', 'Témoin négatif')}
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          data-testid={`vf-crop-toggle-${idx}`}
                          onClick={() => setExpandedCropIdx(cropOpen ? null : idx)}
                          style={{
                            border: roiActive ? '1px solid #B45309' : '1px solid #D8D5CD',
                            backgroundColor: roiActive ? '#FFFBEB' : (cropOpen ? '#141413' : '#F7F6F2'),
                            color: roiActive ? '#92400E' : (cropOpen ? '#FFFFFF' : '#141413'),
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 7px',
                            cursor: 'pointer',
                          }}
                        >
                          {roiActive
                            ? t('ROI active', 'ROI aktiv', 'ROI actif')
                            : t('Crop ROI', 'Objekt-ROI', 'Cadrer ROI')}
                        </button>
                        {analysis?.frame_summaries?.[idx] && (
                          <span className="mono" style={{ fontSize: '10px', color: '#78766F' }}>
                            {analysis.frame_summaries[idx].keypoint_count} pts
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {cropOpen && (
                  <div style={{ borderTop: '1px solid #E5DFD3', paddingTop: '8px', backgroundColor: '#FFFBEB', padding: '8px', fontSize: '10.5px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '6px', flexWrap: 'wrap' }}>
                      <strong style={{ color: '#92400E', fontSize: '10.5px' }}>
                        {t('Object focus region', 'Objekt-Fokusbereich', "Zone de l'objet")}
                      </strong>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          type="button"
                          data-testid={`vf-crop-center-${idx}`}
                          onClick={() => updateFrameRoi(idx, { x: 0.15, y: 0.1, w: 0.7, h: 0.8 })}
                          style={{ border: '1px solid #B45309', backgroundColor: '#FFFFFF', color: '#92400E', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}
                        >
                          {t('Center 70%', 'Mitte 70%', 'Centre 70 %')}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateFrameRoi(idx, null)}
                          style={{ border: '1px solid #D8D5CD', backgroundColor: '#FFFFFF', color: '#141413', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}
                        >
                          {t('Full frame', 'Vollbild', 'Entier')}
                        </button>
                      </div>
                    </div>
                    <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>X: {Math.round(roi.x * 100)}%</span>
                        <input type="range" min={0} max={75} value={Math.round(roi.x * 100)} onChange={(e) => updateFrameRoi(idx, { x: Number(e.target.value) / 100 })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>Y: {Math.round(roi.y * 100)}%</span>
                        <input type="range" min={0} max={75} value={Math.round(roi.y * 100)} onChange={(e) => updateFrameRoi(idx, { y: Number(e.target.value) / 100 })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{t('W', 'B', 'L')}: {Math.round(roi.w * 100)}%</span>
                        <input type="range" min={20} max={100} value={Math.round(roi.w * 100)} onChange={(e) => updateFrameRoi(idx, { w: Number(e.target.value) / 100 })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{t('H', 'H', 'H')}: {Math.round(roi.h * 100)}%</span>
                        <input type="range" min={20} max={100} value={Math.round(roi.h * 100)} onChange={(e) => updateFrameRoi(idx, { h: Number(e.target.value) / 100 })} />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {nonControlFrames.length >= 2 && (
            <div style={{ borderTop: '1px solid #D8D5CD', paddingTop: '10px', marginTop: '4px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#52514C', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('Reconstructed Space-Time Chain', 'Rekonstruierte Ort-Zeit-Kette', 'Chaîne spatio-temporelle reconstruite')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '11.5px' }}>
                {nonControlFrames.map((nf, i) => (
                  <div key={nf.id} style={{ padding: '6px 8px', backgroundColor: '#F7F6F2', borderLeft: '2px solid #141413' }}>
                    <span className="mono" style={{ fontWeight: 700, fontSize: '11px' }}>{i + 1}. {nf.year || t('n.d.', 'o.J.', 's.d.')}</span> — {nf.location || t('Location unknown', 'Ort unbekannt', 'Lieu inconnu')}
                    <div style={{ color: '#78766F', fontSize: '10.5px', marginTop: '1px' }}>{nf.source || nf.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT STAGE: GEOMETRIC CORRESPONDENCE CANVAS / A-B WIPE & VERDICT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px' }}>
            {/* Pair Selector Tabs + Mode Switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(analysis?.pairs || []).map((p: any, idx: number) => {
                  const isSel = idx === selectedPairIdx;
                  const pass = p.inliers >= 7;
                  const isControlPair = Boolean(frames[p.index_a]?.is_control || frames[p.index_b]?.is_control);
                  return (
                    <button
                      key={p.pair_id}
                      onClick={() => setSelectedPairIdx(idx)}
                      style={{
                        padding: '5px 9px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: isSel ? '1px solid #141413' : (isControlPair ? '1px dashed #8C8A82' : '1px solid #D8D5CD'),
                        backgroundColor: isSel ? '#141413' : '#FFFFFF',
                        color: isSel ? '#FFFFFF' : '#141413',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: pass ? '#16A34A' : '#DC2626', display: 'inline-block' }} />
                      <span className="mono" style={{ fontSize: '10.5px' }}>{p.index_a + 1}↔{p.index_b + 1}</span>
                      <span className="mono" style={{ fontSize: '10px', opacity: isSel ? 0.85 : 0.7 }}>{p.inliers}</span>
                      {isControlPair && (
                        <span style={{ fontSize: '9.5px', opacity: 0.75 }}>{t('Control', 'Kontrolle', 'Témoin')}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2', padding: '2px', gap: '2px' }}>
                <button
                  type="button"
                  data-testid="vf-mode-correspondence"
                  onClick={() => setCompareMode('correspondence')}
                  style={{
                    padding: '4px 9px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    border: 'none',
                    backgroundColor: compareMode === 'correspondence' ? '#141413' : 'transparent',
                    color: compareMode === 'correspondence' ? '#FFFFFF' : '#52514C',
                    cursor: 'pointer',
                  }}
                >
                  {t('RANSAC Vectors', 'RANSAC-Vektoren', 'Vecteurs RANSAC')}
                </button>
                <button
                  type="button"
                  data-testid="vf-mode-wipe"
                  onClick={() => setCompareMode('wipe')}
                  style={{
                    padding: '4px 9px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    border: 'none',
                    backgroundColor: compareMode === 'wipe' ? '#155E75' : 'transparent',
                    color: compareMode === 'wipe' ? '#FFFFFF' : '#52514C',
                    cursor: 'pointer',
                  }}
                >
                  {t('A/B Wipe & Overlay', 'A/B Schieber & Overlay', 'Balayage A/B')}
                </button>
              </div>
            </div>

            {/* Secondary Canvas Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px', fontSize: '11px', color: '#52514C' }}>
              {compareMode === 'correspondence' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showOutliers} onChange={(e) => setShowOutliers(e.target.checked)} />
                  {t(
                    'Show rejected outliers (dashed red)',
                    'Abgelehnte Ausreißer zeigen (rot gestrichelt)',
                    'Afficher les points aberrants rejetés (rouge pointillé)'
                  )}
                </label>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flex: 1 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#141413' }}>
                    <span>{t('Split A/B:', 'Schnitt A/B:', 'Coupe A/B :')} <span className="mono">{wipePos}%</span></span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={wipePos}
                      onChange={(e) => { setOverlayBlend(0); setWipePos(Number(e.target.value)); }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#141413' }}>
                    <span>{t('Blend B:', 'Überblenden B:', 'Fondre B :')} <span className="mono">{overlayBlend}%</span></span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={overlayBlend}
                      onChange={(e) => setOverlayBlend(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}

              {analysis?.engine && (
                <span className="mono" style={{ fontSize: '10px', padding: '2px 7px', backgroundColor: '#F7F6F2', border: '1px solid #D8D5CD', color: '#52514C' }}>
                  {analysis.engine === 'browser_rootsift_ransac' || analysis.engine === 'browser-rootsift-ransac'
                    ? t('Engine: Browser RootSIFT+RANSAC', 'Engine: Browser RootSIFT+RANSAC', 'Moteur : RootSIFT+RANSAC navigateur')
                    : t('Engine: Verified Python RootSIFT', 'Engine: Verifiziertes Python RootSIFT', 'Moteur : RootSIFT Python vérifié')}
                </span>
              )}
            </div>

            {/* Canvas Stage */}
            <div style={{ width: '100%', border: '1px solid #1C1B19', overflow: 'hidden', backgroundColor: '#141413' }}>
              <canvas ref={canvasRef} />
            </div>

            {/* Quantitative Forensic Metrics */}
            {activePair && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginTop: '12px' }}>
                <div style={{ padding: '10px 12px', border: '1px solid #D8D5CD', borderLeft: `3px solid ${activePair.inliers >= 10 ? '#166534' : '#991B1B'}`, backgroundColor: activePair.inliers >= 10 ? '#F0FDF4' : '#FEF2F2' }}>
                  <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('Forensic Verdict', 'Forensischer Befund', 'Verdict forensique')}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: activePair.inliers >= 10 ? '#166534' : '#991B1B', marginTop: '4px' }}>
                    {translateVerdict(activePair.verdict, lang)}
                  </div>
                </div>
                <div style={{ padding: '10px 12px', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2' }}>
                  <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('RANSAC Inliers', 'RANSAC Inliers', 'Inliers RANSAC')}
                  </div>
                  <div className="mono" style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px', color: '#141413' }}>
                    {activePair.inliers} / {activePair.putative_matches} <span style={{ fontSize: '11px', color: '#52514C' }}>({Math.round(activePair.inlier_ratio * 100)}%)</span>
                  </div>
                </div>
                <div style={{ padding: '10px 12px', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2' }}>
                  <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('Reprojection RMSE', 'Rückprojektions-RMSE', 'RMSE de rétroprojection')}
                  </div>
                  <div className="mono" style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px', color: '#141413' }}>
                    {activePair.reprojection_rmse_px !== null
                      ? `${activePair.reprojection_rmse_px} px`
                      : t('No model', 'Kein Modell', 'Aucun modèle')}
                  </div>
                </div>
                <div style={{ padding: '10px 12px', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2' }}>
                  <div style={{ fontSize: '10px', color: '#52514C', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('Shannon Entropy H(p)', 'Shannon-Entropie H(p)', 'Entropie H(p)')}
                  </div>
                  <div className="mono" style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px', color: '#141413' }}>
                    {activePair.shannon_entropy} <span style={{ fontSize: '11px', color: '#52514C' }}>({Math.round(activePair.confidence * 100)}%)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* HUMAN-IN-THE-LOOP GRAPH ANCHORING PANEL */}
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D8D5CD', padding: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#141413', marginBottom: '10px', borderBottom: '1px solid #D8D5CD', paddingBottom: '8px' }}>
              {t(
                'Human-in-the-Loop Approval · Anchor Verified Photo-Chain in Graph',
                'Human-in-the-Loop Freigabe · Geprüfte Foto-Kette im Wissensgraphen verankern',
                'Validation humaine · Ancrer la chaîne photo vérifiée dans le graphe'
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              <input value={commitInv} onChange={(e) => setCommitInv(e.target.value)} placeholder={t('Working ID / Inventory No.', 'Arbeits-ID / Inventarnummer', "ID de travail / N° d'inventaire")} className="mono" style={{ padding: '7px 8px', fontSize: '11px', border: '1px solid #D8D5CD', minWidth: 0 }} />
              <input value={commitBez} onChange={(e) => setCommitBez(e.target.value)} placeholder={t('Object Designation', 'Objektbezeichnung', "Désignation de l'objet")} style={{ padding: '7px 8px', fontSize: '11.5px', border: '1px solid #D8D5CD', minWidth: 0 }} />
              <input value={commitComm} onChange={(e) => setCommitComm(e.target.value)} placeholder={t('Community of Origin', 'Herkunftsgemeinschaft', "Communauté d'origine")} style={{ padding: '7px 8px', fontSize: '11.5px', border: '1px solid #D8D5CD', minWidth: 0 }} />
              <input value={commitActor} onChange={(e) => setCommitActor(e.target.value)} placeholder={t('Involved Actor / Dealer', 'Beteiligter Akteur / Händler', 'Acteur / Marchand impliqué')} style={{ padding: '7px 8px', fontSize: '11.5px', border: '1px solid #D8D5CD', minWidth: 0 }} />
              <input value={commitDepot} onChange={(e) => setCommitDepot(e.target.value)} placeholder={t('Current Depot / Museum', 'Heutiges Depot / Institution', 'Dépôt / Institution actuelle')} style={{ padding: '7px 8px', fontSize: '11.5px', border: '1px solid #D8D5CD', minWidth: 0 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                data-testid="vf-commit-btn"
                onClick={handleCommitToGraph}
                className="archival-btn archival-btn-primary"
                style={{ padding: '8px 14px', fontSize: '11.5px' }}
              >
                {t(
                  'Commit Verified Photo-Trace to Graph',
                  'Geprüfte Foto-Spur als Hypothese im Graphen speichern',
                  'Enregistrer cette trace photo dans le graphe'
                )}
              </button>
              {commitStatus && (
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#166534' }}>{commitStatus}</span>
              )}
              {committedInvId && onJumpToObject && (
                <button
                  type="button"
                  onClick={() => onJumpToObject(committedInvId)}
                  className="archival-btn"
                  style={{ color: '#166534', borderColor: '#166534', backgroundColor: '#F0FDF4' }}
                >
                  {t('Inspect in Graph →', 'Im Graphen ansehen →', 'Voir dans le graphe →')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
