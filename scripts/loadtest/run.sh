#!/usr/bin/env bash
# Chạy load test trên VPS, đánh THẲNG vào container api (bỏ qua Caddy).
#
# Vì sao bỏ qua Caddy: Caddyfile ghi đè X-Forwarded-For bằng IP thật của client, nên qua Caddy thì
# 100 VU vẫn là 1 IP và throttle 10 đơn/phút chặn ngay. Xem đầu file loadtest.mjs.
#
# Máy sinh tải chạy trong container `node:20-alpine` dùng-rồi-xoá, gắn vào network
# orderquanbalun_frontend. KHÔNG cài gì lên host VPS.
#
# Dùng:
#   ./scripts/loadtest/run.sh                          # mixed, 100 VU, 60s
#   VUS=10 DURATION_S=30 ./scripts/loadtest/run.sh     # thử nhỏ trước
#   SCENARIO=browse VUS=200 ./scripts/loadtest/run.sh  # chỉ đường đọc, không tạo đơn
#   ./scripts/loadtest/run.sh --stats                  # xem docker stats trong lúc chạy (terminal khác)
#   ./scripts/loadtest/run.sh --count                  # đếm đơn test đang nằm trong DB
#   ./scripts/loadtest/run.sh --cleanup                # XOÁ đơn test (hỏi xác nhận)
set -euo pipefail
cd "$(dirname "$0")/../.."

[[ -f .env.deploy ]] || { echo "❌ Thiếu .env.deploy"; exit 1; }
# shellcheck disable=SC1091
source .env.deploy
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:?}" "${DEPLOY_PASS:?}" "${DEPLOY_PATH:?}"

NET=orderquanbalun_frontend
PHONE_PREFIX="${PHONE_PREFIX:-0999}"

# sshd của VPS đôi khi rate-limit khi kết nối liên tiếp (fail2ban) — retry giống deploy.sh.
rssh() {
  local out
  for i in 1 2 3 4 5; do
    out=$(SSHPASS="$DEPLOY_PASS" sshpass -e ssh -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=20 -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "$1" 2>&1) && { echo "$out"; return 0; }
    if echo "$out" | grep -q "Permission denied"; then echo "  … lần $i bị từ chối, đợi 8s" >&2; sleep 8; continue; fi
    echo "$out"; return 1
  done
  echo "❌ SSH thất bại sau 5 lần"; return 1
}

# mysql chạy trong container, root password nằm ở .env.production TRÊN SERVER — không kéo về local.
#
# KHÔNG `source .env.production`: file có dòng chứa ký tự đặc biệt, shell cố thực thi nó và bắn
# "command not found" ra giữa kết quả. Chỉ cần đúng 2 biến nên cắt thẳng bằng sed, không qua shell.
mysql_q() {
  rssh "cd $DEPLOY_PATH && \
    P=\$(sed -n 's/^MYSQL_ROOT_PASSWORD=//p' .env.production | head -1) && \
    D=\$(sed -n 's/^MYSQL_DATABASE=//p' .env.production | head -1) && \
    docker exec ordbl_mysql mysql -u root -p\"\$P\" \"\$D\" -N -B -e \"$1\" 2>/dev/null"
}

case "${1:-run}" in
  --stats)
    echo "▶ docker stats (Ctrl-C để thoát) — theo dõi ordbl_api CPU/RAM"
    SSHPASS="$DEPLOY_PASS" sshpass -e ssh -t -o StrictHostKeyChecking=accept-new \
      -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "docker stats ordbl_api ordbl_mysql ordbl_caddy"
    ;;

  --count)
    echo "▶ Đơn test (SĐT ${PHONE_PREFIX}%) đang nằm trong DB:"
    mysql_q "SELECT status, COUNT(*) FROM online_order_requests WHERE customer_phone LIKE '${PHONE_PREFIX}%' GROUP BY status;"
    echo "▶ Tổng đơn THẬT (không phải test):"
    mysql_q "SELECT COUNT(*) FROM online_order_requests WHERE customer_phone NOT LIKE '${PHONE_PREFIX}%';"
    ;;

  --cleanup)
    echo "⚠️  Sắp XOÁ mọi đơn có SĐT bắt đầu bằng '${PHONE_PREFIX}' khỏi online_order_requests."
    mysql_q "SELECT COUNT(*) FROM online_order_requests WHERE customer_phone LIKE '${PHONE_PREFIX}%';" \
      | sed 's/^/   số dòng sẽ xoá: /'
    read -r -p "   Gõ XOA để xác nhận: " ans
    [[ "$ans" == "XOA" ]] || { echo "Huỷ."; exit 0; }
    mysql_q "DELETE FROM online_order_requests WHERE customer_phone LIKE '${PHONE_PREFIX}%';"
    echo "✅ Đã xoá. Còn lại:"
    mysql_q "SELECT COUNT(*) FROM online_order_requests WHERE customer_phone LIKE '${PHONE_PREFIX}%';"
    ;;

  run)
    echo "▶ Copy máy sinh tải lên VPS…"
    SSHPASS="$DEPLOY_PASS" sshpass -e scp -o StrictHostKeyChecking=accept-new \
      -P "$DEPLOY_PORT" scripts/loadtest/loadtest.mjs "$DEPLOY_USER@$DEPLOY_HOST:/tmp/loadtest.mjs" >/dev/null
    # ${NET} phải có ngoặc nhọn: ký tự "…" ngay sau đó bị bash gộp vào tên biến.
    echo "▶ Chạy trong container node:20-alpine trên network ${NET}…"
    rssh "docker run --rm --network $NET -v /tmp/loadtest.mjs:/lt.mjs:ro \
      -e BASE='${BASE:-http://api:3001}' \
      -e ORIGIN='${ORIGIN:-https://quanbalun.site}' \
      -e SCENARIO='${SCENARIO:-mixed}' \
      -e VUS='${VUS:-100}' \
      -e DURATION_S='${DURATION_S:-60}' \
      -e RAMP_S='${RAMP_S:-0}' \
      -e PHONE_PREFIX='${PHONE_PREFIX}' \
      node:20-alpine node /lt.mjs"
    ;;

  *) echo "Dùng: $0 [--stats|--count|--cleanup]"; exit 1 ;;
esac
