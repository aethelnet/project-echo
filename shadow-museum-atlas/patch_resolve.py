import re

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/server.js', 'r') as f:
    server = f.read()

resolve_route = """app.post('/api/nodes/:id/resolve', async (req, res) => {
    const { action } = req.body; // 'approve' or 'reject'
    const ws = req.query.workspace || 'Shadow_Museum_Atlas';
    try {
        if (action === 'approve') {
            await pool.query("UPDATE nodes SET status = 'verified' WHERE id = $1 AND workspace = $2", [req.params.id, ws]);
            await pool.query("UPDATE edges SET status = 'verified' WHERE (source = $1 OR target = $1) AND workspace = $2", [req.params.id, ws]);
        } else if (action === 'reject') {
            await pool.query("DELETE FROM edges WHERE (source = $1 OR target = $1) AND workspace = $2", [req.params.id, ws]);
            await pool.query("DELETE FROM nodes WHERE id = $1 AND workspace = $2", [req.params.id, ws]);
        }
        res.json({ success: true, action });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});"""

if "/api/nodes/:id/resolve" not in server:
    server = server.replace(
        "app.post('/api/nodes/:id/tags', async (req, res) => {",
        resolve_route + "\n\napp.post('/api/nodes/:id/tags', async (req, res) => {"
    )
    
with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/server.js', 'w') as f:
    f.write(server)

print("Resolve route added to server.js")
