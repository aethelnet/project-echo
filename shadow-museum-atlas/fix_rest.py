with open('src/App.tsx', 'r') as f:
    code = f.read()

# Fix Museum Search
code = code.replace(
"""        <button 
           onClick={() => setShowMuseumSearch(!showMuseumSearch)}
           <span>{showMuseumSearch ? 'SUCHE SCHLIESSEN' : 'MUSEUMS-DATENBANK'}</span>
           <span>🏛️</span>""",
"""        <button 
           onClick={() => setShowMuseumSearch(!showMuseumSearch)} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: '#FFF', border: '2px solid #000', cursor: 'pointer', fontWeight: 'bold' }}>
           <span>{showMuseumSearch ? 'SUCHE SCHLIESSEN' : 'MUSEUMS-DATENBANK'}</span>
           <span>🏛️</span>
        </button>"""
)

# Fix File Browser
code = code.replace(
"""           onClick={() => setShowFileBrowser(!showFileBrowser)}
           <span>{showFileBrowser ? 'DOKUMENTE SCHLIESSEN' : 'QUELLEN / DOKUMENTE'}</span>
           <span>📁</span>""",
"""        <button 
           onClick={() => setShowFileBrowser(!showFileBrowser)} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: '#FFF', border: '2px solid #000', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px' }}>
           <span>{showFileBrowser ? 'DOKUMENTE SCHLIESSEN' : 'QUELLEN / DOKUMENTE'}</span>
           <span>📁</span>
        </button>"""
)

# Fix Zero Shot Tag
code = code.replace(
"""                />
                  onClick={handleZeroShotTag}
                  style={{ backgroundColor: '#DC2626', color: '#FFF', border: '2px solid #000', padding: '0 10px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {isTagging ? '...' : 'SUCHEN'}
            </div>""",
"""                />
                <button 
                  onClick={handleZeroShotTag}
                  style={{ backgroundColor: '#DC2626', color: '#FFF', border: '2px solid #000', padding: '0 10px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {isTagging ? '...' : 'SUCHEN'}
                </button>
            </div>"""
)

# Fix Add Node
code = code.replace(
"""        <button 
           onClick={() => setIsAddingNode(true)}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
           + NEUEN AKTEUR
        </button>
        
        
        <button 
           onClick={() => setShowSuggestions(!showSuggestions)}""",
"""        <button 
           onClick={() => setIsAddingNode(true)}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
           + NEUEN AKTEUR
        </button>
        
        <button 
           onClick={() => setShowSuggestions(!showSuggestions)}"""
)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Applied fixes")
