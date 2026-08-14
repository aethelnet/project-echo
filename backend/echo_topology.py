import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HUNTER_DB_PATH = os.path.join(BASE_DIR, "hunter_database.json")
TOPOLOGY_OUT_PATH = os.path.join(BASE_DIR, "topology_graph.json")

def generate_topology():
    if not os.path.exists(HUNTER_DB_PATH):
        print("No hunter_database.json found.")
        return

    with open(HUNTER_DB_PATH, "r", encoding="utf-8") as f:
        artifacts = json.load(f)

    nodes = []
    links = []
    node_ids = set()

    def add_node(node_id, name, group, color, val):
        if node_id not in node_ids:
            nodes.append({"id": node_id, "name": name, "group": group, "color": color, "val": val})
            node_ids.add(node_id)

    # Core Hubs
    add_node("hub_echo", "Project Echo Core", 0, "#ffffff", 30)

    for art in artifacts:
        art_id = f"art_{art['id']}"
        title = art.get("title", "Unknown Artifact")
        repo = art.get("repository", "Unknown Repository")
        prov = art.get("provenance", "Unknown Origin")
        conf = float(art.get("confidence", 0.0))
        
        # Determine color based on confidence
        color = "#ff003c" if conf > 90 else "#ff7300"
        
        # Artifact Node
        add_node(art_id, title, 1, color, 10)
        
        # Repository Node
        repo_id = f"repo_{hash(repo)}"
        add_node(repo_id, repo, 2, "#1da1f2", 20)
        
        # Provenance Node
        prov_id = f"prov_{hash(prov)}"
        add_node(prov_id, prov, 3, "#ffa500", 15)

        # Links
        links.append({"source": art_id, "target": repo_id, "name": "HOUSED_IN", "color": "#1da1f2"})
        links.append({"source": art_id, "target": prov_id, "name": "LOOTED_FROM", "color": "#ffa500"})
        links.append({"source": "hub_echo", "target": art_id, "name": "IDENTIFIED", "color": "rgba(255,255,255,0.2)"})

    graph_data = {
        "nodes": nodes,
        "links": links
    }

    with open(TOPOLOGY_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph_data, f, indent=4)
    
    print(f"Topology built! {len(nodes)} nodes, {len(links)} links. Saved to {TOPOLOGY_OUT_PATH}")

if __name__ == "__main__":
    generate_topology()
