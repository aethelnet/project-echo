const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const mergeEndpoint = `
app.post('/api/merge', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const { primaryId, duplicateId } = req.body;
        
        if (!primaryId || !duplicateId) {
            return res.status(400).json({ error: "Missing node IDs" });
        }
        
        // Update Edges
        await pool.query('UPDATE edges SET source = $1 WHERE source = $2 AND workspace = $3', [primaryId, duplicateId, ws]);
        await pool.query('UPDATE edges SET target = $1 WHERE target = $2 AND workspace = $3', [primaryId, duplicateId, ws]);
        
        // Delete Duplicate Node
        await pool.query('DELETE FROM nodes WHERE id = $1 AND workspace = $2', [duplicateId, ws]);
        
        io.to(ws).emit('graph-update', { action: 'merge', primaryId, duplicateId });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`;

if (!code.includes('/api/merge')) {
    code = code.replace("server.listen(PORT", mergeEndpoint + "\nserver.listen(PORT");
    fs.writeFileSync('server.js', code);
    console.log("Merge API added successfully!");
}
