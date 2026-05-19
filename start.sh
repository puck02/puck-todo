#!/usr/bin/env bash
set -euo pipefail
cd /home/admin/workspace/puck-todo
exec /home/admin/.hermes/hermes-agent/venv/bin/python3 app.py --host 0.0.0.0 --port 8787
