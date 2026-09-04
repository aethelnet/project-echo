import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Fix the broken create workspace button
broken_snippet = """\
                    <input type="text" value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} placeholder="Name..." style={{ flex: 1, padding: '5px', border: '2px solid #000' }} />
                        if (!newWorkspaceName) return;
                        fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: newWorkspaceName}) })
                        .then(res => res.json())
                        .then(json => {
                            if(json.success) {
                                setWorkspaces([...workspaces, json.workspace]);
                                setCurrentWorkspace(json.workspace);
                                setIsCreatingWorkspace(false);
                            }
                        });
                </div>
            ) : (
            )}
        </div>

           onClick={() => setShowMuseumSearch(!showMuseumSearch)}\
"""

fixed_snippet = """\
                    <input type="text" value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} placeholder="Name..." style={{ flex: 1, padding: '5px', border: '2px solid #000' }} />
                    <button onClick={() => {
                        if (!newWorkspaceName) return;
                        fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: newWorkspaceName}) })
                        .then(res => res.json())
                        .then(json => {
                            if(json.success) {
                                setWorkspaces([...workspaces, json.workspace]);
                                setCurrentWorkspace(json.workspace);
                                setIsCreatingWorkspace(false);
                            }
                        });
                    }} style={{ backgroundColor: '#10B981', color: '#FFF', border: '2px solid #000', fontWeight: 'bold', padding: '5px' }}>OK</button>
                    <button onClick={() => setIsCreatingWorkspace(false)} style={{ backgroundColor: '#EF4444', color: '#FFF', border: '2px solid #000', fontWeight: 'bold', padding: '5px' }}>X</button>
                </div>
            ) : (
                <button onClick={() => setIsCreatingWorkspace(true)} style={{ width: '100%', marginTop: '5px', backgroundColor: '#000', color: '#FFF', padding: '5px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>+ NEUER WORKSPACE</button>
            )}
        </div>

        <button 
           onClick={() => setShowMuseumSearch(!showMuseumSearch)}\
"""

if "if (!newWorkspaceName) return;" in code:
    code = code.replace(broken_snippet, fixed_snippet)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Syntax fixed!")
else:
    print("Snippet not found")
