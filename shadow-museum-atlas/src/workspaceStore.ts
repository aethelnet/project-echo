/**
 * Local-First Researcher Profile & Multi-Project Case Store for Project Echo.
 *
 * Mirrors the Daily zero-account philosophy:
 * - No central user database or cloud login required (100% GDPR-clean on static hosts).
 * - Each researcher sets their own Name & Role/Institution locally (no hardcoded demo authors).
 * - Researchers can create isolated cases ("Projects"), export/import portable `.echo.json`
 *   bundles, or merge another `.echo.json` cleanly as a toggleable source layer.
 */

export interface ResearcherProfile {
  name: string;
  role: string;
  institution: string;
}

export interface EchoProject {
  id: string;
  name: string;
  description: string;
  includeBaseBundle: boolean;
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
  author: ResearcherProfile;
  publications: any[];
  edges: any[];
  deletedEdgeSigs: string[];
  deletedPubIds: string[];
  annotations: Record<string, any[]>;
  pinnedLayout: Record<string, { x: number; y: number }>;
  pinnedPois: Array<{ id: string; label: string; desc: string }>;
}

export interface EchoProjectExportV1 {
  schema: 'project-echo-workspace/v1';
  exportedAt: string;
  exportedBy: ResearcherProfile;
  project: Omit<EchoProject, 'builtin'>;
}

export const DEFAULT_PROJECT_ID = 'cameroon_atlas';
const LS_PROFILE_KEY = 'echo_researcher_profile_v1';
const LS_PROJECTS_KEY = 'echo_projects_v1';
const LS_ACTIVE_PROJECT_KEY = 'echo_active_project_v1';

// Legacy v1 single-workspace keys (migrated automatically into cameroon_atlas once)
const LEGACY_EDGES_KEY = 'echo_static_edges_v1';
const LEGACY_DELETED_EDGES_KEY = 'echo_static_deleted_edges_v1';
const LEGACY_ANNOTATIONS_KEY = 'echo_static_annotations_v1';
const LEGACY_CUSTOM_PUBS_KEY = 'echo_static_pubs_v1';
const LEGACY_DELETED_PUBS_KEY = 'echo_static_deleted_pubs_v1';
const LEGACY_LAYOUT_KEY = 'echo_guest_layout';
const LEGACY_POIS_KEY = 'echo_pinned_pois';

const DEFAULT_CAMEROON_POIS = [
  { id: 'Ngonnso (Ahnenfigur der Nso)', label: 'Ngonnso (Ahnenfigur der Nso)', desc: 'Sakrale weibliche Ahnenfigur der Nso' },
  { id: 'Mandu Yenu (Königsthron)', label: 'Mandu Yenu (Königsthron)', desc: 'Perlenbesetzter Königsthron von Bamum' },
  { id: 'III C 15017', label: 'III C 15017', desc: 'Schlitztrommel aus Banssa / Bafut (1902)' },
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (_e) {
    return fallback;
  }
}

function writeJson(key: string, val: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_e) {
    // Ignore storage quota errors
  }
}

export function getResearcherProfile(): ResearcherProfile {
  const saved = readJson<Partial<ResearcherProfile> | null>(LS_PROFILE_KEY, null);
  return {
    name: typeof saved?.name === 'string' ? saved.name.trim() : '',
    role: typeof saved?.role === 'string' && saved.role.trim() ? saved.role.trim() : 'Provenance Research',
    institution: typeof saved?.institution === 'string' ? saved.institution.trim() : '',
  };
}

export function saveResearcherProfile(profile: Partial<ResearcherProfile>): ResearcherProfile {
  const current = getResearcherProfile();
  const next: ResearcherProfile = {
    name: typeof profile.name === 'string' ? profile.name.trim() : current.name,
    role: typeof profile.role === 'string' ? profile.role.trim() : current.role,
    institution: typeof profile.institution === 'string' ? profile.institution.trim() : current.institution,
  };
  writeJson(LS_PROFILE_KEY, next);
  return next;
}

export function formatResearcherRoleLine(profile: ResearcherProfile): string {
  const parts = [profile.role, profile.institution].map((s) => (s || '').trim()).filter(Boolean);
  return parts.join(' · ') || 'Provenance Research';
}

