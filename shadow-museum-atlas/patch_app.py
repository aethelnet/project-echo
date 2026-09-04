import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# 1. Add State
if "isMergeSelectMode" not in code:
    code = code.replace(
        "const [isEdgeSelectMode, setIsEdgeSelectMode] = useState(false);",
        "const [isEdgeSelectMode, setIsEdgeSelectMode] = useState(false);\n  const [isMergeSelectMode, setIsMergeSelectMode] = useState(false);\n  const [mergeSourceNode, setMergeSourceNode] = useState<any>(null);"
    )

# 2. Add handleNodeClick logic
click_logic = """
    if (isMergeSelectMode && mergeSourceNode && mergeSourceNode.id !== node.id) {
        if(window.confirm(`Möchtest du '${node.label}' wirklich in '${mergeSourceNode.label}' verschmelzen? Dies kann nicht rückgängig gemacht werden.`)) {
            fetch(`/api/merge?workspace=${currentWorkspace}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId: mergeSourceNode.id, duplicateId: node.id })
            }).then(r => r.json()).then(res => {
                if(res.success) alert("Verschmelzung erfolgreich!");
            });
        }
        setIsMergeSelectMode(false);
        return;
    }
"""
if "isMergeSelectMode && mergeSourceNode" not in code:
    code = code.replace(
        "const handleNodeClick = (node: any) => {\n    setSelectedLink(null);",
        "const handleNodeClick = (node: any) => {\n    setSelectedLink(null);\n" + click_logic
    )

# 3. Add Merge Button to UI
merge_btn = """
            {/* MANUELLER MERGE */}
            <button 
                onClick={() => {
                    setMergeSourceNode(selectedNode);
                    setIsMergeSelectMode(!isMergeSelectMode);
                    if (!isMergeSelectMode) alert("MERGE-MODUS: Klicke jetzt auf das Duplikat im Graphen, das du in DIESEN Knoten verschmelzen willst.");
                }}
                style={{ width: '100%', padding: '10px', backgroundColor: isMergeSelectMode ? '#DC2626' : '#FFF', color: isMergeSelectMode ? '#FFF' : '#000', border: '2px solid #000', borderStyle: 'dashed', fontWeight: 900, cursor: 'pointer', marginTop: '10px', letterSpacing: '1px' }}>
                {isMergeSelectMode ? "⌖ DUPLIKAT WÄHLEN..." : "🔗 MIT KNOTEN VERSCHMELZEN"}
            </button>
"""
if "MIT KNOTEN VERSCHMELZEN" not in code:
    code = code.replace(
        "{isEdgeSelectMode ? \"⌖ ZIEL WÄHLEN...\" : \"+ VERBINDUNG ZIEHEN\"}\n            </button>",
        "{isEdgeSelectMode ? \"⌖ ZIEL WÄHLEN...\" : \"+ VERBINDUNG ZIEHEN\"}\n            </button>\n" + merge_btn
    )

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Merge logic added to App.tsx!")
