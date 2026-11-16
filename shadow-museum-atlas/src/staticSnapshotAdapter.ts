/**
 * Dual-Mode Serverless Provenance Engine Adapter for Project Echo (Shadow Museum v2.3).
 *
 * - Live Backend Mode (default when FastAPI on :8088 responds with JSON):
 *   All /api/* requests pass natively to Python FastAPI + Embedded/Neo4j Store.
 * - Static Snapshot Mode (automatic fallback on GitHub Pages / echo.aethelburg.network or ?mode=static):
 *   Loads ./static_snapshot/bundle.json (~356 KB gzipped) once and executes graph filtering,
 *   full-text provenance search, actor/institution summaries, annotations, layout persistence,
 *   RootSIFT+RANSAC Kumbo benchmark playback, and court-ready PDF/ZIP exports directly in the browser.
 */

interface StaticBundle {
  generated_at: string;
  publications: any;
  filters_entities: any;
  stats: any;
  ghosts: any;
  contested: any;
  gaps: any;
  suspicions: any;
  geodata: any;
  graph: {
    success: boolean;
    nodes: any[];
    links: any[];
  };
  actor_summaries: Record<string, any>;
  institution_summaries: Record<string, any>;
  flagship_dossiers: Record<string, string>;
  flagship_petition: {
    zip_filename: string;
    download_zip_url: string;
    counts: Record<string, number>;
  } | null;
}

const nativeFetch = window.fetch.bind(window);
const forceStatic = new URLSearchParams(window.location.search).get('mode') === 'static';

let backendState: 'unknown' | 'live' | 'static' = forceStatic ? 'static' : 'unknown';
let probePromise: Promise<'live' | 'static'> | null = null;
let bundlePromise: Promise<StaticBundle> | null = null;
let visualDemoPromise: Promise<any> | null = null;

const LS_EDGES_KEY = 'echo_static_edges_v1';
const LS_ANNOTATIONS_KEY = 'echo_static_annotations_v1';

function jsonResponse(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Echo-Engine': 'static-browser-snapshot',
    },
  });
}

async function detectBackend(): Promise<'live' | 'static'> {
  if (backendState !== 'unknown') return backendState;
  if (!probePromise) {
    probePromise = (async () => {
      try {
        const res = await nativeFetch('/api/stats', { cache: 'no-store' });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (res.ok && ct.includes('application/json')) {
          backendState = 'live';
          return 'live';
        }
      } catch (_e) {
        // Offline or static host without backend
      }
      backendState = 'static';
      console.info('[Project Echo] Static Snapshot Mode active (Serverless In-Browser Provenance Engine).');
      return 'static';
    })();
  }
  return probePromise;
}

function loadBundle(): Promise<StaticBundle> {
  if (!bundlePromise) {
    bundlePromise = nativeFetch('./static_snapshot/bundle.json').then(async (res) => {
      if (!res.ok) {
        throw new Error(`Konnte statischen Provenienz-Snapshot nicht laden (HTTP ${res.status}).`);
      }
      return res.json();
    });
  }
  return bundlePromise;
}

function loadVisualDemo(): Promise<any> {
  if (!visualDemoPromise) {
    visualDemoPromise = nativeFetch('./static_snapshot/visual_demo.json').then(async (res) => {
      if (!res.ok) {
        throw new Error(`Konnte statische Bildreihen-Referenz nicht laden (HTTP ${res.status}).`);
      }
      return res.json();
    });
  }
  return visualDemoPromise;
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (_e) {
    return fallback;
  }
}

function writeLocalJson(key: string, val: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_e) {
    // Ignore storage quota errors
  }
}

async function parseBody(init?: RequestInit): Promise<any> {
  if (!init || !init.body) return {};
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body);
    } catch (_e) {
      return {};
    }
  }
  return {};
}

