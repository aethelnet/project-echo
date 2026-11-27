// @ts-nocheck
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import GeodataMap from './GeodataMap';
import VisualForensicsView from './VisualForensicsView';
import DocumentsView from './DocumentsView';
import { isStaticSnapshotMode } from './staticSnapshotAdapter';
import { useLang, relLabel, nodeTypeLabel, localizePoiDesc } from './i18n';

type MetricFilter = null | 'subjekte' | 'raub' | 'schenkung' | 'dissonanz' | 'verdacht' | 'akteure' | 'depots' | 'luecken';

export default function App() {
  const { lang, setLang, cycleLang, t } = useLang();
  const fgRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 900, height: 650 });
  
  // Graph & Data States
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector & Selection States
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [hoveredLink, setHoveredLink] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // View Mode: 'graph' | 'map' | 'visual' | 'docs'
  const [viewMode, setViewMode] = useState<'graph' | 'map' | 'visual' | 'docs'>('graph');
  const [selectedRoute, setSelectedRoute] = useState<any | null>(null);

  // Interactive Metric Toggle (Oben Links)
  const [activeMetricFilter, setActiveMetricFilter] = useState<MetricFilter>(null);

  // Ghost Mode (Verschollene Raubkunst ohne Depotnachweis)
  const [ghostMode, setGhostMode] = useState(false);
  const [ghostIds, setGhostIds] = useState<Set<string>>(new Set());

  // Mobile Navigation & Entity Sidebar Drawers
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Contested Mode (Multigraph Kollisionen: Schenkung vs. Raub)
  const [contestedIds, setContestedIds] = useState<Set<string>>(new Set());
  const [contestedMap, setContestedMap] = useState<Record<string, any>>({});

  // Provenienzlücken (Chain of Custody gerissen: LAGERT_IN ohne Akteur)
  const [gapIds, setGapIds] = useState<Set<string>>(new Set());
  const [gapItems, setGapItems] = useState<any[]>([]);
  const [gapFilter, setGapFilter] = useState<'all' | 'suspicion' | 'unresolved'>('all');
  const [copySuccess, setCopySuccess] = useState(false);

  // Autonomous Provenance Suspicions (36+ probabilistische Kanten via Cameroon Expeditions Matrix)
  const [suspicions, setSuspicions] = useState<any[]>([]);
  const [suspicionMap, setSuspicionMap] = useState<Record<string, any>>({});
  const [suspicionIds, setSuspicionIds] = useState<Set<string>>(new Set());

  // Kiosk Mode (Museum Auto-Pilot)
  const [kioskMode, setKioskMode] = useState(false);
  const [kioskTargetId, setKioskTargetId] = useState<string | null>(null);

  // Publications Filter States
  const [publications, setPublications] = useState<any[]>([]);
  const [selectedPubs, setSelectedPubs] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Stats State
  const [stats, setStats] = useState<{
    subjekte: number;
    akteure: number;
    institutionen: number;
    publikationen: number;
    raub_kanten: number;
    schenk_kanten: number;
    verdacht_kanten: number;
    gesamt_kanten: number;
    contested_objekte: number;
    provenienz_luecken: number;
  }>({
    subjekte: 0,
    akteure: 0,
    institutionen: 0,
    publikationen: 0,
    raub_kanten: 0,
    schenk_kanten: 0,
    verdacht_kanten: 0,
    gesamt_kanten: 0,
    contested_objekte: 0,
    provenienz_luecken: 0
  });

  // Single Dossier State
  const [isGeneratingDossier, setIsGeneratingDossier] = useState(false);
  const [dossierStatus, setDossierStatus] = useState<string | null>(null);

  // Batch Dossier ZIP State
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  // Diplomatic Restitution (HLKO LLM) State
  const [isGeneratingPetition, setIsGeneratingPetition] = useState(false);
  const [petitionStatus, setPetitionStatus] = useState<string | null>(null);
  const [petitionDownloadUrl, setPetitionDownloadUrl] = useState<string | null>(null);
  const [petitionJobId, setPetitionJobId] = useState<string | null>(null);

  // Forensic Entity Quick-Filters (Akteure & Depots)
  const [filterEntities, setFilterEntities] = useState<{ actors: any[]; institutions: any[] }>({ actors: [], institutions: [] });
  const [focusedEntity, setFocusedEntity] = useState<{ type: 'actor' | 'depot'; name: string } | null>(null);
  const [focusedSummary, setFocusedSummary] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'actors' | 'depots' | 'gaps' | 'pois'>('actors');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [exclusiveCypherMode, setExclusiveCypherMode] = useState(false);

  // Researcher Case Watchlist (Pinned POIs / Leitobjekte)
  const [pinnedPois, setPinnedPois] = useState<Array<{ id: string; label: string; desc: string }>>(() => {
    try {
      const raw = localStorage.getItem('echo_pinned_pois');
      if (raw) return JSON.parse(raw);
    } catch (_e) {}
    return [
      { id: 'Ngonnso (Ahnenfigur der Nso)', label: 'Ngonnso (Ahnenfigur der Nso)', desc: 'Sakrale weibliche Ahnenfigur der Nso' },
      { id: 'Mandu Yenu (Königsthron)', label: 'Mandu Yenu (Königsthron)', desc: 'Perlenbesetzter Königsthron von Bamum' },
      { id: 'III C 15017', label: 'III C 15017', desc: 'Schlitztrommel aus Banssa / Bafut (1902)' }
    ];
  });

  const togglePinPoi = useCallback((nodeObj: { id: string; label?: string; desc?: string }) => {
    setPinnedPois(prev => {
      const exists = prev.some(p => p.id === nodeObj.id);
      const next = exists
        ? prev.filter(p => p.id !== nodeObj.id)
        : [{ id: nodeObj.id, label: nodeObj.label || nodeObj.id, desc: nodeObj.desc || t('Key Restitution Object', 'Fokus-Leitobjekt', 'Objet phare de restitution') }, ...prev];
      try {
        localStorage.setItem('echo_pinned_pois', JSON.stringify(next));
      } catch (_e) {}
      return next;
    });
  }, [t]);

  // User Annotations State (Marianne / Richard Kuration)
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [isLoadingAnnotations, setIsLoadingAnnotations] = useState(false);
  const [annAuthor, setAnnAuthor] = useState('Marianne');
  const [annRole, setAnnRole] = useState('Provenance Lead');
  const [annTags, setAnnTags] = useState('');
  const [annNotes, setAnnNotes] = useState('');
  const [annConfidence, setAnnConfidence] = useState('HIGH');
  const [isSubmittingAnn, setIsSubmittingAnn] = useState(false);
  const [annStatusMsg, setAnnStatusMsg] = useState<string | null>(null);

  // Dual-Mode Guest / Researcher Authentication
  const [isResearcher, setIsResearcher] = useState<boolean>(() => {
    return !!localStorage.getItem('echo_researcher_token');
  });
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('echo_researcher_token');
    return token ? { 'X-Researcher-Key': token } : {};
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'marianne', password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('echo_researcher_token', data.token || loginPassword);
        setIsResearcher(true);
        setShowLoginModal(false);
        setLoginPassword('');
      } else {
        setLoginError(data.detail || t('Invalid password.', 'Ungültiges Passwort.', 'Mot de passe invalide.'));
      }
    } catch (err: any) {
      setLoginError(t('Connection error to auth gateway.', 'Verbindungsfehler zum Auth-Gateway.', "Erreur de connexion à la passerelle d'authentification."));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('echo_researcher_token');
    setIsResearcher(false);
  };

  const handleSandboxLogin = () => {
    localStorage.setItem('echo_researcher_token', 'echo-static-sandbox');
    setIsResearcher(true);
    setShowLoginModal(false);
    setLoginError(null);
    setLoginPassword('');
  };

  const loadStats = useCallback(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStats({
            subjekte: data.subjekte || data.objekte || 0,
            akteure: data.akteure || 0,
            institutionen: data.institutionen || 0,
            publikationen: data.publikationen || 0,
            raub_kanten: data.raub_kanten || 0,
            schenk_kanten: data.schenk_kanten || 0,
            verdacht_kanten: data.verdacht_kanten || 0,
            gesamt_kanten: data.gesamt_kanten || 0,
            contested_objekte: data.contested_objekte || 0,
            provenienz_luecken: data.provenienz_luecken || 0
          });
        }
      })
      .catch(err => console.error("Stats Fetch Error:", err));
  }, []);

  // 1. Publikationen laden
  const loadPublications = useCallback((autoSelectPubId?: string) => {
    fetch('/api/publications')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.publications) {
          const validIds = new Set<string>(data.publications.map((p: any) => p.id));
          setPublications(data.publications);
          setSelectedPubs(prev => {
            if (prev.size === 0) {
              return new Set<string>(validIds);
            }
            const next = new Set<string>(Array.from(prev).filter((id) => validIds.has(id)));
            if (autoSelectPubId && validIds.has(autoSelectPubId)) {
              next.add(autoSelectPubId);
            }
            return next.size > 0 ? next : new Set<string>(validIds);
          });
        }
      })
      .catch(err => console.error("Fehler beim Laden der Publikationen:", err));
  }, []);

  // 1.1 Entitaeten fuer Schnellfilter laden
  const loadFilterEntities = useCallback(() => {
    fetch('/api/filters/entities')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setFilterEntities({
            actors: data.actors || [],
            institutions: data.institutions || []
          });
        }
      })
      .catch(err => console.error("Fehler beim Laden der Filter-Entitaeten:", err));
  }, []);

  // 2. Graph Daten laden (mit optionalem Exklusiv-Cypher Filter)
  const loadGraph = useCallback((activePubs?: Set<string>, customSearch?: string) => {
    setLoading(true);
    const pubsToUse = activePubs || selectedPubs;
    let url = '/api/graph?limit=8000';
    
    if (pubsToUse.size > 0 && pubsToUse.size < publications.length) {
      url += `&publications=${Array.from(pubsToUse).join(',')}`;
    }

    const term = customSearch !== undefined ? customSearch : (exclusiveCypherMode && focusedEntity ? focusedEntity.name : '');
    if (term && term.trim()) {
      url += `&search=${encodeURIComponent(term.trim())}`;
    }

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.success) {
          const rawLinks = data.links || [];
          const pairMap = new Map<string, any[]>();

          rawLinks.forEach((link: any) => {
            const s = typeof link.source === 'object' ? (link.source.id || link.source) : link.source;
            const t = typeof link.target === 'object' ? (link.target.id || link.target) : link.target;
            const key = s < t ? `${s}--${t}` : `${t}--${s}`;
            if (!pairMap.has(key)) pairMap.set(key, []);
            pairMap.get(key)!.push(link);
          });

          pairMap.forEach((group) => {
            if (group.length === 1) {
              group[0].curvature = 0;
            } else if (group.length === 2) {
              const isFirstRaub = group[0].type === 'RAUBTE' || group[0].type === 'ENTEIGNETE' || group[0].delikt === 'RAUBTE';
              if (isFirstRaub) {
                group[0].curvature = 0.22;
                group[1].curvature = -0.22;
              } else {
                group[0].curvature = -0.22;
                group[1].curvature = 0.22;
              }
            } else {
              group.forEach((l, idx) => {
                l.curvature = (idx - (group.length - 1) / 2) * 0.24;
              });
            }
          });

          // Sort priority: Background items first, Forensischer Raub (Rot) & Verdacht (Cyan) on top!
          const typePriority: Record<string, number> = {
            'LAGERT_IN': 0,
            'UEBERGAB_AN': 1,
            'SCHENKTE': 2,
            'VERKAUFTE_AN': 3,
            'EIGNETE_SICH_AN': 4,
            'ENTEIGNETE': 5,
            'RAUBTE': 6,
            'VERDACHT_AUF': 7
          };

          rawLinks.sort((a: any, b: any) => (typePriority[a.type] ?? 2) - (typePriority[b.type] ?? 2));

          const rawNodes = data.nodes || [];
          try {
            const guestLayout = JSON.parse(localStorage.getItem('echo_guest_layout') || '{}');
            rawNodes.forEach((n: any) => {
              const coords = guestLayout[n.id] || guestLayout[n.name];
              if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
                n.fx = coords.x;
                n.fy = coords.y;
              }
            });
          } catch (e) {}

          setGraphData({ nodes: rawNodes, links: rawLinks });
          setTimeout(() => {
            if (fgRef.current) {
              try {
                fgRef.current.d3Force('charge')?.strength((n: any) =>
                  n.type === 'Institution' ? -1400 : (n.type === 'Akteur' ? -650 : -90)
                );
                fgRef.current.d3Force('link')?.distance((l: any) =>
                  l.type === 'LAGERT_IN' ? 180 : 140
                );
                if (!focusedEntity) {
                  fgRef.current.zoomToFit(650, 48);
                }
              } catch (_fe) {}
            }
          }, 120);
        } else {
          setError(t('Error loading provenance graph.', 'Fehler beim Laden des Beweisgraphen.', 'Erreur lors du chargement du graphe de provenance.'));
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Graph Fetch Error:", err);
        setError(t('Connection to Graph API failed (Port 8088 / Neo4j).', 'Verbindung zur Graph-API fehlgeschlagen (Port 8088 / Neo4j).', "Échec de connexion à l'API Graphe (Port 8088 / Neo4j)."));
        setLoading(false);
      });
  }, [selectedPubs, publications, exclusiveCypherMode, focusedEntity]);

  // 2.1 ResizeObserver fuer den Canvas-Container

  // 2.2 Kiosk Mode Auto-Pilot (Dauerschleife Kameraflug ueber Dissonanzen und Verdachtsknoten)
  useEffect(() => {
    if (!kioskMode || graphData.nodes.length === 0) return;

    // Priorisiere beruehmte und forensisch brisante Knoten
    const priorityInvs = [
      'AS 1574',     // Mandu Yenu Prachtthron Bamum
      'C 20681',     // Hans Caspar zu Putlitz (Kom Strafexpedition)
      'InvNr. 7087', // Max Buchner (Bonabéri Brandschatzung)
      '033513',      // Hans Houben (Nso Kumbo 1902)
      '032943',      // Curt Pavel (Bangwa/Bafut)
      'C 8010',      // Oltwig von Kamptz (Ikoi-Ngolo)
      'III C 18722', // Ludwig von Stein zu Lausnitz (Kunabembe)
      '045455',      // Oberst Müller (Anyang Strafexpedition)
      'C 26102',     // Hans Glauning (Nso Feldzug)
      '033494',      // Hans Houben (Nso 1902)
      '056017'       // Scheunemann (Südexpedition)
    ];

    const targets: string[] = [];
    priorityInvs.forEach(inv => {
      if (graphData.nodes.some(n => n.id === inv)) targets.push(inv);
    });

    suspicionIds.forEach(id => {
      if (!targets.includes(id) && graphData.nodes.some(n => n.id === id)) {
        targets.push(id);
      }
    });

    contestedIds.forEach(id => {
      if (!targets.includes(id) && graphData.nodes.some(n => n.id === id)) {
        targets.push(id);
      }
    });

    if (targets.length === 0) return;

    let step = 0;
    const flyToNext = () => {
      const nextId = targets[step % targets.length];
      step++;
      const targetNode = graphData.nodes.find(n => n.id === nextId);
      if (targetNode && fgRef.current) {
        setKioskTargetId(nextId);
        setSelectedLink(null);
        setSelectedNode(targetNode);
        fgRef.current.centerAt(targetNode.x, targetNode.y, 1600);
        fgRef.current.zoom(2.8, 1600);
      }
    };

    // Sofort ersten Zielpunkt anfliegen
    flyToNext();

    const timer = setInterval(flyToNext, 8500);
    return () => clearInterval(timer);
  }, [kioskMode, graphData.nodes, contestedIds, suspicionIds]);

  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const updateSize = () => {
      if (canvasContainerRef.current) {
        const { clientWidth, clientHeight } = canvasContainerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setCanvasDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(canvasContainerRef.current);
    return () => observer.disconnect();
  }, [sidebarOpen, selectedNode, selectedLink]);

  // 3. Stats & Initial Mount
  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStats({
            subjekte: data.subjekte || data.objekte || 0,
            akteure: data.akteure || 0,
            institutionen: data.institutionen || 0,
            publikationen: data.publikationen || 0,
            raub_kanten: data.raub_kanten || 0,
            schenk_kanten: data.schenk_kanten || 0,
            verdacht_kanten: data.verdacht_kanten || 0,
            gesamt_kanten: data.gesamt_kanten || 0,
            contested_objekte: data.contested_objekte || 0,
            provenienz_luecken: data.provenienz_luecken || 0
          });
        }
      })
      .catch(err => console.error("Stats Fetch Error:", err));

    fetch('/api/ghosts')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.ghost_ids) {
          setGhostIds(new Set(data.ghost_ids));
        }
      })
      .catch(err => console.error("Ghost Fetch Error:", err));

    fetch('/api/contested')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.items) {
          const ids = new Set<string>();
          const mapping: Record<string, any> = {};
          for (const item of data.items) {
            ids.add(item.id);
            mapping[item.id] = item;
          }
          setContestedIds(ids);
          setContestedMap(mapping);
        }
      })
      .catch(err => console.error("Contested Fetch Error:", err));

    // Provenienzlücken laden
    fetch('/api/gaps')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.items) {
          setGapIds(new Set(data.gap_ids || []));
          setGapItems(data.items || []);
        }
      })
      .catch(err => console.error("Gaps Fetch Error:", err));

    // Autonomous Provenance Suspicions laden
    fetch('/api/suspicions')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.suspicions) {
          setSuspicions(data.suspicions);
          const mapping: Record<string, any> = {};
          const ids = new Set<string>();
          for (const s of data.suspicions) {
            mapping[s.inv] = s;
            ids.add(s.inv);
          }
          setSuspicionMap(mapping);
          setSuspicionIds(ids);
        }
      })
      .catch(err => console.error("Suspicions Fetch Error:", err));

    loadPublications();
    loadFilterEntities();

    const storedToken = localStorage.getItem('echo_researcher_token');
    if (storedToken) {
      fetch('/api/auth/session', { headers: { 'X-Researcher-Key': storedToken } })
        .then(r => r.json())
        .then(s => {
          if (!s.authenticated) {
            localStorage.removeItem('echo_researcher_token');
            setIsResearcher(false);
          } else {
            setIsResearcher(true);
          }
        })
        .catch(() => {});
    }
  }, [loadPublications, loadFilterEntities]);

  useEffect(() => {
    if (publications.length > 0) {
      loadGraph();
    }
  }, [publications.length]);

  // 4. Publikation Toggle
  
  const handleDeletePublication = (pubId: string) => {
    if (!window.confirm(t(
      'Are you sure? This publication ingestion will be permanently removed from the graph.',
      'Bist du sicher? Die Ingestion wird restlos aus dem Graphen entfernt.',
      'Êtes-vous sûr ? Cette ingestion de publication sera définitivement supprimée du graphe.'
    ))) return;
    
    fetch(`/api/publications/${pubId}`, { 
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    })
      .then(async res => {
        if (res.status === 401) {
          setShowLoginModal(true);
          setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich (Marianne).', 'Autorisation chercheur requise.'));
          return;
        }
        const data = await res.json();
        if (data.success) {
          loadPublications();
          loadFilterEntities();
          loadStats();
          const remaining = new Set(Array.from(selectedPubs).filter((id) => id !== pubId));
          setSelectedPubs(remaining);
          loadGraph(remaining);
        } else {
          alert(t('Error: ', 'Fehler: ', 'Erreur : ') + (data.detail || t('Deletion failed', 'Löschen fehlgeschlagen', 'Échec de la suppression')));
        }
      })
      .catch(err => console.error("Fehler beim Loeschen:", err));
  };

  const togglePublication = (pubId: string) => {
    const next = new Set(selectedPubs);
    if (next.has(pubId)) {
      if (next.size > 1) next.delete(pubId);
    } else {
      next.add(pubId);
    }
    setSelectedPubs(next);
    loadGraph(next);
  };

  // 4.01 Batch Dossier ZIP Handler
  const handleBatchDossier = (entityType: 'actor' | 'institution' | 'gaps' | 'list', entityName: string, explicitInvs?: string[]) => {
    setIsGeneratingBatch(true);
    setBatchStatus(t(
      `[START: PACKAGING DOSSIERS FOR ${entityName.toUpperCase()}...]`,
      `[START: BÜNDLE DOSSIERS FÜR ${entityName.toUpperCase()}...]`,
      `[DÉBUT : COMPILATION DES DOSSIERS POUR ${entityName.toUpperCase()}...]`
    ));

    fetch('/api/dossier/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: entityType,
        entity_name: entityName,
        limit: 300,
        inventarnummern: explicitInvs || null
      })
    })
      .then(res => {
        if (!res.ok) throw new Error(t('Batch export failed', 'Batch-Export fehlgeschlagen', "Échec de l'export groupé"));
        return res.json();
      })
      .then(data => {
        if (data.success && data.download_url) {
          setBatchStatus(t(
            `[DONE: ${data.dossiers_packaged} DOSSIERS PACKAGED IN ${data.filename} - STARTING DOWNLOAD]`,
            `[FERTIG: ${data.dossiers_packaged} DOSSIERS IN ${data.filename} GEPACKT - DOWNLOAD STARTET]`,
            `[TERMINÉ : ${data.dossiers_packaged} DOSSIERS COMPILÉS DANS ${data.filename} - TÉLÉCHARGEMENT]`
          ));
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = data.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => {
            setIsGeneratingBatch(false);
            setBatchStatus(null);
          }, 4000);
        } else {
          setBatchStatus(t(
            `[ERROR: ${data.detail || 'Export aborted'}]`,
            `[FEHLER: ${data.detail || 'Export abgebrochen'}]`,
            `[ERREUR : ${data.detail || 'Export annulé'}]`
          ));
          setIsGeneratingBatch(false);
        }
      })
      .catch(err => {
        console.error(err);
        setBatchStatus(t('[BATCH EXPORT ERROR]', '[FEHLER BEIM BATCH-EXPORT]', "[ERREUR D'EXPORT GROUPÉ]"));
        setIsGeneratingBatch(false);
      });
  };

  // 4.02 Diplomatische HLKO Restitutions-Pipeline (Asynchrones Polling)
  const handleGenerateLLMPetition = (institutionName: string) => {
    setIsGeneratingPetition(true);
    setPetitionStatus(t(
      '[INITIALIZING FORENSIC RESTITUTION TRIAGE...]',
      '[INITIALISIERE FORENSISCHE RESTITUTIONS-TRIAGE...]',
      '[INITIALISATION DU TRIAGE FORENSIQUE DE RESTITUTION...]'
    ));
    setPetitionDownloadUrl(null);

    fetch('/api/petition/generate_llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        institution: institutionName,
        community: null
      })
    })
      .then(res => {
        if (!res.ok) throw new Error(t('Restitution request failed', 'Restitutions-Request fehlgeschlagen', 'Échec de la requête de restitution'));
        return res.json();
      })
      .then(data => {
        if (!data.success || !data.job_id) {
          throw new Error(data.message || t('Failed to start job', 'Fehler beim Anstoßen des Auftrags', 'Impossible de démarrer la tâche'));
        }
        setPetitionJobId(data.job_id);
        setPetitionStatus(t(
          `[RUNNING: ${data.step || 'Legal subsumption in progress...'}]`,
          `[IN ARBEIT: ${data.step || 'Subsumtion läuft...'}]`,
          `[EN COURS : ${data.step || 'Qualification juridique en cours...'}]`
        ));

        // Polling alle 2,5 Sekunden
        const pollInterval = setInterval(() => {
          fetch(`/api/petition/status/${data.job_id}`)
            .then(sRes => sRes.json())
            .then(sData => {
              if (sData.status === 'completed') {
                clearInterval(pollInterval);
                const dlUrl = sData.result?.download_zip_url || `/api/dossier/download/${sData.result?.zip_filename}`;
                setPetitionStatus(t(
                  `[DONE: ${sData.result?.counts?.total_extracted || 0} OBJECTS SUBSUMED UNDER INTERNATIONAL LAW & SEALED]`,
                  `[FERTIG: ${sData.result?.counts?.total_extracted || 0} OBJEKTE VÖLKERRECHTLICH SUBSUMIERT & VERSIEGELT]`,
                  `[TERMINÉ : ${sData.result?.counts?.total_extracted || 0} OBJETS QUALIFIÉS EN DROIT INTERNATIONAL ET SCELLÉS]`
                ));
                setPetitionDownloadUrl(dlUrl);
                setIsGeneratingPetition(false);

                // Auto-Download triggern
                if (dlUrl) {
                  const link = document.createElement('a');
                  link.href = dlUrl;
                  link.download = sData.result?.zip_filename || t('Restitution_Package.zip', 'Restitutionspaket.zip', 'Dossier_Restitution.zip');
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
              } else if (sData.status === 'failed') {
                clearInterval(pollInterval);
                setPetitionStatus(t(
                  `[ERROR: ${sData.error || 'Generation failed'}]`,
                  `[FEHLER: ${sData.error || 'Generierung fehlgeschlagen'}]`,
                  `[ERREUR : ${sData.error || 'Échec de la génération'}]`
                ));
                setIsGeneratingPetition(false);
              } else {
                setPetitionStatus(t(
                  `[STATUS: ${sData.step || 'Analyzing graph data...'}]`,
                  `[STATUS: ${sData.step || 'Analysiere Graphendaten...'}]`,
                  `[STATUT : ${sData.step || 'Analyse du graphe en cours...'}]`
                ));
              }
            })
            .catch(err => {
              console.error(err);
              clearInterval(pollInterval);
              setPetitionStatus(t('[STATUS POLLING ERROR]', '[FEHLER BEIM STATUS-POLLING]', '[ERREUR DE SUIVI DE STATUT]'));
              setIsGeneratingPetition(false);
            });
        }, 2500);
      })
      .catch(err => {
        console.error(err);
        setPetitionStatus(t(
          `[ERROR: ${err.message || 'API backend connection failed'}]`,
          `[FEHLER: ${err.message || 'Verbindung zum API-Backend fehlgeschlagen'}]`,
          `[ERREUR : ${err.message || "Échec de connexion au serveur API"}]`
        ));
        setIsGeneratingPetition(false);
      });
  };

  // 4.03 IFG / FOIA / CADA-Auskunftsersuchen in Zwischenablage kopieren
  const handleCopyIFG = (invNumber: string, museum: string) => {
    const text = lang === 'de'
      ? `Antrag nach dem Informationsfreiheitsgesetz (IFG) / Landesinformationsfreiheitsgesetz\n\nBetreff: Auskunftsersuchen zu den historischen Zugangsbüchern (1884–1916) für Inventarnummer ${invNumber}\nEmpfänger: Direktion / Provenienzforschung ${museum}\n\nSehr geehrte Damen und Herren,\n\nim Rahmen unabhängiger Provenienzrecherchen zur kolonialen Herkunft von Kulturgütern aus Kamerun beantrage ich hiermit Einsicht in die physischen bzw. digitalisierten Zugangsbücher, Inventarlisten und Akten der Jahre 1884 bis 1916 für die Inventarnummer ${invNumber}.\n\nDa in den aktuellen Bestandsdaten keinerlei historischer Erwerbsakt dokumentiert ist, ist die Einsicht in die Primärquellen zur Rekonstruktion der lückenlosen Beweiskette (Chain of Custody) zwingend erforderlich.\n\nMit freundlichen Grüßen,\nProject Echo Provenienz-Forensik`
      : lang === 'fr'
        ? `Demande d'accès aux documents administratifs et archives (IFG / CADA / Accès aux registres d'entrée)\n\nObjet : Demande de consultation des registres d'entrée historiques (1884–1916) pour le numéro d'inventaire ${invNumber}\nDestinataire : Direction / Département de recherche de provenance, ${museum}\n\nMadame, Monsieur,\n\nDans le cadre de recherches indépendantes de provenance portant sur l'origine coloniale de biens culturels issus du Cameroun, je sollicite par la présente l'accès aux registres d'entrée physiques ou numérisés, listes d'inventaire et dossiers d'archives des années 1884 à 1916 concernant le numéro d'inventaire ${invNumber}.\n\nLes données publiques actuelles ne documentant aucun acte d'acquisition historique, la consultation des sources primaires est indispensable afin de reconstituer la chaîne de provenance (Chain of Custody).\n\nVeuillez agréer mes salutations distinguées,\nProject Echo — Forensique de provenance`
        : `Freedom of Information Request (German IFG / State Freedom of Information Act)\n\nSubject: Request for Access to Historical Accession Ledgers (1884–1916) for Inventory Number ${invNumber}\nRecipient: Directorate / Provenance Research Department, ${museum}\n\nDear Sir or Madam,\n\nIn the context of independent provenance research into the colonial origin of cultural heritage objects from Cameroon, I hereby request access to the physical or digitized accession ledgers, inventory lists, and archival files from 1884 to 1916 pertaining to inventory number ${invNumber}.\n\nBecause the publicly available collection records contain no documented acquisition act, access to the primary archival sources is essential to reconstruct a complete chain of custody.\n\nSincerely,\nProject Echo Provenance Forensics`;
    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 3000);
      } catch (_err) {}
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 3000);
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  // 4.1 Subnetzwerk-Isolation (Berechnung fokussierter Täter- & Depot-Knoten)
  const focusedSubnetwork = useMemo(() => {
    if (!focusedEntity) return null;
    const nodeIds = new Set<string>();
    const linkSet = new Set<any>();

    const targetName = focusedEntity.name.toLowerCase();

    // Finde Haupt-Knoten
    const focalNode = graphData.nodes.find(n => 
      (n.label && n.label.toLowerCase() === targetName) || 
      (n.id && n.id.toLowerCase() === targetName)
    );
    if (focalNode) {
      nodeIds.add(focalNode.id);
    }

    if (focusedEntity.type === 'actor') {
      graphData.links.forEach(link => {
        const sName = (link.source_label || (link.source && (link.source.label || link.source.id || link.source)) || '').toLowerCase();
        const tName = (link.target_label || (link.target && (link.target.label || link.target.id || link.target)) || '').toLowerCase();

        if (sName === targetName || tName === targetName) {
          linkSet.add(link);
          const sId = link.source.id || link.source;
          const tId = link.target.id || link.target;
          nodeIds.add(sId);
          nodeIds.add(tId);

          // Folgekanten zu Ziel-Depots (LAGERT_IN)
          graphData.links.forEach(l2 => {
            const l2s = l2.source.id || l2.source;
            if ((l2s === sId || l2s === tId) && l2.type === 'LAGERT_IN') {
              linkSet.add(l2);
              nodeIds.add(l2.target.id || l2.target);
            }
          });
        }
      });
    } else if (focusedEntity.type === 'depot') {
      graphData.links.forEach(link => {
        const sName = (link.source_label || (link.source && (link.source.label || link.source.id || link.source)) || '').toLowerCase();
        const tName = (link.target_label || (link.target && (link.target.label || link.target.id || link.target)) || '').toLowerCase();

        if (sName === targetName || tName === targetName || (link.type === 'LAGERT_IN' && (tName.includes(targetName) || sName.includes(targetName)))) {
          linkSet.add(link);
          const sId = link.source.id || link.source;
          const tId = link.target.id || link.target;
          nodeIds.add(sId);
          nodeIds.add(tId);

          // Vorgängerkanten zu Raub-Akteuren
          graphData.links.forEach(l2 => {
            const l2t = l2.target.id || l2.target;
            if ((l2t === sId || l2t === tId) && (l2.type === 'RAUBTE' || l2.type === 'SCHENKTE' || l2.type === 'VERDACHT_AUF' || l2.type === 'ENTEIGNETE' || l2.type === 'EIGNETE_SICH_AN')) {
              linkSet.add(l2);
              nodeIds.add(l2.source.id || l2.source);
            }
          });
        }
      });
    }

    return {
      focalNode,
      nodeIds,
      linkSet
    };
  }, [focusedEntity, graphData]);

  // 4.2 Täter & Depots Suche im Schnellfilter
  const filteredActors = useMemo(() => {
    if (!sidebarSearch.trim()) return filterEntities.actors;
    const q = sidebarSearch.toLowerCase();
    return filterEntities.actors.filter(a => 
      a.name.toLowerCase().includes(q) || 
      (a.rolle && a.rolle.toLowerCase().includes(q))
    );
  }, [filterEntities.actors, sidebarSearch]);

  const filteredInstitutions = useMemo(() => {
    if (!sidebarSearch.trim()) return filterEntities.institutions;
    const q = sidebarSearch.toLowerCase();
    return filterEntities.institutions.filter(i => 
      i.name.toLowerCase().includes(q) || 
      (i.stadt && i.stadt.toLowerCase().includes(q))
    );
  }, [filterEntities.institutions, sidebarSearch]);

  const filteredGaps = useMemo(() => {
    let items = gapItems;
    if (gapFilter === 'suspicion') {
      items = items.filter(g => suspicionIds.has(g.id || g.inv || g.inventarnummer));
    } else if (gapFilter === 'unresolved') {
      items = items.filter(g => !suspicionIds.has(g.id || g.inv || g.inventarnummer));
    }
    if (!sidebarSearch.trim()) return items;
    const q = sidebarSearch.toLowerCase();
    return items.filter(g => {
      const invStr = (g.inv || g.inventarnummer || g.id || '').toLowerCase();
      const nameStr = (g.name || g.bezeichnung || '').toLowerCase();
      const instStr = (g.museum || g.institution || '').toLowerCase();
      return invStr.includes(q) || nameStr.includes(q) || instStr.includes(q);
    });
  }, [gapItems, gapFilter, sidebarSearch, suspicionIds]);

  // 4.3 Handler: Entitaet im Schnellfilter fokussieren
  const handleSelectEntityFocus = (type: 'actor' | 'depot', name: string) => {
    if (focusedEntity && focusedEntity.name === name) {
      setFocusedEntity(null);
      setFocusedSummary(null);
      if (exclusiveCypherMode) {
        setExclusiveCypherMode(false);
        loadGraph(selectedPubs, '');
      }
      return;
    }

    setFocusedEntity({ type, name });
    setSelectedLink(null);
    setMobileSidebarOpen(false);
    if (viewMode === 'visual' || viewMode === 'docs') {
      setViewMode('graph');
    }

    const endpoint = type === 'actor' 
      ? `/api/actors/${encodeURIComponent(name)}/summary` 
      : `/api/institutions/${encodeURIComponent(name)}/summary`;

    fetch(endpoint)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.summary) {
          setFocusedSummary(data.summary);
        }
      })
      .catch(err => console.error("Fehler beim Laden des Profils:", err));

    const targetNode = graphData.nodes.find(n => 
      (n.label && n.label.toLowerCase() === name.toLowerCase()) || 
      (n.id && n.id.toLowerCase() === name.toLowerCase())
    );

    if (targetNode) {
      setSelectedNode(targetNode);
      if (fgRef.current) {
        fgRef.current.centerAt(targetNode.x, targetNode.y, 800);
        fgRef.current.zoom(2.2, 800);
      }
    }
  };

  // 4.4 Handler: Exklusiv Cypher-Modus umschalten
  const handleExclusiveCypherToggle = (name: string) => {
    if (exclusiveCypherMode) {
      setExclusiveCypherMode(false);
      loadGraph(selectedPubs, '');
    } else {
      setExclusiveCypherMode(true);
      loadGraph(selectedPubs, name);
      setTimeout(() => {
        if (fgRef.current) fgRef.current.zoomToFit(800, 50);
      }, 500);
    }
  };

  // 5. Interaktive Metrik-Filter Umschaltung
  const handleMetricToggle = (filter: MetricFilter) => {
    if (activeMetricFilter === filter) {
      setActiveMetricFilter(null);
    } else {
      setActiveMetricFilter(filter);
      if (filter === 'dissonanz') setGhostMode(false);
    }
  };

  // 6. File Upload Handler
  
  // Layout Functions
  const handleEngineStop = useCallback(() => {
    if (!graphData.nodes.length) return;
    if (graphData.nodes[0].fx !== undefined) return;
    
    // Nur autorisierte Forscher überschreiben das Master-Layout
    if (!localStorage.getItem('echo_researcher_token')) return;

    const layout: Record<string, any> = {};
    graphData.nodes.forEach((n: any) => {
      layout[n.id || n] = { x: n.x, y: n.y };
    });
    
    fetch('/api/graph/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(layout)
    }).catch(err => console.error(err));
  }, [graphData, getAuthHeaders]);

  const handleNodeDragEnd = useCallback((node: any) => {
    node.fx = node.x;
    node.fy = node.y;

    if (!localStorage.getItem('echo_researcher_token')) {
      // Gast-Modus: Isoliert im Browser des Besuchers puffern
      try {
        const guestLayout = JSON.parse(localStorage.getItem('echo_guest_layout') || '{}');
        guestLayout[node.id || node] = { x: node.x, y: node.y };
        localStorage.setItem('echo_guest_layout', JSON.stringify(guestLayout));
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // Forscher-Modus: Serverweites Master-Layout synchronisieren
    const layout = { [node.id || node]: { x: node.x, y: node.y } };
    fetch('/api/graph/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(layout)
    }).catch(err => console.error(err));
  }, [getAuthHeaders]);

  const handleResetLayout = () => {
    if (!window.confirm(t(
      'Reset manual node positions and restore ordered constellation layout?',
      'Manuelle Knoten-Verschiebungen zuruecksetzen und geordnetes Konstellations-Layout wiederherstellen?',
      'Réinitialiser les positions manuelles des nœuds et restaurer la constellation ordonnée ?'
    ))) return;
    localStorage.removeItem('echo_guest_layout');
    if (!localStorage.getItem('echo_researcher_token')) {
      window.location.reload();
      return;
    }
    fetch('/api/graph/layout', { 
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    }).then(() => window.location.reload());
  };

  // Edge Functions
  const [newEdgeTarget, setNewEdgeTarget] = useState("");
  const [newEdgeType, setNewEdgeType] = useState("RAUBTE");
  const [newEdgeBeleg, setNewEdgeBeleg] = useState("");

  const handleCreateEdge = () => {
    if (!selectedNode || !newEdgeTarget || !newEdgeBeleg) return;
    fetch('/api/graph/edges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        source_id: selectedNode.id,
        target_id: newEdgeTarget,
        rel_type: newEdgeType,
        props: { beleg: newEdgeBeleg, publikation: 'MANUELLE_INSPEKTION' }
      })
    }).then(async r => {
       if (r.status === 401) {
         setShowLoginModal(true);
         setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich (Marianne).', 'Autorisation chercheur requise.'));
         return;
       }
       if (r.ok) {
         setNewEdgeTarget('');
         setNewEdgeBeleg('');
         loadStats();
         loadFilterEntities();
         loadGraph();
       }
       else { 
         const j = await r.json();
         alert(t('Error: ', 'Fehler: ', 'Erreur : ') + (j.detail || t('Invalid source/target', 'Source/Target ungültig', 'Source/cible invalide'))); 
       }
    });
  };

  const handleDeleteEdge = () => {
    if (!selectedLink) return;
    if (!window.confirm(t('Permanently delete this relation?', 'Relation wirklich restlos löschen?', 'Supprimer définitivement cette relation ?'))) return;
    const sId = typeof selectedLink.source === 'object' ? selectedLink.source.id : selectedLink.source;
    const tId = typeof selectedLink.target === 'object' ? selectedLink.target.id : selectedLink.target;
    
    fetch('/api/graph/edges', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        source_id: sId,
        target_id: tId,
        rel_type: selectedLink.type || selectedLink.label || selectedLink.name || "UNBEKANNT"
      })
    }).then(async r => {
      if (r.status === 401) {
        setShowLoginModal(true);
        setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich (Marianne).', 'Autorisation chercheur requise.'));
        return;
      }
      if (r.ok) {
        setSelectedLink(null);
        loadStats();
        loadFilterEntities();
        loadGraph();
      }
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsUploading(true);
    setUploadMessage(t(
      `[INGESTION: ANALYZING ${file.name.toUpperCase()}...]`,
      `[INGESTION: ANALYSIERE ${file.name.toUpperCase()}...]`,
      `[INGESTION : ANALYSE DE ${file.name.toUpperCase()}...]`
    ));

    const formData = new FormData();
    formData.append("file", file);

    fetch('/api/sources/upload', {
      method: 'POST',
      headers: {
        ...getAuthHeaders()
      },
      body: formData
    })
      .then(async res => {
        if (res.status === 401) {
          setShowLoginModal(true);
          setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich (Marianne).', 'Autorisation chercheur requise.'));
          setUploadMessage(t('[401: AUTHORIZATION REQUIRED]', '[401: AUTORISIERUNG ERFORDERLICH]', '[401 : AUTORISATION REQUISE]'));
          setIsUploading(false);
          return null;
        }
        if (!res.ok) throw new Error(t('Upload failed', 'Upload fehlgeschlagen', 'Échec du téléversement'));
        return res.json();
      })
      .then(data => {
        if (!data) return;
        if (data.success) {
          setUploadMessage(t(
            `[SUCCESS: ${data.triples_extracted} RELATIONS INJECTED FROM ${file.name.toUpperCase()}]`,
            `[ERFOLG: ${data.triples_extracted} RELATIONEN AUS ${file.name.toUpperCase()} INJIZIERT]`,
            `[SUCCÈS : ${data.triples_extracted} RELATIONS INJECTÉES DEPUIS ${file.name.toUpperCase()}]`
          ));
          loadPublications(data.publication_id);
          loadStats();
          loadFilterEntities();
          setTimeout(() => {
            loadGraph();
            setIsUploading(false);
          }, 500);
          setTimeout(() => setUploadMessage(null), 5000);
        } else {
          setUploadMessage(t(
            `[ERROR: ${data.detail || 'Processing aborted'}]`,
            `[FEHLER: ${data.detail || 'Verarbeitung abgebrochen'}]`,
            `[ERREUR : ${data.detail || 'Traitement interrompu'}]`
          ));
          setIsUploading(false);
        }
      })
      .catch(err => {
        console.error(err);
        setUploadMessage(t('[ERROR: FILE INGESTION FAILED]', '[FEHLER: DATEI-INGESTION FEHLGESCHLAGEN]', "[ERREUR : ÉCHEC DE L'INGESTION DU FICHIER]"));
        setIsUploading(false);
      });
  };

  // 7. Dossier Generator
  const handlePrintDossier = (invNumber: string) => {
    if (!invNumber) return;
    setIsGeneratingDossier(true);
    setDossierStatus(t('[EXTRACTING CHAIN OF EVIDENCE...]', '[BEWEISKETTE WIRD EXTRAHIERT...]', '[EXTRACTION DE LA CHAÎNE DE PREUVE...]'));

    fetch('/api/dossier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventarnummer: invNumber })
    })
      .then(res => {
        if (!res.ok) throw new Error(t('Could not generate dossier.', 'Dossier konnte nicht generiert werden.', 'Impossible de générer le dossier.'));
        return res.json();
      })
      .then(data => {
        if (data.success && data.download_url) {
          setDossierStatus(t('[PDF READY - STARTING DOWNLOAD]', '[PDF ERSTELLT - DOWNLOAD STARTET]', '[PDF PRÊT - TÉLÉCHARGEMENT EN COURS]'));
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = data.filename || `${t('Restitution_Dossier', 'Restitutionsdossier', 'Dossier_Restitution')}_${invNumber}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => {
            setIsGeneratingDossier(false);
            setDossierStatus(null);
          }, 3000);
        } else {
          setDossierStatus(t('[ERROR: ', '[FEHLER: ', '[ERREUR : ') + (data.detail || t('Unknown error', 'Unbekannter Fehler', 'Erreur inconnue')) + ']');
          setIsGeneratingDossier(false);
        }
      })
      .catch(err => {
        console.error(err);
        setDossierStatus(t('[PDF GENERATION ERROR]', '[FEHLER BEI DER PDF-GENERIERUNG]', '[ERREUR DE GÉNÉRATION PDF]'));
        setIsGeneratingDossier(false);
      });
  };

  // 7.5 User Annotations Engine (Marianne / Richard)
  useEffect(() => {
    if (selectedNode && (selectedNode.type === 'Subjekt' || selectedNode.type === 'Objekt')) {
      setIsLoadingAnnotations(true);
      setAnnStatusMsg(null);
      fetch(`/api/objects/${encodeURIComponent(selectedNode.id)}/annotations`)
        .then(res => res.json())
        .then(data => {
          if (data && data.annotations) {
            setAnnotations(data.annotations);
          } else {
            setAnnotations([]);
          }
        })
        .catch(err => {
          console.error("Error fetching annotations:", err);
          setAnnotations([]);
        })
        .finally(() => setIsLoadingAnnotations(false));
    } else {
      setAnnotations([]);
    }
  }, [selectedNode]);

  const handleSaveAnnotation = async () => {
    if (!selectedNode || !annNotes.trim()) return;
    setIsSubmittingAnn(true);
    setAnnStatusMsg(null);
    try {
      const tagList = annTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
      const res = await fetch(`/api/objects/${encodeURIComponent(selectedNode.id)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          author: annAuthor,
          role: annRole,
          tags: tagList,
          notes: annNotes,
          confidence: annConfidence
        })
      });
      if (res.status === 401) {
        setShowLoginModal(true);
        setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich.', 'Autorisation chercheur requise.'));
        return;
      }
      const data = await res.json();
      if (data.success) {
        const newAnn = {
          id: data.annotation_id,
          author: annAuthor,
          role: annRole,
          tags: tagList,
          notes: annNotes,
          confidence: annConfidence,
          created_at: new Date().toISOString()
        };
        setAnnotations(prev => [newAnn, ...prev]);
        setAnnNotes('');
        setAnnTags('');
        setAnnStatusMsg(t('[SAVED IN GRAPH]', '[GESPEICHERT IM GRAPHEN]', '[ENREGISTRÉ DANS LE GRAPHE]'));
        setTimeout(() => setAnnStatusMsg(null), 3500);
      } else {
        setAnnStatusMsg(t('[SAVE ERROR]', '[FEHLER BEIM SPEICHERN]', "[ERREUR D'ENREGISTREMENT]"));
      }
    } catch (e) {
      console.error(e);
      setAnnStatusMsg(t('[NETWORK ERROR]', '[NETZWERKFEHLER]', '[ERREUR RÉSEAU]'));
    } finally {
      setIsSubmittingAnn(false);
    }
  };

  const handleDeleteAnnotation = async (id: string) => {
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { 
        method: 'DELETE',
        headers: { ...getAuthHeaders() }
      });
      if (res.status === 401) {
        setShowLoginModal(true);
        setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich (Marianne).', 'Autorisation chercheur requise.'));
        return;
      }
      const data = await res.json();
      if (data.success) {
        setAnnotations(prev => prev.filter(a => a.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 8. Custom Node Rendering
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isGhost = ghostIds.has(node.id);
    const isContested = contestedIds.has(node.id) || Boolean(node.contested);
    const isGap = gapIds.has(node.id);
    const isSuspicion = suspicionIds.has(node.id);
    const isSelected = selectedNode && selectedNode.id === node.id;
    const isLinkEndpoint = selectedLink && (
      (selectedLink.source.id || selectedLink.source) === node.id || 
      (selectedLink.target.id || selectedLink.target) === node.id
    );
    const qLower = searchTerm ? searchTerm.toLowerCase() : '';
    const matchesSearch = Boolean(qLower && ((node.label && node.label.toLowerCase().includes(qLower)) || (node.desc && node.desc.toLowerCase().includes(qLower))));

    // Basis-Farben
    let color = '#475569'; // Standard: Subjekt (Dunkelschiefer)
    let radius = 3.5;
    let strokeColor = '#000000';
    let strokeWidth = 1.0;

    if (node.type === 'Akteur') {
      color = '#B45309'; // Dunkelbernstein / Bronze
      radius = 6.5;
      strokeWidth = 1.5;
    } else if (node.type === 'Institution') {
      color = '#000000'; // Tiefschwarzer Institutions-Anker
      radius = 10;
      strokeColor = '#000000';
      strokeWidth = 2.0;
    }

    if (isGhost) {
      color = '#DC2626';
      radius = ghostMode ? 8.5 : 5;
    }

    if (isContested) {
      color = '#CA8A04';
      radius = (activeMetricFilter === 'dissonanz') ? 8.5 : 5;
    }

    if (isGap && activeMetricFilter === 'luecken') {
      color = '#7C3AED';
      radius = 8.5;
    }

    if (isSuspicion && activeMetricFilter === 'verdacht') {
      color = '#0891B2';
      radius = 8.5;
    }

    // INTERAKTIVER METRIK-FILTER & TÄTER/DEPOT-ISOLATION (Dunkle Schatten)
    let isDimmed = false;
    let isFocalNode = false;
    let isEntityConnected = true;

    if (focusedSubnetwork) {
      if (focusedSubnetwork.focalNode && focusedSubnetwork.focalNode.id === node.id) {
        isFocalNode = true;
      } else if (!focusedSubnetwork.nodeIds.has(node.id)) {
        isEntityConnected = false;
        isDimmed = true;
      }
    }

    if (!isDimmed) {
      if (activeMetricFilter === 'subjekte' && node.type !== 'Subjekt') isDimmed = true;
      else if (activeMetricFilter === 'akteure' && node.type !== 'Akteur') isDimmed = true;
      else if (activeMetricFilter === 'depots' && node.type !== 'Institution') isDimmed = true;
      else if (activeMetricFilter === 'dissonanz' && !isContested) isDimmed = true;
      else if (activeMetricFilter === 'luecken' && !isGap) isDimmed = true;
      else if (activeMetricFilter === 'verdacht' && !isSuspicion && node.type !== 'Akteur') isDimmed = true;
      else if (ghostMode && !isGhost) isDimmed = true;
    }

    if (isDimmed) {
      color = focusedSubnetwork ? 'rgba(203, 213, 225, 0.08)' : 'rgba(203, 213, 225, 0.25)';
      strokeColor = focusedSubnetwork ? 'rgba(203, 213, 225, 0.12)' : 'rgba(203, 213, 225, 0.4)';
      radius = Math.max(1.4, radius * 0.35);
    }

    // Halo-Ringe & Fokussierungs-Aura
    if (isFocalNode) {
      radius = node.type === 'Institution' ? 14 : 10;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI, false);
      ctx.fillStyle = node.type === 'Institution' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(180, 83, 9, 0.3)';
      ctx.fill();
    } else if ((isGhost && ghostMode) || (activeMetricFilter === 'raub' && isGhost)) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.2)';
      ctx.fill();
    } else if (isContested && activeMetricFilter === 'dissonanz') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(202, 138, 4, 0.25)';
      ctx.fill();
    } else if (isGap && activeMetricFilter === 'luecken') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 6, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(124, 58, 237, 0.3)';
      ctx.fill();
    } else if (isSuspicion && activeMetricFilter === 'verdacht') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 6, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(8, 145, 178, 0.35)';
      ctx.fill();
    }

    if (isSelected || isLinkEndpoint || matchesSearch) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Zeichne Knoten-Kreis
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();

    // Rahmen
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    if (node.type === 'Institution' && !isDimmed) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius - 3, 0, 2 * Math.PI, false);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Text Label Rendering
    const shouldShowLabel = 
      isFocalNode ||
      (focusedSubnetwork && isEntityConnected && (node.type === 'Institution' || node.type === 'Akteur' || isSelected || isLinkEndpoint)) ||
      isSelected || 
      isLinkEndpoint ||
      (node.type === 'Institution' && !isDimmed) || 
      (isGhost && ghostMode) || 
      (isContested && activeMetricFilter === 'dissonanz') ||
      (isGap && activeMetricFilter === 'luecken') ||
      (isSuspicion && activeMetricFilter === 'verdacht') ||
      (node.type === 'Akteur' && globalScale > 1.6 && !isDimmed) || 
      matchesSearch || 
      globalScale > 3.0;

    if (shouldShowLabel) {
      const label = node.label || node.id;
      const fontSize = Math.max(9 / globalScale, 2.5);
      ctx.font = `${node.type === 'Institution' || isFocalNode ? 'bold ' : ''}${fontSize}px 'Space Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const textWidth = ctx.measureText(label).width;
      const boxPadding = 3;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(node.x - textWidth / 2 - boxPadding, node.y + radius + 2, textWidth + boxPadding * 2, fontSize + 4);
      ctx.strokeStyle = isFocalNode ? '#000000' : (isGhost ? '#DC2626' : (isContested ? '#CA8A04' : (isGap && activeMetricFilter === 'luecken' ? '#7C3AED' : (isSuspicion && activeMetricFilter === 'verdacht' ? '#0891B2' : '#000000'))));
      ctx.lineWidth = isFocalNode ? 2 : 1;
      ctx.strokeRect(node.x - textWidth / 2 - boxPadding, node.y + radius + 2, textWidth + boxPadding * 2, fontSize + 4);

      ctx.fillStyle = isFocalNode ? '#000000' : (isGhost ? '#DC2626' : (isContested ? '#854D0E' : (isGap && activeMetricFilter === 'luecken' ? '#7C3AED' : (isSuspicion && activeMetricFilter === 'verdacht' ? '#0E7490' : '#000000'))));
      ctx.fillText(label, node.x, node.y + radius + fontSize / 2 + 4);
    }
  }, [ghostIds, ghostMode, contestedIds, gapIds, suspicionIds, activeMetricFilter, selectedNode, selectedLink, searchTerm, focusedSubnetwork]);

  // 9. Custom Link Styling
  const linkColor = useCallback((link: any) => {
    const isRaub = link.type === 'RAUBTE' || link.delikt === 'RAUBTE' || link.type === 'ENTEIGNETE';
    const isSchenkung = link.type === 'SCHENKTE' || link.type === 'VERKAUFTE_AN';
    const isVerdacht = link.type === 'VERDACHT_AUF';
    const isSelected = selectedLink && (
      ((selectedLink.source.id || selectedLink.source) === (link.source.id || link.source)) &&
      ((selectedLink.target.id || selectedLink.target) === (link.target.id || link.target)) &&
      selectedLink.type === link.type
    );
    const isHovered = hoveredLink === link;

    if (isSelected || isHovered) {
      return isRaub ? '#991B1B' : (isSchenkung ? '#1D4ED8' : (isVerdacht ? '#0E7490' : '#000000'));
    }

    // Forensischer Entitaeten-Fokus (Täter- & Depot-Isolation in dunkle Schatten)
    if (focusedSubnetwork) {
      if (!focusedSubnetwork.linkSet.has(link)) {
        return 'rgba(203, 213, 225, 0.03)';
      }
    }

    // Interaktive Filter-Dimmung
    if (activeMetricFilter === 'verdacht') {
      return isVerdacht ? '#0891B2' : 'rgba(203, 213, 225, 0.08)';
    }
    if (activeMetricFilter === 'luecken') {
      const sId = link.source.id || link.source;
      const tId = link.target.id || link.target;
      if (gapIds.has(sId) || gapIds.has(tId)) {
        return '#7C3AED';
      }
      return 'rgba(203, 213, 225, 0.12)';
    }
    if (activeMetricFilter === 'raub') {
      return isRaub ? '#DC2626' : 'rgba(203, 213, 225, 0.15)';
    }
    if (activeMetricFilter === 'schenkung') {
      return isSchenkung ? '#2563EB' : 'rgba(203, 213, 225, 0.15)';
    }
    if (activeMetricFilter === 'dissonanz') {
      if (link.kollision) {
        return isRaub ? '#DC2626' : (isSchenkung ? '#2563EB' : '#CA8A04');
      }
      return 'rgba(203, 213, 225, 0.12)';
    }
    if (ghostMode) {
      return 'rgba(203, 213, 225, 0.15)';
    }

    if (isVerdacht) return '#0891B2';
    if (isRaub) return '#DC2626';
    if (isSchenkung) return '#2563EB';
    if (link.type === 'LAGERT_IN') return '#64748B';
    return '#CBD5E1';
  }, [activeMetricFilter, ghostMode, gapIds, selectedLink, hoveredLink, focusedSubnetwork]);

  const linkWidth = useCallback((link: any) => {
    const isSelected = selectedLink && (
      ((selectedLink.source.id || selectedLink.source) === (link.source.id || link.source)) &&
      ((selectedLink.target.id || selectedLink.target) === (link.target.id || link.target)) &&
      selectedLink.type === link.type
    );
    const isHovered = hoveredLink === link;

    if (isSelected || isHovered) return 3.5;

    // Forensischer Entitaeten-Fokus Kantenstaerke
    if (focusedSubnetwork) {
      if (!focusedSubnetwork.linkSet.has(link)) return 0.15;
      if (link.type === 'RAUBTE' || link.delikt === 'RAUBTE') return 2.8;
      if (link.type === 'SCHENKTE' || link.type === 'VERKAUFTE_AN') return 2.2;
      if (link.type === 'VERDACHT_AUF') return 2.5;
      return 1.6;
    }

    if (activeMetricFilter === 'verdacht') {
      return link.type === 'VERDACHT_AUF' ? 3.0 : 0.3;
    }
    if (activeMetricFilter === 'luecken') {
      const sId = link.source.id || link.source;
      const tId = link.target.id || link.target;
      return (gapIds.has(sId) || gapIds.has(tId)) ? 2.4 : 0.3;
    }
    if (activeMetricFilter === 'raub') {
      return (link.type === 'RAUBTE' || link.type === 'ENTEIGNETE') ? 2.4 : 0.4;
    }
    if (activeMetricFilter === 'schenkung') {
      return (link.type === 'SCHENKTE' || link.type === 'VERKAUFTE_AN') ? 2.2 : 0.4;
    }
    if (activeMetricFilter === 'dissonanz') {
      return link.kollision ? 2.4 : 0.5;
    }

    if (link.type === 'VERDACHT_AUF') return 2.2;
    if (link.type === 'RAUBTE') return 1.8;
    if (link.type === 'SCHENKTE') return 1.4;
    if (link.type === 'LAGERT_IN') return 1.1;
    return 0.8;
  }, [activeMetricFilter, gapIds, selectedLink, hoveredLink, focusedSubnetwork]);

  // 9.1 Custom Canvas Rendering fuer gestrichelte VERDACHT_AUF Kanten
  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    if (link.type !== 'VERDACHT_AUF') return;
    const start = link.source;
    const end = link.target;
    if (!start || !end || typeof start !== 'object' || typeof end !== 'object') return;
    if (start.x === undefined || end.x === undefined || start.y === undefined || end.y === undefined) return;

    const isSelected = selectedLink && (
      ((selectedLink.source.id || selectedLink.source) === (link.source.id || link.source)) &&
      ((selectedLink.target.id || selectedLink.target) === (link.target.id || link.target)) &&
      selectedLink.type === link.type
    );
    const isHovered = hoveredLink === link;
    const isDimmed = activeMetricFilter && activeMetricFilter !== 'verdacht';

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = (isSelected || isHovered) ? '#0E7490' : (isDimmed ? 'rgba(8, 145, 178, 0.15)' : '#0891B2');
    ctx.lineWidth = (isSelected || isHovered) ? 3.5 : (activeMetricFilter === 'verdacht' ? 3.0 : 2.2);
    ctx.stroke();
    ctx.restore();
  }, [selectedLink, hoveredLink, activeMetricFilter]);

  // Details fuer ausgewaehlten Knoten
  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    const connectedLinks = graphData.links.filter(
      l => (l.source.id || l.source) === selectedNode.id || (l.target.id || l.target) === selectedNode.id
    );
    const isGhost = ghostIds.has(selectedNode.id);
    const isContested = contestedIds.has(selectedNode.id);
    const contestedInfo = contestedMap[selectedNode.id] || null;

    return {
      ...selectedNode,
      isGhost,
      isContested,
      contestedInfo,
      links: connectedLinks
    };
  }, [selectedNode, graphData, ghostIds, contestedIds, contestedMap]);

  return (
    <div className="app-root" style={{ width: '100vw', height: '100vh', backgroundColor: '#F7F6F2', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: '#141413' }}>
      
      {/* 1. TOP HEADER (Archival Forensics 2-Tier Masthead) */}
      <header className="app-header" style={{ width: '100%', borderBottom: '1px solid #1C1B19', backgroundColor: '#FFFFFF', zIndex: 60, flexShrink: 0, boxSizing: 'border-box' }}>
        {/* Hidden File Input for Ingestion */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,.txt"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />

        {/* ========================================================= */}
        {/* DESKTOP HEADER (ARCHIVAL FORENSICS LAYOUT)                */}
        {/* ========================================================= */}
        <div className="desktop-header">
          {/* TIER 1: BRAND, VIEWS, SEARCH, LANGUAGE, AUTH, TOOLS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 18px', borderBottom: '1px solid #E5E2DA', gap: '12px', flexWrap: 'wrap' }}>
            {/* Left: Brand & View Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="mono" style={{ backgroundColor: '#141413', color: '#F7F6F2', padding: '3px 8px', fontWeight: 700, fontSize: '10px', letterSpacing: '0.08em' }}>
                  PROJECT ECHO
                </span>
                <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.02em', color: '#141413' }}>
                  Shadow Museum Atlas
                </span>
                <span className="brand-subtitle" style={{ fontSize: '11px', color: '#78766F', fontWeight: 500, borderLeft: '1px solid #D8D5CD', paddingLeft: '8px' }}>
                  {t('Colonial Provenance Research', 'Koloniale Provenienzforschung', 'Recherche de provenance coloniale')}
                </span>
              </div>

              {/* View Mode Switcher */}
              <div style={{ display: 'flex', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2', padding: '2px', gap: '2px', borderRadius: '2px', flexWrap: 'wrap' }}>
                <button
                  data-testid="tab-graph"
                  onClick={() => setViewMode('graph')}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: viewMode === 'graph' ? '#141413' : 'transparent',
                    color: viewMode === 'graph' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: '1px'
                  }}
                >
                  {t('Knowledge Graph', 'Wissensgraph', 'Graphe')}
                </button>
                <button
                  data-testid="tab-map"
                  onClick={() => setViewMode('map')}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: viewMode === 'map' ? '#141413' : 'transparent',
                    color: viewMode === 'map' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    borderBottom: viewMode === 'map' ? '2px solid #DC2626' : '2px solid transparent',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: '1px'
                  }}
                >
                  {t('Geospatial Map', 'Geo-Karte', 'Carte Géo')}
                </button>
                <button
                  data-testid="tab-visual"
                  onClick={() => setViewMode('visual')}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: viewMode === 'visual' ? '#141413' : 'transparent',
                    color: viewMode === 'visual' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    borderBottom: viewMode === 'visual' ? '2px solid #155E75' : '2px solid transparent',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: '1px'
                  }}
                >
                  {t('Visual Forensics', 'Bild-Forensik', 'Forensique visuelle')}
                </button>
                <button
                  data-testid="tab-docs"
                  onClick={() => setViewMode('docs')}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: viewMode === 'docs' ? '#141413' : 'transparent',
                    color: viewMode === 'docs' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    borderBottom: viewMode === 'docs' ? '2px solid #1E40AF' : '2px solid transparent',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: '1px'
                  }}
                >
                  {t('Documents', 'Dokumente', 'Documents')}
                </button>
              </div>
            </div>

            {/* Right: Search, Language, Auth, Quiet Tools */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {uploadMessage && (
                <span className="mono" style={{ padding: '4px 8px', backgroundColor: '#141413', color: '#F7F6F2', fontSize: '10px', borderRadius: '2px' }}>
                  {uploadMessage}
                </span>
              )}
              {batchStatus && (
                <span className="mono" style={{ padding: '4px 8px', backgroundColor: '#92400E', color: '#FFFFFF', fontSize: '10px', borderRadius: '2px' }}>
                  {batchStatus}
                </span>
              )}

              {/* Search Bar */}
              <div className="desktop-search-box" style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', width: '215px', backgroundColor: '#F7F6F2', border: '1px solid #D8D5CD', borderRadius: '2px' }}>
                <input
                  type="text"
                  placeholder={t('Search inventory, actor, depot…', 'Suche Inv., Akteur, Depot…', 'Rechercher inv., acteur, dépôt…')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    fontSize: '11px',
                    color: '#141413',
                    backgroundColor: 'transparent',
                  }}
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#52514C', fontSize: '11px', padding: '0 2px' }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Language Switcher (EN | DE | FR) */}
              <div className="mono" style={{ display: 'flex', border: '1px solid #D8D5CD', borderRadius: '2px', overflow: 'hidden' }} role="group" aria-label="Language">
                <button
                  type="button"
                  data-testid="lang-btn-en"
                  onClick={() => setLang('en')}
                  style={{
                    padding: '4px 7px',
                    backgroundColor: lang === 'en' ? '#141413' : '#FFFFFF',
                    color: lang === 'en' ? '#FFFFFF' : '#52514C',
                    border: 'none',
                    borderRight: '1px solid #D8D5CD',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Switch interface to English"
                >
                  EN
                </button>
                <button
                  type="button"
                  data-testid="lang-btn-de"
                  onClick={() => setLang('de')}
                  style={{
                    padding: '4px 7px',
                    backgroundColor: lang === 'de' ? '#141413' : '#FFFFFF',
                    color: lang === 'de' ? '#FFFFFF' : '#52514C',
                    border: 'none',
                    borderRight: '1px solid #D8D5CD',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Oberfläche auf Deutsch umschalten"
                >
                  DE
                </button>
                <button
                  type="button"
                  data-testid="lang-btn-fr"
                  onClick={() => setLang('fr')}
                  style={{
                    padding: '4px 7px',
                    backgroundColor: lang === 'fr' ? '#141413' : '#FFFFFF',
                    color: lang === 'fr' ? '#FFFFFF' : '#52514C',
                    border: 'none',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Passer l'interface en français"
                >
                  FR
                </button>
              </div>

              {/* Dual-Mode Auth Badge */}
              {isResearcher ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: '1px solid #86EFAC',
                  backgroundColor: '#F0FDF4',
                  padding: '3px 8px',
                  borderRadius: '2px'
                }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#166534' }}>
                    {t('● Researcher', '● Forscher-Modus', '● Chercheur')}
                  </span>
                  <button
                    onClick={handleLogout}
                    title={t('Sign out and switch to guest mode', 'Ausloggen und in Gast-Modus wechseln', 'Se déconnecter et passer en mode invité')}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      fontWeight: 600,
                      backgroundColor: '#FFFFFF',
                      color: '#141413',
                      border: '1px solid #D8D5CD',
                      cursor: 'pointer'
                    }}
                  >
                    {t('Sign out', 'Logout', 'Sortir')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowLoginModal(true); setLoginError(null); }}
                  title={t('Enable researcher or browser sandbox write access', 'Forscher- oder Browser-Sandbox-Modus aktivieren', "Activer le mode chercheur ou bac à sable local")}
                  className="archival-btn"
                  style={{ padding: '4px 9px', fontSize: '10.5px' }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#78766F', display: 'inline-block' }} />
                  {t('Researcher Mode', 'Forscher-Login', 'Mode Chercheur')}
                </button>
              )}

              {/* Quiet Tool Controls */}
              <button
                onClick={() => {
                  const next = !kioskMode;
                  setKioskMode(next);
                  if (next) {
                    setActiveMetricFilter(null);
                    setGhostMode(false);
                  }
                }}
                title={t(
                  'Museum installation mode: automatic camera tour across looted and contested nodes',
                  'Museums-Installationsmodus: Automatischer Kameraflug über Raubkunst- und Dissonanzknoten',
                  'Mode exposition muséale : survol automatique des nœuds pillés et contestés'
                )}
                className="archival-btn"
                style={{
                  padding: '4px 8px',
                  fontSize: '10.5px',
                  backgroundColor: kioskMode ? '#141413' : '#FFFFFF',
                  color: kioskMode ? '#FBBF24' : '#3F3E3A',
                  borderColor: kioskMode ? '#141413' : '#D8D5CD'
                }}
              >
                {kioskMode ? t('Tour active', 'Tour aktiv', 'Visite active') : t('Kiosk Tour', 'Kiosk-Tour', 'Visite')}
              </button>

              <button
                onClick={() => {
                  setGhostMode(!ghostMode);
                  if (!ghostMode) setActiveMetricFilter(null);
                  if (fgRef.current) fgRef.current.zoomToFit(800, 50);
                }}
                className="archival-btn"
                style={{
                  padding: '4px 8px',
                  fontSize: '10.5px',
                  backgroundColor: ghostMode ? '#991B1B' : '#FFFFFF',
                  color: ghostMode ? '#FFFFFF' : '#3F3E3A',
                  borderColor: ghostMode ? '#991B1B' : '#D8D5CD'
                }}
              >
                {ghostMode ? t('Missing active', 'Verschollen aktiv', 'Disparus actifs') : t('Missing', 'Verschollen', 'Disparus')}
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="archival-btn"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
              >
                {isUploading
                  ? t('Ingesting…', 'Lädt…', 'Ingestion…')
                  : t('+ Import Source', '+ Quelle laden', '+ Importer')}
              </button>

              <button
                onClick={() => fgRef.current?.zoomToFit(600, 40)}
                className="archival-btn"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
              >
                {t('Fit', 'Anpassen', 'Ajuster')}
              </button>

              <button
                onClick={handleResetLayout}
                title={t('Reset manual node positions', 'Manuelle Knoten-Positionen zurücksetzen', 'Réinitialiser la disposition')}
                className="archival-btn"
                style={{ padding: '4px 8px', fontSize: '10.5px', color: '#52514C' }}
              >
                {t('Reset', 'Reset', 'Réinit.')}
              </button>
            </div>
          </div>

          {/* TIER 2: QUIET SEMANTIC METRICS & SOURCES */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 18px', gap: '12px', flexWrap: 'wrap', backgroundColor: '#F7F6F2' }}>
            {/* Metrik-Schalter (Ruhige Archiv-Filter mit semantischem Farbpunkt) */}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
              {([
                ['subjekte', stats.subjekte.toLocaleString(), t('Objects', 'Subjekte', 'Objets'), '#141413', t('Isolate all cultural heritage objects', 'Alle Kulturgüter isolieren', 'Isoler tous les biens culturels')],
                ['raub', stats.raub_kanten.toLocaleString(), t('Loot', 'Raub', 'Pillage'), '#991B1B', t('Isolate military looting network', 'Militärisches Raubnetzwerk isolieren', 'Isoler le réseau de pillage militaire')],
                ['schenkung', stats.schenk_kanten.toLocaleString(), t('Donations', 'Schenkungen', 'Dons'), '#1E40AF', t('Isolate alleged museum donations', 'Offizielle Museums-Schenkungen isolieren', 'Isoler les dons allégués')],
                ['dissonanz', stats.contested_objekte.toLocaleString(), t('Dissonances', 'Dissonanzen', 'Dissonances'), '#92400E', t('Isolate multigraph collisions', 'Multigraph-Kollisionen isolieren', 'Isoler les dissonances sémantiques')],
                ['luecken', (stats.provenienz_luecken || 83).toLocaleString(), t('Gaps', 'Lücken', 'Lacunes'), '#5B21B6', t('Isolate provenance gaps (no recorded actor)', 'Provenienzlücken isolieren (ohne Akteur)', 'Isoler les lacunes de provenance')],
                ['verdacht', (stats.verdacht_kanten || suspicions.length || 36).toLocaleString(), t('Suspicions', 'Verdacht', 'Soupçons'), '#155E75', t('Isolate probabilistic suspicion edges', 'Probabilistische Verdachtskanten isolieren', 'Isoler les soupçons probabilistes')],
                ['akteure', String(stats.akteure), t('Actors', 'Akteure', 'Acteurs'), '#9A3412', t('Isolate colonial actors / officers', 'Kolonialakteure isolieren', 'Isoler les acteurs coloniaux')],
                ['depots', String(stats.institutionen), t('Depots', 'Depots', 'Dépôts'), '#3F3E3A', t('Isolate museum depots', 'Museumsdepots isolieren', 'Isoler les dépôts muséaux')],
              ] as const).map(([key, countStr, label, accent, tip]) => {
                const active = activeMetricFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleMetricToggle(key)}
                    title={tip}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      backgroundColor: active ? accent : '#FFFFFF',
                      color: active ? '#FFFFFF' : '#141413',
                      border: `1px solid ${active ? accent : '#D8D5CD'}`,
                      borderRadius: '2px',
                      padding: '3px 8px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: active ? '#FFFFFF' : accent, display: 'inline-block' }} />
                    <span className="mono" style={{ fontSize: '10px', fontWeight: 700 }}>{countStr}</span>
                    <span>{label}</span>
                  </button>
                );
              })}

              {activeMetricFilter && (
                <button
                  onClick={() => setActiveMetricFilter(null)}
                  style={{
                    backgroundColor: '#141413',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '4px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t('Clear filter', 'Filter aufheben', 'Effacer le filtre')}
                </button>
              )}
            </div>

            {/* Zuschaltbare Quellen */}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#78766F' }}>{t('Sources:', 'Quellen:', 'Sources :')}</span>
              {publications.map((pub: any) => {
                const isActive = selectedPubs.has(pub.id);
                return (
                  <div key={pub.id} style={{ display: 'inline-flex', border: '1px solid #D8D5CD', borderRadius: '2px', overflow: 'hidden' }}>
                    <button
                      onClick={() => togglePublication(pub.id)}
                      title={`${pub.name} (${pub.typ}, ${pub.jahr || ''})`}
                      className="mono"
                      style={{
                        padding: '2px 6px',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        backgroundColor: isActive ? '#141413' : '#FFFFFF',
                        color: isActive ? '#F7F6F2' : '#78766F',
                        border: 'none',
                        borderRight: isResearcher ? '1px solid #D8D5CD' : 'none',
                        textDecoration: isActive ? 'none' : 'line-through'
                      }}
                    >
                      {pub.kuerzel} ({pub.edge_count})
                    </button>
                    {isResearcher && (
                      <button
                        onClick={() => handleDeletePublication(pub.id)}
                        title={t('Permanently delete publication', 'Publikation restlos löschen', 'Supprimer définitivement cette publication')}
                        style={{
                          padding: '2px 5px',
                          fontSize: '9.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          backgroundColor: '#FEF2F2',
                          color: '#991B1B',
                          border: 'none'
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* MOBILE HEADER (ARCHIVAL COMPACT TOP BAR + DRAWER)         */}
        {/* ========================================================= */}
        <div className="mobile-header">
          {/* Top Bar (Height ~46px) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 8px', backgroundColor: '#FFFFFF', borderBottom: mobileMenuOpen ? '1px solid #D8D5CD' : 'none', gap: '4px', minHeight: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
              <button
                type="button"
                data-testid="mobile-index-toggle"
                onClick={() => { setMobileSidebarOpen(!mobileSidebarOpen); setMobileMenuOpen(false); }}
                style={{
                  padding: '4px 7px',
                  backgroundColor: mobileSidebarOpen ? '#9A3412' : '#141413',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '2px',
                  fontWeight: 600,
                  fontSize: '10px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
                title={t('Browse Actors, Depots, Provenance Gaps & Key Objects', 'Akteure, Depots, Lücken & Leitobjekte öffnen', 'Parcourir acteurs, dépôts, lacunes et objets phares')}
              >
                {mobileSidebarOpen ? '✕ Index' : '☰ Index'}
              </button>
              <span className="mono" style={{ fontSize: '10px', fontWeight: 700, color: '#141413', whiteSpace: 'nowrap' }}>
                ECHO
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              <div style={{ display: 'flex', border: '1px solid #D8D5CD', backgroundColor: '#F7F6F2', padding: '1px', borderRadius: '2px' }}>
                <button
                  data-testid="mobile-tab-graph"
                  onClick={() => { setViewMode('graph'); setMobileSidebarOpen(false); }}
                  style={{
                    padding: '4px 6px',
                    backgroundColor: viewMode === 'graph' ? '#141413' : 'transparent',
                    color: viewMode === 'graph' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t('Graph', 'Graph', 'Graph')}
                </button>
                <button
                  data-testid="mobile-tab-map"
                  onClick={() => { setViewMode('map'); setMobileSidebarOpen(false); }}
                  style={{
                    padding: '4px 6px',
                    backgroundColor: viewMode === 'map' ? '#991B1B' : 'transparent',
                    color: viewMode === 'map' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t('Map', 'Map', 'Carte')}
                </button>
                <button
                  data-testid="mobile-tab-visual"
                  onClick={() => { setViewMode('visual'); setMobileSidebarOpen(false); }}
                  style={{
                    padding: '4px 6px',
                    backgroundColor: viewMode === 'visual' ? '#155E75' : 'transparent',
                    color: viewMode === 'visual' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t('Photo', 'Foto', 'Photo')}
                </button>
                <button
                  data-testid="mobile-tab-docs"
                  onClick={() => { setViewMode('docs'); setMobileSidebarOpen(false); }}
                  style={{
                    padding: '4px 6px',
                    backgroundColor: viewMode === 'docs' ? '#1E40AF' : 'transparent',
                    color: viewMode === 'docs' ? '#FFFFFF' : '#3F3E3A',
                    border: 'none',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t('Docs', 'Doks', 'Docs')}
                </button>
              </div>

              <button
                type="button"
                data-testid="mobile-lang-toggle"
                onClick={cycleLang}
                className="mono"
                style={{
                  padding: '4px 6px',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  border: '1px solid #D8D5CD',
                  borderRadius: '2px',
                  backgroundColor: '#FFFFFF',
                  color: '#141413',
                  cursor: 'pointer'
                }}
                title={t('Switch language (EN / DE / FR)', 'Sprache wechseln (EN / DE / FR)', 'Changer de langue (EN / DE / FR)')}
              >
                {lang.toUpperCase()}
              </button>

              <button
                onClick={() => { setMobileMenuOpen(!mobileMenuOpen); setMobileSidebarOpen(false); }}
                style={{
                  padding: '4px 7px',
                  fontSize: '10px',
                  fontWeight: 600,
                  border: '1px solid #D8D5CD',
                  borderRadius: '2px',
                  backgroundColor: mobileMenuOpen ? '#141413' : '#FFFFFF',
                  color: mobileMenuOpen ? '#FFFFFF' : '#141413',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {mobileMenuOpen ? '✕' : '☰'}
              </button>
            </div>
          </div>

          {/* Expandable Mobile Drawer */}
          {mobileMenuOpen && (
            <div style={{ padding: '10px 12px', backgroundColor: '#F8FAFC', borderTop: '2px solid #000000', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '70vh', overflowY: 'auto', boxSizing: 'border-box' }}>
              {/* Mobile Language Selector */}
              <div style={{ display: 'flex', border: '1.5px solid #000000' }}>
                {(['en', 'de', 'fr'] as const).map((code, idx) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      fontSize: '8.5px',
                      fontWeight: 900,
                      border: 'none',
                      borderRight: idx < 2 ? '1px solid #000000' : 'none',
                      backgroundColor: lang === code ? '#000000' : '#FFFFFF',
                      color: lang === code ? '#FFFFFF' : '#000000',
                      cursor: 'pointer'
                    }}
                  >
                    {code === 'en' ? 'ENGLISH (EN)' : code === 'de' ? 'DEUTSCH (DE)' : 'FRANÇAIS (FR)'}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="brutalist-border" style={{ padding: '4px 8px', display: 'flex', gap: '4px', width: '100%', boxSizing: 'border-box', backgroundColor: '#FFFFFF' }}>
                <input
                  type="text"
                  placeholder={t('SEARCH (INV / ACTOR / DEPOT)...', 'SUCHE (INV / AKTEUR / DEPOT)...', 'RECHERCHE (INV / ACTEUR / DÉPÔT)...')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    backgroundColor: 'transparent',
                    fontFamily: "'Space Mono', monospace"
                  }}
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}
                  >
                    [X]
                  </button>
                )}
              </div>

              {/* Dual-Mode Auth & Actions */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                {isResearcher ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1.5px solid #16A34A', backgroundColor: '#F0FDF4', padding: '3px 6px' }}>
                    <span style={{ fontSize: '8px', fontWeight: 900, color: '#16A34A' }}>{t('● RESEARCHER', '● MARIANNE', '● CHERCHEUR')}</span>
                    <button onClick={handleLogout} style={{ padding: '2px 5px', fontSize: '8px', fontWeight: 'bold', backgroundColor: '#000000', color: '#FFFFFF', border: 'none', cursor: 'pointer' }}>{t('LOGOUT', 'LOGOUT', 'SORTIR')}</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1.5px solid #64748B', backgroundColor: '#FFFFFF', padding: '3px 6px' }}>
                    <span style={{ fontSize: '8px', fontWeight: 900, color: '#475569' }}>{t('○ GUEST', '○ GAST', '○ INVITÉ')}</span>
                    <button onClick={() => { setShowLoginModal(true); setLoginError(null); setMobileMenuOpen(false); }} style={{ padding: '2px 5px', fontSize: '8px', fontWeight: 'bold', backgroundColor: '#000000', color: '#FFFFFF', border: 'none', cursor: 'pointer' }}>{t('LOGIN', 'LOGIN', 'CONNEXION')}</button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => { handleResetLayout(); setMobileMenuOpen(false); }} style={{ padding: '4px 6px', backgroundColor: '#000000', color: '#FFFFFF', border: '1.5px solid #000000', fontSize: '8px', fontWeight: 'bold', cursor: 'pointer' }}>[RESET]</button>
                  <button onClick={() => { fgRef.current?.zoomToFit(600, 40); setMobileMenuOpen(false); }} style={{ padding: '4px 6px', backgroundColor: '#FFFFFF', border: '1.5px solid #000000', fontSize: '8px', fontWeight: 'bold', cursor: 'pointer' }}>[ZOOM]</button>
                </div>
              </div>

              {/* Mode Toggles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  onClick={() => {
                    const next = !kioskMode;
                    setKioskMode(next);
                    if (next) {
                      setActiveMetricFilter(null);
                      setGhostMode(false);
                    }
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    padding: '6px 8px',
                    backgroundColor: kioskMode ? '#000000' : '#FFFFFF',
                    color: kioskMode ? '#F59E0B' : '#000000',
                    border: kioskMode ? '2px solid #F59E0B' : '1.5px solid #000000',
                    fontWeight: 900,
                    fontSize: '9px',
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  {kioskMode ? t('● KIOSK: ACTIVE', '● KIOSK: AKTIV', '● KIOSQUE : ACTIF') : t('○ KIOSK MODE', '○ KIOSK-MODUS', '○ MODE KIOSQUE')}
                </button>
                <button
                  onClick={() => {
                    setGhostMode(!ghostMode);
                    if (!ghostMode) setActiveMetricFilter(null);
                    if (fgRef.current) fgRef.current.zoomToFit(800, 50);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    padding: '6px 8px',
                    backgroundColor: ghostMode ? '#DC2626' : '#FFFFFF',
                    color: ghostMode ? '#FFFFFF' : '#000000',
                    border: '1.5px solid #000000',
                    fontWeight: 'bold',
                    fontSize: '9px',
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  {ghostMode ? t('● GHOST ACTIVE', '● GHOST AKTIV', '● FANTÔME ACTIF') : t('○ GHOST NODES', '○ GHOST NODES', '○ NŒUDS FANTÔMES')}
                </button>
              </div>

              {/* File Ingestion */}
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                  setMobileMenuOpen(false);
                }}
                disabled={isUploading}
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#FFFFFF',
                  color: '#000000',
                  border: '1.5px dashed #000000',
                  fontWeight: 'bold',
                  fontSize: '9px',
                  cursor: isUploading ? 'wait' : 'pointer',
                  textAlign: 'center'
                }}
              >
                {isUploading ? t('[INGESTING...]', '[INGESTION LAEUFT...]', '[INGESTION...]') : t('[+ INJECT SOURCE]', '[+ QUELLE INJIZIEREN]', '[+ INJECTER UNE SOURCE]')}
              </button>

              {/* Metric Filters */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 900, color: '#475569', letterSpacing: '0.5px' }}>
                    {t('METRIC FILTERS (ISOLATE):', 'METRIK-FILTER (ISOLIEREN):', 'FILTRES MÉTRIQUES (ISOLER) :')}
                  </span>
                  {activeMetricFilter && (
                    <button
                      onClick={() => setActiveMetricFilter(null)}
                      style={{
                        backgroundColor: '#000000',
                        color: '#FFFFFF',
                        border: 'none',
                        padding: '2px 5px',
                        fontSize: '8px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      [RESET]
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                  <button
                    onClick={() => { handleMetricToggle('subjekte'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'subjekte' ? '#000000' : '#FFFFFF',
                      color: activeMetricFilter === 'subjekte' ? '#FFFFFF' : '#000000',
                      border: '1.5px solid #000000',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.subjekte.toLocaleString()} {t('OBJECTS', 'SUBJEKTE', 'OBJETS')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('raub'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'raub' ? '#DC2626' : '#FFFFFF',
                      color: activeMetricFilter === 'raub' ? '#FFFFFF' : '#DC2626',
                      border: '1.5px solid #DC2626',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.raub_kanten.toLocaleString()} {t('LOOT', 'RAUB', 'PILLAGE')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('schenkung'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'schenkung' ? '#2563EB' : '#FFFFFF',
                      color: activeMetricFilter === 'schenkung' ? '#FFFFFF' : '#2563EB',
                      border: '1.5px solid #2563EB',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.schenk_kanten.toLocaleString()} {t('DONATION', 'SCHENKUNG', 'DON')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('dissonanz'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'dissonanz' ? '#CA8A04' : '#FFFFFF',
                      color: activeMetricFilter === 'dissonanz' ? '#FFFFFF' : '#854D0E',
                      border: '1.5px solid #CA8A04',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.contested_objekte.toLocaleString()} {t('DISSONANCE', 'DISSONANZ', 'DISSONANCE')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('luecken'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'luecken' ? '#7C3AED' : '#FFFFFF',
                      color: activeMetricFilter === 'luecken' ? '#FFFFFF' : '#7C3AED',
                      border: '1.5px solid #7C3AED',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {(stats.provenienz_luecken || 83).toLocaleString()} {t('GAPS', 'LÜCKEN', 'LACUNES')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('verdacht'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'verdacht' ? '#0891B2' : '#FFFFFF',
                      color: activeMetricFilter === 'verdacht' ? '#FFFFFF' : '#0891B2',
                      border: '1.5px solid #0891B2',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {(stats.verdacht_kanten || suspicions.length || 36).toLocaleString()} {t('SUSPICION', 'VERDACHT', 'SOUPÇON')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('akteure'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'akteure' ? '#B45309' : '#FFFFFF',
                      color: activeMetricFilter === 'akteure' ? '#FFFFFF' : '#B45309',
                      border: '1.5px solid #B45309',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.akteure} {t('ACTORS', 'AKTEURE', 'ACTEURS')}
                  </button>

                  <button
                    onClick={() => { handleMetricToggle('depots'); setMobileMenuOpen(false); }}
                    style={{
                      backgroundColor: activeMetricFilter === 'depots' ? '#000000' : '#FFFFFF',
                      color: activeMetricFilter === 'depots' ? '#FFFFFF' : '#000000',
                      border: '1.5px solid #000000',
                      padding: '4px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {stats.institutionen} {t('DEPOTS', 'DEPOTS', 'DÉPÔTS')}
                  </button>
                </div>
              </div>

              {/* Quellen */}
              <div>
                <span style={{ fontSize: '9px', fontWeight: 900, color: '#475569', letterSpacing: '0.5px' }}>
                  {t('SOURCES:', 'QUELLEN:', 'SOURCES :')}
                </span>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {publications.map((pub: any) => {
                    const isActive = selectedPubs.has(pub.id);
                    return (
                      <div key={pub.id} style={{ display: 'inline-flex', border: '1px solid #000000' }}>
                        <button
                          onClick={() => togglePublication(pub.id)}
                          style={{
                            padding: '2px 4px',
                            fontSize: '8px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            backgroundColor: isActive ? '#000000' : '#FFFFFF',
                            color: isActive ? '#FFFFFF' : '#64748B',
                            border: 'none',
                            textDecoration: isActive ? 'none' : 'line-through'
                          }}
                        >
                          [{isActive ? 'X' : ' '}] {pub.kuerzel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 2. MAIN 3-COLUMN WORKSPACE */}
      <div className="app-workspace" style={{ flex: 1, display: 'flex', width: '100%', overflow: 'hidden', position: 'relative' }}>
        
        {mobileSidebarOpen && (
          <div className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />
        )}

        {/* COLUMN 1: LEFT SIDEBAR (SCHNELLFILTER — Archival Index) */}
        {(viewMode === 'graph' || viewMode === 'map' || mobileSidebarOpen) && (
        <aside
          className={`left-sidebar${mobileSidebarOpen ? ' mobile-open' : ''}`}
          style={{
            width: sidebarOpen || mobileSidebarOpen ? '316px' : '42px',
            height: '100%',
            borderRight: '1px solid #D8D5CD',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            zIndex: 40,
            boxSizing: 'border-box',
            transition: 'width 0.15s ease'
          }}
        >
          {/* Collapsed Strip */}
          {!sidebarOpen && !mobileSidebarOpen && (
            <div
              style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '14px', cursor: 'pointer', backgroundColor: '#F7F6F2' }}
              onClick={() => setSidebarOpen(true)}
              title={t('Open quick filters', 'Schnellfilter öffnen', 'Ouvrir les filtres rapides')}
            >
              <button style={{ border: '1px solid #D8D5CD', background: '#FFFFFF', color: '#141413', fontWeight: 700, fontSize: '12px', padding: '3px 7px', cursor: 'pointer', borderRadius: '2px' }}>
                +
              </button>
              <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', marginTop: '20px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.06em', color: '#52514C' }}>
                {t('Index · Actors / Depots / Gaps', 'Index · Akteure / Depots / Lücken', 'Index · Acteurs / Dépôts / Lacunes')}
              </div>
            </div>
          )}

          {/* Expanded Sidebar */}
          {(sidebarOpen || mobileSidebarOpen) && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              {/* Header */}
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #D8D5CD', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F7F6F2' }}>
                <div>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#141413' }}>
                    {t('Entity Index', 'Entitäten-Index', 'Index des entités')}
                  </div>
                  <div style={{ fontSize: '10px', color: '#78766F', marginTop: '1px' }}>
                    {t('1-click graph isolation', '1-Klick Isolation im Graphen', 'Isolation en 1 clic dans le graphe')}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (mobileSidebarOpen) setMobileSidebarOpen(false);
                    else setSidebarOpen(false);
                  }}
                  title={t('Minimize sidebar', 'Leiste minimieren', 'Réduire le panneau')}
                  style={{
                    padding: '2px 7px',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #D8D5CD',
                    color: '#52514C',
                    fontWeight: 600,
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  {mobileSidebarOpen ? '✕' : '–'}
                </button>
              </div>

              {/* Active Entity Focus Banner */}
              {focusedEntity && (
                <div style={{ padding: '8px 12px', backgroundColor: '#141413', color: '#F7F6F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t('Focus:', 'Fokus:', 'Focus :')} <span style={{ color: focusedEntity.type === 'actor' ? '#FBBF24' : '#93C5FD' }}>{focusedEntity.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      setFocusedEntity(null);
                      setFocusedSummary(null);
                      if (exclusiveCypherMode) {
                        setExclusiveCypherMode(false);
                        loadGraph(selectedPubs, '');
                      }
                    }}
                    style={{
                      backgroundColor: '#991B1B',
                      color: '#FFFFFF',
                      border: 'none',
                      padding: '2px 7px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                    title={t('Clear focus and show full atlas', 'Fokus aufheben und gesamten Atlas zeigen', "Lever le focus et afficher l'atlas complet")}
                  >
                    {t('Clear', 'Aufheben', 'Effacer')}
                  </button>
                </div>
              )}

              {/* Exclusive Cypher Mode Alert */}
              {exclusiveCypherMode && (
                <div style={{ padding: '6px 12px', backgroundColor: '#FEF2F2', borderBottom: '1px solid #F3D1D1', fontSize: '10.5px', color: '#991B1B', fontWeight: 600 }}>
                  {t(
                    'Exclusive subgraph active (entity nodes only)',
                    'Exklusiv-Subgraph aktiv (nur Knoten dieser Entität)',
                    'Sous-graphe exclusif actif (nœuds de cette entité uniquement)'
                  )}
                </div>
              )}

              {/* 4 Tabs: Actors, Depots, Gaps, POIs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #D8D5CD', backgroundColor: '#F7F6F2' }}>
                <button
                  onClick={() => setSidebarTab('actors')}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    backgroundColor: sidebarTab === 'actors' ? '#FFFFFF' : 'transparent',
                    color: sidebarTab === 'actors' ? '#141413' : '#52514C',
                    border: 'none',
                    borderBottom: sidebarTab === 'actors' ? '2px solid #141413' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  {t('Actors', 'Akteure', 'Acteurs')} <span className="mono" style={{ fontSize: '9.5px', opacity: 0.7 }}>{filterEntities.actors.length}</span>
                </button>
                <button
                  onClick={() => setSidebarTab('depots')}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    backgroundColor: sidebarTab === 'depots' ? '#FFFFFF' : 'transparent',
                    color: sidebarTab === 'depots' ? '#141413' : '#52514C',
                    border: 'none',
                    borderBottom: sidebarTab === 'depots' ? '2px solid #141413' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  {t('Depots', 'Depots', 'Dépôts')} <span className="mono" style={{ fontSize: '9.5px', opacity: 0.7 }}>{filterEntities.institutions.length}</span>
                </button>
                <button
                  onClick={() => setSidebarTab('gaps')}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    backgroundColor: sidebarTab === 'gaps' ? '#FFFFFF' : 'transparent',
                    color: sidebarTab === 'gaps' ? '#5B21B6' : '#52514C',
                    border: 'none',
                    borderBottom: sidebarTab === 'gaps' ? '2px solid #5B21B6' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  {t('Gaps', 'Lücken', 'Lacunes')} <span className="mono" style={{ fontSize: '9.5px', opacity: 0.7 }}>{gapItems.length || stats.provenienz_luecken}</span>
                </button>
                <button
                  onClick={() => setSidebarTab('pois')}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    backgroundColor: sidebarTab === 'pois' ? '#FFFFFF' : 'transparent',
                    color: sidebarTab === 'pois' ? '#155E75' : '#52514C',
                    border: 'none',
                    borderBottom: sidebarTab === 'pois' ? '2px solid #155E75' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  POIs <span className="mono" style={{ fontSize: '9.5px', opacity: 0.7 }}>{pinnedPois.length}</span>
                </button>
              </div>

              {/* Tab Search Filter */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid #ECEAE4', backgroundColor: '#FFFFFF' }}>
                <input
                  type="text"
                  placeholder={sidebarTab === 'actors'
                    ? t('Filter actors…', 'Akteure filtern…', 'Filtrer les acteurs…')
                    : (sidebarTab === 'depots'
                        ? t('Filter depots…', 'Depots filtern…', 'Filtrer les dépôts…')
                        : t('Inventory no. / object…', 'Inventarnr. / Objekt…', "N° d'inv. / objet…"))}
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    fontSize: '11px',
                    border: '1px solid #D8D5CD',
                    borderRadius: '2px',
                    outline: 'none',
                    backgroundColor: '#F7F6F2',
                    color: '#141413'
                  }}
                />
              </div>

              {/* Scrollable List */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {sidebarTab === 'actors' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredActors.map((actor: any) => {
                      const isFocused = focusedEntity && focusedEntity.name === actor.name;
                      return (
                        <div
                          key={actor.name}
                          onClick={() => handleSelectEntityFocus('actor', actor.name)}
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid #E2E8F0',
                            backgroundColor: isFocused ? '#000000' : '#FFFFFF',
                            color: isFocused ? '#FFFFFF' : '#000000',
                            cursor: 'pointer',
                            transition: 'background-color 0.1s ease',
                            borderLeft: isFocused ? '4px solid #B45309' : '4px solid transparent'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 900, fontSize: '10px' }}>{actor.name}</span>
                            <span
                              style={{
                                backgroundColor: isFocused ? '#DC2626' : '#FEE2E2',
                                color: isFocused ? '#FFFFFF' : '#991B1B',
                                padding: '1px 5px',
                                fontSize: '8px',
                                fontWeight: 'bold'
                              }}
                            >
                              {actor.raub_count} {t('LOOT', 'RAUB', 'PILLÉS')}
                            </span>
                          </div>
                          <div style={{ fontSize: '8px', color: isFocused ? '#94A3B8' : '#64748B', marginTop: '2px' }}>
                            {actor.rolle}
                          </div>
                          {actor.top_depots && actor.top_depots.length > 0 && (
                            <div style={{ fontSize: '8px', color: isFocused ? '#CBD5E1' : '#475569', marginTop: '2px', fontStyle: 'italic' }}>
                              &rarr; {actor.top_depots.join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {sidebarTab === 'depots' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredInstitutions.map((inst: any) => {
                      const isFocused = focusedEntity && focusedEntity.name === inst.name;
                      return (
                        <div
                          key={inst.name}
                          onClick={() => handleSelectEntityFocus('depot', inst.name)}
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid #E2E8F0',
                            backgroundColor: isFocused ? '#000000' : '#FFFFFF',
                            color: isFocused ? '#FFFFFF' : '#000000',
                            cursor: 'pointer',
                            transition: 'background-color 0.1s ease',
                            borderLeft: isFocused ? '4px solid #000000' : '4px solid transparent'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 900, fontSize: '10px' }}>{inst.name}</span>
                            <span
                              style={{
                                backgroundColor: isFocused ? '#2563EB' : '#DBEAFE',
                                color: isFocused ? '#FFFFFF' : '#1E40AF',
                                padding: '1px 5px',
                                fontSize: '8px',
                                fontWeight: 'bold'
                              }}
                            >
                              {inst.count} {t('OBJECTS', 'SUBJEKTE', 'OBJETS')}
                            </span>
                          </div>
                          <div style={{ fontSize: '8px', color: isFocused ? '#94A3B8' : '#64748B', marginTop: '2px' }}>
                            {t('City:', 'Stadt:', 'Ville :')} {inst.stadt || t('Unknown', 'Unbekannt', 'Inconnue')} | {inst.contested_count} {t('dissonances', 'Dissonanzen', 'dissonances')} ({Math.round((inst.contested_count / (inst.count || 1)) * 100)}%)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {sidebarTab === 'gaps' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* Sub-Filter: Alle vs. Inferred Verdacht vs. True Blackboxes */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #CBD5E1', padding: '4px 6px', gap: '3px', backgroundColor: '#F1F5F9' }}>
                      <button
                        onClick={() => setGapFilter('all')}
                        style={{
                          flex: 1,
                          padding: '3px 2px',
                          fontSize: '7.5px',
                          fontWeight: 'bold',
                          border: '1px solid #000000',
                          backgroundColor: gapFilter === 'all' ? '#000000' : '#FFFFFF',
                          color: gapFilter === 'all' ? '#FFFFFF' : '#000000',
                          cursor: 'pointer'
                        }}
                      >
                        {t('ALL', 'ALLE', 'TOUT')} ({gapItems.length})
                      </button>
                      <button
                        onClick={() => setGapFilter('suspicion')}
                        style={{
                          flex: 1,
                          padding: '3px 2px',
                          fontSize: '7.5px',
                          fontWeight: 'bold',
                          border: '1px solid #0891B2',
                          backgroundColor: gapFilter === 'suspicion' ? '#0891B2' : '#FFFFFF',
                          color: gapFilter === 'suspicion' ? '#FFFFFF' : '#0891B2',
                          cursor: 'pointer'
                        }}
                      >
                        {t('SUSPICION', 'VERDACHT', 'SOUPÇON')} ({suspicions.length})
                      </button>
                      <button
                        onClick={() => setGapFilter('unresolved')}
                        style={{
                          flex: 1,
                          padding: '3px 2px',
                          fontSize: '7.5px',
                          fontWeight: 'bold',
                          border: '1px solid #7C3AED',
                          backgroundColor: gapFilter === 'unresolved' ? '#7C3AED' : '#FFFFFF',
                          color: gapFilter === 'unresolved' ? '#FFFFFF' : '#7C3AED',
                          cursor: 'pointer'
                        }}
                      >
                        {t('GAPS', 'LÜCKEN', 'LACUNES')} ({Math.max(0, gapItems.length - suspicions.length)})
                      </button>
                    </div>

                    {filteredGaps.map((gap: any) => {
                      const gapId = gap.id || gap.inv || gap.inventarnummer;
                      const isSelected = selectedNode?.id === gapId;
                      const susp = suspicionMap[gapId] || (gap.inv && suspicionMap[gap.inv]);

                      return (
                        <div
                          key={gapId}
                          onClick={() => {
                            setMobileSidebarOpen(false);
                            setViewMode('graph');
                            const node = graphData.nodes.find(n => n.id === gapId);
                            if (node) {
                              setSelectedLink(null);
                              setSelectedNode(node);
                              if (fgRef.current) {
                                fgRef.current.centerAt(node.x, node.y, 800);
                                fgRef.current.zoom(2.8, 800);
                              }
                            }
                          }}
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid #E2E8F0',
                            backgroundColor: isSelected ? (susp ? '#F0FDFA' : '#F5F3FF') : '#FFFFFF',
                            cursor: 'pointer',
                            transition: 'background-color 0.1s ease',
                            borderLeft: isSelected 
                              ? (susp ? '4px solid #0891B2' : '4px solid #7C3AED')
                              : (susp ? '4px solid #99F6E4' : '4px solid transparent')
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 900, fontSize: '10px', color: susp ? '#0891B2' : '#7C3AED' }}>
                              {gap.inv || gap.inventarnummer || gap.id}
                            </span>
                            <span
                              style={{
                                backgroundColor: susp ? '#CCFBF1' : '#EDE9FE',
                                color: susp ? '#0E7490' : '#6D28D9',
                                padding: '1px 5px',
                                fontSize: '8px',
                                fontWeight: 'bold'
                              }}
                            >
                              {gap.institution || gap.museum || t('Museum Depot', 'Museumsdepot', 'Dépôt muséal')}
                            </span>
                          </div>
                          <div style={{ fontSize: '8px', color: '#334155', marginTop: '2px', fontWeight: 'bold' }}>
                            {gap.bezeichnung || gap.name}
                          </div>
                          {susp ? (
                            <div style={{ marginTop: '3px' }}>
                              <div style={{ fontSize: '8px', color: '#0891B2', fontWeight: 'bold' }}>
                                [{t('SUSPICION', 'VERDACHT', 'SOUPÇON')}: {susp.akteur} ({Math.round((susp.confidence || 0.9) * 100)}%)]
                              </div>
                              <div style={{ fontSize: '7.5px', color: '#64748B', fontStyle: 'italic' }}>
                                {susp.expedition}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '8px', color: '#64748B', marginTop: '1px', fontStyle: 'italic' }}>
                              {t(
                                'No historical actor recorded (Depot Blackbox)',
                                'Kein historischer Akteur verzeichnet (Depot-Blackbox)',
                                'Aucun acteur historique recensé (Boîte noire muséale)'
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {sidebarTab === 'pois' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '6px 10px', backgroundColor: '#F0FDFA', borderBottom: '1px solid #0F766E', fontSize: '8px', color: '#115E59', fontWeight: 'bold' }}>
                      {t(
                        'PINNED KEY OBJECTS (CASE WATCHLIST FOR TARGETED RESTITUTION)',
                        'GEMERKTE LEITOBJEKTE (FALLAKTE FUER GEZIELTE RESTITUTION)',
                        'OBJETS PHARES ÉPINGLÉS (DOSSIER DE SUIVI POUR RESTITUTION CIBLÉE)'
                      )}
                    </div>
                    {pinnedPois.length === 0 && (
                      <div style={{ padding: '16px 12px', fontSize: '8.5px', color: '#64748B', textAlign: 'center' }}>
                        {t(
                          'No key objects pinned. Select an object in the graph and click [+ PIN AS KEY OBJECT] on the right.',
                          'Keine Leitobjekte gepinnt. Waehle ein Subjekt im Graphen und klicke rechts auf [+ IN FALLAKTE MERKEN].',
                          'Aucun objet phare épinglé. Sélectionnez un objet dans le graphe puis cliquez à droite sur [+ ÉPINGLER COMME OBJET PHARE].'
                        )}
                      </div>
                    )}
                    {pinnedPois.map((poi) => {
                      const isSel = selectedNode && selectedNode.id === poi.id;
                      return (
                        <div
                          key={poi.id}
                          onClick={() => {
                            setMobileSidebarOpen(false);
                            const node = graphData.nodes.find((n: any) => n.id === poi.id || n.label === poi.label);
                            if (node) {
                              setViewMode('graph');
                              setSelectedLink(null);
                              setSelectedNode(node);
                              if (fgRef.current && node.x !== undefined) {
                                fgRef.current.centerAt(node.x, node.y, 700);
                                fgRef.current.zoom(2.8, 700);
                              }
                            } else {
                              setViewMode('graph');
                              setSelectedNode({ id: poi.id, label: poi.label, type: 'Subjekt', desc: localizePoiDesc(poi, lang) });
                            }
                          }}
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid #E2E8F0',
                            backgroundColor: isSel ? '#F0FDFA' : '#FFFFFF',
                            borderLeft: isSel ? '4px solid #0F766E' : '4px solid transparent',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 900, fontSize: '9.5px', color: '#0F766E' }}>{poi.label}</span>
                            <button
                              onClick={(ev) => { ev.stopPropagation(); togglePinPoi(poi); }}
                              style={{ border: '1px solid #000', backgroundColor: '#FFF', fontSize: '7.5px', fontWeight: 'bold', cursor: 'pointer', padding: '0 4px' }}
                            >
                              [X]
                            </button>
                          </div>
                          <div style={{ fontSize: '8px', color: '#334155', marginTop: '2px' }}>{localizePoiDesc(poi, lang)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </aside>
        )}

        {/* COLUMN 2: CENTER CANVAS CONTAINER (RESIZES DYNAMICALLY VIA RESIZEOBSERVER) */}
        <main
          ref={canvasContainerRef}
          className="main-canvas"
          style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#FBFBF9'
          }}
        >
          {viewMode === 'graph' ? (
            <div className="graph-canvas-wrap" style={{ width: '100%', height: '100%' }}>
              <ForceGraph2D
                ref={fgRef}
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                graphData={graphData}
                backgroundColor="#FBFBF9"
                nodeCanvasObject={nodeCanvasObject}
                nodePointerAreaPaint={(node, color, ctx) => {
                  ctx.fillStyle = color;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, 9, 0, 2 * Math.PI, false);
                  ctx.fill();
                }}
                linkColor={linkColor}
                linkWidth={linkWidth}
                linkCurvature={(link: any) => link.curvature || 0}
                linkCanvasObjectMode={(link: any) => link.type === 'VERDACHT_AUF' ? 'replace' : undefined}
                linkCanvasObject={linkCanvasObject}
                onNodeClick={(node) => {
                  setSelectedLink(null);
                  setSelectedRoute(null);
                  setSelectedNode(node);
                  if (fgRef.current) {
                    fgRef.current.centerAt(node.x, node.y, 600);
                    fgRef.current.zoom(2.5, 600);
                  }
                }}
                onLinkClick={(link) => {
                  setSelectedNode(null);
                  setSelectedRoute(null);
                  setSelectedLink(link);
                }}
                onLinkHover={(link) => setHoveredLink(link)}
                onBackgroundClick={() => {
                  setSelectedNode(null);
                  setSelectedLink(null);
                  setSelectedRoute(null);
                }}
                onEngineStop={handleEngineStop}
                onNodeDragEnd={handleNodeDragEnd}
                cooldownTicks={graphData.nodes.length > 0 && graphData.nodes[0].fx !== undefined ? 0 : 120}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
              />
            </div>
          ) : viewMode === 'map' ? (
            <GeodataMap
              activeMetricFilter={activeMetricFilter}
              searchTerm={searchTerm}
              onSelectNode={(node) => {
                setSelectedLink(null);
                setSelectedRoute(null);
                const found = graphData.nodes.find((n: any) => n.id === node.id || n.label === node.label);
                setSelectedNode(found || node);
              }}
              onSelectLink={(link) => {
                setSelectedNode(null);
                setSelectedRoute(null);
                setSelectedLink(link);
              }}
              onSelectRoute={(route) => {
                setSelectedNode(null);
                setSelectedLink(null);
                setSelectedRoute(route);
              }}
              selectedRouteId={selectedRoute?.id}
            />
          ) : viewMode === 'docs' ? (
            <DocumentsView
              publications={publications}
              selectedPubs={selectedPubs}
              onTogglePublication={togglePublication}
              onDeletePublication={handleDeletePublication}
              graphLinks={graphData.links}
              isResearcher={isResearcher}
              isStaticMode={isStaticSnapshotMode()}
              onJumpToNode={(nodeId) => {
                setViewMode('graph');
                setSelectedLink(null);
                setSelectedRoute(null);
                const found = graphData.nodes.find((n: any) => n.id === nodeId || n.label === nodeId);
                setSelectedNode(found || { id: nodeId, label: nodeId, type: 'Subjekt', desc: '' });
                setTimeout(() => {
                  if (found && fgRef.current && found.x !== undefined) {
                    fgRef.current.centerAt(found.x, found.y, 700);
                    fgRef.current.zoom(2.6, 700);
                  }
                }, 150);
              }}
              onJumpToLink={(link) => {
                setViewMode('graph');
                setSelectedNode(null);
                setSelectedRoute(null);
                setSelectedLink(link);
              }}
              onSourceIngested={(newPubId) => {
                loadPublications(newPubId);
                loadFilterEntities();
                loadStats();
                setTimeout(() => loadGraph(), 200);
              }}
              onRequestLogin={() => { setShowLoginModal(true); setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich.', 'Autorisation chercheur requise.')); }}
              getAuthHeaders={getAuthHeaders}
            />
          ) : (
            <VisualForensicsView
              isResearcher={isResearcher}
              getAuthHeaders={getAuthHeaders}
              onRequestLogin={() => { setShowLoginModal(true); setLoginError(t('Researcher authorization required.', 'Forscher-Autorisierung erforderlich.', 'Autorisation chercheur requise.')); }}
              onChainCommitted={(newPubId) => {
                loadPublications(newPubId);
                loadFilterEntities();
                loadStats();
                setTimeout(() => loadGraph(), 200);
              }}
              onJumpToObject={(invId) => {
                setViewMode('graph');
                setSelectedLink(null);
                setSelectedRoute(null);
                const found = graphData.nodes.find((n: any) => n.id === invId || n.label === invId);
                setSelectedNode(found || { id: invId, label: invId, type: 'Subjekt', desc: '' });
                setTimeout(() => {
                  if (found && fgRef.current && found.x !== undefined) {
                    fgRef.current.centerAt(found.x, found.y, 700);
                    fgRef.current.zoom(2.6, 700);
                  }
                }, 150);
              }}
            />
          )}

          {/* Kiosk Mode Floating HUD */}
          {kioskMode && (
            <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(20, 20, 19, 0.94)', color: '#F7F6F2', border: '1px solid rgba(251, 191, 36, 0.5)', borderRadius: '2px', padding: '7px 14px', zIndex: 35, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', fontWeight: 600 }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#F59E0B', display: 'inline-block' }}></span>
              <span>
                {t('Museum tour active — Focus:', 'Museums-Tour aktiv — Fokus:', 'Visite muséale active — Focus :')}{' '}
                <strong className="mono" style={{ color: '#FBBF24' }}>{kioskTargetId || t('Traversing records', 'Durchlaufe Beweisgut', 'Parcours des preuves')}</strong>
              </span>
              <button
                onClick={() => setKioskMode(false)}
                style={{ backgroundColor: '#991B1B', color: '#FFFFFF', border: 'none', borderRadius: '2px', padding: '3px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                {t('Pause', 'Pause', 'Pause')}
              </button>
            </div>
          )}

          {/* Loading Overlay */}
          {loading && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 }}>
              <div style={{ padding: '18px 26px', textAlign: 'center', backgroundColor: '#FFFFFF', border: '1px solid #1C1B19', boxShadow: '0 8px 24px rgba(20,20,19,0.12)', borderRadius: '2px' }}>
                <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#141413' }}>
                  {t('Loading provenance network…', 'Lade Provenienz-Netzwerk…', 'Chargement du réseau de provenance…')}
                </h2>
                <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#78766F' }}>
                  {t('Indexing archival records and relations', 'Indiziere Archivbelege und Relationen', 'Indexation des archives et relations')}
                </p>
              </div>
            </div>
          )}

          {/* Error Overlay */}
          {error && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 }}>
              <div style={{ padding: '18px 26px', backgroundColor: '#FEF2F2', border: '1px solid #991B1B', borderLeft: '3px solid #991B1B', borderRadius: '2px' }}>
                <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#991B1B' }}>
                  {t('Connection notice', 'Verbindungshinweis', 'Avis de connexion')}
                </h2>
                <p style={{ margin: '6px 0 0 0', fontSize: '11.5px', color: '#7F1D1D' }}>{error}</p>
              </div>
            </div>
          )}

          {/* Floating Legende (Unten Links im Canvas) */}
          {viewMode === 'graph' && (
          <div className="ui-overlay" style={{ position: 'absolute', bottom: 14, left: 14, padding: '7px 12px', backgroundColor: 'rgba(255, 255, 255, 0.94)', border: '1px solid #D8D5CD', borderRadius: '2px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', zIndex: 20, backdropFilter: 'blur(4px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#141413', display: 'inline-block' }}></span>
              {t('Depot', 'Depot', 'Dépôt')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#9A3412', display: 'inline-block' }}></span>
              {t('Actor', 'Akteur', 'Acteur')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#52514C', display: 'inline-block' }}></span>
              {t('Object', 'Objekt', 'Objet')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#CA8A04', display: 'inline-block' }}></span>
              {t('Dissonance', 'Dissonanz', 'Dissonance')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#6D28D9', display: 'inline-block' }}></span>
              {t('Gap', 'Lücke', 'Lacune')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
              {t('Missing', 'Verschollen', 'Disparu')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '13px', height: '2px', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
              {t('Loot', 'Raub', 'Pillage')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '13px', height: '2px', backgroundColor: '#2563EB', display: 'inline-block' }}></span>
              {t('Donation', 'Schenkung', 'Don')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 500, color: '#3F3E3A' }}>
              <span style={{ width: '13px', height: '2px', borderTop: '2px dashed #0891B2', display: 'inline-block' }}></span>
              {t('Suspicion', 'Verdacht', 'Soupçon')}
            </div>
          </div>
          )}
        </main>

        {/* COLUMN 3: RIGHT INSPECTOR (ARCHIVAL CASE FILE) */}
        {(selectedNodeDetails || selectedLink || selectedRoute) && (
          <aside
            className="inspector-aside"
            style={{
              width: '430px',
              height: '100%',
              borderLeft: '1px solid #1C1B19',
              backgroundColor: '#FFFFFF',
              overflowY: 'auto',
              flexShrink: 0,
              padding: '20px',
              boxSizing: 'border-box',
              zIndex: 30
            }}
          >
            {/* Case A: KNOTEN INSPEKTOR */}
            {selectedNodeDetails && !selectedLink && !selectedRoute && (
              <div>
                {/* Header & Close */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #D8D5CD', paddingBottom: '12px', marginBottom: '16px', gap: '10px' }}>
                  <div>
                    <span
                      className="mono"
                      style={{
                        display: 'inline-block',
                        backgroundColor: gapIds.has(selectedNodeDetails.id)
                          ? '#5B21B6'
                          : (selectedNodeDetails.isContested 
                              ? '#92400E' 
                              : (selectedNodeDetails.isGhost ? '#991B1B' : (selectedNodeDetails.type === 'Institution' ? '#141413' : '#9A3412'))),
                        color: '#FFFFFF',
                        padding: '2px 7px',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        marginBottom: '6px'
                      }}
                    >
                      {gapIds.has(selectedNodeDetails.id)
                        ? t('Provenance Gap', 'Provenienzlücke', 'Lacune de provenance')
                        : (selectedNodeDetails.isContested 
                            ? t('Semantic Dissonance', 'Semantische Dissonanz', 'Dissonance sémantique') 
                            : (selectedNodeDetails.isGhost
                                ? t('Missing / No Depot', 'Verschollen / Kein Depot', 'Disparu / Sans dépôt')
                                : nodeTypeLabel(selectedNodeDetails.type, lang)))}
                    </span>
                    <h2 style={{ margin: '2px 0 0 0', fontSize: '16px', fontWeight: 700, wordBreak: 'break-word', color: '#141413' }}>
                      {selectedNodeDetails.label}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="archival-btn"
                    style={{ padding: '4px 9px', fontSize: '11px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Description & Metadata */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '10px', color: '#78766F', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('Description / Historical Function', 'Beschreibung / Historische Funktion', 'Description / Fonction historique')}
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 500, marginTop: '3px', color: '#141413', lineHeight: 1.5 }}>
                    {selectedNodeDetails.desc || t('No additional description recorded', 'Keine Zusatzbeschreibung erfasst', 'Aucune description supplémentaire enregistrée')}
                  </div>
                </div>

                {/* AUTONOMER PROVENIENZ-VERDACHT CARD */}
                {suspicionMap[selectedNodeDetails.id] && (
                  <div style={{ marginBottom: '16px', border: '2px solid #0891B2', padding: '12px', backgroundColor: '#F0FDFA' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 900, color: '#0E7490', letterSpacing: '0.5px' }}>
                        {t('[AUTONOMOUS PROVENANCE SUSPICION]', '[AUTONOMER PROVENIENZ-VERDACHT]', '[SOUPÇON AUTONOME DE PROVENANCE]')}
                      </span>
                      <span style={{ backgroundColor: '#0891B2', color: '#FFFFFF', padding: '1px 6px', fontSize: '8px', fontWeight: 'bold' }}>
                        {Math.round((suspicionMap[selectedNodeDetails.id].confidence || 0.9) * 100)}% {t('CONFIDENCE', 'KONFIDENZ', 'CONFIANCE')}
                      </span>
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '4px', lineHeight: 1.4 }}>
                      <b>{t('Suspected Colonial Officer:', 'Verdächtiger Kolonialoffizier:', 'Officier colonial suspecté :')}</b> <span style={{ color: '#B45309', fontWeight: 'bold' }}>{suspicionMap[selectedNodeDetails.id].akteur}</span>
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '2px' }}>
                      <b>{t('Military Register:', 'Militärisches Register:', 'Registre militaire :')}</b> {suspicionMap[selectedNodeDetails.id].expedition} ({suspicionMap[selectedNodeDetails.id].zeit || t('Colonial Era', 'Kolonialzeit', 'Période coloniale')})
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '2px', lineHeight: 1.3 }}>
                      <b>{t('Forensic Rationale:', 'Forensische Begründung:', 'Justification forensique :')}</b> {suspicionMap[selectedNodeDetails.id].begruendung}
                    </div>
                    <div style={{ fontSize: '8px', color: '#334155', marginTop: '6px', fontStyle: 'italic', backgroundColor: '#CCFBF1', padding: '5px 7px', borderLeft: '3px solid #0891B2' }}>
                      <b>{t('Primary Citation:', 'Primärbeleg:', 'Source primaire :')}</b> {suspicionMap[selectedNodeDetails.id].beleg}
                    </div>
                    {suspicionMap[selectedNodeDetails.id].zitat && (
                      <div style={{ fontSize: '8px', color: '#0E7490', marginTop: '4px', borderLeft: '3px solid #0891B2', paddingLeft: '6px', fontStyle: 'italic' }}>
                        &ldquo;{suspicionMap[selectedNodeDetails.id].zitat}&rdquo;
                      </div>
                    )}
                  </div>
                )}

                {/* PROVENIENZLÜCKE PANEL: Warning & IFG Request Generator */}
                {gapIds.has(selectedNodeDetails.id) && (
                  <div style={{ marginBottom: '16px', border: '2px solid #7C3AED', padding: '12px', backgroundColor: '#F5F3FF' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#6D28D9', letterSpacing: '0.5px' }}>
                      {t(
                        '[FINDING: PROVENANCE GAP (BROKEN CHAIN OF CUSTODY)]',
                        '[BEFUND: PROVENIENZLÜCKE (CHAIN OF CUSTODY GERISSEN)]',
                        '[CONSTAT : LACUNE DE PROVENANCE (CHAÎNE ROMPUE)]'
                      )}
                    </div>
                    <div style={{ fontSize: '9px', color: '#4C1D95', marginTop: '4px', lineHeight: 1.4 }}>
                      {t(
                        'This object is held in a museum depot but has no documented acquisition record, donation contract, or looting report in public collection data.',
                        'Dieses Subjekt lagert im Depot, besitzt jedoch in den öffentlichen Museumsdaten keinerlei dokumentierten Erwerbsakt, Schenkungsvertrag oder Raubbericht.',
                        "Cet objet est conservé en dépôt muséal mais ne dispose d'aucun acte d'acquisition, contrat de don ou rapport de pillage dans les données publiques."
                      )}
                    </div>
                    <button
                      onClick={() => {
                        const depotLink = selectedNodeDetails.links.find((l: any) => l.type === 'LAGERT_IN');
                        const depotName = depotLink ? (depotLink.target.label || depotLink.target.id || depotLink.target) : t('Museum Depot', 'Museumsdepot', 'Dépôt muséal');
                        handleCopyIFG(selectedNodeDetails.id, depotName);
                      }}
                      style={{
                        width: '100%',
                        marginTop: '10px',
                        padding: '8px 12px',
                        backgroundColor: '#5B21B6',
                        color: '#FFFFFF',
                        border: '1px solid #5B21B6',
                        borderRadius: '2px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {copySuccess
                        ? t('Inquiry text copied to clipboard', 'Antragstext in Zwischenablage kopiert', 'Demande copiée dans le presse-papiers')
                        : t('Copy FOIA / IFG Request (Accession Ledgers)', 'IFG-Auskunftsersuchen kopieren (Zugangsbücher)', "Copier la demande CADA / IFG (Registres d'entrée)")}
                    </button>
                  </div>
                )}

                {/* DISSONANZ-PANEL: Gegenüberstellung der Kanten */}
                {selectedNodeDetails.isContested && selectedNodeDetails.contestedInfo && (
                  <div style={{ marginBottom: '18px', border: '2px solid #000000', padding: '12px', backgroundColor: '#FEFCE8' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#854D0E', marginBottom: '10px', letterSpacing: '0.5px' }}>
                      {t(
                        '[EVIDENCE DISSONANCE: MULTIGRAPH COLLISION]',
                        '[BEWEIS-DISSONANZ: MULTIGRAPH-KOLLISION]',
                        '[DISSONANCE DE PREUVE : COLLISION MULTIGRAPHE]'
                      )}
                    </div>

                    <div style={{ borderLeft: '4px solid #2563EB', paddingLeft: '8px', marginBottom: '10px', backgroundColor: '#EFF6FF', padding: '8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#1D4ED8' }}>
                        {t(
                          '[1] OFFICIAL MUSEUM NARRATIVE (EXCULPATORY CLAIM)',
                          '[1] OFFIZIELLES MUSEUMS-NARRATIV (SCHUTZBEHAUPTUNG)',
                          '[1] RÉCIT OFFICIEL DU MUSÉE (ALLÉGATION EXCULPATOIRE)'
                        )}
                      </div>
                      {selectedNodeDetails.contestedInfo.museum_narratives.slice(0, 2).map((m: any, idx: number) => (
                        <div key={idx} style={{ marginTop: '4px', fontSize: '9px' }}>
                          <div><b>{t('Edge:', 'Kante:', 'Arête :')}</b> <span style={{ color: '#1D4ED8' }}>{relLabel(m.rel, lang)}</span> ({m.jahr || t('Colonial Era', 'Kolonialzeit', 'Période coloniale')}) {t('by', 'durch', 'par')} <b>{m.akteur}</b></div>
                          <div style={{ fontSize: '8px', color: '#475569', fontStyle: 'italic', marginTop: '2px' }}>
                            <b>{t('Citation:', 'Beleg:', 'Source :')}</b> {m.beleg}
                          </div>
                          <div style={{ fontSize: '8px', color: '#0f172a', marginTop: '3px', backgroundColor: '#DBEAFE', padding: '3px 5px' }}>
                            &ldquo;{m.claim}&rdquo;
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ borderLeft: '4px solid #DC2626', paddingLeft: '8px', backgroundColor: '#FEF2F2', padding: '8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#991B1B' }}>
                        {t(
                          '[2] FORENSIC REALITY (MILITARY LOOTING RAID)',
                          '[2] FORENSISCHE REALITÄT (MILITÄRISCHER RAUBZUG)',
                          '[2] RÉALITÉ FORENSIQUE (RAID MILITAIRE DE PILLAGE)'
                        )}
                      </div>
                      {selectedNodeDetails.contestedInfo.forensic_realities.slice(0, 2).map((f: any, idx: number) => (
                        <div key={idx} style={{ marginTop: '4px', fontSize: '9px' }}>
                          <div><b>{t('Edge:', 'Kante:', 'Arête :')}</b> <span style={{ color: '#DC2626' }}>{relLabel(f.rel, lang)}</span> ({f.jahr || t('Colonial Era', 'Kolonialzeit', 'Période coloniale')}) {t('by', 'durch', 'par')} <b>{f.akteur}</b></div>
                          <div style={{ fontSize: '8px', color: '#475569', fontStyle: 'italic', marginTop: '2px' }}>
                            <b>{t('Citation:', 'Beleg:', 'Source :')}</b> {f.beleg}
                          </div>
                          <div style={{ fontSize: '8px', color: '#7f1d1d', marginTop: '3px', backgroundColor: '#FEE2E2', padding: '3px 5px', fontWeight: 'bold' }}>
                            {t('Finding:', 'Befund:', 'Constat :')} {f.claim}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verbundene Kanten Liste */}
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '9px', color: '#64748B', fontWeight: 'bold', marginBottom: '8px' }}>
                    {t('VERIFIED EVIDENCE PATHS IN GRAPH', 'VERIFIZIERTE BEWEISPFADE IM GRAPHEN', 'CHEMINS DE PREUVE VÉRIFIÉS DANS LE GRAPHE')} ({selectedNodeDetails.links.length}):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedNodeDetails.links.slice(0, 6).map((lnk: any, idx: number) => {
                      const isOutgoing = (lnk.source.id || lnk.source) === selectedNodeDetails.id;
                      const otherParty = isOutgoing ? (lnk.target.label || lnk.target.id || lnk.target) : (lnk.source.label || lnk.source.id || lnk.source);
                      const isRaub = lnk.type === 'RAUBTE' || lnk.type === 'ENTEIGNETE';
                      const isSchenkung = lnk.type === 'SCHENKTE' || lnk.type === 'VERKAUFTE_AN';
                      const isVerdacht = lnk.type === 'VERDACHT_AUF';

                      let borderCol = '#000000';
                      let bgCol = '#F8FAFC';
                      if (isRaub) { borderCol = '#DC2626'; bgCol = '#FEF2F2'; }
                      else if (isSchenkung) { borderCol = '#2563EB'; bgCol = '#EFF6FF'; }
                      else if (isVerdacht) { borderCol = '#0891B2'; bgCol = '#F0FDFA'; }

                      return (
                        <div
                          key={idx}
                          onClick={() => { setSelectedNode(null); setSelectedLink(lnk); }}
                          style={{
                            border: '1px solid #000000',
                            padding: '6px 8px',
                            backgroundColor: bgCol,
                            borderLeft: `4px solid ${borderCol}`,
                            cursor: 'pointer'
                          }}
                          title={t('Click to open edge record', 'Klicken zum Öffnen der Kanten-Akte', "Cliquer pour ouvrir la fiche de l'arête")}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>
                            <span style={{ fontWeight: 'bold', color: borderCol }}>
                              {isOutgoing ? '-> ' : '<- '} {relLabel(lnk.type, lang)}
                            </span>
                            {lnk.jahr && <span style={{ color: '#64748B' }}>{lnk.jahr}</span>}
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 'bold', marginTop: '2px', color: '#000000' }}>
                            {otherParty}
                          </div>
                          {lnk.beleg && (
                            <div style={{ fontSize: '8px', color: '#475569', marginTop: '2px', fontStyle: 'italic' }}>
                              {t('Citation:', 'Beleg:', 'Source :')} {lnk.beleg}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {selectedNodeDetails.links.length > 6 && (
                      <div style={{ fontSize: '8px', color: '#64748B', textAlign: 'center', marginTop: '2px' }}>
                        + {selectedNodeDetails.links.length - 6} {t('more verified edges', 'weitere verifizierte Kanten', 'autres arêtes vérifiées')}
                      </div>
                    )}
                  </div>
                </div>

                {/* ======================================================= */}
                {/* MANUELLE FORSCHUNGS-ANNOTATION (MARIANNE / RICHARD)     */}
                {/* ======================================================= */}
                {(selectedNodeDetails && (selectedNodeDetails.type === 'Subjekt' || selectedNodeDetails.type === 'Objekt')) && (
                  <div style={{
                    marginBottom: '16px',
                    border: '1px solid #A7F3D0',
                    borderLeft: '3px solid #166534',
                    backgroundColor: '#F7FBF8',
                  }}>
                    {/* Header Bar */}
                    <div style={{
                      backgroundColor: '#EDF7F0',
                      color: '#166534',
                      borderBottom: '1px solid #CBE7D4',
                      padding: '8px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '11px', fontWeight: 700 }}>
                        {t('Manual Research Curation', 'Manuelle Forschungs-Kuration', 'Curation scientifique manuelle')}
                      </span>
                      <span className="mono" style={{
                        backgroundColor: '#FFFFFF',
                        color: '#166534',
                        border: '1px solid #A7F3D0',
                        padding: '1px 6px',
                        fontSize: '9px',
                        fontWeight: 600,
                      }}>
                        {t('Persistent', 'Persistent', 'Persistant')}
                      </span>
                    </div>

                    <div style={{ padding: '10px' }}>
                      {/* Vorhandene Annotationen */}
                      {isLoadingAnnotations ? (
                        <div style={{ fontSize: '9px', color: '#047857', fontStyle: 'italic', marginBottom: '8px' }}>
                          {t('Loading manual curations from graph...', 'Lade manuelle Kurationen aus Neo4j...', 'Chargement des annotations depuis le graphe...')}
                        </div>
                      ) : annotations.length > 0 ? (
                        <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#065F46' }}>
                            {t('VERIFIED PEER-REVIEW ENTRIES', 'VERIFIZIERTE PEER-REVIEW-EINTRÄGE', 'ENTRÉES ÉVALUÉES PAR LES PAIRS')} ({annotations.length}):
                          </div>
                          {annotations.map((ann) => (
                            <div key={ann.id} style={{
                              border: '1px solid #A7F3D0',
                              backgroundColor: '#FFFFFF',
                              padding: '8px',
                              borderLeft: '4px solid #059669',
                              fontSize: '9px'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <div>
                                  <span style={{ fontWeight: 900, color: '#065F46' }}>{ann.author}</span>
                                  <span style={{ color: '#64748B', marginLeft: '6px', fontSize: '8px' }}>({ann.role || t('Researcher', 'Forscher', 'Chercheur')})</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{
                                    backgroundColor: ann.confidence === 'HIGH' ? '#D1FAE5' : '#FEF3C7',
                                    color: ann.confidence === 'HIGH' ? '#065F46' : '#92400E',
                                    fontSize: '8px',
                                    fontWeight: 'bold',
                                    padding: '1px 4px'
                                  }}>
                                    {ann.confidence || 'HIGH'}
                                  </span>
                                  <button
                                    onClick={() => handleDeleteAnnotation(ann.id)}
                                    title={t('Delete annotation', 'Annotation löschen', "Supprimer l'annotation")}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#DC2626',
                                      fontWeight: 'bold',
                                      cursor: 'pointer',
                                      fontSize: '9px',
                                      padding: '0 2px'
                                    }}
                                  >
                                    [×]
                                  </button>
                                </div>
                              </div>

                              <div style={{ color: '#0F172A', marginTop: '4px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                                {ann.notes}
                              </div>

                              {ann.tags && ann.tags.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                                  {ann.tags.map((tagItem: string, idx: number) => (
                                    <span key={idx} style={{
                                      backgroundColor: '#D1FAE5',
                                      color: '#065F46',
                                      border: '1px solid #A7F3D0',
                                      padding: '1px 5px',
                                      fontSize: '8px',
                                      fontWeight: 'bold'
                                    }}>
                                      #{tagItem}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div style={{ fontSize: '7.5px', color: '#94A3B8', marginTop: '4px', textAlign: 'right' }}>
                                {ann.created_at ? new Date(ann.created_at).toLocaleString(lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : 'en-US') : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '8.5px', color: '#047857', fontStyle: 'italic', marginBottom: '10px' }}>
                          {t(
                            'No manual curation recorded for this object yet.',
                            'Bislang keine manuelle Kuration für dieses Objekt hinterlegt.',
                            'Aucune curation manuelle enregistrée pour cet objet.'
                          )}
                        </div>
                      )}

                      {/* Neuer Eintrag Formular */}
                      <div style={{
                        borderTop: '1px dashed #A7F3D0',
                        paddingTop: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#064E3B' }}>
                          {t('ADD NEW ANNOTATION:', 'NEUE ANNOTATION HINZUFÜGEN:', 'AJOUTER UNE ANNOTATION :')}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <div>
                            <label style={{ fontSize: '8px', color: '#065F46', fontWeight: 'bold' }}>{t('AUTHOR:', 'AUTOR:', 'AUTEUR :')}</label>
                            <select
                              value={annAuthor}
                              onChange={e => {
                                setAnnAuthor(e.target.value);
                                if (e.target.value === 'Marianne') setAnnRole('Provenance Lead');
                                else if (e.target.value === 'Richard') setAnnRole(t('Project Lead', 'Projektleitung', 'Direction de projet'));
                                else if (e.target.value === 'Stud. Hilfskraft') setAnnRole(t('Research Team', 'Recherche-Team', 'Équipe de recherche'));
                                else setAnnRole(t('Guest Researcher', 'Gastforscher', 'Chercheur invité'));
                              }}
                              style={{
                                width: '100%',
                                fontSize: '9px',
                                padding: '3px 4px',
                                border: '1px solid #059669',
                                backgroundColor: '#FFFFFF',
                                fontWeight: 'bold'
                              }}
                            >
                              <option value="Marianne">Marianne (Provenance Lead)</option>
                              <option value="Richard">{t('Richard (Project Lead)', 'Richard (Projektleitung)', 'Richard (Direction de projet)')}</option>
                              <option value="Stud. Hilfskraft">{t('Research Assistant', 'Stud. Hilfskraft', 'Assistant·e de recherche')}</option>
                              <option value="Gastforscher">{t('Guest Researcher / Delegation', 'Gastforscher / Delegation', 'Chercheur invité / Délégation')}</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: '8px', color: '#065F46', fontWeight: 'bold' }}>{t('CONFIDENCE:', 'KONFIDENZ:', 'CONFIANCE :')}</label>
                            <select
                              value={annConfidence}
                              onChange={e => setAnnConfidence(e.target.value)}
                              style={{
                                width: '100%',
                                fontSize: '9px',
                                padding: '3px 4px',
                                border: '1px solid #059669',
                                backgroundColor: '#FFFFFF'
                              }}
                            >
                              <option value="HIGH">{t('VERIFIED (HIGH)', 'VERIFIZIERT (HIGH)', 'VÉRIFIÉ (ÉLEVÉ)')}</option>
                              <option value="MEDIUM">{t('PRELIMINARY (MEDIUM)', 'VORLÄUFIG (MEDIUM)', 'PRÉLIMINAIRE (MOYEN)')}</option>
                              <option value="LOW">{t('HYPOTHESIS (LOW)', 'HYPOTHESE (LOW)', 'HYPOTHÈSE (FAIBLE)')}</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: '8px', color: '#065F46', fontWeight: 'bold' }}>{t('TAGS (COMMA-SEPARATED):', 'TAGS (KOMMAGETRENNT):', 'MOTS-CLÉS (SÉPARÉS PAR VIRGULES) :')}</label>
                          <input
                            type="text"
                            placeholder={t('e.g. Glauning 1906, Bamum, Looted', 'z.B. Glauning 1906, Bamum, Beutegut', 'ex. Glauning 1906, Bamoun, Butin')}
                            value={annTags}
                            onChange={e => setAnnTags(e.target.value)}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              fontSize: '9px',
                              padding: '4px',
                              border: '1px solid #059669',
                              backgroundColor: '#FFFFFF'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '8px', color: '#065F46', fontWeight: 'bold' }}>{t('RESEARCH NOTE / LEGAL SUBSUMPTION:', 'FORSCHUNGSNOTIZ / SUBSUMTION:', 'NOTE DE RECHERCHE / QUALIFICATION JURIDIQUE :')}</label>
                          <textarea
                            rows={3}
                            placeholder={t(
                              'Enter forensic note, archive reference, witness statement, or curation...',
                              'Forensische Notiz, Archivbeleg, Zeugenbericht oder Kuration eintragen...',
                              "Saisir une note forensique, référence d'archive, témoignage ou curation..."
                            )}
                            value={annNotes}
                            onChange={e => setAnnNotes(e.target.value)}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              fontSize: '9px',
                              padding: '4px',
                              border: '1px solid #059669',
                              backgroundColor: '#FFFFFF',
                              fontFamily: 'inherit'
                            }}
                          />
                        </div>

                        <button
                          onClick={handleSaveAnnotation}
                          disabled={isSubmittingAnn || !annNotes.trim()}
                          style={{
                            backgroundColor: !annNotes.trim() ? '#A3A097' : '#166534',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '2px',
                            padding: '7px 12px',
                            fontWeight: 600,
                            fontSize: '11px',
                            cursor: (!annNotes.trim() || isSubmittingAnn) ? 'not-allowed' : 'pointer',
                            marginTop: '4px'
                          }}
                        >
                          {isSubmittingAnn
                            ? t('Saving annotation…', 'Speichere Annotation…', 'Enregistrement…')
                            : t('Save annotation to graph', 'Annotation im Graphen speichern', "Enregistrer l'annotation dans le graphe")}
                        </button>

                        {annStatusMsg && (
                          <div style={{ fontSize: '8.5px', color: '#065F46', fontWeight: 'bold', textAlign: 'center', marginTop: '2px' }}>
                            {annStatusMsg}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                
                {/* MANUELLE RELATION */}
                {(selectedNodeDetails && (selectedNodeDetails.type === 'Subjekt' || selectedNodeDetails.type === 'Objekt' || selectedNodeDetails.type === 'Institution' || selectedNodeDetails.type === 'Akteur')) && (
                  <div style={{ marginTop: '14px', border: '1px solid #D8D5CD', borderLeft: '3px solid #991B1B', padding: '12px', backgroundColor: '#F7F6F2' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#991B1B', marginBottom: '8px' }}>
                      {t('+ Link Manual Relation', '+ Manuelle Relation verknüpfen', '+ Lier une relation manuelle')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                      <input 
                        type="text" 
                        placeholder={t('Target Node ID (e.g. Hans Glauning)', 'Ziel-Knoten ID (z. B. Hans Glauning)', 'ID du nœud cible (ex. Hans Glauning)')} 
                        value={newEdgeTarget} 
                        onChange={e => setNewEdgeTarget(e.target.value)} 
                        style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #D8D5CD', backgroundColor: '#FFFFFF' }} 
                      />
                      <select 
                        value={newEdgeType} 
                        onChange={e => setNewEdgeType(e.target.value)} 
                        style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #D8D5CD', fontWeight: 600, backgroundColor: '#FFFFFF' }}
                      >
                        <option value="RAUBTE">{relLabel('RAUBTE', lang)}</option>
                        <option value="SCHENKTE">{relLabel('SCHENKTE', lang)}</option>
                        <option value="LAGERT_IN">{relLabel('LAGERT_IN', lang)}</option>
                        <option value="VERKAUFTE_AN">{relLabel('VERKAUFTE_AN', lang)}</option>
                        <option value="UEBERGAB_AN">{relLabel('UEBERGAB_AN', lang)}</option>
                        <option value="ENTEIGNETE">{relLabel('ENTEIGNETE', lang)}</option>
                        <option value="VERDACHT_AUF">{relLabel('VERDACHT_AUF', lang)}</option>
                        <option value="WAR_BETEILIGT_AN">{relLabel('WAR_BETEILIGT_AN', lang)}</option>
                      </select>
                      <input 
                        type="text" 
                        placeholder={t('Citation / File Ref. / Source', 'Beleg / Aktenzeichen / Quelle', "Référence / Cote d'archive / Source")} 
                        value={newEdgeBeleg} 
                        onChange={e => setNewEdgeBeleg(e.target.value)} 
                        style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #D8D5CD', backgroundColor: '#FFFFFF' }} 
                      />
                      <button 
                        onClick={handleCreateEdge} 
                        style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 600, backgroundColor: '#991B1B', color: '#FFFFFF', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
                      >
                        {t('Save relation to graph', 'Kante im Graphen speichern', "Enregistrer l'arête")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Subjekt Actions: POI Watchlist + Single Dossier */}
                {(selectedNodeDetails && (selectedNodeDetails.type === 'Subjekt' || selectedNodeDetails.type === 'Objekt')) && (
                  <div style={{ borderTop: '1px solid #D8D5CD', paddingTop: '14px', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      onClick={() => togglePinPoi({ id: selectedNodeDetails.id, label: selectedNodeDetails.label, desc: selectedNodeDetails.desc })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: pinnedPois.some(p => p.id === selectedNodeDetails.id) ? '#155E75' : '#FFFFFF',
                        color: pinnedPois.some(p => p.id === selectedNodeDetails.id) ? '#FFFFFF' : '#155E75',
                        border: '1px solid #155E75',
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      {pinnedPois.some(p => p.id === selectedNodeDetails.id)
                        ? t('Remove from Case Watchlist (POI)', 'Aus Fallakte (POI) entfernen', 'Retirer des objets phares (POI)')
                        : t('+ Pin as Key Object (Watchlist)', '+ Als Leitobjekt in Fallakte merken', '+ Épingler comme objet phare')}
                    </button>
                    <button
                      onClick={() => handlePrintDossier(selectedNodeDetails.id)}
                      disabled={isGeneratingDossier}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        backgroundColor: '#141413',
                        color: '#FFFFFF',
                        border: 'none',
                        borderLeft: `3px solid ${selectedNodeDetails.isContested ? '#CA8A04' : '#991B1B'}`,
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11.5px',
                        cursor: isGeneratingDossier ? 'wait' : 'pointer',
                      }}
                    >
                      {isGeneratingDossier
                        ? t('Generating restitution dossier…', 'Generiere Restitutionsdossier…', 'Génération du dossier…')
                        : t('Export Restitution Dossier (PDF / HTML)', 'Restitutionsdossier exportieren (PDF / HTML)', 'Exporter le dossier de restitution')}
                    </button>
                    
                    {dossierStatus && (
                      <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: 'bold', marginTop: '6px', textAlign: 'center' }}>
                        {dossierStatus}
                      </div>
                    )}

                    <p style={{ fontSize: '8px', color: '#64748B', marginTop: '6px', lineHeight: 1.3, textAlign: 'center' }}>
                      {t(
                        'Generates a 2-page forensic dossier incl. SHA-256 hash, primary citations, and Hague Convention / Washington Principles assessment.',
                        'Generiert ein 2-seitiges Gutachten inkl. SHA-256-Hash, Primärbeleg und HLKO/Washingtoner Prinzipien-Prüfung.',
                        'Génère une expertise de 2 pages avec empreinte SHA-256, sources primaires et analyse Convention de La Haye / Principes de Washington.'
                      )}
                    </p>
                  </div>
                )}

                {/* Akteur Actions & Batch Dossier ZIP */}
                {selectedNodeDetails.type === 'Akteur' && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#B45309', marginBottom: '2px' }}>
                      {t('[FORENSIC ACTOR & LOOT REGISTER]', '[FORENSISCHES TÄTER- & BEUTEREGISTER]', '[REGISTRE FORENSIQUE DES ACTEURS & BUTINS]')}
                    </div>
                    {focusedSummary && (focusedSummary.name === selectedNodeDetails.label || focusedSummary.name === selectedNodeDetails.id) && (
                      <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #B45309', padding: '8px', fontSize: '9px', lineHeight: 1.4, marginBottom: '4px' }}>
                        <div><b>{t('Documented Looting Raids:', 'Dokumentierte Raubzüge:', 'Raids de pillage documentés :')}</b> <span style={{ color: '#DC2626', fontWeight: 'bold' }}>{focusedSummary.raub_count} {t('objects', 'Subjekte', 'objets')}</span></div>
                        <div><b>{t('Official "Donations":', 'Offizielle "Schenkungen":', '« Dons » officiels :')}</b> <span style={{ color: '#2563EB', fontWeight: 'bold' }}>{focusedSummary.schenk_count} {t('cases', 'Fälle', 'cas')}</span></div>
                        {focusedSummary.depots && focusedSummary.depots.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>{t('Target Depots:', 'Ziel-Depots:', 'Dépôts cibles :')}</b> {focusedSummary.depots.join(', ')}</div>
                        )}
                        {focusedSummary.expeditionen && focusedSummary.expeditionen.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>{t('Expeditions:', 'Expeditionen:', 'Expéditions :')}</b> {focusedSummary.expeditionen.join(', ')}</div>
                        )}
                      </div>
                    )}

                    {/* Batch Dossier ZIP Export Button */}
                    <button
                      onClick={() => handleBatchDossier('actor', selectedNodeDetails.label)}
                      disabled={isGeneratingBatch}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        backgroundColor: '#9A3412',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11px',
                        cursor: isGeneratingBatch ? 'wait' : 'pointer',
                      }}
                    >
                      {isGeneratingBatch
                        ? t('Packaging dossier archive…', 'Bündle Dossier-Archiv…', "Compilation de l'archive…")
                        : t(
                            `Export all ${focusedSummary?.raub_count || selectedNodeDetails.links?.filter((l: any) => l.type === 'RAUBTE').length || ''} actor dossiers`,
                            `Alle ${focusedSummary?.raub_count || selectedNodeDetails.links?.filter((l: any) => l.type === 'RAUBTE').length || ''} Akteur-Dossiers exportieren`,
                            `Exporter les ${focusedSummary?.raub_count || selectedNodeDetails.links?.filter((l: any) => l.type === 'RAUBTE').length || ''} dossiers`
                          )}
                    </button>

                    {batchStatus && (
                      <div style={{ fontSize: '9px', color: '#B45309', fontWeight: 'bold', backgroundColor: '#FFFBEB', padding: '6px', border: '1px solid #B45309', textAlign: 'center' }}>
                        {batchStatus}
                      </div>
                    )}

                    <button
                      onClick={() => handleSelectEntityFocus('actor', selectedNodeDetails.label)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: focusedEntity?.name === selectedNodeDetails.label ? '#B45309' : '#FFFFFF',
                        color: focusedEntity?.name === selectedNodeDetails.label ? '#FFFFFF' : '#B45309',
                        border: '2px solid #B45309',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      {focusedEntity?.name === selectedNodeDetails.label
                        ? t('[ACTOR ISOLATION ACTIVE (CLEAR FOCUS)]', '[TÄTER-ISOLATION AKTIV (FOKUS AUFHEBEN)]', '[ISOLATION ACTEUR ACTIVE (LEVER LE FOCUS)]')
                        : t(`[ISOLATE ${selectedNodeDetails.label.toUpperCase()} ONLY]`, `[NUR ${selectedNodeDetails.label.toUpperCase()} ISOLIEREN]`, `[ISOLER UNIQUEMENT ${selectedNodeDetails.label.toUpperCase()}]`)}
                    </button>
                    <button
                      onClick={() => handleExclusiveCypherToggle(selectedNodeDetails.label)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label ? '#DC2626' : '#000000',
                        color: '#FFFFFF',
                        border: 'none',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      {exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label
                        ? t('[EXIT EXCLUSIVE CYPHER (FULL VIEW)]', '[EXKLUSIV-CYPHER BEENDEN (VOLLANSICHT)]', '[QUITTER CYPHER EXCLUSIF (VUE COMPLÈTE)]')
                        : t(`[LOAD EXCLUSIVE CYPHER: ${selectedNodeDetails.label.toUpperCase()} ONLY]`, `[EXKLUSIV CYPHER LADEN: NUR ${selectedNodeDetails.label.toUpperCase()}]`, `[CHARGER CYPHER EXCLUSIF : ${selectedNodeDetails.label.toUpperCase()}]`)}
                    </button>
                  </div>
                )}

                {/* Institution Actions & Batch Dossier ZIP */}
                {selectedNodeDetails.type === 'Institution' && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#000000', marginBottom: '2px' }}>
                      {t('[MUSEUM DEPOT HOLDINGS FILE]', '[MUSEUMS-DEPOT BESTANDSAKTE]', "[DOSSIER D'INVENTAIRE DU DÉPÔT MUSÉAL]")}
                    </div>
                    {focusedSummary && (focusedSummary.name === selectedNodeDetails.label || focusedSummary.name === selectedNodeDetails.id) && (
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #000000', padding: '8px', fontSize: '9px', lineHeight: 1.4, marginBottom: '4px' }}>
                        <div><b>{t('Location:', 'Standort:', 'Localisation :')}</b> {selectedNodeDetails.desc || t('Germany', 'Deutschland', 'Allemagne')}</div>
                        <div><b>{t('Recorded Objects:', 'Erfasste Subjekte:', 'Objets recensés :')}</b> <span style={{ fontWeight: 'bold' }}>{focusedSummary.total_subjekte}</span></div>
                        <div><b>{t('Dissonances (Whitewashed):', 'Dissonanzen (Whitewashed):', 'Dissonances (Blanchies) :')}</b> <span style={{ color: '#CA8A04', fontWeight: 'bold' }}>{focusedSummary.contested_subjekte} ({Math.round((focusedSummary.contested_subjekte / (focusedSummary.total_subjekte || 1)) * 100)}%)</span></div>
                        {focusedSummary.top_akteure && focusedSummary.top_akteure.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>{t('Primary Suppliers:', 'Hauptzulieferer:', 'Fournisseurs principaux :')}</b> {focusedSummary.top_akteure.join(', ')}</div>
                        )}
                      </div>
                    )}

                    {/* Diplomatic Restitution Package (HLKO) LLM Button */}
                    <button
                      onClick={() => handleGenerateLLMPetition(selectedNodeDetails.label)}
                      disabled={isGeneratingPetition}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: '#991B1B',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11px',
                        cursor: isGeneratingPetition ? 'wait' : 'pointer',
                      }}
                    >
                      {isGeneratingPetition
                        ? t('Generating Hague Convention package…', 'HLKO-Paket wird generiert…', 'Génération du dossier La Haye…')
                        : t('Generate Diplomatic Restitution Package (HLKO)', 'Diplomatisches Restitutionspaket (HLKO) generieren', 'Générer le dossier diplomatique (La Haye)')}
                    </button>

                    {petitionStatus && (
                      <div style={{ fontSize: '10.5px', color: '#991B1B', fontWeight: 600, backgroundColor: '#FEF2F2', padding: '7px 9px', border: '1px solid #F3D1D1', textAlign: 'center' }}>
                        {petitionStatus}
                      </div>
                    )}

                    {petitionDownloadUrl && (
                      <a
                        href={petitionDownloadUrl}
                        download
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '9px 12px',
                          backgroundColor: '#166534',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '2px',
                          fontWeight: 600,
                          fontSize: '11px',
                          textAlign: 'center',
                          textDecoration: 'none',
                          boxSizing: 'border-box'
                        }}
                      >
                        {t('Download Restitution Package (ZIP)', 'Restitutionspaket herunterladen (ZIP)', 'Télécharger le dossier de restitution (ZIP)')}
                      </a>
                    )}

                    {/* Batch Dossier Export Button for Depot */}
                    <button
                      onClick={() => handleBatchDossier('institution', selectedNodeDetails.label)}
                      disabled={isGeneratingBatch}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        backgroundColor: '#141413',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11px',
                        cursor: isGeneratingBatch ? 'wait' : 'pointer',
                      }}
                    >
                      {isGeneratingBatch
                        ? t('Packaging depot archive…', 'Bündle Depot-Archiv…', "Compilation de l'archive du dépôt…")
                        : t('Export All Dossiers for This Depot', 'Alle Dossiers dieses Depots exportieren', 'Exporter tous les dossiers de ce dépôt')}
                    </button>

                    {batchStatus && (
                      <div style={{ fontSize: '9px', color: '#2563EB', fontWeight: 'bold', backgroundColor: '#EFF6FF', padding: '6px', border: '1px solid #2563EB', textAlign: 'center' }}>
                        {batchStatus}
                      </div>
                    )}

                    <button
                      onClick={() => handleSelectEntityFocus('depot', selectedNodeDetails.label)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: focusedEntity?.name === selectedNodeDetails.label ? '#000000' : '#FFFFFF',
                        color: focusedEntity?.name === selectedNodeDetails.label ? '#FFFFFF' : '#000000',
                        border: '2px solid #000000',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      {focusedEntity?.name === selectedNodeDetails.label
                        ? t('[DEPOT ISOLATION ACTIVE (CLEAR FOCUS)]', '[DEPOT-ISOLATION AKTIV (FOKUS AUFHEBEN)]', '[ISOLATION DÉPÔT ACTIVE (LEVER LE FOCUS)]')
                        : t(`[ISOLATE ${selectedNodeDetails.label.toUpperCase()} ONLY]`, `[NUR ${selectedNodeDetails.label.toUpperCase()} ISOLIEREN]`, `[ISOLER UNIQUEMENT ${selectedNodeDetails.label.toUpperCase()}]`)}
                    </button>
                    <button
                      onClick={() => handleExclusiveCypherToggle(selectedNodeDetails.label)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label ? '#DC2626' : '#000000',
                        color: '#FFFFFF',
                        border: 'none',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      {exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label
                        ? t('[EXIT EXCLUSIVE CYPHER (FULL VIEW)]', '[EXKLUSIV-CYPHER BEENDEN (VOLLANSICHT)]', '[QUITTER CYPHER EXCLUSIF (VUE COMPLÈTE)]')
                        : t(`[LOAD EXCLUSIVE CYPHER: ${selectedNodeDetails.label.toUpperCase()} ONLY]`, `[EXKLUSIV CYPHER LADEN: NUR ${selectedNodeDetails.label.toUpperCase()}]`, `[CHARGER CYPHER EXCLUSIF : ${selectedNodeDetails.label.toUpperCase()}]`)}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Case B: KANTEN INSPEKTOR */}
            {selectedLink && !selectedRoute && (
              <div>
                {/* Header & Close */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000000', paddingBottom: '12px', marginBottom: '16px' }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        backgroundColor: selectedLink.type === 'VERDACHT_AUF'
                          ? '#0891B2'
                          : ((selectedLink.type === 'RAUBTE' || selectedLink.type === 'ENTEIGNETE') ? '#DC2626' : ((selectedLink.type === 'SCHENKTE' || selectedLink.type === 'VERKAUFTE_AN') ? '#2563EB' : '#000000')),
                        color: '#FFFFFF',
                        padding: '2px 8px',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        letterSpacing: '0.5px',
                        marginBottom: '4px'
                      }}
                    >
                      {selectedLink.type === 'VERDACHT_AUF'
                        ? t('[FORENSIC SUSPICION: EXPEDITION MATCH]', '[FORENSISCHER VERDACHT: EXPEDITIONS-MATCH]', "[SOUPÇON FORENSIQUE : CORRESPONDANCE D'EXPÉDITION]")
                        : `[${t('EVENT RECORD', 'EREIGNIS-AKTE', "FICHE D'ÉVÉNEMENT")}: ${relLabel(selectedLink.type, lang)}]`}
                    </span>
                    <h2 style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 900, wordBreak: 'break-word', color: '#000000' }}>
                      {selectedLink.source_label || (selectedLink.source.label || selectedLink.source.id || selectedLink.source)} &rarr; {selectedLink.target_label || (selectedLink.target.label || selectedLink.target.id || selectedLink.target)}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedLink(null)}
                    style={{
                      border: '2px solid #000000',
                      background: '#FFFFFF',
                      padding: '4px 8px',
                      fontWeight: 'bold',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    [X]
                  </button>
                </div>

                {/* Kanten-Eigenschaften */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
                  {selectedLink.type === 'VERDACHT_AUF' && (
                    <div style={{ border: '2px solid #0891B2', padding: '10px', backgroundColor: '#F0FDFA' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '9px', fontWeight: 900, color: '#0E7490' }}>
                          {t('[PROBABILISTIC PROVENANCE ASSIGNMENT]', '[PROBABILISTISCHE PROVENIENZ-ZUWEISUNG]', '[ATTRIBUTION PROBABILISTE DE PROVENANCE]')}
                        </span>
                        <span style={{ backgroundColor: '#0891B2', color: '#FFFFFF', padding: '1px 6px', fontSize: '8px', fontWeight: 'bold' }}>
                          {Math.round((selectedLink.confidence || 0.9) * 100)}% {t('CONFIDENCE', 'KONFIDENZ', 'CONFIANCE')}
                        </span>
                      </div>
                      {selectedLink.begruendung && (
                        <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '6px', lineHeight: 1.3 }}>
                          <b>{t('Heuristic Rationale:', 'Heuristische Begründung:', 'Justification heuristique :')}</b> {selectedLink.begruendung}
                        </div>
                      )}
                      {selectedLink.zitat && (
                        <div style={{ fontSize: '8px', color: '#0E7490', marginTop: '6px', fontStyle: 'italic', borderLeft: '3px solid #0891B2', paddingLeft: '6px', backgroundColor: '#CCFBF1', padding: '4px 6px' }}>
                          &ldquo;{selectedLink.zitat}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('ORIGINATOR / RESPONSIBLE ACTOR:', 'URHEBER / VERANTWORTLICHER AKTEUR:', 'AUTEUR / ACTEUR RESPONSABLE :')}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedLink.source_label || (selectedLink.source.label || selectedLink.source.id)}
                    </div>
                    {selectedLink.source_desc && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>
                        {selectedLink.source_desc}
                      </div>
                    )}
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('AFFECTED OBJECT / CULTURAL HERITAGE:', 'BETROFFENES SUBJEKT / KULTURGUT:', 'OBJET / BIEN CULTUREL CONCERNÉ :')}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedLink.target_label || (selectedLink.target.label || selectedLink.target.id)}
                    </div>
                    {selectedLink.target_desc && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>
                        {selectedLink.target_desc}
                      </div>
                    )}
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#EFF6FF', borderLeft: '4px solid #2563EB' }}>
                    <div style={{ fontSize: '8px', color: '#1E40AF', fontWeight: 'bold' }}>
                      {t('HISTORICAL PRIMARY CITATION / SOURCE:', 'HISTORISCHER PRIMÄRBELEG / QUELLE:', 'SOURCE PRIMAIRE HISTORIQUE :')}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedLink.beleg || t('No citation recorded', 'Keine Quellenangabe verzeichnet', 'Aucune source enregistrée')}
                    </div>
                    {selectedLink.jahr && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '3px' }}>
                        <b>{t('Event Year:', 'Ereignisjahr:', "Année de l'événement :")}</b> {selectedLink.jahr}
                      </div>
                    )}
                    {selectedLink.expedition && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>
                        <b>{t('Expedition / Register:', 'Expedition / Register:', 'Expédition / Registre :')}</b> {selectedLink.expedition}
                      </div>
                    )}
                  </div>

                  {selectedLink.behauptung && (
                    <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#FEFCE8', borderLeft: '4px solid #CA8A04' }}>
                      <div style={{ fontSize: '8px', color: '#854D0E', fontWeight: 'bold' }}>
                        {t('NARRATIVE CLASSIFICATION:', 'NARRATIV-EINSTUFUNG:', 'QUALIFICATION NARRATIVE :')}
                      </div>
                      <div style={{ fontSize: '9px', color: '#000000', marginTop: '2px', fontStyle: 'italic' }}>
                        &ldquo;{selectedLink.behauptung}&rdquo;
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Button: Dossier fuer verknuepftes Subjekt */}
                {(selectedLink.target_inv || selectedLink.source_inv) && (
                  <div style={{ borderTop: '1px solid #D8D5CD', paddingTop: '14px' }}>
                    <button
                      onClick={() => handlePrintDossier(selectedLink.target_inv || selectedLink.source_inv)}
                      disabled={isGeneratingDossier}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        backgroundColor: '#141413',
                        color: '#FFFFFF',
                        border: 'none',
                        borderLeft: '3px solid #991B1B',
                        borderRadius: '2px',
                        fontWeight: 600,
                        fontSize: '11px',
                        cursor: isGeneratingDossier ? 'wait' : 'pointer',
                      }}
                    >
                      {isGeneratingDossier
                        ? t('Generating dossier…', 'Generiere Dossier…', 'Génération du dossier…')
                        : t(
                            `Export Dossier for ${selectedLink.target_inv || selectedLink.source_inv}`,
                            `Dossier für ${selectedLink.target_inv || selectedLink.source_inv} exportieren`,
                            `Exporter le dossier pour ${selectedLink.target_inv || selectedLink.source_inv}`
                          )}
                    </button>
                    
                    {dossierStatus && (
                      <div style={{ fontSize: '10.5px', color: '#991B1B', fontWeight: 600, marginTop: '6px', textAlign: 'center' }}>
                        {dossierStatus}
                      </div>
                    )}

                    <div style={{ marginTop: '8px' }}>
                      <button
                        onClick={handleDeleteEdge}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          backgroundColor: '#FEF2F2',
                          color: '#991B1B',
                          border: '1px solid #E5B8B8',
                          borderRadius: '2px',
                          fontWeight: 600,
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        {t('Delete this relation', 'Diese Relation löschen', 'Supprimer cette relation')}
                      </button>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* Case C: RESTITUTIONS-ROUTEN INSPEKTOR */}
            {selectedRoute && (
              <div>
                {/* Header & Close */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000000', paddingBottom: '12px', marginBottom: '16px' }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        backgroundColor: selectedRoute.has_suspicion ? '#0891B2' : (selectedRoute.has_contested ? '#CA8A04' : '#DC2626'),
                        color: '#FFFFFF',
                        padding: '2px 8px',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        letterSpacing: '0.5px',
                        marginBottom: '4px'
                      }}
                    >
                      {selectedRoute.has_suspicion
                        ? t('[FORENSIC SUSPICION: EXPEDITION VECTOR]', '[FORENSISCHER VERDACHT: EXPEDITIONS-VEKTOR]', "[SOUPÇON FORENSIQUE : VECTEUR D'EXPÉDITION]")
                        : t('[RESTITUTION VECTOR: LOOT ROUTE]', '[RESTITUTIONS-VEKTOR: RAUBROUTE]', '[VECTEUR DE RESTITUTION : ROUTE DE PILLAGE]')}
                    </span>
                    <h2 style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 900, wordBreak: 'break-word', color: '#000000' }}>
                      {selectedRoute.origin_name} &rarr; {selectedRoute.depot_city}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedRoute(null)}
                    style={{
                      border: '2px solid #000000',
                      background: '#FFFFFF',
                      padding: '4px 8px',
                      fontWeight: 'bold',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    [X]
                  </button>
                </div>

                {/* Route Metriken */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('ORIGIN DISTRICT / POLITY (CAMEROON):', 'HERKUNFTS-DISTRIKT / POLITY (KAMERUN):', "DISTRICT / POLITY D'ORIGINE (CAMEROUN) :")}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedRoute.origin_name} ({selectedRoute.origin_region})
                    </div>
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('TARGET DEPOT (MUSEUM):', 'ZIEL-DEPOT (MUSEUM):', 'DÉPÔT CIBLE (MUSÉE) :')}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedRoute.depot_name}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#FEF2F2', borderLeft: '4px solid #DC2626' }}>
                    <div style={{ fontSize: '8px', color: '#991B1B', fontWeight: 'bold' }}>
                      {t('CULTURAL OBJECTS ON THIS VECTOR:', 'KULTURGÜTER AUF DIESEM VEKTOR:', 'BIENS CULTURELS SUR CE VECTEUR :')}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 900, color: '#DC2626', marginTop: '2px' }}>
                      {selectedRoute.object_count} {t('objects', 'Objekte', 'objets')}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('COLONIAL OFFICERS / PERPETRATORS:', 'KOLONIALOFFIZIERE / TÄTER:', 'OFFICIERS COLONIAUX / AUTEURS :')}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#B45309', marginTop: '2px' }}>
                      {selectedRoute.actors.join(', ') || t('Schutztruppe / Not named individually', 'Schutztruppe / Nicht namentlich erfasst', 'Schutztruppe / Non identifiés nominativement')}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>
                      {t('MILITARY EXPEDITIONS:', 'MILITÄRISCHE EXPEDITIONEN:', 'EXPÉDITIONS MILITAIRES :')}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedRoute.expeditions.join(', ')}
                    </div>
                  </div>
                </div>

                {/* Batch Export Button */}
                <button
                  onClick={() => handleBatchDossier('list', selectedRoute.origin_name, (selectedRoute.objects || []).map((o: any) => o.inv || o.id).filter(Boolean))}
                  disabled={isGeneratingBatch}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#141413',
                    color: '#FFFFFF',
                    border: 'none',
                    borderLeft: '3px solid #991B1B',
                    borderRadius: '2px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: isGeneratingBatch ? 'wait' : 'pointer',
                    marginBottom: '16px'
                  }}
                >
                  {isGeneratingBatch
                    ? t('Packaging route archive…', 'Bündle Routen-Archiv…', "Compilation de l'archive…")
                    : t(
                        `Export all ${selectedRoute.object_count} dossiers on this route`,
                        `Alle ${selectedRoute.object_count} Dossiers dieser Route exportieren`,
                        `Exporter les ${selectedRoute.object_count} dossiers de cette route`
                      )}
                </button>

                {/* Liste der Kulturgüter */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 900, color: '#000000', marginBottom: '8px', letterSpacing: '0.5px' }}>
                    {t('LOOTED HERITAGE OBJECTS', 'RAUBKUNST-SUBJEKTE', 'BIENS CULTURELS PILLÉS')} ({selectedRoute.objects.length}):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '380px', overflowY: 'auto' }}>
                    {selectedRoute.objects.map((obj: any, idx: number) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const found = graphData.nodes.find((n: any) => n.id === obj.inv);
                          setSelectedRoute(null);
                          setSelectedNode(found || {
                            id: obj.inv,
                            label: obj.bez || obj.inv,
                            type: 'Subjekt',
                            desc: obj.bez || '',
                            contested: obj.contested
                          });
                        }}
                        style={{
                          padding: '8px',
                          border: '1px solid #000000',
                          backgroundColor: obj.contested ? '#FEFCE8' : '#FFFFFF',
                          cursor: 'pointer',
                          boxShadow: '1px 1px 0px #000000'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', fontWeight: 900, color: '#000000' }}>
                            {obj.inv}
                          </span>
                          {obj.contested && (
                            <span style={{ fontSize: '7px', fontWeight: 'bold', backgroundColor: '#CA8A04', color: '#FFFFFF', padding: '1px 4px' }}>
                              {t('DISSONANCE', 'DISSONANZ', 'DISSONANCE')}
                            </span>
                          )}
                          {obj.rel_type === 'VERDACHT_AUF' && (
                            <span style={{ fontSize: '7px', fontWeight: 'bold', backgroundColor: '#0891B2', color: '#FFFFFF', padding: '1px 4px' }}>
                              {t('SUSPICION', 'VERDACHT', 'SOUPÇON')}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>
                          {obj.bez || t('Untitled', 'Ohne Bezeichnung', 'Sans désignation')}
                        </div>
                        {obj.actor && (
                          <div style={{ fontSize: '8px', color: '#B45309', marginTop: '2px' }}>
                            {t('Actor:', 'Täter:', 'Acteur :')} {obj.actor}
                          </div>
                        )}
                        <div style={{ fontSize: '7px', color: '#0284C7', marginTop: '4px', fontWeight: 'bold' }}>
                          {t('[CLICK: OPEN INDIVIDUAL DOSSIER]', '[KLICKEN: EINZEL-DOSSIER ÖFFNEN]', '[CLIQUER : OUVRIR LE DOSSIER INDIVIDUEL]')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}

      {/* Archival Researcher Authorization Modal */}
      {showLoginModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(20,20,19,0.55)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #1C1B19',
            borderRadius: '2px',
            boxShadow: '0 20px 50px rgba(20,20,19,0.24)',
            width: '92%',
            maxWidth: '450px',
            padding: '24px',
            fontFamily: "'Inter', sans-serif"
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #D8D5CD', paddingBottom: '10px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#141413' }}>
                {t('Researcher Authorization', 'Forscher-Autorisierung', 'Autorisation chercheur')}
              </div>
              <button
                onClick={() => { setShowLoginModal(false); setLoginError(null); }}
                className="archival-btn"
                style={{ padding: '2px 8px', fontSize: '12px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '12px', color: '#52514C', lineHeight: 1.55, marginBottom: '14px', marginTop: 0 }}>
              {lang === 'de' ? (
                <>
                  Im <strong>Gast-Modus</strong> sind alle Analysen, Graph-Erkundungen, Filter und Dossiers frei verfügbar. Schreibende Aktionen (Kanten anlegen/löschen, Quellen-Ingestionen, Annotationen) erfordern den Forscher-Modus.
                </>
              ) : lang === 'fr' ? (
                <>
                  En <strong>mode invité</strong>, toutes les analyses, explorations du graphe, filtres et dossiers sont librement accessibles. Les actions d'écriture (arêtes, ingestions, annotations) nécessitent le mode chercheur.
                </>
              ) : (
                <>
                  In <strong>Guest Mode</strong>, all analyses, graph explorations, filters, and dossiers are freely available. Mutating actions (creating/deleting edges, source ingestions, annotations) require researcher mode.
                </>
              )}
            </p>

            {isStaticSnapshotMode() && (
              <div style={{
                marginBottom: '16px',
                padding: '12px 14px',
                backgroundColor: '#F0FDF4',
                border: '1px solid #86EFAC',
                borderLeft: '3px solid #166534',
                borderRadius: '2px'
              }}>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#166534', marginBottom: '4px' }}>
                  {t(
                    'Public Browser Sandbox — No Password Required',
                    'Öffentliche Browser-Sandbox — Kein Passwort nötig',
                    'Bac à sable navigateur public — Sans mot de passe'
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#166534', lineHeight: 1.5, marginBottom: '10px', opacity: 0.9 }}>
                  {t(
                    'All source ingestions, photo-chain commits, annotations, and edge edits are saved privately in your browser (localStorage) without modifying the shared server.',
                    'Alle Quellen-Ingestionen, Foto-Ketten-Commits, Annotationen und Kanten-Änderungen werden privat in deinem Browser (localStorage) gespeichert — ohne den öffentlichen Server zu verändern.',
                    'Toutes les ingestions, chaînes photo, annotations et éditions restent enregistrées localement dans votre navigateur (localStorage).'
                  )}
                </div>
                <button
                  type="button"
                  data-testid="sandbox-login-btn"
                  onClick={handleSandboxLogin}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#166534',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '2px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t(
                    'Enable Local Sandbox Researcher Mode',
                    'Lokalen Sandbox-Forschermodus aktivieren',
                    'Activer le mode chercheur bac à sable'
                  )}
                </button>
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '6px', color: '#3F3E3A' }}>
                  {t('Server Researcher Password', 'Server-Forscher-Passwort', 'Mot de passe chercheur serveur')}
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder={t('Enter password…', 'Passwort eingeben…', 'Saisir le mot de passe…')}
                  autoFocus={!isStaticSnapshotMode()}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #D8D5CD',
                    borderRadius: '2px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              {loginError && (
                <div style={{
                  padding: '8px 10px',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #E5B8B8',
                  borderLeft: '3px solid #991B1B',
                  color: '#991B1B',
                  fontSize: '11px',
                  fontWeight: 500,
                  marginBottom: '14px'
                }}>
                  {loginError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowLoginModal(false); setLoginError(null); }}
                  className="archival-btn"
                  style={{ padding: '7px 12px', fontSize: '11.5px' }}
                >
                  {t('Cancel', 'Abbrechen', 'Annuler')}
                </button>
                <button
                  type="submit"
                  disabled={isLoggingIn || !loginPassword.trim()}
                  className="archival-btn archival-btn-primary"
                  style={{ padding: '7px 14px', fontSize: '11.5px' }}
                >
                  {isLoggingIn
                    ? t('Verifying…', 'Prüfe…', 'Vérification…')
                    : t('Sign in', 'Anmelden', 'Connexion')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
