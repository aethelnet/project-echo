with open('server.js', 'r') as f:
    code = f.read()

cleanup_api = """
app.post('/api/cleanup', async (req, res) => {
    const ws = req.query.workspace || 'Shadow_Museum_Atlas';
    console.log(`Starting cleanup for workspace: ${ws}`);
    
    exec(`python3 strict_name_merger.py`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Cleanup error: ${error.message}`);
            return res.status(500).json({ error: error.message });
        }
        console.log(`Cleanup stdout: ${stdout}`);
        // Notify all clients to completely reload the graph
        io.to(ws).emit('graph-update', { action: 'full-reload' });
        res.json({ success: true, log: stdout });
    });
});
"""

suggestions_api = """
app.get('/api/merge-suggestions', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const result = await pool.query(
            `SELECT s.id, s.primary_id, s.duplicate_id, s.confidence, 
                    n1.label as primary_label, n2.label as duplicate_label
             FROM merge_suggestions s
             JOIN nodes n1 ON s.primary_id = n1.id
             JOIN nodes n2 ON s.duplicate_id = n2.id
             WHERE s.workspace = $1 AND s.status = 'pending'
             ORDER BY s.confidence DESC`, [ws]
        );
        res.json({ success: true, suggestions: result.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/merge-suggestions/:id/resolve', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const { id } = req.params;
        const { action } = req.body; // 'approve' or 'reject'
        
        const suggestionRes = await pool.query('SELECT * FROM merge_suggestions WHERE id = $1 AND workspace = $2', [id, ws]);
        if (suggestionRes.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const suggestion = suggestionRes.rows[0];
        
        if (action === 'approve') {
            await pool.query('UPDATE edges SET source = $1 WHERE source = $2 AND workspace = $3', [suggestion.primary_id, suggestion.duplicate_id, ws]);
            await pool.query('UPDATE edges SET target = $1 WHERE target = $2 AND workspace = $3', [suggestion.primary_id, suggestion.duplicate_id, ws]);
            await pool.query('DELETE FROM nodes WHERE id = $1 AND workspace = $2', [suggestion.duplicate_id, ws]);
            io.to(ws).emit('graph-update', { action: 'merge', primaryId: suggestion.primary_id, duplicateId: suggestion.duplicate_id });
        }
        
        await pool.query('UPDATE merge_suggestions SET status = $1 WHERE id = $2', [action === 'approve' ? 'approved' : 'rejected', id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
"""

if "/api/cleanup" not in code:
    code = code.replace("server.listen(PORT", cleanup_api + "\n" + suggestions_api + "\nserver.listen(PORT")
    with open('server.js', 'w') as f:
        f.write(code)
    print("ALL APIS INJECTED!")
else:
    print("ALREADY INJECTED!")
