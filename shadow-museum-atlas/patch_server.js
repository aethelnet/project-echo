import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://shadow_user:shadow_password@localhost:5432/shadow_atlas',
});
async function run() {
    await pool.query('ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_by TEXT, ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;');
    console.log("DB altered!");
    process.exit(0);
}
run();
