import re

SERVER_FILE = "server.js"
APP_FILE = "src/App.tsx"

# 1. Patch Server
with open(SERVER_FILE, 'r') as f:
    server_code = f.read()

api_code = """
// GHOST NODE API FOR MARIANNE
app.get('/api/suggestions/ghosts', async (req, res) => {
    try {
        const { workspace } = req.query;
        if (!workspace) return res.status(400).json({ error: 'Workspace required' });
        
        const result = await pool.query(
            "SELECT id, label, type, status FROM nodes WHERE workspace = $1 AND status = 'ki-suggested' LIMIT 20",
            [workspace]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/suggestions/review', async (req, res) => {
    try {
        const { id, action } = req.body; // action: 'approve' | 'reject'
        if (action === 'approve') {
            await pool.query("UPDATE nodes SET status = 'verified' WHERE id = $1", [id]);
            await pool.query("UPDATE edges SET status = 'verified' WHERE source = $1 OR target = $1", [id]);
        } else if (action === 'reject') {
            await pool.query("DELETE FROM edges WHERE source = $1 OR target = $1", [id]);
            await pool.query("DELETE FROM nodes WHERE id = $1", [id]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
"""

if "GHOST NODE API" not in server_code:
    # Insert before app.listen
    server_code = server_code.replace("app.listen(port", api_code + "\napp.listen(port")
    with open(SERVER_FILE, 'w') as f:
        f.write(server_code)
    print("Server patched!")
else:
    print("Server already patched.")

# 2. Patch App.tsx
with open(APP_FILE, 'r') as f:
    app_code = f.read()

sidebar_component = """
function GhostNodeSidebar({ workspace }) {
    const [ghosts, setGhosts] = useState([]);
    const [loading, setLoading] = useState(false);

    const loadGhosts = () => {
        setLoading(true);
        fetch(`/api/suggestions/ghosts?workspace=${workspace}`)
            .then(r => r.json())
            .then(data => { setGhosts(data); setLoading(false); })
            .catch(() => setLoading(false));
    };

    useEffect(() => { loadGhosts(); }, [workspace]);

    const handleReview = (id, action) => {
        fetch('/api/suggestions/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, action })
        }).then(() => loadGhosts());
    };

    return (
        <div className="ui-overlay brutalist-border" style={{ position: 'absolute', top: 20, right: 20, width: '350px', backgroundColor: '#FFFFFF', padding: '20px', zIndex: 1000, maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>👻 Ghost-Node Curation</h3>
            <p style={{ fontSize: '12px', color: '#666' }}>KI-halluzinierte Knotenpunkte. Zur Überprüfung durch Historiker.</p>
            <button onClick={loadGhosts} style={{ width: '100%', marginBottom: '15px' }} className="brutalist-button">🔄 Refresh AI Queue</button>
            
            {loading ? <p>Scannning Atlas...</p> : null}
            {ghosts.length === 0 && !loading ? <p style={{ color: 'green' }}>✓ Alle Ghost-Nodes kuratiert!</p> : null}
            
            {ghosts.map(g => (
                <div key={g.id} style={{ border: '1px solid black', padding: '10px', marginBottom: '10px', backgroundColor: '#f5f5f5' }}>
                    <div style={{ fontWeight: 'bold' }}>{g.label}</div>
                    <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px' }}>Type: {g.type}</div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={() => handleReview(g.id, 'approve')} style={{ flex: 1, backgroundColor: '#cce5ff', border: '1px solid black', cursor: 'pointer' }}>✅ Approve</button>
                        <button onClick={() => handleReview(g.id, 'reject')} style={{ flex: 1, backgroundColor: '#ffcccc', border: '1px solid black', cursor: 'pointer' }}>🗑️ Reject</button>
                    </div>
                </div>
            ))}
        </div>
    );
}
"""

if "GhostNodeSidebar" not in app_code:
    # Insert component before export default function App
    app_code = app_code.replace("export default function App() {", sidebar_component + "\nexport default function App() {")
    
    # Inject it into the UI (find the main return div)
    app_code = app_code.replace("<div style={{ width: '100vw', height: '100vh', position: 'relative' }}>", 
                                "<div style={{ width: '100vw', height: '100vh', position: 'relative' }}>\n      <GhostNodeSidebar workspace={currentWorkspace} />")
    
    with open(APP_FILE, 'w') as f:
        f.write(app_code)
    print("App.tsx patched!")
else:
    print("App.tsx already patched.")

