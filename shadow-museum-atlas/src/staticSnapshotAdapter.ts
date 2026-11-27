/**
 * Dual-Mode Serverless Provenance Engine Adapter for Project Echo (Shadow Museum v2.4).
 *
 * - Live Backend Mode (when FastAPI on :8088 responds with JSON):
 *   All /api/* requests pass natively to Python FastAPI + Embedded/Neo4j Store.
 * - Static Snapshot Mode (automatic fallback on GitHub Pages / echo.aethelburg.network or ?mode=static):
 *   Executes graph filtering, multilingual source ingestion (DE/EN/FR), in-browser RootSIFT+RANSAC
 *   photo-chain matching, annotations, edge CRUD with tombstones, and entity-scoped restitution dossiers
 *   directly in the browser with zero dead buttons.
 */

import { getStoredLang, trStatic, relLabel } from './i18n';
import { analyzePhotoChainInBrowser } from './browserVisualForensics';
import { parseSourceTextInBrowser } from './browserSourceParser';
import {
  getActiveProject,
  updateActiveProject,
  getResearcherProfile,
  formatResearcherRoleLine,
  setActivePinnedNode,
  clearActivePinnedLayout,
} from './workspaceStore';

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

if (forceStatic) {
  (window as any).__ECHO_STATIC_MODE__ = true;
}

export function isStaticSnapshotMode(): boolean {
  return backendState === 'static' || Boolean((window as any).__ECHO_STATIC_MODE__);
}

function isStaticAuthenticated(init?: RequestInit): boolean {
  if (localStorage.getItem('echo_researcher_token')) return true;
  const hdrs: any = init?.headers;
  if (hdrs && typeof hdrs === 'object') {
    if (hdrs['X-Researcher-Key'] || hdrs['x-researcher-key']) return true;
    if (typeof hdrs.get === 'function' && hdrs.get('X-Researcher-Key')) return true;
  }
  return false;
}

function requireStaticAuth(init?: RequestInit): Response | null {
  if (isStaticAuthenticated(init)) return null;
  return jsonResponse(
    {
      success: false,
      detail: trStatic(
        'Researcher workspace mode required for write actions.',
        'Forscher-Modus für schreibende Aktionen erforderlich.',
        "Mode chercheur requis pour les actions d'écriture.",
      ),
    },
    401,
  );
}

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
          (window as any).__ECHO_STATIC_MODE__ = false;
          return 'live';
        }
      } catch (_e) {
        // Offline or static host without backend
      }
      backendState = 'static';
      (window as any).__ECHO_STATIC_MODE__ = true;
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
        throw new Error(
          trStatic(
            `Could not load static provenance snapshot (HTTP ${res.status}).`,
            `Konnte statischen Provenienz-Snapshot nicht laden (HTTP ${res.status}).`,
            `Impossible de charger l'instantané statique de provenance (HTTP ${res.status}).`,
          ),
        );
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
        throw new Error(
          trStatic(
            `Could not load static photo-series reference (HTTP ${res.status}).`,
            `Konnte statische Bildreihen-Referenz nicht laden (HTTP ${res.status}).`,
            `Impossible de charger la série photographique de référence statique (HTTP ${res.status}).`,
          ),
        );
      }
      return res.json();
    });
  }
  return visualDemoPromise;
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

function edgeSig(source: any, target: any, type: any): string {
  const s = String(typeof source === 'object' ? source?.id || source : source || '');
  const t = String(typeof target === 'object' ? target?.id || target : target || '');
  return `${s}::${String(type || '')}::${t}`;
}

function deterministicRingPos(id: string, type: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) * (Math.PI / 1800);
  const r = type === 'Institution' ? 110 : type === 'Akteur' ? 210 : 300;
  return { x: Math.round(Math.cos(angle) * r), y: Math.round(Math.sin(angle) * r) };
}

