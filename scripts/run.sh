#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "    PROJECT ECHO: SOVEREIGN RESTITUTION FRAMEWORK"
echo "           Aethelnet OS Forge Application"
echo "=========================================================="

echo "[1/3] Starting Echo Engine API (Port 5000)..."
python3 backend/echo_engine.py &
API_PID=$!

echo "[2/3] Starting Echo Hunter Daemon (Wikidata SPARQL)..."
python3 backend/echo_hunter.py &
HUNTER_PID=$!

echo "[3/3] Starting Cinematic Web UI (Port 8089)..."
python3 -m http.server 8089 --directory frontend &
UI_PID=$!

echo ""
echo "🚀 Project Echo is fully ONLINE!"
echo "   • API Server:     http://localhost:5000"
echo "   • Web Interface:  http://localhost:8089"
echo "   • Process IDs:    API=$API_PID, Hunter=$HUNTER_PID, UI=$UI_PID"
echo ""
echo "Press Ctrl+C to terminate all services."

trap "kill $API_PID $HUNTER_PID $UI_PID 2>/dev/null || true; exit 0" SIGINT SIGTERM

wait
