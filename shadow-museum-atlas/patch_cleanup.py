with open('server.js', 'r') as f:
    code = f.read()

cleanup_api = """
const { exec } = require('child_process');

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

if "/api/cleanup" not in code:
    code = code.replace("server.listen(PORT", cleanup_api + "\nserver.listen(PORT")
    with open('server.js', 'w') as f:
        f.write(code)
    print("API WAS INJECTED!")
else:
    print("API ALREADY PRESENT")