function buildEffectiveCorpus(bundle: StaticBundle) {
  const project = getActiveProject();
  const includeBase = project.includeBaseBundle;
  const customEdges = project.edges || [];
  const deletedEdgeSigs = new Set(project.deletedEdgeSigs || []);
  const deletedPubIds = new Set(project.deletedPubIds || []);

  const allNodesMap = new Map<string, any>();
  if (includeBase) {
    for (const n of bundle.graph.nodes) {
      allNodesMap.set(String(n.id), { ...n });
    }
  }

  for (const ce of customEdges) {
    if (ce.source && !allNodesMap.has(String(ce.source))) {
      const sType = ce.source_type || 'Subjekt';
      const pos = deterministicRingPos(String(ce.source), sType);
      allNodesMap.set(String(ce.source), {
        id: String(ce.source),
        label: ce.source_label || String(ce.source),
        type: sType,
        desc: ce.source_desc || trStatic('Case Node (Local Workspace)', 'Fall-Knoten (Lokales Projekt)', 'Nœud de dossier (Espace local)'),
        contested: Boolean(ce.kollision),
        x: pos.x,
        y: pos.y,
      });
    }
    if (ce.target && !allNodesMap.has(String(ce.target))) {
      const tType = ce.target_type || 'Subjekt';
      const pos = deterministicRingPos(String(ce.target), tType);
      allNodesMap.set(String(ce.target), {
        id: String(ce.target),
        label: ce.target_label || String(ce.target),
        type: tType,
        desc: ce.target_desc || trStatic('Case Node (Local Workspace)', 'Fall-Knoten (Lokales Projekt)', 'Nœud de dossier (Espace local)'),
        contested: Boolean(ce.kollision),
        x: pos.x,
        y: pos.y,
      });
    }
  }

  let links = [
    ...(includeBase ? bundle.graph.links.map((l) => ({ ...l })) : []),
    ...customEdges.map((l) => ({ ...l })),
  ];

  if (deletedEdgeSigs.size > 0) {
    links = links.filter((l) => !deletedEdgeSigs.has(edgeSig(l.source, l.target, l.type)));
  }
  if (deletedPubIds.size > 0) {
    links = links.filter((l) => !l.publikation || !deletedPubIds.has(String(l.publikation)));
  }

  // Flag contested objects dynamically across project edges (RAUBTE/ENTEIGNETE vs SCHENKTE/VERKAUFTE_AN)
  const lootedSet = new Set<string>();
  const donatedSet = new Set<string>();
  for (const l of links) {
    const s = String(typeof l.source === 'object' ? l.source.id : l.source);
    const t = String(typeof l.target === 'object' ? l.target.id : l.target);
    const ty = String(l.type || '');
    if (ty === 'RAUBTE' || ty === 'ENTEIGNETE' || ty === 'EIGNETE_SICH_AN') {
      lootedSet.add(s);
      lootedSet.add(t);
    }
    if (ty === 'SCHENKTE' || ty === 'VERKAUFTE_AN' || ty === 'UEBERGAB_AN') {
      donatedSet.add(s);
      donatedSet.add(t);
    }
  }
  for (const [id, n] of allNodesMap.entries()) {
    if ((n.type === 'Subjekt' || n.type === 'Objekt') && lootedSet.has(id) && donatedSet.has(id)) {
      n.contested = true;
    }
  }

  const pubs = [
    ...(includeBase ? bundle.publications?.publications || [] : []),
    ...(project.publications || []),
  ].filter((p) => !deletedPubIds.has(String(p.id)));

  return { project, includeBase, allNodesMap, links, pubs };
}

