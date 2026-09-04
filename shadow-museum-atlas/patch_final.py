with open('server.js', 'r') as f:
    code = f.read()

merge_api = """
app.post('/api/merge', async (req, res) => {
    console.log('MERGE REQUEST TRIGGERED:', req.body);
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const { primaryId, duplicateId } = req.body;
        if (!primaryId || !duplicateId) return res.status(400).json({ error: "Missing node IDs" });
        await pool.query('UPDATE edges SET source = $1 WHERE source = $2 AND workspace = $3', [primaryId, duplicateId, ws]);
        await pool.query('UPDATE edges SET target = $1 WHERE target = $2 AND workspace = $3', [primaryId, duplicateId, ws]);
        await pool.query('DELETE FROM nodes WHERE id = $1 AND workspace = $2', [duplicateId, ws]);
        io.to(ws).emit('graph-update', { action: 'merge', primaryId, duplicateId });
        console.log('MERGE SUCCESS!');
        res.json({ success: true });
    } catch (e) {
        console.error('MERGE ERROR:', e);
        res.status(500).json({ error: e.message });
    }
});
"""

if "/api/merge" not in code:
    code = code.replace("server.listen(PORT", merge_api + "\nserver.listen(PORT")
    with open('server.js', 'w') as f:
        f.write(code)
    print("API WAS INJECTED!")
else:
    print("API ALREADY PRESENT")
