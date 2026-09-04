import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Add pagination state variables
code = code.replace(
    'const [suggestions, setSuggestions] = useState<any[]>([]);',
    'const [suggestions, setSuggestions] = useState<any[]>([]);\n  const [suggestionPage, setSuggestionPage] = useState(0);\n  const suggestionsPerPage = 10;'
)

# Update resolveSuggestion to include username
resolve_old = """  const resolveSuggestion = (id: string, action: 'approve' | 'reject') => {
      fetch(`/api/merge-suggestions/${id}/resolve?workspace=${currentWorkspace}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
      }).then(r => r.json()).then(res => {
          if (res.success) {
              setSuggestions(prev => prev.filter(s => s.id !== id));
          }
      });
  };"""
resolve_new = """  const resolveSuggestion = (id: string, action: 'approve' | 'reject') => {
      const historian = localStorage.getItem('historian_name') || window.prompt("ZUR VERIFIZIERUNG: Bitte Historiker-Kürzel/Namen für das Audit-Log eingeben:");
      if (!historian) {
          alert("Abbruch: Ohne Audit-Log-Eintrag kann keine Änderung am Graphen vorgenommen werden.");
          return;
      }
      localStorage.setItem('historian_name', historian);
      
      fetch(`/api/merge-suggestions/${id}/resolve?workspace=${currentWorkspace}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, historian })
      }).then(r => r.json()).then(res => {
          if (res.success) {
              setSuggestions(prev => prev.filter(s => s.id !== id));
          }
      });
  };"""
code = code.replace(resolve_old, resolve_new)

# Update Suggestions UI Modal with pagination and buttons
modal_old = """          <div style={{ padding: '15px', fontFamily: '"Space Mono", monospace' }}>
            {suggestions.length === 0 ? (
                <p>Keine neuen Vorschläge.</p>
            ) : (
                suggestions.map((s: any) => (
                    <div key={s.id} style={{ border: '2px solid #000', marginBottom: '10px', padding: '10px' }}>
                        <p style={{ margin: '0 0 5px 0', fontSize: '12px' }}><strong>KI-Confidence: {s.confidence}%</strong></p>
                        <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#666' }}>Verschmelze:<br/>"{s.duplicate_label}" <br/>➔ "{s.primary_label}"</p>
                        <div style={{ display: 'flex', gap: '5px' }}>
                        </div>
                    </div>
                ))
            )}
          </div>"""
modal_new = """          <div style={{ padding: '15px', fontFamily: '"Space Mono", monospace' }}>
            {suggestions.length === 0 ? (
                <p>Keine neuen Vorschläge.</p>
            ) : (
                <>
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Sortiert nach Confidence</span>
                    <span style={{ fontSize: '12px' }}>{suggestions.length} offene Tasks</span>
                </div>
                {suggestions
                    .sort((a, b) => b.confidence - a.confidence)
                    .slice(suggestionPage * suggestionsPerPage, (suggestionPage + 1) * suggestionsPerPage)
                    .map((s: any) => (
                    <div key={s.id} style={{ border: '2px solid #000', marginBottom: '10px', padding: '10px' }}>
                        <p style={{ margin: '0 0 5px 0', fontSize: '12px' }}><strong>KI-Confidence: {s.confidence}%</strong></p>
                        <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#666' }}>Verschmelze:<br/>"{s.duplicate_label}" <br/>➔ "{s.primary_label}"</p>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button onClick={() => resolveSuggestion(s.id, 'approve')} style={{ flex: 1, backgroundColor: '#10B981', color: '#FFF', border: '1px solid #000', padding: '5px', fontWeight: 'bold', cursor: 'pointer' }}>[VERIFY]</button>
                            <button onClick={() => resolveSuggestion(s.id, 'reject')} style={{ flex: 1, backgroundColor: '#DC2626', color: '#FFF', border: '1px solid #000', padding: '5px', fontWeight: 'bold', cursor: 'pointer' }}>[REJECT]</button>
                        </div>
                    </div>
                ))}
                
                {/* Pagination Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                    <button 
                        disabled={suggestionPage === 0} 
                        onClick={() => setSuggestionPage(p => p - 1)}
                        style={{ padding: '5px 10px', backgroundColor: '#000', color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                        &lt; ZURÜCK
                    </button>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', alignSelf: 'center' }}>Seite {suggestionPage + 1}</span>
                    <button 
                        disabled={(suggestionPage + 1) * suggestionsPerPage >= suggestions.length}
                        onClick={() => setSuggestionPage(p => p + 1)}
                        style={{ padding: '5px 10px', backgroundColor: '#000', color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                        WEITER &gt;
                    </button>
                </div>
                </>
            )}
          </div>"""
code = code.replace(modal_old, modal_new)

with open('src/App.tsx', 'w') as f:
    f.write(code)

print("Pagination added!")
