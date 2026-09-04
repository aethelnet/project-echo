with open('server.js', 'r') as f:
    code = f.read()

# Remove the endpoints from the bottom
import re
cleanup_regex = r"app\.post\('/api/cleanup'.*?res\.json\(\{ success: true, log: stdout \}\);\n    \}\);\n\}\);\n"
suggestions_regex = r"app\.get\('/api/merge-suggestions'.*?res\.status\(500\)\.json\(\{ error: e\.message \}\);\n    \}\n\}\);\n"
suggestions2_regex = r"app\.post\('/api/merge-suggestions/:id/resolve'.*?res\.status\(500\)\.json\(\{ error: e\.message \}\);\n    \}\n\}\);\n"

code = re.sub(cleanup_regex, '', code, flags=re.DOTALL)
code = re.sub(suggestions_regex, '', code, flags=re.DOTALL)
code = re.sub(suggestions2_regex, '', code, flags=re.DOTALL)

# Inject them BEFORE the catch-all
catch_all = "app.use((req, res) => {\n    res.sendFile(path.join(buildPath, 'index.html'));\n});"

api_block = """
app.post('/api/cleanup', async (req, res) => {
    const ws = req.query.workspace || 'Shadow_Museum_Atlas';
    console.log(`Starting cleanup for workspace: ${ws}`);
    
    exec(`python3 strict_name_merger.py`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Cleanup error: ${error.message}`);
            return res.status(500).json({ error: error.message });
        }
        console.log(`Cleanup stdout: ${stdout}`);
        io.to(ws).emit('graph-update', { action: 'full-reload' });
        res.json({ success: true, log: stdout });
    });
});

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
        const { action } = req.body; 
        
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

code = code.replace(catch_all, api_block + "\n" + catch_all)
with open('server.js', 'w') as f:
    f.write(code)
