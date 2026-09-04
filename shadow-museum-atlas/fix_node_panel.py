with open('src/App.tsx', 'r') as f:
    code = f.read()

fixes = [
    (
        """                       {res.image && (
                       )}""",
        """                       {res.image && (
                           <img src={res.image} alt={res.title} style={{ width: '100%', maxHeight: '200px', objectFit: 'cover' }} />
                       )}"""
    ),
    (
        """            {/* RESTITUTION PATH TRIGGER */}
                onClick={() => {
                    setRouteMode(!routeMode);
                    if (!routeMode) alert("ZIELAUSWAHL AKTIV: Bitte klicke jetzt auf den Ziel-Knoten in der Karte.");
                }}
                {routeMode ? "⌖ WÄHLE ZIEL-KNOTEN..." : "⌖ ROUTE BERECHNEN"}""",
        """            {/* RESTITUTION PATH TRIGGER */}
                <button onClick={() => {
                    setRouteMode(!routeMode);
                    if (!routeMode) alert("ZIELAUSWAHL AKTIV: Bitte klicke jetzt auf den Ziel-Knoten in der Karte.");
                }} style={{ width: '100%', padding: '10px', backgroundColor: '#000', color: '#FFF', fontWeight: 'bold', cursor: 'pointer', border: 'none', marginBottom: '5px' }}>
                {routeMode ? "⌖ WÄHLE ZIEL-KNOTEN..." : "⌖ ROUTE BERECHNEN"}
                </button>"""
    ),
    (
        """            {/* MANUELLE KANTE ZIEHEN */}
                onClick={() => {
                    setEdgeSourceNode(selectedNode);
                    setIsEdgeSelectMode(!isEdgeSelectMode);
                    if (!isEdgeSelectMode) alert("KANTEN-MODUS: Klicke jetzt auf den Ziel-Knoten in der Karte, zu dem du eine historische Verbindung ziehen willst.");
                }}
                {isEdgeSelectMode ? "⌖ ZIEL WÄHLEN..." : "+ VERBINDUNG ZIEHEN"}""",
        """            {/* MANUELLE KANTE ZIEHEN */}
                <button onClick={() => {
                    setEdgeSourceNode(selectedNode);
                    setIsEdgeSelectMode(!isEdgeSelectMode);
                    if (!isEdgeSelectMode) alert("KANTEN-MODUS: Klicke jetzt auf den Ziel-Knoten in der Karte, zu dem du eine historische Verbindung ziehen willst.");
                }} style={{ width: '100%', padding: '10px', backgroundColor: '#000', color: '#FFF', fontWeight: 'bold', cursor: 'pointer', border: 'none', marginBottom: '5px' }}>
                {isEdgeSelectMode ? "⌖ ZIEL WÄHLEN..." : "+ VERBINDUNG ZIEHEN"}
                </button>"""
    ),
    (
        """            {/* MANUELLER MERGE */}
                onClick={() => {
                    setMergeSourceNode(selectedNode);
                    setIsMergeSelectMode(!isMergeSelectMode);
                    if (!isMergeSelectMode) alert("MERGE-MODUS: Klicke jetzt auf das Duplikat im Graphen, das du in DIESEN Knoten verschmelzen willst.");
                }}
                {isMergeSelectMode ? "⌖ DUPLIKAT WÄHLEN..." : "🔗 MIT KNOTEN VERSCHMELZEN"}""",
        """            {/* MANUELLER MERGE */}
                <button onClick={() => {
                    setMergeSourceNode(selectedNode);
                    setIsMergeSelectMode(!isMergeSelectMode);
                    if (!isMergeSelectMode) alert("MERGE-MODUS: Klicke jetzt auf das Duplikat im Graphen, das du in DIESEN Knoten verschmelzen willst.");
                }} style={{ width: '100%', padding: '10px', backgroundColor: '#000', color: '#FFF', fontWeight: 'bold', cursor: 'pointer', border: 'none', marginBottom: '5px' }}>
                {isMergeSelectMode ? "⌖ DUPLIKAT WÄHLEN..." : "🔗 MIT KNOTEN VERSCHMELZEN"}
                </button>"""
    ),
    (
        """            {restitutionPath && (
                    onClick={() => setRestitutionPath(null)}
                    PFAD ZURÜCKSETZEN
            )}""",
        """            {restitutionPath && (
                <button onClick={() => setRestitutionPath(null)} style={{ width: '100%', padding: '10px', backgroundColor: '#DC2626', color: '#FFF', fontWeight: 'bold', cursor: 'pointer', border: 'none', marginTop: '5px' }}>
                    PFAD ZURÜCKSETZEN
                </button>
            )}"""
    ),
    (
        """            {/* GLOBALE KI RECON (OPENALEX) */}
                 onClick={() => {
                   fetch(`/api/recon?workspace=${currentWorkspace}&node=${encodeURIComponent(selectedNode.label)}`, { method: 'POST' })
                     .then(res => res.json())
                     .then(json => {
                         if(json.success) {
                             alert(`Globale KI-Recon abgeschlossen: ${json.newEdges} neue historische Verknüpfungen (gestrichelt) vorgeschlagen!`);
                         } else {
                             alert(`Recon Fehler: ${json.error}`);
                         }
                     });
                 }}
                 🔎 In wissenschaftlicher Literatur suchen""",
        """            {/* GLOBALE KI RECON (OPENALEX) */}
                 <button onClick={() => {
                   fetch(`/api/recon?workspace=${currentWorkspace}&node=${encodeURIComponent(selectedNode.label)}`, { method: 'POST' })
                     .then(res => res.json())
                     .then(json => {
                         if(json.success) {
                             alert(`Globale KI-Recon abgeschlossen: ${json.newEdges} neue historische Verknüpfungen (gestrichelt) vorgeschlagen!`);
                         } else {
                             alert(`Recon Fehler: ${json.error}`);
                         }
                     });
                 }} style={{ width: '100%', padding: '10px', backgroundColor: '#FFF', color: '#000', fontWeight: 'bold', cursor: 'pointer', border: '2px solid #000', marginTop: '10px' }}>
                 🔎 In wissenschaftlicher Literatur suchen
                 </button>"""
    ),
    (
        """            
                 onClick={() => {
                   setShowMuseumSearch(true);
                   setMuseumSearchTerm("LADE TENSOR...");
                   fetch(`/api/deep-resonance?workspace=${currentWorkspace}&node=${encodeURIComponent(selectedNode.id)}`)
                     .then(res => res.json())
                     .then(json => {
                         if(json.keywords && json.keywords.length > 0) {
                             setMuseumSearchTerm(json.query);
                             // Async fix: Direkter Fetch statt handleMuseumSearch()
                             setIsSearchingMuseum(true);
                             fetch(`/api/museum-search?q=${encodeURIComponent(json.query)}`)
                                 .then(r => r.json())
                                 .then(museumJson => {
                                     if(museumJson.success) setMuseumResults(museumJson.results);
                                     setIsSearchingMuseum(false);
                                 })
                                 .catch(() => setIsSearchingMuseum(false));
                         }
                     });
                 }}
            >
                🔮 Verwandte Museums-Artefakte finden""",
        """            
                 <button onClick={() => {
                   setShowMuseumSearch(true);
                   setMuseumSearchTerm("LADE TENSOR...");
                   fetch(`/api/deep-resonance?workspace=${currentWorkspace}&node=${encodeURIComponent(selectedNode.id)}`)
                     .then(res => res.json())
                     .then(json => {
                         if(json.keywords && json.keywords.length > 0) {
                             setMuseumSearchTerm(json.query);
                             // Async fix: Direkter Fetch statt handleMuseumSearch()
                             setIsSearchingMuseum(true);
                             fetch(`/api/museum-search?q=${encodeURIComponent(json.query)}`)
                                 .then(r => r.json())
                                 .then(museumJson => {
                                     if(museumJson.success) setMuseumResults(museumJson.results);
                                     setIsSearchingMuseum(false);
                                 })
                                 .catch(() => setIsSearchingMuseum(false));
                         }
                     });
                 }} style={{ width: '100%', padding: '10px', backgroundColor: '#FFF', color: '#000', fontWeight: 'bold', cursor: 'pointer', border: '2px solid #000', marginTop: '5px' }}>
                🔮 Verwandte Museums-Artefakte finden
                </button>"""
    )
]

for orig, new in fixes:
    code = code.replace(orig, new)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Applied node panel fixes")