function computeDynamicProjectAnalytics(bundle: StaticBundle) {
  const { includeBase, allNodesMap, links, pubs } = buildEffectiveCorpus(bundle);
  const usedIds = new Set<string>();
  for (const l of links) {
    usedIds.add(String(typeof l.source === 'object' ? l.source.id : l.source));
    usedIds.add(String(typeof l.target === 'object' ? l.target.id : l.target));
  }
  const nodes = Array.from(usedIds).map((id) => allNodesMap.get(id)).filter(Boolean);

  let subjekte = 0;
  let akteure = 0;
  let institutionen = 0;
  for (const n of nodes) {
    if (n.type === 'Akteur') akteure += 1;
    else if (n.type === 'Institution') institutionen += 1;
    else subjekte += 1;
  }

  let raub_kanten = 0;
  let schenk_kanten = 0;
  let verdacht_kanten = 0;
  const actorCounts = new Map<string, { name: string; count: number; raub: number }>();
  const depotCounts = new Map<string, { name: string; count: number; contested: number }>();
  const edgesByObj = new Map<string, any[]>();

  for (const l of links) {
    const ty = String(l.type || '');
    const s = String(typeof l.source === 'object' ? l.source.id : l.source);
    const t = String(typeof l.target === 'object' ? l.target.id : l.target);
    const sn = allNodesMap.get(s);
    const tn = allNodesMap.get(t);
    const isLoot = ty === 'RAUBTE' || ty === 'ENTEIGNETE' || ty === 'EIGNETE_SICH_AN';
    const isGift = ty === 'SCHENKTE' || ty === 'VERKAUFTE_AN' || ty === 'UEBERGAB_AN';
    if (isLoot) raub_kanten += 1;
    if (isGift) schenk_kanten += 1;
    if (ty === 'VERDACHT_AUF') verdacht_kanten += 1;

    if (sn?.type === 'Akteur') {
      const prev = actorCounts.get(s) || { name: sn.label || s, count: 0, raub: 0 };
      prev.count += 1;
      if (isLoot) prev.raub += 1;
      actorCounts.set(s, prev);
    }
    if (tn?.type === 'Akteur') {
      const prev = actorCounts.get(t) || { name: tn.label || t, count: 0, raub: 0 };
      prev.count += 1;
      if (isLoot) prev.raub += 1;
      actorCounts.set(t, prev);
    }
    if (tn?.type === 'Institution') {
      const prev = depotCounts.get(t) || { name: tn.label || t, count: 0, contested: 0 };
      prev.count += 1;
      if (sn?.contested) prev.contested += 1;
      depotCounts.set(t, prev);
    }

    if (sn && (sn.type === 'Subjekt' || sn.type === 'Objekt')) {
      const arr = edgesByObj.get(s) || [];
      arr.push(l);
      edgesByObj.set(s, arr);
    }
    if (tn && (tn.type === 'Subjekt' || tn.type === 'Objekt')) {
      const arr = edgesByObj.get(t) || [];
      arr.push(l);
      edgesByObj.set(t, arr);
    }
  }

  const contestedItems: any[] = [];
  const gapItems: any[] = [];
  const ghostItems: any[] = [];
  for (const [objId, objEdges] of edgesByObj.entries()) {
    const n = allNodesMap.get(objId);
    const hasLoot = objEdges.some((e) => ['RAUBTE', 'ENTEIGNETE', 'EIGNETE_SICH_AN'].includes(e.type));
    const hasGift = objEdges.some((e) => ['SCHENKTE', 'VERKAUFTE_AN', 'UEBERGAB_AN'].includes(e.type));
    const hasDepot = objEdges.some((e) => e.type === 'LAGERT_IN');
    if (hasLoot && hasGift) {
      contestedItems.push({
        id: objId,
        label: n?.label || objId,
        desc: n?.desc || '',
        conflict_count: objEdges.length,
        claims: objEdges.map((e) => ({ type: e.type, beleg: e.beleg || '', jahr: e.jahr || '' })),
      });
    }
    if (hasDepot && !hasLoot && !hasGift) {
      gapItems.push({ id: objId, label: n?.label || objId, desc: n?.desc || '' });
    }
    if (hasLoot && !hasDepot) {
      ghostItems.push({ id: objId, label: n?.label || objId, desc: n?.desc || '' });
    }
  }

  const actors = Array.from(actorCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((a) => ({ id: a.name, name: a.name, edge_count: a.count, raub_count: a.raub }));
  const institutions = Array.from(depotCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ id: d.name, name: d.name, edge_count: d.count, contested_count: d.contested }));

  return {
    includeBase,
    stats: {
      success: true,
      subjekte,
      objekte: subjekte,
      akteure,
      institutionen,
      publikationen: pubs.length,
      raub_kanten,
      schenk_kanten,
      verdacht_kanten,
      gesamt_kanten: links.length,
      contested_objekte: contestedItems.length,
      provenienz_luecken: gapItems.length,
    },
    entities: { success: true, actors, institutions },
    contested: { success: true, total: contestedItems.length, items: contestedItems },
    gaps: { success: true, total: gapItems.length, gap_ids: gapItems.map((g) => g.id), items: gapItems },
    ghosts: { success: true, total: ghostItems.length, ghost_ids: ghostItems.map((g) => g.id), items: ghostItems },
    suspicions: { success: true, total: 0, suspicions: [] },
  };
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

  const { allNodesMap, links: initialLinks } = buildEffectiveCorpus(bundle);
  let links = initialLinks;

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
  const lang = getStoredLang();
  const tr = (en: string, de: string, fr: string) => trStatic(en, de, fr, lang);
  const { allNodesMap, links: allLinks } = buildEffectiveCorpus(bundle);
  const node = allNodesMap.get(invNumber) || Array.from(allNodesMap.values()).find((n) => String(n.label) === invNumber);
  const edges = allLinks.filter((l) => String(l.source) === invNumber || String(l.target) === invNumber);

  const edgeRows = edges
    .map(
      (e) => `<tr>
        <td>${e.jahr || tr('n.d.', 'o. J.', 's.d.')}</td>
        <td><strong>${relLabel(e.type, lang)}</strong></td>
        <td>${e.source_label || e.source} &rarr; ${e.target_label || e.target}</td>
        <td>${e.expedition || e.beleg || '-'}</td>
        <td>${e.zitat || e.begruendung || e.behauptung || '-'}</td>
      </tr>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${tr('Forensic Restitution Evidence Sheet', 'Forensisches Restitutions-Beweisblatt', 'Fiche forensique de preuve pour restitution')} — ${invNumber}</title>
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
  <h1>${tr(
    'Project Echo // Forensic Provenance &amp; Restitution Dossier',
    'Project Echo // Forensisches Provenienz- &amp; Restitutionsdossier',
    'Project Echo // Dossier forensique de provenance &amp; de restitution',
  )}</h1>
  <div class="meta">
    <div><strong>${tr('INVENTORY NUMBER', 'INVENTARNUMMER', "NUMÉRO D'INVENTAIRE")}:</strong> ${invNumber}</div>
    <div><strong>${tr('DESIGNATION', 'BEZEICHNUNG', 'DÉSIGNATION')}:</strong> ${node?.desc || node?.label || tr('Colonial Cultural Heritage Object', 'Koloniales Kulturgut', 'Bien culturel issu de contexte colonial')}</div>
    <div><strong>${tr('CONTESTED STATUS', 'CONTESTED-STATUS', 'STATUT DE CONTESTATION')}:</strong> ${
      node?.contested
        ? tr(
            'CONTESTED (Hague Convention IV Arts. 46 / 56 Review Case)',
            'KONFLIKTBEHAFTET (HLKO Art. 46 / Art. 56 Prueffall)',
            'CONTESTÉ (Cas d’examen Convention de La Haye IV art. 46 / 56)',
          )
        : tr('Recorded Collection Holding', 'Erfasster Sammlungsbestand', 'Bien recensé en collection')
    }</div>
    <div><strong>${tr('SOURCE', 'QUELLE', 'SOURCE')}:</strong> Serverless Provenance Snapshot (${bundle.generated_at})</div>
  </div>
  <h2>${tr('Documented Provenance &amp; Event Edges', 'Dokumentierte Provenienz- &amp; Ereigniskanten', 'Arêtes documentées de provenance et d’événements')} (${edges.length})</h2>
  <table>
    <thead>
      <tr><th>${tr('Year', 'Jahr', 'Année')}</th><th>${tr('Relation', 'Relation', 'Relation')}</th><th>${tr('Actors / Nodes', 'Akteure / Knoten', 'Acteurs / Nœuds')}</th><th>${tr('Context / Citation', 'Kontext / Beleg', 'Contexte / Référence')}</th><th>${tr('Primary Evidence', 'Quellenbefund', 'Preuve primaire')}</th></tr>
    </thead>
    <tbody>${edgeRows || `<tr><td colspan="5">${tr('No direct edges recorded in snapshot.', 'Keine direkten Kanten im Snapshot verzeichnet.', 'Aucune arête directe enregistrée dans cet instantané.')}</td></tr>`}</tbody>
  </table>
  <div class="foot">
    ${tr(
      'Note: Print-ready HTML evidence sheet generated in static serverless mode (Browser Ctrl+P -&gt; Save as PDF). For the four flagship reference cases (AS 1574, 033513, C 20681, InvNr. 7087), pre-rendered binary PyMuPDF A4 PDF dossiers are served directly.',
      'Hinweis: Im statischen GitHub-Pages-Modus generiertes druckfaehiges HTML-Beweisblatt (Browser Strg+P -&gt; Als PDF speichern). Fuer die vier Referenz-Leitfaelle (AS 1574, 033513, C 20681, InvNr. 7087) liegt das binaere PyMuPDF-DIN-A4-Dossier direkt vor.',
      'Remarque : Fiche HTML imprimable générée en mode statique sans serveur (Ctrl+P -&gt; Enregistrer en PDF). Pour les quatre dossiers phares (AS 1574, 033513, C 20681, InvNr. 7087), les dossiers PDF A4 PyMuPDF précalculés sont fournis directement.',
    )}
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safeInv = invNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    url: URL.createObjectURL(blob),
    filename: `${tr('Restitution_Dossier', 'Restitutionsdossier', 'Dossier_Restitution')}_${safeInv}.html`,
  };
}

function buildDynamicBatchHtmlUrl(
  bundle: StaticBundle,
  entityType: string,
  entityName: string,
  explicitInvs?: string[] | null,
): { url: string; filename: string; count: number } {
  const lang = getStoredLang();
  const tr = (en: string, de: string, fr: string) => trStatic(en, de, fr, lang);
  const q = String(entityName || '').toLowerCase();

  let matchedLinks: any[] = [];
  if (Array.isArray(explicitInvs) && explicitInvs.length > 0) {
    const invSet = new Set(explicitInvs.map((x) => String(x)));
    matchedLinks = bundle.graph.links.filter(
      (l) => invSet.has(String(l.source)) || invSet.has(String(l.target)),
    );
  } else {
    matchedLinks = bundle.graph.links.filter((l) => {
      const s = String(l.source_label || l.source || '').toLowerCase();
      const t = String(l.target_label || l.target || '').toLowerCase();
      return s === q || t === q || s.includes(q) || t.includes(q);
    });
  }

  const uniqueObjects = new Set<string>();
  for (const l of matchedLinks) {
    if (l.source_type === 'Subjekt' || l.source_inv) uniqueObjects.add(String(l.source));
    if (l.target_type === 'Subjekt' || l.target_inv) uniqueObjects.add(String(l.target));
  }

  const rows = matchedLinks
    .slice(0, 400)
    .map(
      (e) => `<tr>
        <td>${e.jahr || tr('n.d.', 'o. J.', 's.d.')}</td>
        <td><strong>${relLabel(e.type, lang)}</strong></td>
        <td>${e.source_label || e.source} &rarr; ${e.target_label || e.target}</td>
        <td>${e.beleg || e.expedition || '-'}</td>
      </tr>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${tr('Forensic Batch Dossier', 'Forensisches Sammeldossier', 'Dossier forensique groupé')} — ${entityName}</title>
<style>
  body { font-family: Georgia, serif; max-width: 940px; margin: 36px auto; color: #111; line-height: 1.45; padding: 0 24px; }
  h1 { font-size: 20px; border-bottom: 3px solid #111; padding-bottom: 8px; text-transform: uppercase; }
  .meta { background: #f5f5f4; padding: 12px 16px; border-left: 4px solid #b91c1c; margin: 16px 0; font-family: monospace; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
  th, td { border: 1px solid #d6d3d1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #1c1917; color: #fafaf9; font-family: monospace; text-transform: uppercase; font-size: 10px; }
</style>
</head>
<body>
  <h1>Project Echo // ${tr('Forensic Batch Evidence Compilation', 'Forensische Sammel-Beweisakte', 'Compilation forensique de preuves')}</h1>
  <div class="meta">
    <div><strong>${tr('SCOPE', 'BEREICH', 'PÉRIMÈTRE')}:</strong> ${entityType.toUpperCase()} — ${entityName}</div>
    <div><strong>${tr('IDENTIFIED OBJECTS', 'ERFASSTE OBJEKTE', 'OBJETS IDENTIFIÉS')}:</strong> ${uniqueObjects.size}</div>
    <div><strong>${tr('DOCUMENTED EDGES', 'DOKUMENTIERTE KANTEN', 'ARÊTES DOCUMENTÉES')}:</strong> ${matchedLinks.length}</div>
    <div><strong>${tr('SNAPSHOT', 'SNAPSHOT', 'INSTANTANÉ')}:</strong> ${bundle.generated_at}</div>
  </div>
  <table>
    <thead>
      <tr><th>${tr('Year', 'Jahr', 'Année')}</th><th>${tr('Relation', 'Relation', 'Relation')}</th><th>${tr('Path', 'Pfad', 'Lien')}</th><th>${tr('Primary Citation', 'Primärbeleg', 'Source primaire')}</th></tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="4">${tr('No matching edges found.', 'Keine passenden Kanten gefunden.', 'Aucune arête correspondante.')}</td></tr>`}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safeName = String(entityName || 'batch').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return {
    url: URL.createObjectURL(blob),
    filename: `${tr('Batch_Dossier', 'Sammeldossier', 'Dossier_Groupe')}_${safeName}.html`,
    count: Math.max(uniqueObjects.size, explicitInvs?.length || 0),
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
      note: trStatic(
        'Local browser researcher session enabled (localStorage).',
        'Lokale Browser-Forschersitzung aktiviert (localStorage).',
        'Session chercheur locale activée dans le navigateur (localStorage).',
      ),
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
    const hasCustomRoi = frames.some((f) => f.roi && (f.roi.w < 0.99 || f.roi.h < 0.99));
    const onlyDemoFrames =
      !hasCustomRoi &&
      frames.length === (demo.frames_with_previews || []).length &&
      frames.every((f) => allDemoIds.has(f.id));
    if (onlyDemoFrames) {
      return jsonResponse(demo);
    }
    try {
      const result = await analyzePhotoChainInBrowser(frames);
      return jsonResponse(result);
    } catch (err: any) {
      return jsonResponse(
        {
          success: false,
          detail: err?.message || trStatic('In-browser visual matching failed.', 'Browser-Bildabgleich fehlgeschlagen.', "Échec de l'appariement visuel dans le navigateur."),
        },
        500,
      );
    }
  }

  if (path === '/api/visual/commit_chain' && method === 'POST') {
    const authErr = requireStaticAuth(init);
    if (authErr) return authErr;
    const body = await parseBody(init);
    const prof = getResearcherProfile();
    const invId = body.inventarnummer || body.subject_id || '033513';
    const newEdge = {
      id: `vis_${Date.now()}`,
      source: invId,
      source_label: invId,
      source_type: 'Subjekt',
      source_desc: body.bezeichnung || trStatic('Visually Matched Object', 'Visuell identifiziertes Objekt', 'Objet identifié visuellement'),
      target: body.institution || body.target_node || 'Ethnologisches Museum Berlin',
      target_label: body.institution || body.target_node || 'Ethnologisches Museum Berlin',
      target_type: 'Institution',
      type: 'VISUELL_IDENTIFIZIERT_MIT',
      jahr: '1902-2024',
      beleg:
        body.evidence_summary ||
        trStatic(
          `RootSIFT+RANSAC Photo-Chain (${body.inliers || 29} inliers, RMSE ${body.rmse_px || 0.78} px)`,
          `RootSIFT+RANSAC Foto-Kette (${body.inliers || 29} Inliers, RMSE ${body.rmse_px || 0.78} px)`,
          `Chaîne photo RootSIFT+RANSAC (${body.inliers || 29} inliers, RMSE ${body.rmse_px || 0.78} px)`,
        ),
      publikation: 'visual_forensics_session',
      created_by: prof.name || undefined,
      confidence: body.confidence || 0.96,
      begruendung:
        body.notes ||
        trStatic(
          'Geometrically verified surface correspondence.',
          'Geometrisch verifizierte Oberflaechen-Korrespondenz.',
          'Correspondance géométrique de surface vérifiée.',
        ),
    };
    updateActiveProject((p) => {
      p.edges.push(newEdge);
    });
    return jsonResponse({
      success: true,
      inventarnummer: invId,
      triples_committed: 1,
      edge: newEdge,
      message: trStatic(
        'Visual evidence edge saved in active project.',
        'Visuelle Beweiskante im aktiven Projekt gespeichert.',
        'Arête de preuve visuelle enregistrée dans le projet actif.',
      ),
    });
  }

  const bundle = await loadBundle();
  const activeProj = getActiveProject();

  if (path === '/api/publications' && method === 'GET') {
    const { pubs } = buildEffectiveCorpus(bundle);
    return jsonResponse({ success: true, publications: pubs, total: pubs.length });
  }

  if (path.startsWith('/api/publications/') && method === 'DELETE') {
    const authErr = requireStaticAuth(init);
    if (authErr) return authErr;
    const pubId = decodeURIComponent(path.slice('/api/publications/'.length));
    updateActiveProject((p) => {
      p.publications = p.publications.filter((pub) => String(pub.id) !== pubId);
      p.edges = p.edges.filter((e) => String(e.publikation) !== pubId);
      if (!p.deletedPubIds.includes(pubId)) p.deletedPubIds.push(pubId);
    });

    return jsonResponse({
      success: true,
      message: trStatic(
        `Source '${pubId}' removed from active project.`,
        `Quelle '${pubId}' aus dem aktiven Projekt entfernt.`,
        `Source « ${pubId} » retirée du projet actif.`,
      ),
    });
  }

  if (!activeProj.includeBaseBundle) {
    const dyn = computeDynamicProjectAnalytics(bundle);
    if (path === '/api/filters/entities' && method === 'GET') return jsonResponse(dyn.entities);
    if (path === '/api/stats' && method === 'GET') return jsonResponse(dyn.stats);
    if (path === '/api/ghosts' && method === 'GET') return jsonResponse(dyn.ghosts);
    if (path === '/api/contested' && method === 'GET') return jsonResponse(dyn.contested);
    if (path === '/api/gaps' && method === 'GET') return jsonResponse(dyn.gaps);
    if (path === '/api/suspicions' && method === 'GET') return jsonResponse(dyn.suspicions);
    if (path === '/api/geodata' && method === 'GET') return jsonResponse({ success: true, routes: [], locations: [], events: [] });
  } else {
    const hasCustomDeltas =
      (activeProj.edges?.length || 0) > 0 ||
      (activeProj.publications?.length || 0) > 0 ||
      (activeProj.deletedEdgeSigs?.length || 0) > 0 ||
      (activeProj.deletedPubIds?.length || 0) > 0;
    if (hasCustomDeltas && path === '/api/stats' && method === 'GET') {
      return jsonResponse(computeDynamicProjectAnalytics(bundle).stats);
    }
    if (path === '/api/filters/entities' && method === 'GET') return jsonResponse(bundle.filters_entities);
    if (path === '/api/stats' && method === 'GET') return jsonResponse(bundle.stats);
    if (path === '/api/ghosts' && method === 'GET') return jsonResponse(bundle.ghosts);
    if (path === '/api/contested' && method === 'GET') return jsonResponse(bundle.contested);
    if (path === '/api/gaps' && method === 'GET') return jsonResponse(bundle.gaps);
    if (path === '/api/suspicions' && method === 'GET') return jsonResponse(bundle.suspicions);
    if (path === '/api/geodata' && method === 'GET') return jsonResponse(bundle.geodata);
  }

  if (path === '/api/graph' && method === 'GET') {
    return jsonResponse(filterGraph(bundle, urlObj.searchParams));
  }

  if (path.startsWith('/api/actors/') && path.endsWith('/summary')) {
    const rawName = decodeURIComponent(path.slice('/api/actors/'.length, -'/summary'.length));
    const found =
      (activeProj.includeBaseBundle && (bundle.actor_summaries[rawName] || bundle.actor_summaries[rawName.toLowerCase()])) || {
        success: true,
        summary: {
          name: rawName,
          rolle: trStatic('Historical Actor', 'Historischer Akteur', 'Acteur historique'),
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
      (activeProj.includeBaseBundle && (bundle.institution_summaries[rawName] || bundle.institution_summaries[rawName.toLowerCase()])) || {
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
      clearActivePinnedLayout();
      return jsonResponse({ success: true, reset: true });
    }
    const body = await parseBody(init);
    if (body && body.positions) {
      updateActiveProject((p) => {
        p.pinnedLayout = { ...p.pinnedLayout, ...body.positions };
      });
    } else if (body && body.id && typeof body.x === 'number' && typeof body.y === 'number') {
      setActivePinnedNode(body.id, body.x, body.y);
    } else if (body && typeof body === 'object') {
      updateActiveProject((p) => {
        for (const [k, v] of Object.entries(body)) {
          if (v && typeof (v as any).x === 'number' && typeof (v as any).y === 'number') {
            p.pinnedLayout[k] = { x: (v as any).x, y: (v as any).y };
          }
        }
      });
    }
    return jsonResponse({ success: true });
  }

  if (path === '/api/graph/edges') {
    const authErr = requireStaticAuth(init);
    if (authErr) return authErr;
    const body = await parseBody(init);
    if (method === 'POST') {
      const prof = getResearcherProfile();
      const edge = {
        id: `edge_${Date.now()}`,
        source: body.source_id || body.source,
        target: body.target_id || body.target,
        type: body.rel_type || body.type,
        beleg: body.props?.beleg || body.beleg,
        publikation: body.props?.publikation || body.publikation || 'manual_session',
        created_by: body.props?.created_by || prof.name || undefined,
        created_role: body.props?.created_role || formatResearcherRoleLine(prof),
        ...body,
      };
      updateActiveProject((p) => {
        p.edges.push(edge);
      });
      return jsonResponse({ success: true, edge });
    }
    if (method === 'DELETE') {
      const s = body.source_id || body.source;
      const t = body.target_id || body.target;
      const r = body.rel_type || body.type;
      const sig = edgeSig(s, t, r);
      updateActiveProject((p) => {
        p.edges = p.edges.filter((e) => edgeSig(e.source, e.target, e.type) !== sig);
        if (!p.deletedEdgeSigs.includes(sig)) p.deletedEdgeSigs.push(sig);
      });
      return jsonResponse({ success: true });
    }
  }

  if (path.startsWith('/api/objects/') && path.endsWith('/annotations')) {
    const objId = decodeURIComponent(path.slice('/api/objects/'.length, -'/annotations'.length));
    if (method === 'GET') {
      const store = activeProj.annotations || {};
      return jsonResponse({ success: true, annotations: store[objId] || [] });
    }
    if (method === 'POST') {
      const authErr = requireStaticAuth(init);
      if (authErr) return authErr;
      const body = await parseBody(init);
      const prof = getResearcherProfile();
      const annId = `ann_${Date.now()}`;
      const entry = {
        id: annId,
        object_id: objId,
        author: body.author || prof.name || trStatic('Researcher', 'Forschung', 'Chercheur·se'),
        role: body.role || formatResearcherRoleLine(prof),
        tags: body.tags || [],
        notes: body.notes || '',
        confidence: body.confidence ?? 'HIGH',
        created_at: new Date().toISOString(),
      };
      updateActiveProject((p) => {
        p.annotations[objId] = [entry, ...(p.annotations[objId] || [])];
      });
      return jsonResponse({ success: true, annotation_id: annId, annotation: entry });
    }
  }

  if (path.startsWith('/api/annotations/') && method === 'DELETE') {
    const authErr = requireStaticAuth(init);
    if (authErr) return authErr;
    const annId = decodeURIComponent(path.slice('/api/annotations/'.length));
    updateActiveProject((p) => {
      for (const k of Object.keys(p.annotations)) {
        p.annotations[k] = (p.annotations[k] || []).filter((a) => a.id !== annId);
      }
    });
    return jsonResponse({ success: true });
  }

  if (path === '/api/dossier/generate' && method === 'POST') {
    const body = await parseBody(init);
    const inv = String(body.inventarnummer || '').trim();
    const prebuiltUrl = bundle.flagship_dossiers?.[inv];
    if (prebuiltUrl) {
      const fname = prebuiltUrl.split('/').pop() || `Restitution_Dossier_${inv}.pdf`;
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
    const body = await parseBody(init);
    const entityType = String(body.entity_type || 'institution');
    const entityName = String(body.entity_name || 'Collection');
    const explicitInvs = Array.isArray(body.inventarnummern) ? body.inventarnummern : null;

    if (
      entityType === 'institution' &&
      entityName.toLowerCase().includes('ethnologisches museum berlin') &&
      bundle.flagship_petition
    ) {
      return jsonResponse({
        success: true,
        dossiers_packaged: bundle.flagship_petition.counts?.total_extracted || 320,
        filename: bundle.flagship_petition.zip_filename,
        download_url: bundle.flagship_petition.download_zip_url,
      });
    }

    const batchDoc = buildDynamicBatchHtmlUrl(bundle, entityType, entityName, explicitInvs);
    return jsonResponse({
      success: true,
      dossiers_packaged: batchDoc.count,
      filename: batchDoc.filename,
      download_url: batchDoc.url,
    });
  }

  if (path === '/api/petition/generate_llm' && method === 'POST') {
    return jsonResponse({
      success: true,
      job_id: 'static_hlko_job_01',
      step: trStatic(
        'Loading precomputed Hague Convention (HLKO) restitution package (Arts. 46 / 56)...',
        'Lade vorberechnetes HLKO-Restitutionspaket (Art. 46 / Art. 56)...',
        'Chargement du dossier précalculé Convention de La Haye (art. 46 / 56)...',
      ),
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
    const authErr = requireStaticAuth(init);
    if (authErr) return authErr;
    let filename = 'Browser_Excerpt.txt';
    let rawText = '';

    if (init?.body instanceof FormData) {
      const file = init.body.get('file') as File | null;
      if (file) {
        filename = file.name || filename;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        if (ext === 'txt' || ext === 'csv' || ext === 'tsv' || ext === 'md') {
          rawText = await file.text();
        } else {
          return jsonResponse(
            {
              success: false,
              detail: trStatic(
                'Binary PDF/XLSX extraction requires the local Python engine (port 8088). In browser demo mode you can upload .txt/.csv directly or paste text inside the [DOCUMENTS] tab.',
                'Binäre PDF/XLSX-Extraktion benötigt das lokale Python-Backend (Port 8088). Im Browser-Demo-Modus funktionieren .txt/.csv-Uploads direkt oder Text-Einfügen im Tab [DOKUMENTE].',
                "L'extraction binaire PDF/XLSX nécessite le backend local Python (port 8088). En mode démo navigateur, importez un fichier .txt/.csv ou collez votre texte dans l'onglet [DOCUMENTS].",
              ),
            },
            400,
          );
        }
      }
    } else {
      const body = await parseBody(init);
      filename = String(body.filename || filename);
      rawText = String(body.text || '');
    }

    const parsed = parseSourceTextInBrowser(rawText, filename);
    const pubId = `browser_${Date.now().toString(36)}`;
    const kuerzel = filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 10).toUpperCase() || 'UPLOAD';

    const newEdges = parsed.triples.map((trItem, i) => ({
      id: `${pubId}_e${i}`,
      ...trItem,
      publikation: pubId,
    }));

    updateActiveProject((p) => {
      p.edges.push(...newEdges);
      p.publications.unshift({
        id: pubId,
        name: filename,
        kuerzel,
        typ: trStatic('Browser Session Ingestion', 'Browser-Sitzung (Ingestion)', 'Ingestion locale (Navigateur)'),
        jahr: new Date().getFullYear(),
        beschreibung: trStatic(
          `Extracted ${newEdges.length} provenance relations (${parsed.inventories.length} objects, ${parsed.collisions} collisions).`,
          `${newEdges.length} Provenienz-Relationen extrahiert (${parsed.inventories.length} Objekte, ${parsed.collisions} Kollisionen).`,
          `${newEdges.length} relations de provenance extraites (${parsed.inventories.length} objets, ${parsed.collisions} collisions).`,
        ),
        edge_count: newEdges.length,
        source_text: rawText,
      });
    });

    return jsonResponse({
      success: true,
      filename,
      publication_id: pubId,
      triples_extracted: newEdges.length,
      message: trStatic(
        `Source '${filename}' processed in browser: ${newEdges.length} relations injected.`,
        `Quelle '${filename}' im Browser verarbeitet: ${newEdges.length} Relationen injiziert.`,
        `Source « ${filename} » traitée dans le navigateur : ${newEdges.length} relations injectées.`,
      ),
    });
  }

  return jsonResponse(
    {
      success: false,
      detail: trStatic(
        `Static endpoint unavailable: ${path}`,
        `Statischer Endpunkt nicht verfuegbar: ${path}`,
        `Point de terminaison statique indisponible : ${path}`,
      ),
    },
    404,
  );
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
