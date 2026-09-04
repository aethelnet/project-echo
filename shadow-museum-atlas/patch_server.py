with open('server.js', 'r') as f:
    code = f.read()

old_init = """        await client.query(`
            CREATE TABLE IF NOT EXISTS workspaces (
                name TEXT PRIMARY KEY
            );"""

new_init = """        await client.query(`
            CREATE TABLE IF NOT EXISTS workspaces (
                name TEXT PRIMARY KEY
            );
            
            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_by TEXT;
            ALTER TABLE merge_suggestions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
            """
            
code = code.replace(old_init, new_init)

old_resolve = """        const { action } = req.body; // 'approve' or 'reject'
        
        const suggestionRes = await pool.query('SELECT * FROM merge_suggestions WHERE id = $1 AND workspace = $2', [id, ws]);"""

new_resolve = """        const { action, historian } = req.body; // 'approve' or 'reject'
        
        const suggestionRes = await pool.query('SELECT * FROM merge_suggestions WHERE id = $1 AND workspace = $2', [id, ws]);"""

old_update = """        await pool.query('UPDATE merge_suggestions SET status = $1 WHERE id = $2', [action === 'approve' ? 'approved' : 'rejected', id]);"""
new_update = """        await pool.query('UPDATE merge_suggestions SET status = $1, resolved_by = $2, resolved_at = CURRENT_TIMESTAMP WHERE id = $3', [action === 'approve' ? 'approved' : 'rejected', historian || 'UNKNOWN_HISTORIAN', id]);"""

code = code.replace(old_resolve, new_resolve)
code = code.replace(old_update, new_update)

with open('server.js', 'w') as f:
    f.write(code)
print("server.js patched!")
