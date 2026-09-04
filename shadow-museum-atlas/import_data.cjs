const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas',
});

async function run() {
    const ws = 'Shadow_Museum_Atlas';
    const rawData = fs.readFileSync('src/data.json', 'utf8');
    const parsed = JSON.parse(rawData);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let nodeCount = 0;
        let edgeCount = 0;

        for (const n of parsed.nodes) {
            await client.query(
                'INSERT INTO nodes (id, workspace, label, type, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace, id) DO NOTHING',
                [n.id, ws, n.label, n.type, n.status]
            );
            nodeCount++;
        }
        for (const e of parsed.edges) {
            await client.query(
                'INSERT INTO edges (id, workspace, source, target, year, page, quote, status, file) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace, id) DO NOTHING',
                [e.id, ws, e.source, e.target, e.year, e.page || "Unbekannt", e.quote, e.status, e.file || ""]
            );
            edgeCount++;
        }
        
        await client.query('COMMIT');
        console.log(`Inserted ${nodeCount} nodes and ${edgeCount} edges!`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
    }
}

run().then(() => process.exit(0));
