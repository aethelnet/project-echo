import re

APP_FILE = "src/App.tsx"

with open(APP_FILE, 'r') as f:
    code = f.read()

# 1. Patch Node Colors
node_target = """if (node.type === 'person') {
              bgColor = '#000000';
              textColor = '#FFFFFF';
          } else if (node.type === 'artifact') {"""

node_replacement = """if (node.type === 'person') {
              bgColor = '#000000';
              textColor = '#FFFFFF';
          } else if (node.type === 'evidence_document') {
              bgColor = '#8B0000'; // Blood Red Case File
              textColor = '#FFFFFF';
              borderColor = '#000000';
          } else if (node.type === 'artifact') {"""

code = code.replace(node_target, node_replacement)

# 2. Patch Link Colors (Red Thread for KI-Suggested / Evidence traces)
link_target = "linkColor={(link: any) => taggedEdges.has(link.id) ? '#DC2626' : (link.color || '#9CA3AF')}"
link_replacement = "linkColor={(link: any) => taggedEdges.has(link.id) ? '#DC2626' : (link.status === 'ki-suggested' ? '#8B0000' : (link.color || '#9CA3AF'))}"

code = code.replace(link_target, link_replacement)

# 3. Patch Link Width for Evidence
width_target = "linkWidth={(link: any) => taggedEdges.has(link.id) ? 6 : (link.isPathEdge ? 6 : (link.lineDash ? 2 : 4))}"
width_replacement = "linkWidth={(link: any) => taggedEdges.has(link.id) ? 6 : (link.status === 'ki-suggested' ? 5 : (link.isPathEdge ? 6 : (link.lineDash ? 2 : 4)))}"

code = code.replace(width_target, width_replacement)

# 4. Patch Link LineDash for Evidence (Make it dashed to show it's a "Trace")
dash_target = "linkLineDash=\"lineDash\""
dash_replacement = "linkLineDash={(link: any) => link.status === 'ki-suggested' ? [10, 5] : link.lineDash}"

code = code.replace(dash_target, dash_replacement)

with open(APP_FILE, 'w') as f:
    f.write(code)

print("Forensic UI styles injected!")
