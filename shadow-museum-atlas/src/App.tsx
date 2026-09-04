// @ts-nocheck
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

type MetricFilter = null | 'subjekte' | 'raub' | 'schenkung' | 'dissonanz' | 'verdacht' | 'akteure' | 'depots' | 'luecken';

export default function App() {
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
  
  // Interactive Metric Toggle (Oben Links)
  const [activeMetricFilter, setActiveMetricFilter] = useState<MetricFilter>(null);

  // Ghost Mode (Verschollene Raubkunst ohne Depotnachweis)
  const [ghostMode, setGhostMode] = useState(false);
  const [ghostIds, setGhostIds] = useState<Set<string>>(new Set());

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

  // Forensic Entity Quick-Filters (Akteure & Depots)
  const [filterEntities, setFilterEntities] = useState<{ actors: any[]; institutions: any[] }>({ actors: [], institutions: [] });
  const [focusedEntity, setFocusedEntity] = useState<{ type: 'actor' | 'depot'; name: string } | null>(null);
  const [focusedSummary, setFocusedSummary] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'actors' | 'depots' | 'gaps'>('actors');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [exclusiveCypherMode, setExclusiveCypherMode] = useState(false);

  // 1. Publikationen laden
  const loadPublications = useCallback(() => {
    fetch('/api/publications')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.publications) {
          setPublications(data.publications);
          if (selectedPubs.size === 0) {
            const allIds = new Set<string>(data.publications.map((p: any) => p.id));
            setSelectedPubs(allIds);
          }
        }
      })
      .catch(err => console.error("Fehler beim Laden der Publikationen:", err));
  }, [selectedPubs]);

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

          setGraphData({ nodes: data.nodes || [], links: rawLinks });
        } else {
          setError("Fehler beim Laden des Beweisgraphen.");
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Graph Fetch Error:", err);
        setError("Verbindung zur Graph-API fehlgeschlagen (Port 8088 / Neo4j).");
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
  }, [loadPublications, loadFilterEntities]);

  useEffect(() => {
    if (publications.length > 0) {
      loadGraph();
    }
  }, [publications.length]);

  // 4. Publikation Toggle
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
  const handleBatchDossier = (entityType: 'actor' | 'institution' | 'gaps', entityName: string) => {
    setIsGeneratingBatch(true);
    setBatchStatus(`[START: BÜNDLE DOSSIERS FÜR ${entityName.toUpperCase()}...]`);

    fetch('/api/dossier/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: entityType,
        entity_name: entityName,
        limit: 300
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("Batch-Export fehlgeschlagen");
        return res.json();
      })
      .then(data => {
        if (data.success && data.download_url) {
          setBatchStatus(`[FERTIG: ${data.dossiers_packaged} DOSSIERS IN ${data.filename} GEPACKT - DOWNLOAD STARTET]`);
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
          setBatchStatus(`[FEHLER: ${data.detail || "Export abgebrochen"}]`);
          setIsGeneratingBatch(false);
        }
      })
      .catch(err => {
        console.error(err);
        setBatchStatus("[FEHLER BEIM BATCH-EXPORT]");
        setIsGeneratingBatch(false);
      });
  };

  // 4.02 IFG-Auskunftsersuchen in Zwischenablage kopieren
  const handleCopyIFG = (invNumber: string, museum: string) => {
    const text = `Antrag nach dem Informationsfreiheitsgesetz (IFG) / Landesinformationsfreiheitsgesetz\n\nBetreff: Auskunftsersuchen zu den historischen Zugangsbüchern (1884–1916) für Inventarnummer ${invNumber}\nEmpfänger: Direktion / Provenienzforschung ${museum}\n\nSehr geehrte Damen und Herren,\n\nim Rahmen unabhängiger Provenienzrecherchen zur kolonialen Herkunft von Kulturgütern aus Kamerun beantrage ich hiermit Einsicht in die physischen bzw. digitalisierten Zugangsbücher, Inventarlisten und Akten der Jahre 1884 bis 1916 für die Inventarnummer ${invNumber}.\n\nDa in den aktuellen Bestandsdaten keinerlei historischer Erwerbsakt dokumentiert ist, ist die Einsicht in die Primärquellen zur Rekonstruktion der lückenlosen Beweiskette (Chain of Custody) zwingend erforderlich.\n\nMit freundlichen Grüßen,\nMarianne (Project Echo Provenienz-Forensik)`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 3000);
      });
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
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsUploading(true);
    setUploadMessage(`[INGESTION: ANALYSIERE ${file.name.toUpperCase()}...]`);

    const formData = new FormData();
    formData.append("file", file);

    fetch('/api/sources/upload', {
      method: 'POST',
      body: formData
    })
      .then(res => {
        if (!res.ok) throw new Error("Upload fehlgeschlagen");
        return res.json();
      })
      .then(data => {
        if (data.success) {
          setUploadMessage(`[ERFOLG: ${data.triples_extracted} RELATIONEN AUS ${file.name.toUpperCase()} INJIZIERT]`);
          loadPublications();
          setTimeout(() => {
            loadGraph();
            setIsUploading(false);
          }, 1000);
          setTimeout(() => setUploadMessage(null), 5000);
        } else {
          setUploadMessage(`[FEHLER: ${data.detail || "Verarbeitung abgebrochen"}]`);
          setIsUploading(false);
        }
      })
      .catch(err => {
        console.error(err);
        setUploadMessage("[FEHLER: DATEI-INGESTION FEHLGESCHLAGEN]");
        setIsUploading(false);
      });
  };

  // 7. Dossier Generator
  const handlePrintDossier = (invNumber: string) => {
    if (!invNumber) return;
    setIsGeneratingDossier(true);
    setDossierStatus("[BEWEISKETTE WIRD EXTRAHIERT...]");

    fetch('/api/dossier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventarnummer: invNumber })
    })
      .then(res => {
        if (!res.ok) throw new Error("Dossier konnte nicht generiert werden.");
        return res.json();
      })
      .then(data => {
        if (data.success && data.download_url) {
          setDossierStatus("[PDF ERSTELLT - DOWNLOAD STARTET]");
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = data.filename || `Restitutionsdossier_${invNumber}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => {
            setIsGeneratingDossier(false);
            setDossierStatus(null);
          }, 3000);
        } else {
          setDossierStatus("[FEHLER: " + (data.detail || "Unbekannter Fehler") + "]");
          setIsGeneratingDossier(false);
        }
      })
      .catch(err => {
        console.error(err);
        setDossierStatus("[FEHLER BEI DER PDF-GENERIERUNG]");
        setIsGeneratingDossier(false);
      });
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
    const matchesSearch = searchTerm && node.label.toLowerCase().includes(searchTerm.toLowerCase());

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
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Space Mono', monospace" }}>
      
      {/* 1. TOP HEADER (Fixed in document flow, full width) */}
      <header style={{ width: '100%', borderBottom: '3px solid #000000', backgroundColor: '#FFFFFF', padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 60, flexShrink: 0, boxSizing: 'border-box' }}>
        
        {/* Linke Header-Sektion: Titel, Metriken, Quellen */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '74%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ backgroundColor: '#000000', color: '#FFFFFF', padding: '2px 8px', fontWeight: 'bold', fontSize: '10px', letterSpacing: '1px' }}>
              PROJECT ECHO
            </span>
            <span style={{ fontSize: '10px', color: '#475569', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              RESTITUTION PROVENANCE KNOWLEDGE GRAPH
            </span>
            <span style={{ fontSize: '13px', fontWeight: 900, letterSpacing: '-0.5px', color: '#000000', marginLeft: '4px' }}>
              SHADOW MUSEUM ATLAS
            </span>
          </div>

          {/* Metrik-Schalter */}
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleMetricToggle('subjekte')}
              title="Klicken zum Isolieren aller Subjekte / Kulturgüter"
              style={{
                backgroundColor: activeMetricFilter === 'subjekte' ? '#000000' : '#F1F5F9',
                color: activeMetricFilter === 'subjekte' ? '#FFFFFF' : '#000000',
                border: '2px solid #000000',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'subjekte' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.subjekte.toLocaleString()} SUBJEKTE
            </button>

            <button
              onClick={() => handleMetricToggle('raub')}
              title="Klicken zum Isolieren des militärischen Raubnetzwerks"
              style={{
                backgroundColor: activeMetricFilter === 'raub' ? '#DC2626' : '#FFFFFF',
                color: activeMetricFilter === 'raub' ? '#FFFFFF' : '#DC2626',
                border: '2px solid #DC2626',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'raub' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.raub_kanten.toLocaleString()} RAUB-KANTEN
            </button>

            <button
              onClick={() => handleMetricToggle('schenkung')}
              title="Klicken zum Isolieren der offiziellen Museums-Schenkungen"
              style={{
                backgroundColor: activeMetricFilter === 'schenkung' ? '#2563EB' : '#FFFFFF',
                color: activeMetricFilter === 'schenkung' ? '#FFFFFF' : '#2563EB',
                border: '2px solid #2563EB',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'schenkung' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.schenk_kanten.toLocaleString()} SCHENKUNGEN
            </button>

            <button
              onClick={() => handleMetricToggle('dissonanz')}
              title="Klicken zum Isolieren der semantischen Dissonanzen (Multigraph-Kollision)"
              style={{
                backgroundColor: activeMetricFilter === 'dissonanz' ? '#CA8A04' : '#FFFFFF',
                color: activeMetricFilter === 'dissonanz' ? '#FFFFFF' : '#854D0E',
                border: '2px solid #CA8A04',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'dissonanz' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.contested_objekte.toLocaleString()} DISSONANZEN
            </button>

            <button
              onClick={() => handleMetricToggle('luecken')}
              title="Klicken zum Isolieren der Provenienzlücken (Chain of Custody gerissen: LAGERT_IN ohne Akteur)"
              style={{
                backgroundColor: activeMetricFilter === 'luecken' ? '#7C3AED' : '#FFFFFF',
                color: activeMetricFilter === 'luecken' ? '#FFFFFF' : '#7C3AED',
                border: '2px solid #7C3AED',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'luecken' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {(stats.provenienz_luecken || 83).toLocaleString()} PROVENIENZLÜCKEN
            </button>

            <button
              onClick={() => handleMetricToggle('verdacht')}
              title="Klicken zum Isolieren der 36 probabilistischen Verdachtskanten (Autonomous Provenance Hunter)"
              style={{
                backgroundColor: activeMetricFilter === 'verdacht' ? '#0891B2' : '#FFFFFF',
                color: activeMetricFilter === 'verdacht' ? '#FFFFFF' : '#0891B2',
                border: '2px solid #0891B2',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'verdacht' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {(stats.verdacht_kanten || suspicions.length || 36).toLocaleString()} VERDACHTS-KANTEN
            </button>

            <button
              onClick={() => handleMetricToggle('akteure')}
              title="Klicken zum Isolieren der Kolonialakteure / Offiziere"
              style={{
                backgroundColor: activeMetricFilter === 'akteure' ? '#B45309' : '#FFFFFF',
                color: activeMetricFilter === 'akteure' ? '#FFFFFF' : '#B45309',
                border: '2px solid #B45309',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'akteure' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.akteure} AKTEURE
            </button>

            <button
              onClick={() => handleMetricToggle('depots')}
              title="Klicken zum Isolieren der Museumsinstitutionen"
              style={{
                backgroundColor: activeMetricFilter === 'depots' ? '#000000' : '#FFFFFF',
                color: activeMetricFilter === 'depots' ? '#FFFFFF' : '#000000',
                border: '2px solid #000000',
                padding: '3px 7px',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: activeMetricFilter === 'depots' ? '2px 2px 0px #000000' : 'none'
              }}
            >
              {stats.institutionen} DEPOTS
            </button>

            {activeMetricFilter && (
              <button
                onClick={() => setActiveMetricFilter(null)}
                style={{
                  backgroundColor: '#000000',
                  color: '#FFFFFF',
                  border: '1px solid #000000',
                  padding: '3px 6px',
                  fontSize: '8px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                [RESET FILTER]
              </button>
            )}
          </div>

          {/* Zuschaltbare Quellen */}
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '8px', fontWeight: 900, color: '#000000' }}>QUELLEN:</span>
            {publications.map((pub: any) => {
              const isActive = selectedPubs.has(pub.id);
              return (
                <button
                  key={pub.id}
                  onClick={() => togglePublication(pub.id)}
                  title={`${pub.name} (${pub.typ}, ${pub.jahr || ''})`}
                  style={{
                    padding: '2px 5px',
                    fontSize: '8px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    border: '1px solid #000000',
                    backgroundColor: isActive ? '#000000' : '#FFFFFF',
                    color: isActive ? '#FFFFFF' : '#64748B',
                    textDecoration: isActive ? 'none' : 'line-through'
                  }}
                >
                  [{isActive ? 'X' : ' '}] {pub.kuerzel} ({pub.edge_count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Rechte Header-Sektion: Aktionen & Suche */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              onClick={() => {
                const next = !kioskMode;
                setKioskMode(next);
                if (next) {
                  setActiveMetricFilter(null);
                  setGhostMode(false);
                }
              }}
              title="Museums-Installationsmodus: Automatischer Kameraflug über Raubkunst- und Dissonanzknoten"
              style={{
                padding: '6px 10px',
                backgroundColor: kioskMode ? '#000000' : '#FFFFFF',
                color: kioskMode ? '#F59E0B' : '#000000',
                border: kioskMode ? '2px solid #F59E0B' : '2px solid #000000',
                boxShadow: kioskMode ? '2px 2px 0px #F59E0B' : '2px 2px 0px #000000',
                fontWeight: 900,
                fontSize: '9px',
                cursor: 'pointer',
                letterSpacing: '0.5px'
              }}
            >
              {kioskMode ? '[KIOSK-AUTOPILOT: AKTIV]' : '[KIOSK-MODUS (AUTOPILOT)]'}
            </button>

            <button
              onClick={() => {
                setGhostMode(!ghostMode);
                if (!ghostMode) setActiveMetricFilter(null);
                if (fgRef.current) fgRef.current.zoomToFit(800, 50);
              }}
              style={{
                padding: '6px 10px',
                backgroundColor: ghostMode ? '#DC2626' : '#FFFFFF',
                color: ghostMode ? '#FFFFFF' : '#000000',
                border: '2px solid #000000',
                boxShadow: '2px 2px 0px #000000',
                fontWeight: 'bold',
                fontSize: '9px',
                cursor: 'pointer'
              }}
            >
              {ghostMode ? '[GHOST-MODUS AKTIV]' : '[GHOST-NODES (VERSCHOLLEN)]'}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.txt,.csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              style={{
                padding: '6px 10px',
                backgroundColor: '#F8FAFC',
                color: '#000000',
                border: '2px dashed #000000',
                boxShadow: '2px 2px 0px #000000',
                fontWeight: 'bold',
                fontSize: '9px',
                cursor: isUploading ? 'wait' : 'pointer'
              }}
            >
              {isUploading ? '[INGESTION LAEUFT...]' : '[+ QUELLE INJIZIEREN]'}
            </button>

            <button
              onClick={() => fgRef.current?.zoomToFit(600, 40)}
              style={{
                padding: '6px 8px',
                backgroundColor: '#FFFFFF',
                border: '2px solid #000000',
                boxShadow: '2px 2px 0px #000000',
                fontSize: '9px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              [ZOOM TO FIT]
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {uploadMessage && (
              <span style={{ padding: '3px 6px', backgroundColor: '#000000', color: '#FFFFFF', fontSize: '8px', fontWeight: 'bold' }}>
                {uploadMessage}
              </span>
            )}
            {batchStatus && (
              <span style={{ padding: '3px 6px', backgroundColor: '#B45309', color: '#FFFFFF', fontSize: '8px', fontWeight: 'bold' }}>
                {batchStatus}
              </span>
            )}
            <div className="brutalist-border" style={{ padding: '3px 6px', display: 'flex', gap: '4px', width: '250px', backgroundColor: '#FFFFFF' }}>
              <input
                type="text"
                placeholder="SUCHE (INV / AKTEUR / DEPOT)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  backgroundColor: 'transparent',
                  fontFamily: "'Space Mono', monospace"
                }}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '9px' }}
                >
                  [X]
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 2. MAIN 3-COLUMN WORKSPACE */}
      <div style={{ flex: 1, display: 'flex', width: '100%', overflow: 'hidden', position: 'relative' }}>
        
        {/* COLUMN 1: LEFT SIDEBAR (SCHNELLFILTER) */}
        <aside
          style={{
            width: sidebarOpen ? '320px' : '44px',
            height: '100%',
            borderRight: '3px solid #000000',
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
          {!sidebarOpen && (
            <div
              style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '16px', cursor: 'pointer' }}
              onClick={() => setSidebarOpen(true)}
              title="Schnellfilter öffnen"
            >
              <button style={{ border: '2px solid #000000', background: '#FFFFFF', fontWeight: 'bold', fontSize: '10px', padding: '4px 6px', cursor: 'pointer' }}>
                [+]
              </button>
              <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', marginTop: '24px', fontSize: '10px', fontWeight: 900, letterSpacing: '1.5px', color: '#000000' }}>
                SCHNELLFILTER (TÄTER / DEPOTS / LÜCKEN)
              </div>
            </div>
          )}

          {/* Expanded Sidebar */}
          {sidebarOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              {/* Header */}
              <div style={{ padding: '10px 12px', borderBottom: '2px solid #000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 900, color: '#000000', letterSpacing: '0.5px' }}>
                    [SCHNELLFILTER]
                  </div>
                  <div style={{ fontSize: '8px', color: '#64748B', marginTop: '1px' }}>
                    1-KLICK ISOLATION IM GRAPHEN
                  </div>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  title="Leiste minimieren"
                  style={{
                    padding: '2px 6px',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #000000',
                    fontWeight: 'bold',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  [-]
                </button>
              </div>

              {/* Active Entity Focus Banner */}
              {focusedEntity && (
                <div style={{ padding: '8px 12px', backgroundColor: '#000000', color: '#FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '9px', fontWeight: 'bold' }}>
                    FOKUS: <span style={{ color: focusedEntity.type === 'actor' ? '#F59E0B' : '#60A5FA' }}>{focusedEntity.name.toUpperCase()}</span>
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
                      backgroundColor: '#DC2626',
                      color: '#FFFFFF',
                      border: 'none',
                      padding: '2px 6px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                    title="Fokus aufheben und gesamten Atlas zeigen"
                  >
                    [RESET]
                  </button>
                </div>
              )}

              {/* Exclusive Cypher Mode Alert */}
              {exclusiveCypherMode && (
                <div style={{ padding: '6px 10px', backgroundColor: '#FEF2F2', borderBottom: '1px solid #DC2626', fontSize: '8px', color: '#991B1B', fontWeight: 'bold' }}>
                  [EXKLUSIV-CYPHER AKTIV: NUR KNOTEN DIESER ENTITÄT]
                </div>
              )}

              {/* 3 Tabs: TÄTER, DEPOTS, LÜCKEN */}
              <div style={{ display: 'flex', borderBottom: '2px solid #000000' }}>
                <button
                  onClick={() => setSidebarTab('actors')}
                  style={{
                    flex: 1,
                    padding: '7px 4px',
                    fontSize: '8px',
                    fontWeight: 900,
                    backgroundColor: sidebarTab === 'actors' ? '#000000' : '#FFFFFF',
                    color: sidebarTab === 'actors' ? '#FFFFFF' : '#000000',
                    border: 'none',
                    borderRight: '1px solid #000000',
                    cursor: 'pointer'
                  }}
                >
                  TÄTER ({filterEntities.actors.length})
                </button>
                <button
                  onClick={() => setSidebarTab('depots')}
                  style={{
                    flex: 1,
                    padding: '7px 4px',
                    fontSize: '8px',
                    fontWeight: 900,
                    backgroundColor: sidebarTab === 'depots' ? '#000000' : '#FFFFFF',
                    color: sidebarTab === 'depots' ? '#FFFFFF' : '#000000',
                    border: 'none',
                    borderRight: '1px solid #000000',
                    cursor: 'pointer'
                  }}
                >
                  DEPOTS ({filterEntities.institutions.length})
                </button>
                <button
                  onClick={() => setSidebarTab('gaps')}
                  style={{
                    flex: 1,
                    padding: '7px 4px',
                    fontSize: '8px',
                    fontWeight: 900,
                    backgroundColor: sidebarTab === 'gaps' ? '#7C3AED' : '#FFFFFF',
                    color: sidebarTab === 'gaps' ? '#FFFFFF' : '#7C3AED',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  LÜCKEN ({gapItems.length || stats.provenienz_luecken})
                </button>
              </div>

              {/* Tab Search Filter */}
              <div style={{ padding: '6px 10px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                <input
                  type="text"
                  placeholder={sidebarTab === 'actors' ? "TÄTER FILTERN..." : (sidebarTab === 'depots' ? "DEPOT FILTERN..." : "INVENTARNR / SUBJEKT...")}
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    fontSize: '9px',
                    fontWeight: 'bold',
                    border: '1px solid #000000',
                    outline: 'none',
                    backgroundColor: '#FFFFFF',
                    fontFamily: "'Space Mono', monospace"
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
                              {actor.raub_count} RAUB
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
                              {inst.count} SUBJEKTE
                            </span>
                          </div>
                          <div style={{ fontSize: '8px', color: isFocused ? '#94A3B8' : '#64748B', marginTop: '2px' }}>
                            Stadt: {inst.stadt || 'Unbekannt'} | {inst.contested_count} Dissonanzen ({Math.round((inst.contested_count / (inst.count || 1)) * 100)}%)
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
                        ALLE ({gapItems.length})
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
                        VERDACHT ({suspicions.length})
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
                        LÜCKEN ({Math.max(0, gapItems.length - suspicions.length)})
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
                              {gap.institution || gap.museum || 'Museumsdepot'}
                            </span>
                          </div>
                          <div style={{ fontSize: '8px', color: '#334155', marginTop: '2px', fontWeight: 'bold' }}>
                            {gap.bezeichnung || gap.name}
                          </div>
                          {susp ? (
                            <div style={{ marginTop: '3px' }}>
                              <div style={{ fontSize: '8px', color: '#0891B2', fontWeight: 'bold' }}>
                                [VERDACHT: {susp.akteur} ({Math.round((susp.confidence || 0.9) * 100)}%)]
                              </div>
                              <div style={{ fontSize: '7.5px', color: '#64748B', fontStyle: 'italic' }}>
                                {susp.expedition}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '8px', color: '#64748B', marginTop: '1px', fontStyle: 'italic' }}>
                              Kein historischer Akteur verzeichnet (Depot-Blackbox)
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </aside>

        {/* COLUMN 2: CENTER CANVAS CONTAINER (RESIZES DYNAMICALLY VIA RESIZEOBSERVER) */}
        <main
          ref={canvasContainerRef}
          style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#FFFFFF'
          }}
        >
          <ForceGraph2D
            ref={fgRef}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            graphData={graphData}
            backgroundColor="#FFFFFF"
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
              setSelectedNode(node);
              if (fgRef.current) {
                fgRef.current.centerAt(node.x, node.y, 600);
                fgRef.current.zoom(2.5, 600);
              }
            }}
            onLinkClick={(link) => {
              setSelectedNode(null);
              setSelectedLink(link);
            }}
            onLinkHover={(link) => setHoveredLink(link)}
            onBackgroundClick={() => {
              setSelectedNode(null);
              setSelectedLink(null);
            }}
            cooldownTicks={120}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />

          {/* Kiosk Mode Floating HUD */}
          {kioskMode && (
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#000000', color: '#F59E0B', border: '2px solid #F59E0B', boxShadow: '4px 4px 0px rgba(0,0,0,0.4)', padding: '8px 16px', zIndex: 35, display: 'flex', alignItems: 'center', gap: '12px', fontSize: '10px', fontWeight: 900, letterSpacing: '0.5px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B', display: 'inline-block' }}></span>
              <span>MUSEUM-KIOSK AUTOPILOT AKTIV — FOKUS: {kioskTargetId || 'TRAVERSIERE BEWEISGUT'}</span>
              <button
                onClick={() => setKioskMode(false)}
                style={{ backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', padding: '2px 8px', fontSize: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                [PAUSE]
              </button>
            </div>
          )}

          {/* Loading Overlay */}
          {loading && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 }}>
              <div className="brutalist-border" style={{ padding: '20px 30px', textAlign: 'center', backgroundColor: '#FFFFFF' }}>
                <h2 style={{ margin: 0, fontSize: '12px', letterSpacing: '0.5px' }}>[SYNCHRONISIERE BEWEISNETZWERK...]</h2>
                <p style={{ margin: '6px 0 0 0', fontSize: '10px', color: '#64748B' }}>Traversiere Neo4j Graph-Datenbank...</p>
              </div>
            </div>
          )}

          {/* Error Overlay */}
          {error && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 }}>
              <div className="brutalist-border" style={{ padding: '20px 30px', backgroundColor: '#FEF2F2', borderColor: '#DC2626' }}>
                <h2 style={{ margin: 0, fontSize: '12px', color: '#DC2626' }}>[VERBINDUNGSFEHLER]</h2>
                <p style={{ margin: '6px 0 0 0', fontSize: '10px', color: '#991B1B' }}>{error}</p>
              </div>
            </div>
          )}

          {/* Floating Legende (Unten Links im Canvas) */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, padding: '8px 12px', backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '2px solid #000000', boxShadow: '3px 3px 0px #000000', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', zIndex: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#000000', display: 'inline-block' }}></span>
              DEPOT
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#B45309', display: 'inline-block' }}></span>
              TÄTER
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#475569', display: 'inline-block' }}></span>
              SUBJEKT
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#CA8A04', display: 'inline-block' }}></span>
              DISSONANZ
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#7C3AED', display: 'inline-block' }}></span>
              LÜCKE (OHNE AKTEUR)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
              GHOST (VERSCHOLLEN)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '14px', height: '2px', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
              RAUB
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '14px', height: '2px', backgroundColor: '#2563EB', display: 'inline-block' }}></span>
              SCHENKUNG
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ width: '14px', height: '2px', borderTop: '2px dashed #0891B2', display: 'inline-block' }}></span>
              VERDACHT (PROBABILISTISCH)
            </div>
          </div>
        </main>

        {/* COLUMN 3: RIGHT INSPECTOR (KNOTEN- ODER KANTEN-AKTE) */}
        {(selectedNodeDetails || selectedLink) && (
          <aside
            style={{
              width: '440px',
              height: '100%',
              borderLeft: '3px solid #000000',
              backgroundColor: '#FFFFFF',
              overflowY: 'auto',
              flexShrink: 0,
              padding: '20px',
              boxSizing: 'border-box',
              zIndex: 30
            }}
          >
            {/* Case A: KNOTEN INSPEKTOR */}
            {selectedNodeDetails && !selectedLink && (
              <div>
                {/* Header & Close */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000000', paddingBottom: '12px', marginBottom: '16px' }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        backgroundColor: gapIds.has(selectedNodeDetails.id)
                          ? '#7C3AED'
                          : (selectedNodeDetails.isContested 
                              ? '#CA8A04' 
                              : (selectedNodeDetails.isGhost ? '#DC2626' : (selectedNodeDetails.type === 'Institution' ? '#000000' : '#B45309'))),
                        color: '#FFFFFF',
                        padding: '2px 8px',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        letterSpacing: '0.5px',
                        marginBottom: '4px'
                      }}
                    >
                      {gapIds.has(selectedNodeDetails.id)
                        ? '[STATUS: PROVENIENZLÜCKE]'
                        : (selectedNodeDetails.isContested 
                            ? '[STATUS: SEMANTISCHE DISSONANZ]' 
                            : (selectedNodeDetails.isGhost ? '[STATUS: VERSCHOLLEN / KEIN DEPOT]' : `[ENTITAET: ${selectedNodeDetails.type.toUpperCase()}]`))}
                    </span>
                    <h2 style={{ margin: '4px 0 0 0', fontSize: '15px', fontWeight: 900, wordBreak: 'break-word', color: '#000000' }}>
                      {selectedNodeDetails.label}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
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

                {/* Description & Metadata */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '9px', color: '#64748B', fontWeight: 'bold' }}>BESCHREIBUNG / HISTORISCHE FUNKTION:</div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', marginTop: '2px', color: '#000000' }}>
                    {selectedNodeDetails.desc || "Keine Zusatzbeschreibung erfasst"}
                  </div>
                </div>

                {/* AUTONOMER PROVENIENZ-VERDACHT CARD */}
                {suspicionMap[selectedNodeDetails.id] && (
                  <div style={{ marginBottom: '16px', border: '2px solid #0891B2', padding: '12px', backgroundColor: '#F0FDFA' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 900, color: '#0E7490', letterSpacing: '0.5px' }}>
                        [AUTONOMER PROVENIENZ-VERDACHT]
                      </span>
                      <span style={{ backgroundColor: '#0891B2', color: '#FFFFFF', padding: '1px 6px', fontSize: '8px', fontWeight: 'bold' }}>
                        {Math.round((suspicionMap[selectedNodeDetails.id].confidence || 0.9) * 100)}% KONFIDENZ
                      </span>
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '4px', lineHeight: 1.4 }}>
                      <b>Verdächtiger Kolonialoffizier:</b> <span style={{ color: '#B45309', fontWeight: 'bold' }}>{suspicionMap[selectedNodeDetails.id].akteur}</span>
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '2px' }}>
                      <b>Militärisches Register:</b> {suspicionMap[selectedNodeDetails.id].expedition} ({suspicionMap[selectedNodeDetails.id].zeit || 'Kolonialzeit'})
                    </div>
                    <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '2px', lineHeight: 1.3 }}>
                      <b>Forensische Begründung:</b> {suspicionMap[selectedNodeDetails.id].begruendung}
                    </div>
                    <div style={{ fontSize: '8px', color: '#334155', marginTop: '6px', fontStyle: 'italic', backgroundColor: '#CCFBF1', padding: '5px 7px', borderLeft: '3px solid #0891B2' }}>
                      <b>Primärbeleg:</b> {suspicionMap[selectedNodeDetails.id].beleg}
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
                      [BEFUND: PROVENIENZLÜCKE (CHAIN OF CUSTODY GERISSEN)]
                    </div>
                    <div style={{ fontSize: '9px', color: '#4C1D95', marginTop: '4px', lineHeight: 1.4 }}>
                      Dieses Subjekt lagert im Depot, besitzt jedoch in den öffentlichen Museumsdaten keinerlei dokumentierten Erwerbsakt, Schenkungsvertrag oder Raubbericht.
                    </div>
                    <button
                      onClick={() => {
                        const depotLink = selectedNodeDetails.links.find((l: any) => l.type === 'LAGERT_IN');
                        const depotName = depotLink ? (depotLink.target.label || depotLink.target.id || depotLink.target) : 'Museumsdepot';
                        handleCopyIFG(selectedNodeDetails.id, depotName);
                      }}
                      style={{
                        width: '100%',
                        marginTop: '10px',
                        padding: '8px 12px',
                        backgroundColor: '#7C3AED',
                        color: '#FFFFFF',
                        border: '2px solid #000000',
                        boxShadow: '2px 2px 0px #000000',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      {copySuccess ? '[ANTRAGSTEXT IN ZWISCHENABLAGE KOPIERT!]' : '[IFG-AUSKUNFTSERSUCHEN KOPIEREN (ZUGANGSBÜCHER)]'}
                    </button>
                  </div>
                )}

                {/* DISSONANZ-PANEL: Gegenüberstellung der Kanten */}
                {selectedNodeDetails.isContested && selectedNodeDetails.contestedInfo && (
                  <div style={{ marginBottom: '18px', border: '2px solid #000000', padding: '12px', backgroundColor: '#FEFCE8' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#854D0E', marginBottom: '10px', letterSpacing: '0.5px' }}>
                      [BEWEIS-DISSONANZ: MULTIGRAPH-KOLLISION]
                    </div>

                    <div style={{ borderLeft: '4px solid #2563EB', paddingLeft: '8px', marginBottom: '10px', backgroundColor: '#EFF6FF', padding: '8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#1D4ED8' }}>
                        [1] OFFIZIELLES MUSEUMS-NARRATIV (SCHUTZBEHAUPTUNG)
                      </div>
                      {selectedNodeDetails.contestedInfo.museum_narratives.slice(0, 2).map((m: any, idx: number) => (
                        <div key={idx} style={{ marginTop: '4px', fontSize: '9px' }}>
                          <div><b>Kante:</b> <span style={{ color: '#1D4ED8' }}>{m.rel}</span> ({m.jahr || 'Kolonialzeit'}) durch <b>{m.akteur}</b></div>
                          <div style={{ fontSize: '8px', color: '#475569', fontStyle: 'italic', marginTop: '2px' }}>
                            <b>Beleg:</b> {m.beleg}
                          </div>
                          <div style={{ fontSize: '8px', color: '#0f172a', marginTop: '3px', backgroundColor: '#DBEAFE', padding: '3px 5px' }}>
                            &ldquo;{m.claim}&rdquo;
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ borderLeft: '4px solid #DC2626', paddingLeft: '8px', backgroundColor: '#FEF2F2', padding: '8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#991B1B' }}>
                        [2] FORENSISCHE REALITÄT (MILITÄRISCHER RAUBZUG)
                      </div>
                      {selectedNodeDetails.contestedInfo.forensic_realities.slice(0, 2).map((f: any, idx: number) => (
                        <div key={idx} style={{ marginTop: '4px', fontSize: '9px' }}>
                          <div><b>Kante:</b> <span style={{ color: '#DC2626' }}>{f.rel}</span> ({f.jahr || 'Kolonialzeit'}) durch <b>{f.akteur}</b></div>
                          <div style={{ fontSize: '8px', color: '#475569', fontStyle: 'italic', marginTop: '2px' }}>
                            <b>Beleg:</b> {f.beleg}
                          </div>
                          <div style={{ fontSize: '8px', color: '#7f1d1d', marginTop: '3px', backgroundColor: '#FEE2E2', padding: '3px 5px', fontWeight: 'bold' }}>
                            Befund: {f.claim}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verbundene Kanten Liste */}
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '9px', color: '#64748B', fontWeight: 'bold', marginBottom: '8px' }}>
                    VERIFIZIERTE BEWEISPFADE IM GRAPHEN ({selectedNodeDetails.links.length}):
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
                          title="Klicken zum Öffnen der Kanten-Akte"
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>
                            <span style={{ fontWeight: 'bold', color: borderCol }}>
                              {isOutgoing ? '-> ' : '<- '} {lnk.type}
                            </span>
                            {lnk.jahr && <span style={{ color: '#64748B' }}>{lnk.jahr}</span>}
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 'bold', marginTop: '2px', color: '#000000' }}>
                            {otherParty}
                          </div>
                          {lnk.beleg && (
                            <div style={{ fontSize: '8px', color: '#475569', marginTop: '2px', fontStyle: 'italic' }}>
                              Beleg: {lnk.beleg}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {selectedNodeDetails.links.length > 6 && (
                      <div style={{ fontSize: '8px', color: '#64748B', textAlign: 'center', marginTop: '2px' }}>
                        + {selectedNodeDetails.links.length - 6} weitere verifizierte Kanten
                      </div>
                    )}
                  </div>
                </div>

                {/* Subjekt Actions: Single Dossier */}
                {(selectedNodeDetails.type === 'Subjekt' || selectedNodeDetails.type === 'Objekt') && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px' }}>
                    <button
                      onClick={() => handlePrintDossier(selectedNodeDetails.id)}
                      disabled={isGeneratingDossier}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        backgroundColor: '#000000',
                        color: '#FFFFFF',
                        border: 'none',
                        boxShadow: selectedNodeDetails.isContested ? '3px 3px 0px #CA8A04' : '3px 3px 0px #DC2626',
                        fontWeight: 'bold',
                        fontSize: '10px',
                        cursor: isGeneratingDossier ? 'wait' : 'pointer',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {isGeneratingDossier ? '[GENERIERE AMTLICHES PDF...]' : '[AMTLICHES RESTITUTIONSDOSSIER DRUCKEN (PDF)]'}
                    </button>
                    
                    {dossierStatus && (
                      <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: 'bold', marginTop: '6px', textAlign: 'center' }}>
                        {dossierStatus}
                      </div>
                    )}

                    <p style={{ fontSize: '8px', color: '#64748B', marginTop: '6px', lineHeight: 1.3, textAlign: 'center' }}>
                      Generiert ein 2-seitiges Gutachten inkl. SHA-256-Hash, Primärbeleg und HLKO/Washingtoner Prinzipien-Prüfung.
                    </p>
                  </div>
                )}

                {/* Akteur Actions & Batch Dossier ZIP */}
                {selectedNodeDetails.type === 'Akteur' && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#B45309', marginBottom: '2px' }}>
                      [FORENSISCHES TÄTER- & BEUTEREGISTER]
                    </div>
                    {focusedSummary && (focusedSummary.name === selectedNodeDetails.label || focusedSummary.name === selectedNodeDetails.id) && (
                      <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #B45309', padding: '8px', fontSize: '9px', lineHeight: 1.4, marginBottom: '4px' }}>
                        <div><b>Dokumentierte Raubzüge:</b> <span style={{ color: '#DC2626', fontWeight: 'bold' }}>{focusedSummary.raub_count} Subjekte</span></div>
                        <div><b>Offizielle "Schenkungen":</b> <span style={{ color: '#2563EB', fontWeight: 'bold' }}>{focusedSummary.schenk_count} Fälle</span></div>
                        {focusedSummary.depots && focusedSummary.depots.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>Ziel-Depots:</b> {focusedSummary.depots.join(', ')}</div>
                        )}
                        {focusedSummary.expeditionen && focusedSummary.expeditionen.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>Expeditionen:</b> {focusedSummary.expeditionen.join(', ')}</div>
                        )}
                      </div>
                    )}

                    {/* Batch Dossier ZIP Export Button */}
                    <button
                      onClick={() => handleBatchDossier('actor', selectedNodeDetails.label)}
                      disabled={isGeneratingBatch}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: '#B45309',
                        color: '#FFFFFF',
                        border: '2px solid #000000',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: isGeneratingBatch ? 'wait' : 'pointer',
                        boxShadow: '3px 3px 0px #000000',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {isGeneratingBatch ? '[BÜNDLE DOSSIER-ARCHIV...]' : `[ALLE ${focusedSummary?.raub_count || selectedNodeDetails.links?.filter((l: any) => l.type === 'RAUBTE').length || ''} RAUB-DOSSIERS EXPORTIEREN (ZIP)]`}
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
                      {focusedEntity?.name === selectedNodeDetails.label ? '[TÄTER-ISOLATION AKTIV (FOKUS AUFHEBEN)]' : `[NUR ${selectedNodeDetails.label.toUpperCase()} ISOLIEREN]`}
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
                      {exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label ? '[EXKLUSIV-CYPHER BEENDEN (VOLLANSICHT)]' : `[EXKLUSIV CYPHER LADEN: NUR ${selectedNodeDetails.label.toUpperCase()}]`}
                    </button>
                  </div>
                )}

                {/* Institution Actions & Batch Dossier ZIP */}
                {selectedNodeDetails.type === 'Institution' && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 900, color: '#000000', marginBottom: '2px' }}>
                      [MUSEUMS-DEPOT BESTANDSAKTE]
                    </div>
                    {focusedSummary && (focusedSummary.name === selectedNodeDetails.label || focusedSummary.name === selectedNodeDetails.id) && (
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #000000', padding: '8px', fontSize: '9px', lineHeight: 1.4, marginBottom: '4px' }}>
                        <div><b>Standort:</b> {selectedNodeDetails.desc || 'Deutschland'}</div>
                        <div><b>Erfasste Subjekte:</b> <span style={{ fontWeight: 'bold' }}>{focusedSummary.total_subjekte}</span></div>
                        <div><b>Dissonanzen (Whitewashed):</b> <span style={{ color: '#CA8A04', fontWeight: 'bold' }}>{focusedSummary.contested_subjekte} ({Math.round((focusedSummary.contested_subjekte / (focusedSummary.total_subjekte || 1)) * 100)}%)</span></div>
                        {focusedSummary.top_akteure && focusedSummary.top_akteure.length > 0 && (
                          <div style={{ marginTop: '2px' }}><b>Hauptzulieferer:</b> {focusedSummary.top_akteure.join(', ')}</div>
                        )}
                      </div>
                    )}

                    {/* Batch Dossier ZIP Export Button for Depot */}
                    <button
                      onClick={() => handleBatchDossier('institution', selectedNodeDetails.label)}
                      disabled={isGeneratingBatch}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: '#000000',
                        color: '#FFFFFF',
                        border: '2px solid #000000',
                        fontWeight: 'bold',
                        fontSize: '9px',
                        cursor: isGeneratingBatch ? 'wait' : 'pointer',
                        boxShadow: '3px 3px 0px #2563EB',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {isGeneratingBatch ? '[BÜNDLE DEPOT-ARCHIV...]' : `[ALLE DOSSIERS DIESES DEPOTS EXPORTIEREN (ZIP)]`}
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
                      {focusedEntity?.name === selectedNodeDetails.label ? '[DEPOT-ISOLATION AKTIV (FOKUS AUFHEBEN)]' : `[NUR ${selectedNodeDetails.label.toUpperCase()} ISOLIEREN]`}
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
                      {exclusiveCypherMode && focusedEntity?.name === selectedNodeDetails.label ? '[EXKLUSIV-CYPHER BEENDEN (VOLLANSICHT)]' : `[EXKLUSIV CYPHER LADEN: NUR ${selectedNodeDetails.label.toUpperCase()}]`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Case B: KANTEN INSPEKTOR */}
            {selectedLink && (
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
                      {selectedLink.type === 'VERDACHT_AUF' ? '[FORENSISCHER VERDACHT: EXPEDITIONS-MATCH]' : `[EREIGNIS-AKTE: ${selectedLink.type}]`}
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
                          [PROBABILISTISCHE PROVENIENZ-ZUWEISUNG]
                        </span>
                        <span style={{ backgroundColor: '#0891B2', color: '#FFFFFF', padding: '1px 6px', fontSize: '8px', fontWeight: 'bold' }}>
                          {Math.round((selectedLink.confidence || 0.9) * 100)}% KONFIDENZ
                        </span>
                      </div>
                      {selectedLink.begruendung && (
                        <div style={{ fontSize: '9px', color: '#0F172A', marginTop: '6px', lineHeight: 1.3 }}>
                          <b>Heuristische Begründung:</b> {selectedLink.begruendung}
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
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>URHEBER / VERANTWORTLICHER AKTEUR:</div>
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
                    <div style={{ fontSize: '8px', color: '#64748B', fontWeight: 'bold' }}>BETROFFENES SUBJEKT / KULTURGUT:</div>
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
                    <div style={{ fontSize: '8px', color: '#1E40AF', fontWeight: 'bold' }}>HISTORISCHER PRIMÄRBELEG / QUELLE:</div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000', marginTop: '2px' }}>
                      {selectedLink.beleg || "Keine Quellenangabe verzeichnet"}
                    </div>
                    {selectedLink.jahr && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '3px' }}>
                        <b>Ereignisjahr:</b> {selectedLink.jahr}
                      </div>
                    )}
                    {selectedLink.expedition && (
                      <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>
                        <b>Expedition / Register:</b> {selectedLink.expedition}
                      </div>
                    )}
                  </div>

                  {selectedLink.behauptung && (
                    <div style={{ border: '1px solid #000000', padding: '8px', backgroundColor: '#FEFCE8', borderLeft: '4px solid #CA8A04' }}>
                      <div style={{ fontSize: '8px', color: '#854D0E', fontWeight: 'bold' }}>NARRATIV-EINSTUFUNG:</div>
                      <div style={{ fontSize: '9px', color: '#000000', marginTop: '2px', fontStyle: 'italic' }}>
                        &ldquo;{selectedLink.behauptung}&rdquo;
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Button: Dossier fuer verknuepftes Subjekt */}
                {(selectedLink.target_inv || selectedLink.source_inv) && (
                  <div style={{ borderTop: '2px solid #000000', paddingTop: '14px' }}>
                    <button
                      onClick={() => handlePrintDossier(selectedLink.target_inv || selectedLink.source_inv)}
                      disabled={isGeneratingDossier}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        backgroundColor: '#000000',
                        color: '#FFFFFF',
                        border: 'none',
                        boxShadow: '3px 3px 0px #DC2626',
                        fontWeight: 'bold',
                        fontSize: '10px',
                        cursor: isGeneratingDossier ? 'wait' : 'pointer',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {isGeneratingDossier ? '[GENERIERE AMTLICHES PDF...]' : `[AMTLICHES DOSSIER FUER ${selectedLink.target_inv || selectedLink.source_inv} DRUCKEN]`}
                    </button>
                    
                    {dossierStatus && (
                      <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: 'bold', marginTop: '6px', textAlign: 'center' }}>
                        {dossierStatus}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

      </div>
    </div>
  );
}
