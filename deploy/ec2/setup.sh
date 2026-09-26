#!/usr/bin/env bash
# Pullwright worker on a fresh Ubuntu 24.04 EC2 instance (t4g.small / t3.small, 30 GB gp3).
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/MyOwnDevin/main/deploy/ec2/setup.sh | sudo bash
#   sudo nano /etc/pullwright/worker.env      # fill in secrets (see worker.env.example)
#   sudo systemctl enable --now pullwright-worker
#
# Security group: NO inbound rules needed (SSH optional, or use SSM Session Manager).
# The worker only makes outbound connections: Redis, Postgres, GitHub, the LLM API.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Ayushjo/MyOwnDevin.git}"
BRANCH="${BRANCH:-main}"

echo "==> packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git docker.io
systemctl enable --now docker

echo "==> node 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "==> 2 GB swap (npm installs on 2 GB instances)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> user + dirs"
id pullwright >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin pullwright
usermod -aG docker pullwright
# Sandbox containers run as uid 1000; task workspaces must be writable by it.
install -d -o pullwright -g pullwright /srv/pullwright /srv/pullwright/tasks /srv/pullwright/spend
install -d -m 750 /etc/pullwright

echo "==> code"
if [ ! -d /srv/pullwright/app ]; then
  sudo -u pullwright git clone --depth 1 --branch "$BRANCH" "$REPO_URL" /srv/pullwright/app
else
  sudo -u pullwright git -C /srv/pullwright/app pull --ff-only
fi
cd /srv/pullwright/app/backend
sudo -u pullwright npm ci --no-audit --no-fund
sudo -u pullwright npm run build

echo "==> sandbox image"
docker build -t pullwright-sandbox:2 src/sandbox

echo "==> systemd"
cp /srv/pullwright/app/deploy/ec2/pullwright-worker.service /etc/systemd/system/
[ -f /etc/pullwright/worker.env ] || cp /srv/pullwright/app/deploy/ec2/worker.env.example /etc/pullwright/worker.env
# Sandbox containers must run as the same uid that owns the task workspaces.
grep -q '^SANDBOX_USER=' /etc/pullwright/worker.env || echo "SANDBOX_USER=$(id -u pullwright):$(id -g pullwright)" >> /etc/pullwright/worker.env
chmod 640 /etc/pullwright/worker.env && chgrp pullwright /etc/pullwright/worker.env
systemctl daemon-reload
echo "Done. Edit /etc/pullwright/worker.env, then: systemctl enable --now pullwright-worker"
