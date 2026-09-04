with open('src/App.tsx', 'r') as f:
    code = f.read()

fixes = [
    (
        """                       onClick={handleOpenAlexSearch}
                       disabled={isSearchingOpenAlex}
                       style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '0 10px', fontWeight: 'bold', cursor: 'pointer' }}>
                       {isSearchingOpenAlex ? '...' : 'SUCHE'}
               </div>""",
        """                       <button onClick={handleOpenAlexSearch}
                       disabled={isSearchingOpenAlex}
                       style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '0 10px', fontWeight: 'bold', cursor: 'pointer' }}>
                       {isSearchingOpenAlex ? '...' : 'SUCHE'}
                       </button>
               </div>"""
    ),
    (
        """                               {res.pdf_url ? (
                                       onClick={() => downloadOpenAlexPdf(res)}
                                       disabled={isDownloadingPdf === res.id}
                                       style={{ padding: '4px 8px', fontSize: '10px', backgroundColor: '#10B981', color: '#FFF', border: '1px solid #000', cursor: 'pointer', fontWeight: 'bold' }}>
                                       {isDownloadingPdf === res.id ? 'DOWNLOADING...' : '+ PDF IMPORTIEREN'}
                               ) : (""",
        """                               {res.pdf_url ? (
                                       <button onClick={() => downloadOpenAlexPdf(res)}
                                       disabled={isDownloadingPdf === res.id}
                                       style={{ padding: '4px 8px', fontSize: '10px', backgroundColor: '#10B981', color: '#FFF', border: '1px solid #000', cursor: 'pointer', fontWeight: 'bold' }}>
                                       {isDownloadingPdf === res.id ? 'DOWNLOADING...' : '+ PDF IMPORTIEREN'}
                                       </button>
                               ) : ("""
    ),
    (
        """                 onClick={handleVisionAnalyze} 
                 disabled={isVisionAnalyzing || !documents || documents.length === 0}
                 {isVisionAnalyzing ? "CALCULATING GRAVITY..." : "INITIATE CLIP VISION"}
           </div>""",
        """                 <button onClick={handleVisionAnalyze} 
                 disabled={isVisionAnalyzing || !documents || documents.length === 0}
                 style={{ width: '100%', padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                 {isVisionAnalyzing ? "CALCULATING GRAVITY..." : "INITIATE CLIP VISION"}
                 </button>
           </div>"""
    ),
    (
        """             
                 onClick={handleAnalyze} 
                 disabled={isAnalyzing || !documents || documents.length === 0}
                 {isAnalyzing ? "EXTRACTING KNOWLEDGE..." : "ANALYZE TEXT CORPUS"}
           </div>""",
        """             
                 <button onClick={handleAnalyze} 
                 disabled={isAnalyzing || !documents || documents.length === 0}
                 style={{ width: '100%', padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                 {isAnalyzing ? "EXTRACTING KNOWLEDGE..." : "ANALYZE TEXT CORPUS"}
                 </button>
           </div>"""
    ),
    (
        """                   onClick={handleMuseumSearch}
                   disabled={isSearchingMuseum}
                   style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '0 15px', fontWeight: 'bold', cursor: 'pointer' }}>
                   {isSearchingMuseum ? '...' : 'SUCHE'}
           </div>""",
        """                   <button onClick={handleMuseumSearch}
                   disabled={isSearchingMuseum}
                   style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '0 15px', fontWeight: 'bold', cursor: 'pointer' }}>
                   {isSearchingMuseum ? '...' : 'SUCHE'}
                   </button>
           </div>"""
    ),
    (
        """                           onClick={() => importMuseumArtifact(res)}
                           + IN ATLAS AUFNEHMEN
                   </div>""",
        """                           <button onClick={() => importMuseumArtifact(res)}
                           style={{ padding: '10px', backgroundColor: '#000', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>
                           + IN ATLAS AUFNEHMEN
                           </button>
                   </div>"""
    )
]

for orig, new in fixes:
    code = code.replace(orig, new)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Applied final fixes 2")