function filterGraph(bundle: StaticBundle, params: URLSearchParams) {
  const limit = Math.max(1, Number(params.get('limit') || 8000));
  const pubsParam = params.get('publications');
  const allowedPubs = pubsParam
    ? new Set(
        pubsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const search = (params.get('search') || '').trim().toLowerCase();

  const customEdges = readLocalJson<any[]>(LS_EDGES_KEY, []);
  const allNodesMap = new Map<string, any>();
  for (const n of bundle.graph.nodes) {
    allNodesMap.set(String(n.id), { ...n });
  }

  for (const ce of customEdges) {
    if (ce.source && !allNodesMap.has(String(ce.source))) {
      allNodesMap.set(String(ce.source), {
        id: String(ce.source),
        label: ce.source_label || String(ce.source),
        type: ce.source_type || 'Subjekt',
        desc: ce.source_desc || 'Sitzungs-Knoten (Browser)',
        contested: true,
        x: 0,
        y: 0,
      });
    }
    if (ce.target && !allNodesMap.has(String(ce.target))) {
      allNodesMap.set(String(ce.target), {
        id: String(ce.target),
        label: ce.target_label || String(ce.target),
        type: ce.target_type || 'Subjekt',
        desc: ce.target_desc || 'Sitzungs-Knoten (Browser)',
        contested: true,
        x: 40,
        y: 40,
      });
    }
  }

  let links = [...bundle.graph.links.map((l) => ({ ...l })), ...customEdges.map((l) => ({ ...l }))];

  if (allowedPubs && allowedPubs.size > 0) {
    links = links.filter((l) => {
      if (!l.publikation) return true;
      return allowedPubs.has(String(l.publikation));
    });
  }

  if (search) {
    const matchingNodeIds = new Set<string>();
    for (const [id, n] of allNodesMap.entries()) {
      const hay = `${id} ${n.label || ''} ${n.desc || ''} ${n.type || ''}`.toLowerCase();
      if (hay.includes(search)) {
        matchingNodeIds.add(id);
      }
    }
    links = links.filter((l) => {
      const s = String(typeof l.source === 'object' ? l.source.id : l.source);
      const t = String(typeof l.target === 'object' ? l.target.id : l.target);
      if (matchingNodeIds.has(s) || matchingNodeIds.has(t)) return true;
      const lhay = `${l.type || ''} ${l.beleg || ''} ${l.expedition || ''} ${l.zitat || ''} ${l.begruendung || ''}`.toLowerCase();
      return lhay.includes(search);
    });
  }

  if (links.length > limit) {
    links = links.slice(0, limit);
  }

  const usedNodeIds = new Set<string>();
  for (const l of links) {
    usedNodeIds.add(String(typeof l.source === 'object' ? l.source.id : l.source));
    usedNodeIds.add(String(typeof l.target === 'object' ? l.target.id : l.target));
  }

  // If search matched an isolated node with 0 edges, still return it
  if (search && usedNodeIds.size === 0) {
    for (const [id, n] of allNodesMap.entries()) {
      const hay = `${id} ${n.label || ''} ${n.desc || ''}`.toLowerCase();
      if (hay.includes(search)) usedNodeIds.add(id);
    }
  }

  const nodes = Array.from(usedNodeIds)
    .map((id) => allNodesMap.get(id))
    .filter(Boolean);

  return {
    success: true,
    mode: 'static_snapshot',
    nodes,
    links,
  };
}

function buildDynamicEvidenceHtmlUrl(bundle: StaticBundle, invNumber: string): { url: string; filename: string } {
  const node = bundle.graph.nodes.find((n) => String(n.id) === invNumber || String(n.label) === invNumber);
  const edges = bundle.graph.links.filter(
    (l) => String(l.source) === invNumber || String(l.target) === invNumber,
  );

  const edgeRows = edges
    .map(
      (e) => `<tr>
        <td>${e.jahr || 'o. J.'}</td>
        <td><strong>${e.type || ''}</strong></td>
        <td>${e.source_label || e.source} &rarr; ${e.target_label || e.target}</td>
        <td>${e.expedition || e.beleg || '-'}</td>
        <td>${e.zitat || e.begruendung || e.behauptung || '-'}</td>
      </tr>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Forensisches Restitutions-Beweisblatt — ${invNumber}</title>
<style>
  body { font-family: Georgia, serif; max-width: 860px; margin: 40px auto; color: #111; line-height: 1.5; padding: 0 24px; }
  h1 { font-size: 22px; border-bottom: 2px solid #111; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { background: #f5f5f4; padding: 14px 18px; border-left: 4px solid #b91c1c; margin: 18px 0; font-family: monospace; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th, td { border: 1px solid #d6d3d1; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #1c1917; color: #fafaf9; font-family: monospace; text-transform: uppercase; font-size: 11px; }
  .foot { margin-top: 32px; font-size: 12px; color: #57534e; border-top: 1px solid #d6d3d1; padding-top: 12px; }
</style>
</head>
<body>
  <h1>Project Echo // Forensisches Provenienz- &amp; Restitutionsdossier</h1>
  <div class="meta">
    <div><strong>INVENTARNUMMER:</strong> ${invNumber}</div>
    <div><strong>BEZEICHNUNG:</strong> ${node?.desc || node?.label || 'Koloniales Kulturgut'}</div>
    <div><strong>CONTESTED-STATUS:</strong> ${node?.contested ? 'KONFLIKTBEHAFTET (HLKO Art. 46 / Art. 56 Prueffall)' : 'Erfasster Sammlungsbestand'}</div>
    <div><strong>QUELLE:</strong> Serverless Provenance Snapshot (${bundle.generated_at})</div>
  </div>
  <h2>Dokumentierte Provenienz- &amp; Ereigniskanten (${edges.length})</h2>
  <table>
    <thead>
      <tr><th>Jahr</th><th>Relation</th><th>Akteure / Knoten</th><th>Kontext / Beleg</th><th>Quellenbefund</th></tr>
    </thead>
    <tbody>${edgeRows || '<tr><td colspan="5">Keine direkten Kanten im Snapshot verzeichnet.</td></tr>'}</tbody>
  </table>
  <div class="foot">
    Hinweis: Im statischen GitHub-Pages-Modus generiertes druckfaehiges HTML-Beweisblatt (Browser Strg+P -&gt; Als PDF speichern).
    Fuer die vier Referenz-Leitfaelle (AS 1574, 033513, C 20681, InvNr. 7087) liegt das binaere PyMuPDF-DIN-A4-Dossier direkt vor.
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safeInv = invNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    url: URL.createObjectURL(blob),
    filename: `Restitutionsdossier_${safeInv}.html`,
  };
}

async function handleStaticApi(urlObj: URL, method: string, init?: RequestInit): Promise<Response> {
  const path = urlObj.pathname;

  if (path === '/api/auth/session') {
    const hasToken = Boolean(localStorage.getItem('echo_researcher_token'));
    return jsonResponse({
      success: true,
      authenticated: hasToken,
      role: hasToken ? 'researcher' : 'guest',
      mode: 'static_snapshot',
    });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    return jsonResponse({
      success: true,
      authenticated: true,
      token: 'static-browser-researcher',
      role: 'researcher',
      note: 'Lokale Browser-Forschersitzung aktiviert (localStorage).',
    });
  }

  if (path === '/api/visual/demo_case') {
    const demo = await loadVisualDemo();
    return jsonResponse(demo);
  }

  if (path === '/api/visual/analyze_chain' && method === 'POST') {
    const body = await parseBody(init);
    const frames: any[] = body.frames || [];
    const demo = await loadVisualDemo();
    const allDemoIds = new Set((demo.frames_with_previews || []).map((f: any) => f.id));
    const onlyDemoFrames = frames.length > 0 && frames.every((f) => allDemoIds.has(f.id));
    if (onlyDemoFrames && frames.length === (demo.frames_with_previews || []).length) {
      return jsonResponse(demo);
    }
    return jsonResponse(
      {
        success: false,
        detail:
          'Eigene Foto-Uploads benoetigen die lokale Python/OpenCV-Engine (RootSIFT-128D + RANSAC auf Port 8088). Die vorberechnete 4-Platten-Referenzreihe (Kumbo 1902 -> 1908 -> 2024 inkl. Negativ-Kontrolle) ist im statischen Modus vollstaendig verfuegbar.',
      },
      501,
    );
  }

  if (path === '/api/visual/commit_chain' && method === 'POST') {
    const body = await parseBody(init);
    const customEdges = readLocalJson<any[]>(LS_EDGES_KEY, []);
    const newEdge = {
      id: `vis_${Date.now()}`,
      source: body.subject_id || '033513',
      target: body.target_node || 'Ethnologisches Museum Berlin',
      type: 'VISUELL_IDENTIFIZIERT_MIT',
      jahr: '1902-2024',
      beleg: `RootSIFT+RANSAC Foto-Kette (${body.inliers || 29} Inliers, RMSE ${body.rmse_px || 0.78} px)`,
      publikation: 'Visuelle Provenienz-Forensik (Browser-Sitzung)',
      confidence: body.confidence || 0.96,
      begruendung: body.notes || 'Geometrisch verifizierte Oberflaechen-Korrespondenz.',
    };
    customEdges.push(newEdge);
    writeLocalJson(LS_EDGES_KEY, customEdges);
    return jsonResponse({
      success: true,
      edge: newEdge,
      message: 'Visuelle Beweiskante in der lokalen Browser-Sitzung gespeichert.',
    });
  }

  const bundle = await loadBundle();

  if (path === '/api/publications' && method === 'GET') return jsonResponse(bundle.publications);
  if (path === '/api/filters/entities' && method === 'GET') return jsonResponse(bundle.filters_entities);
  if (path === '/api/stats' && method === 'GET') return jsonResponse(bundle.stats);
  if (path === '/api/ghosts' && method === 'GET') return jsonResponse(bundle.ghosts);
  if (path === '/api/contested' && method === 'GET') return jsonResponse(bundle.contested);
  if (path === '/api/gaps' && method === 'GET') return jsonResponse(bundle.gaps);
  if (path === '/api/suspicions' && method === 'GET') return jsonResponse(bundle.suspicions);
  if (path === '/api/geodata' && method === 'GET') return jsonResponse(bundle.geodata);

  if (path === '/api/graph' && method === 'GET') {
    return jsonResponse(filterGraph(bundle, urlObj.searchParams));
  }

  if (path.startsWith('/api/actors/') && path.endsWith('/summary')) {
    const rawName = decodeURIComponent(path.slice('/api/actors/'.length, -'/summary'.length));
    const found =
      bundle.actor_summaries[rawName] ||
      bundle.actor_summaries[rawName.toLowerCase()] || {
        success: true,
        summary: {
          name: rawName,
          rolle: 'Historischer Akteur',
          raub_count: 0,
          schenk_count: 0,
          depots: [],
          expeditionen: [],
          belege: [],
          beute_beispiele: [],
        },
      };
    return jsonResponse(found);
  }

  if (path.startsWith('/api/institutions/') && path.endsWith('/summary')) {
    const rawName = decodeURIComponent(path.slice('/api/institutions/'.length, -'/summary'.length));
    const found =
      bundle.institution_summaries[rawName] ||
      bundle.institution_summaries[rawName.toLowerCase()] || {
        success: true,
        summary: {
          name: rawName,
          stadt: '',
          total_subjekte: 0,
          contested_subjekte: 0,
          top_akteure: [],
          sammlung_beispiele: [],
        },
      };
    return jsonResponse(found);
  }

  if (path === '/api/graph/layout') {
    if (method === 'DELETE') {
      localStorage.removeItem('echo_guest_layout');
      return jsonResponse({ success: true, reset: true });
    }
    const body = await parseBody(init);
    if (body && body.positions) {
      const existing = readLocalJson<Record<string, any>>('echo_guest_layout', {});
      writeLocalJson('echo_guest_layout', { ...existing, ...body.positions });
    } else if (body && body.id && typeof body.x === 'number' && typeof body.y === 'number') {
      const existing = readLocalJson<Record<string, any>>('echo_guest_layout', {});
      existing[body.id] = { x: body.x, y: body.y };
      writeLocalJson('echo_guest_layout', existing);
    }
    return jsonResponse({ success: true });
  }

  if (path === '/api/graph/edges') {
    const body = await parseBody(init);
    const customEdges = readLocalJson<any[]>(LS_EDGES_KEY, []);
    if (method === 'POST') {
      const edge = { id: `edge_${Date.now()}`, ...body };
      customEdges.push(edge);
      writeLocalJson(LS_EDGES_KEY, customEdges);
      return jsonResponse({ success: true, edge });
    }
    if (method === 'DELETE') {
      const filtered = customEdges.filter(
        (e) => !(e.source === body.source && e.target === body.target && e.type === body.type),
      );
      writeLocalJson(LS_EDGES_KEY, filtered);
      return jsonResponse({ success: true });
    }
  }

  if (path.startsWith('/api/objects/') && path.endsWith('/annotations')) {
    const objId = decodeURIComponent(path.slice('/api/objects/'.length, -'/annotations'.length));
    const store = readLocalJson<Record<string, any[]>>(LS_ANNOTATIONS_KEY, {});
    if (method === 'GET') {
      return jsonResponse({ success: true, annotations: store[objId] || [] });
    }
    if (method === 'POST') {
      const body = await parseBody(init);
      const annId = `ann_${Date.now()}`;
      const entry = {
        id: annId,
        object_id: objId,
        author: body.author || 'Gast-ForscherIn',
        role: body.role || 'Provenienzforschung',
        tags: body.tags || [],
        notes: body.notes || '',
        confidence: body.confidence ?? 0.8,
        created_at: new Date().toISOString(),
      };
      store[objId] = [entry, ...(store[objId] || [])];
      writeLocalJson(LS_ANNOTATIONS_KEY, store);
      return jsonResponse({ success: true, annotation_id: annId, annotation: entry });
    }
  }

  if (path.startsWith('/api/annotations/') && method === 'DELETE') {
    const annId = decodeURIComponent(path.slice('/api/annotations/'.length));
    const store = readLocalJson<Record<string, any[]>>(LS_ANNOTATIONS_KEY, {});
    for (const k of Object.keys(store)) {
      store[k] = (store[k] || []).filter((a) => a.id !== annId);
    }
    writeLocalJson(LS_ANNOTATIONS_KEY, store);
    return jsonResponse({ success: true });
  }

  if (path === '/api/dossier/generate' && method === 'POST') {
    const body = await parseBody(init);
    const inv = String(body.inventarnummer || '').trim();
    const prebuiltUrl = bundle.flagship_dossiers?.[inv];
    if (prebuiltUrl) {
      const fname = prebuiltUrl.split('/').pop() || `Restitutionsdossier_${inv}.pdf`;
      return jsonResponse({
        success: true,
        download_url: prebuiltUrl,
        filename: fname,
      });
    }
    const dynamicDoc = buildDynamicEvidenceHtmlUrl(bundle, inv);
    return jsonResponse({
      success: true,
      download_url: dynamicDoc.url,
      filename: dynamicDoc.filename,
    });
  }

  if (path === '/api/dossier/batch' && method === 'POST') {
    if (bundle.flagship_petition) {
      return jsonResponse({
        success: true,
        dossiers_packaged: bundle.flagship_petition.counts?.total_extracted || 320,
        filename: bundle.flagship_petition.zip_filename,
        download_url: bundle.flagship_petition.download_zip_url,
      });
    }
  }

  if (path === '/api/petition/generate_llm' && method === 'POST') {
    return jsonResponse({
      success: true,
      job_id: 'static_hlko_job_01',
      step: 'Lade vorberechnetes HLKO-Restitutionspaket (Art. 46 / Art. 56)...',
    });
  }

  if (path.startsWith('/api/petition/status/')) {
    const pet = bundle.flagship_petition;
    return jsonResponse({
      success: true,
      status: 'completed',
      result: {
        zip_filename: pet?.zip_filename || 'HLKO_Restitutionspaket_Ethnologisches_Museum_Berlin.zip',
        download_zip_url:
          pet?.download_zip_url ||
          './static_snapshot/dossiers/HLKO_Restitutionspaket_Ethnologisches_Museum_Berlin.zip',
        counts: pet?.counts || { total_extracted: 320 },
      },
    });
  }

  if (path === '/api/sources/upload' && method === 'POST') {
    return jsonResponse(
      {
        success: false,
        detail:
          'PDF/CSV-Volltext-Ingestion benoetigt das lokale Python-Backend (extract_provenance_triples.py auf Port 8088).',
      },
      501,
    );
  }

  return jsonResponse({ success: false, detail: `Statischer Endpunkt nicht verfuegbar: ${path}` }, 404);
}

window.fetch = async function patchedEchoFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  let urlObj: URL;
  try {
    urlObj = new URL(rawUrl, window.location.origin);
  } catch (_e) {
    return nativeFetch(input, init);
  }

  if (urlObj.origin !== window.location.origin || !urlObj.pathname.startsWith('/api/')) {
    return nativeFetch(input, init);
  }

  const mode = await detectBackend();
  if (mode === 'live') {
    return nativeFetch(input, init);
  }

  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return handleStaticApi(urlObj, method, init);
};
