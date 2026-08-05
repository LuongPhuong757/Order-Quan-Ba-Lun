#!/usr/bin/env bash
# Deploy Order Quán Bà Lùn lên VPS: push GitHub (nếu cần) → git pull + rebuild Docker trên server.
# Credentials đọc từ .env.deploy (gitignored). KHÔNG hardcode mật khẩu ở đây.
#
# Cách dùng:
#   ./deploy.sh            # pull + rebuild trên server (mặc định)
#   ./deploy.sh --logs     # xem 60 dòng log build gần nhất
#   ./deploy.sh --status   # docker compose ps trên server
#
# Yêu cầu máy local: sshpass (brew install hudochenkov/sshpass/sshpass)
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env.deploy ]]; then echo "❌ Thiếu .env.deploy (xem README/skill deploy-vps)"; exit 1; fi
# shellcheck disable=SC1091
source .env.deploy
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:?}" "${DEPLOY_PASS:?}" "${DEPLOY_PATH:?}"

# SSH có retry — sshd VPS đôi khi rate-limit khi kết nối liên tiếp (fail2ban).
rssh() {
  local out
  for i in 1 2 3 4 5; do
    out=$(SSHPASS="$DEPLOY_PASS" sshpass -e ssh -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=20 -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "$1" 2>&1) && { echo "$out"; return 0; }
    if echo "$out" | grep -q "Permission denied"; then echo "  … lần $i bị từ chối, đợi 8s" >&2; sleep 8; continue; fi
    echo "$out"; return 1
  done
  echo "❌ SSH thất bại sau 5 lần (kiểm tra mật khẩu / fail2ban)"; return 1
}

case "${1:-deploy}" in
  --logs)   rssh "tail -n 60 /tmp/deploy-build.log" ;;
  --status) rssh "cd $DEPLOY_PATH && docker compose -f docker-compose.prod.yml ps" ;;
  deploy)
    echo "▶ git pull trên server…"
    rssh "cd $DEPLOY_PATH && git pull --ff-only origin main && git log --oneline -1"
    echo "▶ rebuild Docker (chạy nền, log /tmp/deploy-build.log)…"
    rssh "cd $DEPLOY_PATH && rm -f /tmp/deploy-build.log && nohup bash -c 'docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build > /tmp/deploy-build.log 2>&1; rc=\$?; bash scripts/attach-caddy-networks.sh >> /tmp/deploy-build.log 2>&1; echo DEPLOY_DONE_EXIT=\$rc >> /tmp/deploy-build.log' >/dev/null 2>&1 & echo BUILD_STARTED"
    echo "✅ Đã start build. Theo dõi: ./deploy.sh --logs   |   Kiểm tra: ./deploy.sh --status" ;;
  *) echo "Dùng: ./deploy.sh [--logs|--status]"; exit 1 ;;
esac
