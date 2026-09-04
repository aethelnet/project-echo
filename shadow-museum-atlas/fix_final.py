with open('src/App.tsx', 'r') as f:
    code = f.read()

# Fix ZeroShot tag clear button
code = code.replace(
"""            {taggedEdges.size > 0 && (
            )}""",
"""            {taggedEdges.size > 0 && (
                <button onClick={() => setTaggedEdges(new Set())} style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '5px', marginTop: '5px', cursor: 'pointer', width: '100%' }}>CLEAR TAGS</button>
            )}"""
)

# Fix Voids button
code = code.replace(
"""             onClick={() => setShowVoids(!showVoids)}
             style={{ 
                 width: '100%', 
                 padding: '10px', 
                 backgroundColor: showVoids ? '#DC2626' : '#FFF', 
                 color: showVoids ? '#FFF' : '#000', 
                 border: '2px solid #000', 
                 fontWeight: 900, 
                 cursor: 'pointer', 
                 marginTop: '5px' 
             }}>
             {showVoids ? 'VOIDS AUSBLENDEN' : 'PROVENIENZ-LÜCKEN FINDEN'}""",
"""             <button onClick={() => setShowVoids(!showVoids)}
             style={{ 
                 width: '100%', 
                 padding: '10px', 
                 backgroundColor: showVoids ? '#DC2626' : '#FFF', 
                 color: showVoids ? '#FFF' : '#000', 
                 border: '2px solid #000', 
                 fontWeight: 900, 
                 cursor: 'pointer', 
                 marginTop: '5px' 
             }}>
             {showVoids ? 'VOIDS AUSBLENDEN' : 'PROVENIENZ-LÜCKEN FINDEN'}
             </button>"""
)

# Fix Bottom Right Box
code = code.replace(
"""      {/* Bottom Right Stats & Add Tools */}
      <div className="ui-overlay brutalist-border" style={{ bottom: 20, right: 20, padding: '15px', pointerEvents: 'auto', backgroundColor: '#FFF' }}>
        <p style={{ margin: 0, fontWeight: 'bold' }}>Nodes: {data?.nodes?.length || 0} | Edges: {data?.links?.length || 0}</p>
        
        </button>

           onClick={() => setIsAddingNode(true)}
           + NEUEN AKTEUR
        
        
           onClick={() => setShowSuggestions(!showSuggestions)}
           🧠 KI-VORSCHLÄGE {suggestions.length > 0 && `(${suggestions.length})`}

           onClick={handleCleanup}
           disabled={isCleaning}
           {isCleaning ? '⏳ WASCHANLAGE LÄUFT...' : '🧹 GRAPH BEREINIGEN (KI)'}

           onClick={handleExportGraph}
           GRAPH EXPORT (JSON)
      </div>""",
"""      {/* Bottom Right Stats & Add Tools */}
      <div className="ui-overlay brutalist-border" style={{ bottom: 20, right: 20, padding: '15px', pointerEvents: 'auto', backgroundColor: '#FFF' }}>
        <p style={{ margin: 0, fontWeight: 'bold' }}>Nodes: {data?.nodes?.length || 0} | Edges: {data?.links?.length || 0}</p>
        
        <button 
           onClick={() => setIsAddingNode(true)}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
           + NEUEN AKTEUR
        </button>
        
        <button 
           onClick={() => setShowSuggestions(!showSuggestions)}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: suggestions.length > 0 ? '#F59E0B' : '#FFF', color: suggestions.length > 0 ? '#FFF' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', position: 'relative' }}>
           🧠 KI-VORSCHLÄGE {suggestions.length > 0 && `(${suggestions.length})`}
        </button>

        <button 
           onClick={handleCleanup}
           disabled={isCleaning}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: '#FFF', color: '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>
           {isCleaning ? '⏳ WASCHANLAGE LÄUFT...' : '🧹 GRAPH BEREINIGEN (KI)'}
        </button>

        <button 
           onClick={handleExportGraph}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: '#2563EB', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
           GRAPH EXPORT (JSON)
        </button>
      </div>"""
)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Applied final fixes")
