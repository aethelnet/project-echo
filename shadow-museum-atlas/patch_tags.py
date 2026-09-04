import re

# --- Patch server.js ---
with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/server.js', 'r') as f:
    server = f.read()

# Add to initDB
if "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;" not in server:
    server = server.replace(
        "ALTER TABLE edges ADD COLUMN IF NOT EXISTS type TEXT;",
        "ALTER TABLE edges ADD COLUMN IF NOT EXISTS type TEXT;\n            ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;"
    )

# Add POST /api/nodes/:id/tags route
tag_route = """app.post('/api/nodes/:id/tags', async (req, res) => {
    const { tags } = req.body;
    const ws = req.query.workspace || 'Shadow_Museum_Atlas';
    try {
        await pool.query('UPDATE nodes SET tags = $1 WHERE id = $2 AND workspace = $3', [JSON.stringify(tags), req.params.id, ws]);
        res.json({ success: true, tags });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});"""

if "/api/nodes/:id/tags" not in server:
    server = server.replace(
        "app.post('/api/nodes', async (req, res) => {",
        tag_route + "\n\napp.post('/api/nodes', async (req, res) => {"
    )

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/server.js', 'w') as f:
    f.write(server)


# --- Patch App.tsx ---
with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/src/App.tsx', 'r') as f:
    app = f.read()

# 1. State for tags input
if "const [newTag, setNewTag] = useState" not in app:
    app = app.replace(
        "const [newNodeType, setNewNodeType] = useState('person');",
        "const [newNodeType, setNewNodeType] = useState('person');\n  const [newTag, setNewTag] = useState('');"
    )

# 2. Add Tagging UI in Dossier
tag_ui = """            {/* SEMANTIC TAGGING */}
            <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#F9FAFB', border: '1px solid #000' }}>
               <strong>Semantische Tags:</strong>
               <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '10px' }}>
                 {(selectedNode.tags || []).map((tag: string, i: number) => (
                    <span key={i} style={{ backgroundColor: '#10B981', color: '#000', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', border: '1px solid #000', borderRadius: '12px' }}>
                        #{tag} 
                        <span onClick={() => {
                            const updatedTags = (selectedNode.tags || []).filter((t: string) => t !== tag);
                            fetch(`/api/nodes/${encodeURIComponent(selectedNode.id)}/tags?workspace=${currentWorkspace}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tags: updatedTags }) })
                                .then(() => {
                                    selectedNode.tags = updatedTags;
                                    setSelectedNode({...selectedNode});
                                });
                        }} style={{ cursor: 'pointer', marginLeft: '5px', color: '#DC2626' }}>✖</span>
                    </span>
                 ))}
               </div>
               <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
                 <input 
                    type="text" 
                    value={newTag} 
                    onChange={e => setNewTag(e.target.value)} 
                    placeholder="Neuer Tag (z.B. Raubkunst)" 
                    onKeyDown={e => {
                        if (e.key === 'Enter' && newTag.trim()) {
                            const updatedTags = [...(selectedNode.tags || []), newTag.trim()];
                            fetch(`/api/nodes/${encodeURIComponent(selectedNode.id)}/tags?workspace=${currentWorkspace}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tags: updatedTags }) })
                                .then(() => {
                                    selectedNode.tags = updatedTags;
                                    setSelectedNode({...selectedNode});
                                    setNewTag('');
                                });
                        }
                    }}
                    style={{ flex: 1, padding: '5px', border: '1px solid #000', fontSize: '10px', fontFamily: '"Space Mono", monospace' }} 
                 />
                 <button 
                    onClick={() => {
                        if (newTag.trim()) {
                            const updatedTags = [...(selectedNode.tags || []), newTag.trim()];
                            fetch(`/api/nodes/${encodeURIComponent(selectedNode.id)}/tags?workspace=${currentWorkspace}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tags: updatedTags }) })
                                .then(() => {
                                    selectedNode.tags = updatedTags;
                                    setSelectedNode({...selectedNode});
                                    setNewTag('');
                                });
                        }
                    }}
                    style={{ backgroundColor: '#000', color: '#FFF', border: 'none', padding: '5px 10px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                 >HINZUFÜGEN</button>
               </div>
            </div>"""

if "{/* SEMANTIC TAGGING */}" not in app:
    app = app.replace(
        "{/* Show all associated quotes for traceability */}",
        tag_ui + "\n\n            {/* Show all associated quotes for traceability */}"
    )

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/src/App.tsx', 'w') as f:
    f.write(app)

print("Museum Tagging API + UI injected!")
