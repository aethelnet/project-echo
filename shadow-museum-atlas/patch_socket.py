with open('src/App.tsx', 'r') as f:
    code = f.read()

merge_socket = """
              if (event.action === 'merge') {
                  const pId = event.primaryId;
                  const dId = event.duplicateId;
                  // Edges umbiegen
                  const updatedEdges = prev.edges.map(e => ({
                      ...e,
                      source: e.source === dId || (e.source && e.source.id === dId) ? pId : e.source,
                      target: e.target === dId || (e.target && e.target.id === dId) ? pId : e.target
                  }));
                  // Knoten löschen
                  return {
                      ...prev,
                      nodes: prev.nodes.filter(n => n.id !== dId),
                      edges: updatedEdges
                  };
              }
"""

if "action === 'merge'" not in code:
    code = code.replace(
        "if (event.action === 'add-node') {",
        merge_socket + "\n              if (event.action === 'add-node') {"
    )
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Socket merge logic injected!")