function makeDefaultCameroonProject(): EchoProject {
  const now = new Date().toISOString();
  const legacyEdges = readJson<any[]>(LEGACY_EDGES_KEY, []);
  const legacyDeletedEdges = readJson<string[]>(LEGACY_DELETED_EDGES_KEY, []);
  const legacyAnns = readJson<Record<string, any[]>>(LEGACY_ANNOTATIONS_KEY, {});
  const legacyPubs = readJson<any[]>(LEGACY_CUSTOM_PUBS_KEY, []);
  const legacyDeletedPubs = readJson<string[]>(LEGACY_DELETED_PUBS_KEY, []);
  const legacyLayout = readJson<Record<string, { x: number; y: number }>>(LEGACY_LAYOUT_KEY, {});
  const legacyPois = readJson<Array<{ id: string; label: string; desc: string }>>(LEGACY_POIS_KEY, DEFAULT_CAMEROON_POIS);

  return {
    id: DEFAULT_PROJECT_ID,
    name: 'Cameroon Colonial Atlas',
    description: 'Pre-indexed provenance corpus (1,400+ entities, 6,600+ edges) with local working layers.',
    includeBaseBundle: true,
    builtin: true,
    createdAt: now,
    updatedAt: now,
    author: getResearcherProfile(),
    publications: Array.isArray(legacyPubs) ? legacyPubs : [],
    edges: Array.isArray(legacyEdges) ? legacyEdges : [],
    deletedEdgeSigs: Array.isArray(legacyDeletedEdges) ? legacyDeletedEdges : [],
    deletedPubIds: Array.isArray(legacyDeletedPubs) ? legacyDeletedPubs : [],
    annotations: legacyAnns && typeof legacyAnns === 'object' ? legacyAnns : {},
    pinnedLayout: legacyLayout && typeof legacyLayout === 'object' ? legacyLayout : {},
    pinnedPois: Array.isArray(legacyPois) ? legacyPois : DEFAULT_CAMEROON_POIS,
  };
}

function ensureProjects(): EchoProject[] {
  let list = readJson<EchoProject[] | null>(LS_PROJECTS_KEY, null);
  if (!Array.isArray(list) || list.length === 0) {
    list = [makeDefaultCameroonProject()];
    writeJson(LS_PROJECTS_KEY, list);
  } else if (!list.some((p) => p.id === DEFAULT_PROJECT_ID)) {
    list = [makeDefaultCameroonProject(), ...list];
    writeJson(LS_PROJECTS_KEY, list);
  }
  return list;
}

function saveProjects(list: EchoProject[]): void {
  writeJson(LS_PROJECTS_KEY, list);
}

export function listProjects(): EchoProject[] {
  return ensureProjects();
}

export function getActiveProjectId(): string {
  const list = ensureProjects();
  const saved = localStorage.getItem(LS_ACTIVE_PROJECT_KEY);
  if (saved && list.some((p) => p.id === saved)) return saved;
  return DEFAULT_PROJECT_ID;
}

export function getActiveProject(): EchoProject {
  const list = ensureProjects();
  const activeId = getActiveProjectId();
  return list.find((p) => p.id === activeId) || list[0];
}

export function setActiveProjectId(projectId: string): EchoProject {
  const list = ensureProjects();
  const found = list.find((p) => p.id === projectId) || list[0];
  try {
    localStorage.setItem(LS_ACTIVE_PROJECT_KEY, found.id);
  } catch (_e) {}
  return found;
}

export function updateActiveProject(updater: (proj: EchoProject) => void): EchoProject {
  const list = ensureProjects();
  const activeId = getActiveProjectId();
  const idx = list.findIndex((p) => p.id === activeId);
  const targetIdx = idx >= 0 ? idx : 0;
  const clone: EchoProject = {
    ...list[targetIdx],
    publications: [...(list[targetIdx].publications || [])],
    edges: [...(list[targetIdx].edges || [])],
    deletedEdgeSigs: [...(list[targetIdx].deletedEdgeSigs || [])],
    deletedPubIds: [...(list[targetIdx].deletedPubIds || [])],
    annotations: { ...(list[targetIdx].annotations || {}) },
    pinnedLayout: { ...(list[targetIdx].pinnedLayout || {}) },
    pinnedPois: [...(list[targetIdx].pinnedPois || [])],
  };
  updater(clone);
  clone.updatedAt = new Date().toISOString();
  list[targetIdx] = clone;
  saveProjects(list);
  // Mirror layout for legacy readers when on default project
  if (clone.id === DEFAULT_PROJECT_ID) {
    writeJson(LEGACY_LAYOUT_KEY, clone.pinnedLayout);
  }
  return clone;
}

