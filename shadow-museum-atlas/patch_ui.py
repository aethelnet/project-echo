with open('src/App.tsx', 'r') as f:
    code = f.read()

# 1. Add state and handleCleanup
state_injection = """
  const [isCleaning, setIsCleaning] = useState(false);
  
  const handleCleanup = () => {
      setIsCleaning(true);
      fetch(`/api/cleanup?workspace=${currentWorkspace}`, { method: 'POST' })
          .then(r => r.json())
          .then(res => {
              setIsCleaning(false);
              if(res.success) alert("Waschanlage beendet! Der Graph wurde bereinigt.");
          })
          .catch(e => {
              setIsCleaning(false);
              alert("Fehler bei der Bereinigung!");
          });
  };
"""
if "const handleCleanup" not in code:
    code = code.replace("const [isExporting, setIsExporting] = useState(false);", "const [isExporting, setIsExporting] = useState(false);\n" + state_injection)

# 2. Add full-reload socket handler
reload_injection = """
              if (event.action === 'full-reload') {
                  fetch(`/api/graph?workspace=${currentWorkspace}`)
                      .then(res => res.json())
                      .then(json => {
                          setMasterGraphData({ nodes: json.nodes || [], edges: json.links || [] });
                      });
                  return prev;
              }
"""
if "event.action === 'full-reload'" not in code:
    code = code.replace("if (event.action === 'add-node') {", reload_injection + "\n              if (event.action === 'add-node') {")

# 3. Add Button
btn_injection = """
        <button 
           onClick={handleCleanup}
           disabled={isCleaning}
           style={{ width: '100%', marginTop: '10px', padding: '10px', backgroundColor: isCleaning ? '#9CA3AF' : '#10B981', color: '#FFF', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>
           {isCleaning ? '⏳ WASCHANLAGE LÄUFT...' : '🧹 GRAPH BEREINIGEN (KI)'}
        </button>
"""
if "GRAPH BEREINIGEN" not in code:
    code = code.replace("<button \n           onClick={handleExportGraph}", btn_injection + "\n        <button \n           onClick={handleExportGraph}")

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("UI patched!")
