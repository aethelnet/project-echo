import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

# 1. State for suggestions
state_injection = """
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  useEffect(() => {
      fetch(`/api/merge-suggestions?workspace=${currentWorkspace}`)
          .then(r => r.json())
          .then(res => {
              if (res.success) setSuggestions(res.suggestions);
          });
  }, [currentWorkspace]);

  const resolveSuggestion = (id: string, action: 'approve' | 'reject') => {
      fetch(`/api/merge-suggestions/${id}/resolve?workspace=${currentWorkspace}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
      }).then(r => r.json()).then(res => {
          if (res.success) {
              setSuggestions(prev => prev.filter(s => s.id !== id));
          }
      });
  };
"""
if "const [suggestions" not in code:
    code = code.replace("const [isCleaning, setIsCleaning] = useState(false);", "const [isCleaning, setIsCleaning] = useState(false);\n" + state_injection)

# 2. Button to open suggestions (with badge if > 0)
btn_injection = """
        <button 
           onClick={() => setShowSuggestions(!showSuggestions)}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: suggestions.length > 0 ? '#F59E0B' : '#FFF', color: suggestions.length > 0 ? '#FFF' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', position: 'relative' }}>
           🧠 KI-VORSCHLÄGE {suggestions.length > 0 && `(${suggestions.length})`}
        </button>
"""
if "KI-VORSCHLÄGE" not in code:
    code = code.replace("<button \n           onClick={handleCleanup}", btn_injection + "\n        <button \n           onClick={handleCleanup}")

# 3. Suggestions Modal
modal_injection = """
      {/* SUGGESTIONS MODAL */}
      {showSuggestions && (
        <div style={{ position: 'absolute', top: '150px', right: '320px', width: '350px', maxHeight: '500px', overflowY: 'auto', backgroundColor: '#FFF', border: '3px solid #000', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderBottom: '2px solid #000', backgroundColor: '#000', color: '#FFF' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontFamily: '"Space Mono", monospace' }}>KI MERGE-WARTESCHLANGE</h3>
            <button onClick={() => setShowSuggestions(false)} style={{ backgroundColor: '#DC2626', color: '#FFF', border: 'none', cursor: 'pointer', padding: '5px 15px', fontWeight: '900', fontSize: '16px' }}>X</button>
          </div>
          <div style={{ padding: '15px', fontFamily: '"Space Mono", monospace' }}>
            {suggestions.length === 0 ? (
                <p>Keine neuen Vorschläge.</p>
            ) : (
                suggestions.map(s => (
                    <div key={s.id} style={{ border: '2px solid #000', marginBottom: '10px', padding: '10px' }}>
                        <p style={{ margin: '0 0 5px 0', fontSize: '12px' }}><strong>KI-Confidence: {s.confidence}%</strong></p>
                        <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#666' }}>Verschmelze:<br/>"{s.duplicate_label}" <br/>➔ "{s.primary_label}"</p>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button onClick={() => resolveSuggestion(s.id, 'approve')} style={{ flex: 1, backgroundColor: '#10B981', color: '#FFF', border: '2px solid #000', padding: '5px', cursor: 'pointer', fontWeight: 'bold' }}>VERIFY</button>
                            <button onClick={() => resolveSuggestion(s.id, 'reject')} style={{ flex: 1, backgroundColor: '#DC2626', color: '#FFF', border: '2px solid #000', padding: '5px', cursor: 'pointer', fontWeight: 'bold' }}>REJECT</button>
                        </div>
                    </div>
                ))
            )}
          </div>
        </div>
      )}
"""
if "KI MERGE-WARTESCHLANGE" not in code:
    code = code.replace("{/* MODALS & OVERLAYS */}", "{/* MODALS & OVERLAYS */}\n" + modal_injection)

with open('src/App.tsx', 'w') as f:
    f.write(code)
