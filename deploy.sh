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
    # `sync-caddyfile` (2026-09-04) — BƯỚC BẮT BUỘC, đừng bỏ. Caddyfile được mount kiểu MỘT
    # FILE (./Caddyfile:/etc/caddy/Caddyfile). Bind mount một file bám theo inode, mà `git pull`
    # thay file bằng cách ghi file mới rồi rename đè — inode đổi, nên container VẪN ĐỌC BẢN CŨ
    # dù file trên đĩa đã mới. `docker compose up -d` cũng không cứu được: nội dung container
    # không đổi nên nó để nguyên, chỉ in "Container ordbl_caddy Running".
    #
    # Hậu quả đã gặp thật: thêm host menu.<domain>, deploy báo thành công, `caddy reload` cũng
    # báo thành công (nó đọc đúng bản CŨ trong container nên thấy "không có gì đổi"), và host
    # mới im lặng không tồn tại. Mất 20 phút mới lần ra.
    #
    # Nên: so nội dung file trong container với file trên đĩa, KHÁC thì mới tạo lại container
    # caddy. So nội dung chứ không so commit — nó bắt đúng cái hỏng thật (bản trong container
    # bị cũ), bất kể vì lý do gì. Giống nhau thì không đụng vào, tránh vài giây gián đoạn cho
    # mọi site dùng chung Caddy này ở mỗi lần deploy.
    #
    # Phải chạy TRƯỚC attach-caddy-networks.sh: tạo lại container là mất các network đấu thêm
    # tay, script kia nối lại.
    rssh "cd $DEPLOY_PATH && rm -f /tmp/deploy-build.log && nohup bash -c 'docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build > /tmp/deploy-build.log 2>&1; rc=\$?; if ! docker exec ordbl_caddy cat /etc/caddy/Caddyfile 2>/dev/null | diff -q - Caddyfile >/dev/null 2>&1; then echo \"[caddyfile] đổi rồi — tạo lại container caddy\" >> /tmp/deploy-build.log; docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate caddy >> /tmp/deploy-build.log 2>&1; fi; bash scripts/attach-caddy-networks.sh >> /tmp/deploy-build.log 2>&1; echo DEPLOY_DONE_EXIT=\$rc >> /tmp/deploy-build.log' >/dev/null 2>&1 & echo BUILD_STARTED"
    echo "✅ Đã start build. Theo dõi: ./deploy.sh --logs   |   Kiểm tra: ./deploy.sh --status" ;;
  *) echo "Dùng: ./deploy.sh [--logs|--status]"; exit 1 ;;
esac
