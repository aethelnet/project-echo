import re

# Update CURRENT_TASKS.md
with open('/home/nikahrlyn/Documents/AethelnetBrain/02_TASK_QUEUE/CURRENT_TASKS.md', 'r') as f:
    tasks = f.read()

# Replace Phase 30
tasks = re.sub(
    r'### Phase 30: Core Decoupling & Ecosystem Paradigm\n- \[ \] \*\*Architectural Debt\*\*: Extract all Sovereign Trading logic \(\`hyperliquid_sniper\.py\`, \`solana_dex_crawler\.py\`, \`jito_mev\.py\`\) out of the root directory and the \`backend_clean/\` graveyard\.\n- \[ \] \*\*The Container Boundary\*\*: Refactor \`Dockerfile\` to only build the Trading Engine\.\n- \[ \] \*\*Ignition Patch\*\*: Update \`ignition_receiver\.py\` and \`deploy/supervisord\.conf\` to point to the new \`sovereign_trading_engine/\` paths\.',
    """### Phase 30: Core Decoupling & Ecosystem Paradigm
- [x] **Architectural Debt**: Decoupled the Sovereign Trading Engine (App #1) into `sovereign_trading_engine/`. Bots running at 100% CPU.

### Phase 31: Multiplayer / Real-Time Upgrade (Project Echo)
- [x] Patched Node.js backend to emit `graph-update` WebSocket events for node merges (`/api/merge`).
- [x] Created `strict_name_merger.py` (The "Waschanlage") for Levenshtein typo-fixing (>95% identical labels), eliminating 71 duplicate nodes.
- [x] Wired "Waschanlage" into React UI via `/api/cleanup` and "GRAPH BEREINIGEN" button.

### Phase 32: Human-in-the-Loop Merge Suggestions UI
- [ ] Implement a Human-in-the-Loop Merge Suggestion Queue in the UI to give historians control over node merging.""",
    tasks
)
with open('/home/nikahrlyn/Documents/AethelnetBrain/02_TASK_QUEUE/CURRENT_TASKS.md', 'w') as f:
    f.write(tasks)

# Update SESSION_LOGS.md
with open('/home/nikahrlyn/Documents/AethelnetBrain/03_MEMORY_BANK/SESSION_LOGS.md', 'a') as f:
    f.write("""\n---

# Session Log: 2026-08-19 (The Great Decoupling & Shadow Museum Multiplayer)

## What We Achieved
1. **The Great Decoupling (Phase 30):** Ran a parallel agent session to decouple the Sovereign Trading Engine from the main repo, moving it into `sovereign_trading_engine/`. The trading bots are now running cleanly in the background at 100% CPU.
2. **Multiplayer / Real-Time Upgrade (Phase 31):** Shifted focus back to the Shadow Museum Atlas (Projekt Echo). Patched the Node.js backend to emit `graph-update` WebSocket events for node merges (`/api/merge`).
3. **The "Waschanlage":** Created `strict_name_merger.py`, a strict Levenshtein-based typo-fixing script that merges >95% identical node labels to clean up PDF extraction noise (instantly eliminated 71 duplicate nodes).
4. **UI Integration:** Wired the "Waschanlage" into the React UI via an `/api/cleanup` endpoint and a green "GRAPH BEREINIGEN" button, giving historians direct control.

## What Was NOT Done (Missstände, Offene Baustellen & Unfertige Komponenten)
1. **Human-in-the-Loop Merge Suggestions:** While the "Waschanlage" automatically merges >95% identical labels, we have not yet built the UI for a "Human-in-the-Loop" Merge Suggestion Queue to review less certain merges.

## Next Logical Steps & Brainstorming Proposal (Next Phase)
1. **Build Merge Suggestion UI (Phase 32):** Implement a staging area in the React UI where historians can manually approve or reject fuzzy merge suggestions (e.g., 80-95% similarity) before they are committed to the graph.
2. **Ensure Real-Time Broadcast:** Make sure that approvals/rejections in the suggestion queue trigger WebSocket broadcasts so all connected historians see the graph update live.
""")
print("Vault updated!")