export function createProject(opts: {
  name: string;
  description?: string;
  includeBaseBundle: boolean;
}): EchoProject {
  const list = ensureProjects();
  const cleanName = opts.name.trim() || 'Untitled Provenance Case';
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28) || 'case';
  const id = `case_${slug}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const proj: EchoProject = {
    id,
    name: cleanName,
    description: (opts.description || '').trim(),
    includeBaseBundle: Boolean(opts.includeBaseBundle),
    builtin: false,
    createdAt: now,
    updatedAt: now,
    author: getResearcherProfile(),
    publications: [],
    edges: [],
    deletedEdgeSigs: [],
    deletedPubIds: [],
    annotations: {},
    pinnedLayout: {},
    pinnedPois: opts.includeBaseBundle ? [...DEFAULT_CAMEROON_POIS] : [],
  };
  list.push(proj);
  saveProjects(list);
  setActiveProjectId(proj.id);
  return proj;
}

export function deleteProject(projectId: string): EchoProject {
  if (projectId === DEFAULT_PROJECT_ID) {
    return getActiveProject();
  }
  const list = ensureProjects().filter((p) => p.id !== projectId);
  saveProjects(list);
  if (getActiveProjectId() === projectId) {
    return setActiveProjectId(DEFAULT_PROJECT_ID);
  }
  return getActiveProject();
}

export function resetActiveProjectWorkspace(): EchoProject {
  return updateActiveProject((p) => {
    p.publications = [];
    p.edges = [];
    p.deletedEdgeSigs = [];
    p.deletedPubIds = [];
    p.annotations = {};
    p.pinnedLayout = {};
    p.pinnedPois = p.includeBaseBundle ? [...DEFAULT_CAMEROON_POIS] : [];
  });
}

export function getActivePinnedLayout(): Record<string, { x: number; y: number }> {
  return getActiveProject().pinnedLayout || {};
}

export function setActivePinnedNode(nodeId: string, x: number, y: number): void {
  updateActiveProject((p) => {
    p.pinnedLayout[nodeId] = { x, y };
  });
}

export function removeActivePinnedNode(nodeId: string): void {
  updateActiveProject((p) => {
    delete p.pinnedLayout[nodeId];
  });
}

export function clearActivePinnedLayout(): void {
  updateActiveProject((p) => {
    p.pinnedLayout = {};
  });
}

export function exportProjectPayload(projectId?: string): EchoProjectExportV1 {
  const list = ensureProjects();
  const target = (projectId ? list.find((p) => p.id === projectId) : null) || getActiveProject();
  const { builtin: _b, ...cleanProject } = target;
  return {
    schema: 'project-echo-workspace/v1',
    exportedAt: new Date().toISOString(),
    exportedBy: getResearcherProfile(),
    project: cleanProject,
  };
}

function normalizeImportedProject(raw: any): Omit<EchoProject, 'builtin'> {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON file.');
  }
  const src = raw.schema === 'project-echo-workspace/v1' && raw.project ? raw.project : raw;
  if (!src || typeof src !== 'object' || (!Array.isArray(src.edges) && !Array.isArray(src.publications))) {
    throw new Error('Not a valid Project Echo (.echo.json) workspace file.');
  }
  const now = new Date().toISOString();
  return {
    id: String(src.id || `imported_${Date.now().toString(36)}`),
    name: String(src.name || 'Imported Provenance Case').trim(),
    description: String(src.description || '').trim(),
    includeBaseBundle: Boolean(src.includeBaseBundle),
    createdAt: String(src.createdAt || now),
    updatedAt: now,
    author: {
      name: String(src.author?.name || raw.exportedBy?.name || ''),
      role: String(src.author?.role || raw.exportedBy?.role || 'Provenance Research'),
      institution: String(src.author?.institution || raw.exportedBy?.institution || ''),
    },
    publications: Array.isArray(src.publications) ? src.publications : [],
    edges: Array.isArray(src.edges) ? src.edges : [],
    deletedEdgeSigs: Array.isArray(src.deletedEdgeSigs) ? src.deletedEdgeSigs : [],
    deletedPubIds: Array.isArray(src.deletedPubIds) ? src.deletedPubIds : [],
    annotations: src.annotations && typeof src.annotations === 'object' ? src.annotations : {},
    pinnedLayout: src.pinnedLayout && typeof src.pinnedLayout === 'object' ? src.pinnedLayout : {},
    pinnedPois: Array.isArray(src.pinnedPois) ? src.pinnedPois : [],
  };
}

export function importProjectAsNew(raw: any): EchoProject {
  const norm = normalizeImportedProject(raw);
  const list = ensureProjects();
  let newId = norm.id;
  if (newId === DEFAULT_PROJECT_ID || list.some((p) => p.id === newId)) {
    newId = `${norm.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}_${Date.now().toString(36)}`;
  }
  const proj: EchoProject = {
    ...norm,
    id: newId,
    builtin: false,
  };
  list.push(proj);
  saveProjects(list);
  setActiveProjectId(proj.id);
  return proj;
}

function makeEdgeSig(e: any): string {
  const s = String(typeof e.source === 'object' ? e.source?.id || e.source : e.source || '');
  const t = String(typeof e.target === 'object' ? e.target?.id || e.target : e.target || '');
  return `${s}::${String(e.type || '')}::${t}`;
}

export function mergeProjectAsLayer(raw: any): {
  addedEdges: number;
  addedPubs: number;
  addedAnnotations: number;
  layerName: string;
  layerPubId: string;
} {
  const norm = normalizeImportedProject(raw);
  const layerPubId = `layer_${Date.now().toString(36)}`;
  const layerName = norm.name || 'Imported Case Layer';
  let addedEdges = 0;
  let addedPubs = 0;
  let addedAnnotations = 0;

  updateActiveProject((active) => {
    const existingSigs = new Set((active.edges || []).map(makeEdgeSig));
    const existingPubIds = new Set((active.publications || []).map((p) => String(p.id)));
    const importedPubIdMap = new Map<string, string>();

    for (const pub of norm.publications || []) {
      const origId = String(pub.id || '');
      const targetId = existingPubIds.has(origId) || !origId ? `${layerPubId}_${origId || addedPubs}` : origId;
      importedPubIdMap.set(origId, targetId);
      active.publications.unshift({
        ...pub,
        id: targetId,
        name: `[${layerName}] ${pub.name || targetId}`,
      });
      existingPubIds.add(targetId);
      addedPubs += 1;
    }

    let orphanLayerEdges = 0;
    for (const edge of norm.edges || []) {
      const sig = makeEdgeSig(edge);
      if (existingSigs.has(sig)) continue;
      existingSigs.add(sig);
      const origPub = edge.publikation ? String(edge.publikation) : '';
      const mappedPub = origPub && importedPubIdMap.has(origPub) ? importedPubIdMap.get(origPub)! : layerPubId;
      if (mappedPub === layerPubId) orphanLayerEdges += 1;
      active.edges.push({
        ...edge,
        id: `${layerPubId}_e${addedEdges}`,
        publikation: mappedPub,
      });
      addedEdges += 1;
    }

    if (orphanLayerEdges > 0 || (addedPubs === 0 && addedEdges > 0)) {
      active.publications.unshift({
        id: layerPubId,
        name: `${layerName} (Imported Layer)`,
        kuerzel: layerName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'LAYER',
        typ: 'Imported Case Layer (.echo.json)',
        jahr: new Date().getFullYear(),
        beschreibung: norm.description || `Merged ${addedEdges} relations from "${layerName}".`,
        edge_count: orphanLayerEdges || addedEdges,
      });
      addedPubs += 1;
    }

    for (const [objId, anns] of Object.entries(norm.annotations || {})) {
      if (!Array.isArray(anns)) continue;
      const cur = active.annotations[objId] || [];
      const curIds = new Set(cur.map((a) => String(a.id)));
      const toAdd = anns.filter((a) => !curIds.has(String(a.id)));
      if (toAdd.length > 0) {
        active.annotations[objId] = [...toAdd, ...cur];
        addedAnnotations += toAdd.length;
      }
    }
  });

  return { addedEdges, addedPubs, addedAnnotations, layerName, layerPubId };
}
