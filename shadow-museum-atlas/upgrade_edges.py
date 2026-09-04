import re

# --- BACKEND UPGRADE ---
with open('server.js', 'r') as f:
    server = f.read()

# Add edge type to DB init
old_init = """            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
            """
new_init = """            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
            ALTER TABLE edges ADD COLUMN IF NOT EXISTS type TEXT;
            """
server = server.replace(old_init, new_init)

# Add edge type to POST /api/edges
old_post = """app.post('/api/edges', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const { id, source, target, year, page, quote, status } = req.body;
        await pool.query(
            'INSERT INTO edges (id, workspace, source, target, year, page, quote, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [id, ws, source, target, year, page, quote, status]
        );"""
new_post = """app.post('/api/edges', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const { id, source, target, year, page, quote, status, type } = req.body;
        await pool.query(
            'INSERT INTO edges (id, workspace, source, target, year, page, quote, status, type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [id, ws, source, target, year, page, quote, status, type || 'relation']
        );"""
server = server.replace(old_post, new_post)

with open('server.js', 'w') as f:
    f.write(server)


# --- FRONTEND UPGRADE ---
with open('src/App.tsx', 'r') as f:
    app = f.read()

# Add state
app = app.replace(
    'const [newEdgeQuote, setNewEdgeQuote] = useState("");',
    'const [newEdgeQuote, setNewEdgeQuote] = useState("");\n  const [newEdgeType, setNewEdgeType] = useState("influenced_by");'
)

# Update handleCreateEdge
old_handle = """    const newEdge = {
        id,
        source: edgeSourceNode.id,
        target: edgeTargetNode.id,
        year: parseInt(newEdgeYear) || 1900,
        page: newEdgePage,
        quote: newEdgeQuote,
        status: 'user-added'
    };"""
new_handle = """    const newEdge = {
        id,
        source: edgeSourceNode.id,
        target: edgeTargetNode.id,
        year: parseInt(newEdgeYear) || 1900,
        page: newEdgePage,
        quote: newEdgeQuote,
        status: 'user-added',
        type: newEdgeType
    };"""
app = app.replace(old_handle, new_handle)

# Update UI
old_modal = """           <div style={{ display: 'flex', gap: '10px' }}>
           </div>
        </div>
      )}"""
new_modal = """           <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px', marginTop: '10px' }}>RELATIONSTYP (TAG):</label>
           <select 
             value={newEdgeType} 
             onChange={(e) => setNewEdgeType(e.target.value)}
             style={{ width: '100%', padding: '5px', marginBottom: '15px', border: '2px solid #000' }}
           >
               <option value="influenced_by">influenced_by (Inspiriert von)</option>
               <option value="stolen_from">stolen_from (Geraubt / Konfisziert)</option>
               <option value="sold_to">sold_to (Verkauft an)</option>
               <option value="documented_in">documented_in (Belegt in)</option>
               <option value="contradicts">contradicts (Widerspricht)</option>
           </select>

           <div style={{ display: 'flex', gap: '10px' }}>
             <button onClick={handleCreateEdge} style={{ flex: 1, padding: '10px', backgroundColor: '#10B981', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>SPEICHERN</button>
             <button onClick={() => setShowEdgeModal(false)} style={{ flex: 1, padding: '10px', backgroundColor: '#DC2626', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>ABBRECHEN</button>
           </div>
        </div>
      )}"""
app = app.replace(old_modal, new_modal)

with open('src/App.tsx', 'w') as f:
    f.write(app)

print("Upgraded!")
