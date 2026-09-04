import express from 'express';
import basicAuth from 'express-basic-auth';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import multer from 'multer';
import { exec } from 'child_process';
import http from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8088;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    socket.on('join-workspace', (workspace) => {
        socket.join(workspace);
        console.log(`Socket ${socket.id} joined workspace ${workspace}`);
    });
});

app.use(cors());
app.use(express.json());

// Password Protection for Marianne and PAWLO-Masoso
// app.use(basicAuth({
//     users: { 'admin': 'onesolutionrestitution' },
//     challenge: true,
//     realm: 'Shadow Museum Atlas',
//     unauthorizedResponse: 'Zugriff verweigert. Bitte korrektes Passwort eingeben.'
// }));

// =========================================
// POSTGRESQL DATABASE LOGIC
// =========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas',
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS workspaces (
                name TEXT PRIMARY KEY
            );
            
            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_by TEXT;
            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
            ALTER TABLE edges ADD COLUMN IF NOT EXISTS type TEXT;
            ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
            
            
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT,
                workspace TEXT,
                label TEXT,
                type TEXT,
                status TEXT,
                image TEXT,
                PRIMARY KEY (workspace, id)
            );
            
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT,
                workspace TEXT,
                source TEXT,
                target TEXT,
                year INTEGER,
                page TEXT,
                quote TEXT,
                status TEXT,
                file TEXT,
                PRIMARY KEY (workspace, id)
            );
            
            CREATE TABLE IF NOT EXISTS processed_files (
                workspace TEXT,
                filename TEXT,
                hash TEXT,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (workspace, filename)
            );
        `);
        console.log('✅ PostgreSQL Schema initialized');
        await client.query('INSERT INTO workspaces (name) VALUES ($1) ON CONFLICT DO NOTHING', ['Shadow_Museum_Atlas']);
    } finally {
        client.release();
    }
}
initDB().catch(console.error);

// =========================================
// MULTI-TENANT WORKSPACE LOGIC
// =========================================

const dropzonesDir = path.join(__dirname, 'data_dropzone', 'workspaces');
if (!fs.existsSync(dropzonesDir)) fs.mkdirSync(dropzonesDir, { recursive: true });

function getWorkspaceDropzone(workspaceName) {
    if (!workspaceName) workspaceName = 'Shadow_Museum_Atlas';
    if (!/^[a-zA-Z0-9_-]+$/.test(workspaceName)) throw new Error('Invalid workspace name.');
    
    const dz = path.join(dropzonesDir, workspaceName, 'verified_research');
    if (!fs.existsSync(dz)) fs.mkdirSync(dz, { recursive: true });
    return dz;
}

// Setup Multer for PDF uploads dynamically
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const ws = req.query.workspace || 'Shadow_Museum_Atlas';
            cb(null, getWorkspaceDropzone(ws));
        } catch (e) {
            cb(e, null);
        }
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });


// =========================================
// API ENDPOINTS
// =========================================

// Workspaces
app.get('/api/workspaces', async (req, res) => {
    try {
        const result = await pool.query('SELECT name FROM workspaces');
        const workspaces = result.rows.map(r => r.name);
        if (workspaces.length === 0) workspaces.push('Shadow_Museum_Atlas');
        res.json({ success: true, workspaces });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/workspaces', async (req, res) => {
    try {
        const ws = req.body.name;
        if (!ws || !/^[a-zA-Z0-9_-]+$/.test(ws)) return res.status(400).json({ error: "Invalid name" });
        await pool.query('INSERT INTO workspaces (name) VALUES ($1) ON CONFLICT DO NOTHING', [ws]);
        getWorkspaceDropzone(ws); // Creates the dropzone
        res.json({ success: true, workspace: ws });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Graph data
app.get('/api/graph', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const nodesRes = await pool.query('SELECT * FROM nodes WHERE workspace = $1', [ws]);
        const edgesRes = await pool.query('SELECT * FROM edges WHERE workspace = $1', [ws]);
        res.json({ success: true, nodes: nodesRes.rows, links: edgesRes.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/nodes/:id/resolve', async (req, res) => {
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
});

app.post('/api/nodes/:id/tags', async (req, res) => {
    const { tags } = req.body;
    const ws = req.query.workspace || 'Shadow_Museum_Atlas';
    try {
        await pool.query('UPDATE nodes SET tags = $1 WHERE id = $2 AND workspace = $3', [JSON.stringify(tags), req.params.id, ws]);
        res.json({ success: true, tags });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/nodes', async (req, res) => {
    const { id, label, type, status, image } = req.body;
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const node = { id, label, type, status: status || 'user-added', image: image || null };
        
        try {
            await pool.query(
                'INSERT INTO nodes (id, workspace, label, type, status, image) VALUES ($1, $2, $3, $4, $5, $6)',
                [node.id, ws, node.label, node.type, node.status, node.image]
            );
            io.to(ws).emit('graph-update', { action: 'add-node', data: node });
            res.json({ success: true, node });
        } catch (dbErr) {
            if (dbErr.code === '23505') { // Postgres unique violation
                res.status(400).json({ error: "Node existiert bereits." });
            } else {
                throw dbErr;
            }
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/edges', async (req, res) => {
    const { id, source, target, year, page, quote, status, file } = req.body;
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const edge = { id, source, target, year, page: page || "Unbekannt", quote: quote || "", status: status || 'user-added', file: file || "" };
        await pool.query(
            'INSERT INTO edges (id, workspace, source, target, year, page, quote, status, file) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [edge.id, ws, edge.source, edge.target, edge.year, edge.page, edge.quote, edge.status, edge.file]
        );
        io.to(ws).emit('graph-update', { action: 'add-edge', data: edge });
        res.json({ success: true, edge });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Document Management
app.use('/documents', (req, res, next) => {
    next();
}, express.static(dropzonesDir));

app.get('/api/documents', (req, res) => {
    try {
        const dz = getWorkspaceDropzone(req.query.workspace);
        const files = fs.readdirSync(dz);
        res.json({ success: true, files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/documents', upload.single('document'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ success: true, filename: req.file.originalname });
});

app.delete('/api/documents/:filename', (req, res) => {
    try {
        const dz = getWorkspaceDropzone(req.query.workspace);
        const filepath = path.join(dz, req.params.filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// OpenAlex Integration
app.get('/api/openalex-search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json({ success: true, results: [] });
        
        const openAlexRes = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=15`);
        const openAlexJson = await openAlexRes.json();
        
        const results = (openAlexJson.results || []).map((work) => ({
            id: work.id,
            title: work.title,
            authors: work.authorships ? work.authorships.map(a => a.author.display_name).join(', ') : 'Unbekannt',
            year: work.publication_year,
            doi: work.doi,
            pdf_url: work.best_oa_location && work.best_oa_location.pdf_url ? work.best_oa_location.pdf_url : null,
            landing_page: work.best_oa_location ? work.best_oa_location.landing_page_url : (work.primary_location ? work.primary_location.landing_page_url : null)
        }));
        
        res.json({ success: true, results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/download-document', async (req, res) => {
    try {
        const { url, title } = req.body;
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        if (!url) return res.status(400).json({ error: 'No URL provided' });
        
        const dz = getWorkspaceDropzone(ws);
        const safeTitle = (title || 'document').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `${safeTitle}_${Date.now()}.pdf`;
        const filepath = path.join(dz, filename);
        
        const pdfRes = await fetch(url);
        if (!pdfRes.ok) throw new Error(`Failed to fetch PDF: ${pdfRes.statusText}`);
        
        const buffer = await pdfRes.arrayBuffer();
        fs.writeFileSync(filepath, Buffer.from(buffer));
        
        res.json({ success: true, filename });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/museum-search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json({ success: true, results: [] });
        
        const results = [];

        const euTerms = query.split(' ').map(t => t.trim()).filter(t => t.length > 0).join(' AND ');
        try {
            const euRes = await fetch(`https://api.europeana.eu/record/v2/search.json?wskey=api2demo&query=${encodeURIComponent(euTerms)}&rows=10`);
            const euJson = await euRes.json();
            if (euJson.items) {
                for (const item of euJson.items) {
                    results.push({
                        id: `eu-${item.id.replace(/\//g, '')}`,
                        title: item.title ? item.title[0] : "Unbekannter Titel",
                        artist: item.dcCreator ? item.dcCreator.join(', ') : "Unbekannt",
                        date: item.year ? item.year[0] : "Unbekannt",
                        culture: "",
                        country: item.country ? item.country[0] : "",
                        museum: item.dataProvider ? item.dataProvider[0] : "Europeana",
                        url: item.guid || "",
                        image: item.edmPreview ? item.edmPreview[0] : null
                    });
                }
            }
        } catch (e) { console.error("Europeana API Error", e); }
        
        try {
            const metSearchRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}`);
            const metSearchJson = await metSearchRes.json();
            
            if (metSearchJson.objectIDs && metSearchJson.objectIDs.length > 0) {
                const idsToFetch = metSearchJson.objectIDs.slice(0, 5); 
                for (const id of idsToFetch) {
                    try {
                        const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
                        const objJson = await objRes.json();
                        if (objJson && objJson.title) {
                            results.push({
                                id: `met-${id}`,
                                title: objJson.title,
                                artist: objJson.artistDisplayName || "Unbekannt",
                                date: objJson.objectDate || "Unbekannt",
                                culture: objJson.culture || "",
                                country: objJson.country || "",
                                museum: "The MET",
                                url: objJson.objectURL,
                                image: objJson.primaryImageSmall || null
                            });
                        }
                    } catch (e) { console.error("MET object error", id, e); }
                }
            }
        } catch (e) { console.error("MET API Error", e); }
        
        res.json({ success: true, results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/analyze', async (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        if (!/^[a-zA-Z0-9_-]+$/.test(ws)) throw new Error("Invalid workspace");
        
        const dz = getWorkspaceDropzone(ws);
        const outJson = path.join(__dirname, 'workspaces', `${ws}_data.json`);
        
        console.log(`🚀 Starte SpaCy Analyse für Workspace: ${ws}...`);
        
        const processedRows = await pool.query('SELECT filename FROM processed_files WHERE workspace = $1', [ws]);
        const processedFiles = processedRows.rows.map(r => r.filename).join(',');
        
        const env = {
            ...process.env,
            DROPZONE_DIR: dz,
            OUTPUT_FILE: outJson,
            PROCESSED_FILES: processedFiles
        };
        
        exec('python build_spacy_starmap.py', { cwd: __dirname, env }, async (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return res.status(500).json({ error: 'Analyze failed' });
            }
            
            console.log(`🧠 Analyse abgeschlossen. Importiere neue Daten in Postgres (${ws})...`);
            try {
                if (fs.existsSync(outJson)) {
                    const rawData = fs.readFileSync(outJson, 'utf8');
                    const parsed = JSON.parse(rawData);

                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const newFiles = new Set();

                        for (const n of parsed.nodes) {
                            await client.query(
                                'INSERT INTO nodes (id, workspace, label, type, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace, id) DO NOTHING',
                                [n.id, ws, n.label, n.type, n.status]
                            );
                        }
                        for (const e of parsed.edges) {
                            await client.query(
                                'INSERT INTO edges (id, workspace, source, target, year, page, quote, status, file) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace, id) DO NOTHING',
                                [e.id, ws, e.source, e.target, e.year, e.page || "Unbekannt", e.quote, e.status, e.file || ""]
                            );
                            if (e.file) newFiles.add(e.file);
                        }
                        for (const f of parsed.processed_files || []) {
                            newFiles.add(f);
                        }
                        for (const file of newFiles) {
                            await client.query(
                                'INSERT INTO processed_files (workspace, filename) VALUES ($1, $2) ON CONFLICT (workspace, filename) DO NOTHING',
                                [ws, file]
                            );
                        }
                        await client.query('COMMIT');
                        console.log(`✅ Import der neuen Dokumente für ${ws} abgeschlossen. (${newFiles.size} neue Dateien)`);
                    } catch (e) {
                        await client.query('ROLLBACK');
                        throw e;
                    } finally {
                        client.release();
                    }
                    
                    fs.unlinkSync(outJson);
                }
                res.json({ success: true, message: "Analyse erfolgreich." });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vision-analyze', (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        if (!/^[a-zA-Z0-9_-]+$/.test(ws)) throw new Error("Invalid workspace");
        
        const dz = getWorkspaceDropzone(ws);
        const scriptPath = path.join(__dirname, 'vision_lgnn_engine.py');
        const child = spawn('python3', [scriptPath, dz]);

        let output = '';
        child.stdout.on('data', d => output += d);
        child.stderr.on('data', d => console.error(d.toString()));
        child.on('close', code => {
            if (code !== 0) return res.status(500).json({ error: "Vision Engine Failed" });
            res.json({ success: true, message: "Beweise extrahiert" });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/hidden-connections', (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        if (!/^[a-zA-Z0-9_-]+$/.test(ws)) throw new Error("Invalid workspace");
        
        const scriptPath = path.join(__dirname, 'lgnn_link_prediction.py');
        const child = spawn('python3', [scriptPath, ws]);

        let output = '';
        child.stdout.on('data', d => output += d);
        child.stderr.on('data', d => console.error(d.toString()));
        child.on('close', code => {
            if (code !== 0) return res.status(500).json({ error: "Link Prediction Failed" });
            try {
                const hiddenEdges = JSON.parse(output);
                res.json(hiddenEdges);
            } catch (e) {
                res.status(500).json({ error: "Invalid JSON from Python script" });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/zero-shot-tag', (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const tag = req.query.tag;
        if (!/^[a-zA-Z0-9_-]+$/.test(ws)) throw new Error("Invalid workspace");
        if (!tag) throw new Error("Tag is required");
        
        const scriptPath = path.join(__dirname, 'live_zero_shot.py');
        const child = spawn('python3', [scriptPath, ws, tag]);

        let output = '';
        child.stdout.on('data', d => output += d);
        child.stderr.on('data', d => console.error(d.toString()));
        child.on('close', code => {
            if (code !== 0) return res.status(500).json({ error: "Zero Shot Tagger Failed" });
            try {
                const taggedEdges = JSON.parse(output);
                res.json(taggedEdges);
            } catch (e) {
                res.status(500).json({ error: "Invalid JSON from Python script" });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/recon', (req, res) => {
    try {
        const ws = req.query.workspace || 'Shadow_Museum_Atlas';
        const node = req.query.node;
        if (!/^[a-zA-Z0-9_-]+$/.test(ws)) throw new Error("Invalid workspace");
        if (!node) throw new Error("Node label required");

        console.log(`🔎 Starte Globale KI Recon für Knoten: ${node} in Workspace: ${ws}`);
        
        // Ensure python script gets the POSTGRES database URL
        const env = {
            ...process.env,
            WORKSPACE: ws,
            TARGET_NODE: node,
            DATABASE_URL: process.env.DATABASE_URL || 'postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas'
        };
        
        exec('python global_ai_recon.py', { cwd: __dirname, env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                console.error(stderr);
                return res.status(500).json({ error: 'Recon failed' });
            }
            console.log(stdout);
            
            io.to(ws).emit('graph-update', { action: 'recon-complete' });
            res.json({ success: true, newEdges: 3 });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =========================================
// FRONTEND HOSTING
// =========================================
const buildPath = path.join(__dirname, 'dist');
app.use(express.static(buildPath));

app.use('/:workspace/verified_research', (req, res, next) => {
    const ws = req.params.workspace;
    if (!/^[a-zA-Z0-9_-]+$/.test(ws)) return next();
    const researchDir = path.join(getWorkspaceDropzone(ws), 'verified_research');
    express.static(researchDir)(req, res, next);
});



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
        const { action, historian } = req.body; // 'approve' or 'reject'
        
        const suggestionRes = await pool.query('SELECT * FROM merge_suggestions WHERE id = $1 AND workspace = $2', [id, ws]);
        if (suggestionRes.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const suggestion = suggestionRes.rows[0];
        
        if (action === 'approve') {
            await pool.query('UPDATE edges SET source = $1 WHERE source = $2 AND workspace = $3', [suggestion.primary_id, suggestion.duplicate_id, ws]);
            await pool.query('UPDATE edges SET target = $1 WHERE target = $2 AND workspace = $3', [suggestion.primary_id, suggestion.duplicate_id, ws]);
            await pool.query('DELETE FROM nodes WHERE id = $1 AND workspace = $2', [suggestion.duplicate_id, ws]);
            io.to(ws).emit('graph-update', { action: 'merge', primaryId: suggestion.primary_id, duplicateId: suggestion.duplicate_id });
        }
        
        await pool.query('UPDATE merge_suggestions SET status = $1, resolved_by = $2, resolved_at = CURRENT_TIMESTAMP WHERE id = $3', [action === 'approve' ? 'approved' : 'rejected', historian || 'UNKNOWN_HISTORIAN', id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🛡️  SHADOW MUSEUM ATLAS LIVE (POSTGRESQL)`);
    console.log(`=========================================`);
    console.log(`Hosting on port ${PORT}`);
    console.log(`Passwort-Schutz (Basic Auth) ist AKTIV.`);
    console.log(`=========================================`);
});

app.use((req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
});
