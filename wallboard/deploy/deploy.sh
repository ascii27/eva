#!/usr/bin/env bash
# Ship the wallboard to its exe.dev VM. Idempotent: safe to run on every change.
#
#   ./deploy/deploy.sh            (or: npm run deploy)
#
# First run installs Node 24 and generates the board + hermes tokens into
# /etc/wallboard.env on the VM. Later runs copy files and restart; open boards
# notice the new build id over SSE and reload themselves.
set -euo pipefail

HOST="${WALLBOARD_HOST:-eva-board.exe.xyz}"
VM="${HOST%%.exe.xyz}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  --exclude node_modules --exclude data --exclude .env \
  "$DIR/" "$HOST:wallboard/"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
# Runtime deps only (sharp, for photo resizing); it ships prebuilt linux binaries.
(cd ~/wallboard && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
if [ ! -f /etc/wallboard.env ]; then
  {
    echo "PORT=8080"
    echo "BOARD_TOKEN=$(openssl rand -hex 24)"
    echo "HERMES_TOKEN=$(openssl rand -hex 24)"
  } | sudo tee /etc/wallboard.env >/dev/null
  sudo chmod 600 /etc/wallboard.env
fi
sudo cp ~/wallboard/deploy/wallboard.service /etc/systemd/system/wallboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now wallboard >/dev/null 2>&1
sudo systemctl restart wallboard
# Chores from Apple Reminders. Idle (skipped by its ConditionPathExists) until an
# iCloud session is copied to ~/.wallboard-icloud — see README "Chores".
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null
sudo cp ~/wallboard/deploy/wallboard-reminders.service /etc/systemd/system/wallboard-reminders.service
sudo systemctl daemon-reload
sudo systemctl enable wallboard-reminders >/dev/null 2>&1
sudo systemctl restart wallboard-reminders
sleep 1
curl -fsS localhost:8080/healthz && echo
REMOTE

echo "Deployed to https://$HOST/"
echo "Make sure the proxy targets 8080:  ssh exe.dev share port $VM 8080"
