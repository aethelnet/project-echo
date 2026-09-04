const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace("app.post('/api/merge', async (req, res) => {", "app.post('/api/merge', async (req, res) => { console.log('MERGE REQUEST:', req.body);");
code = code.replace("res.status(500).json({ error: e.message });", "console.error('MERGE ERROR:', e); res.status(500).json({ error: e.message });");

fs.writeFileSync('server.js', code);
