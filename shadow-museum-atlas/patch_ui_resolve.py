with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/src/App.tsx', 'r') as f:
    app = f.read()

resolve_ui = """            {/* KI-SUGGESTED VALIDATION */}
            {selectedNode.status === 'ki-suggested' && (
                <div style={{ margin: '15px 0', padding: '15px', backgroundColor: '#FEF3C7', border: '2px dashed #D97706' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#D97706', fontSize: '14px' }}>👻 KI-GEISTERKNOTEN</h4>
                    <p style={{ fontSize: '11px', margin: '0 0 10px 0', color: '#92400E' }}>
                        Dieser Knoten wurde vom Auto-Crawler halluziniert. Bitte historisch überprüfen.
                    </p>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button 
                            onClick={() => {
                                fetch(`/api/nodes/${encodeURIComponent(selectedNode.id)}/resolve?workspace=${currentWorkspace}`, {
                                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'approve' })
                                }).then(() => {
                                    alert("✅ Knoten verifiziert!");
                                    selectedNode.status = 'verified';
                                    setSelectedNode({...selectedNode});
                                    // Trigger graph reload
                                    fetch(`/api/graph?workspace=${currentWorkspace}`).then(r => r.json()).then(j => { if(j.success) setData({nodes: j.nodes, links: j.links}); });
                                });
                            }}
                            style={{ flex: 1, padding: '8px', backgroundColor: '#10B981', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                            ✅ VERIFIZIEREN
                        </button>
                        <button 
                            onClick={() => {
                                fetch(`/api/nodes/${encodeURIComponent(selectedNode.id)}/resolve?workspace=${currentWorkspace}`, {
                                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'reject' })
                                }).then(() => {
                                    alert("🗑️ Knoten verworfen.");
                                    setSelectedNode(null);
                                    fetch(`/api/graph?workspace=${currentWorkspace}`).then(r => r.json()).then(j => { if(j.success) setData({nodes: j.nodes, links: j.links}); });
                                });
                            }}
                            style={{ flex: 1, padding: '8px', backgroundColor: '#EF4444', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                            ❌ VERWERFEN
                        </button>
                    </div>
                </div>
            )}"""

if "{/* KI-SUGGESTED VALIDATION */}" not in app:
    app = app.replace(
        "{/* Show all associated quotes for traceability */}",
        resolve_ui + "\n\n            {/* Show all associated quotes for traceability */}"
    )

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/src/App.tsx', 'w') as f:
    f.write(app)

print("UI Validation injected!")
