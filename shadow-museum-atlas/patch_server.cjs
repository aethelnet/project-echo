const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const resonanceEndpoint = `
app.get('/api/deep-resonance', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const nodeId = req.query.node;
        
        const { spawn } = require('child_process');
        const py = spawn('python3', ['deep_resonance.py', ws, nodeId]);
        
        let output = '';
        py.stdout.on('data', data => output += data.toString());
        py.on('close', () => {
            try {
                const result = JSON.parse(output);
                res.json(result);
            } catch(e) {
                res.status(500).json({error: 'Python parsing error: ' + output});
            }
        });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});
`;

if (!code.includes('/api/deep-resonance')) {
    code = code.replace("app.listen(PORT", resonanceEndpoint + "\napp.listen(PORT");
    fs.writeFileSync('server.js', code);
}
