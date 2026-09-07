#!/usr/bin/env bash
# Chốt chặn sau deploy: domain thật phải đang nói chuyện với ĐÚNG stack vừa deploy.
#
# Vì sao cần (sự cố 2026-09-07): trên VPS này còn stack develop, và cả hai stack đều đặt tên
# service là `api`. Container Caddy dùng chung được đấu vào network của cả hai, nên Docker DNS
# phân giải `api` sang container nào là tuỳ network nào tới trước. Sáng đó nó chọn
# `ordbl_dev_api`: apex, admin và menu của production đều chạy trên backend + DATABASE DEV gần
# một tiếng. KHÔNG có lỗi nào — mọi request vẫn 200, health vẫn `ok`, log Caddy vẫn sạch. Chỉ
# có người dùng thấy "sai mật khẩu" vì đang tra vào database khác.
#
# `Caddyfile` giờ trỏ bằng tên container nên nhập nhằng đó hết. Script này là lớp thứ hai: nó
# không tin cấu hình, nó hỏi thẳng domain công khai xem ai đang trả lời.
#
# Dùng:
#   bash scripts/verify-env.sh                       # prod: đòi env=production
#   WANT_ENV=develop ENV_FILE=.env.dev bash scripts/verify-env.sh
#   HOSTS="dev.quanbalun.site" WANT_ENV=develop CURL_OPTS="-u dev:matkhau" bash …
set -uo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.production}"
WANT_ENV="${WANT_ENV:-production}"
TRIES="${TRIES:-6}"          # API vừa restart cần vài giây mới nhận request
SLEEP_S="${SLEEP_S:-10}"
read -r -a CURL_EXTRA <<< "${CURL_OPTS:-}"

if [ -n "${HOSTS:-}" ]; then
  read -r -a hosts <<< "$HOSTS"
else
  DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' ")
  [ -z "$DOMAIN" ] && { echo "[verify] ❌ không đọc được DOMAIN từ $ENV_FILE"; exit 1; }
  # Chỉ 2 host BẮT BUỘC. `menu.<domain>` là tuỳ chọn (DEPLOY.md mục 2) nên không đưa vào đây —
  # thiếu bản ghi đó không phải lỗi deploy.
  hosts=("$DOMAIN" "admin.$DOMAIN")
fi

# Lấy field env ra khỏi JSON health mà không cần jq (image/VPS không chắc có).
extract_env() { sed -n 's/.*"env"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' <<< "$1"; }

fail=0
for host in "${hosts[@]}"; do
  url="https://$host/api/public/health"
  got=''; body=''
  for i in $(seq 1 "$TRIES"); do
    body=$(curl -fsS --max-time 20 "${CURL_EXTRA[@]}" "$url" 2>&1) && got=$(extract_env "$body")
    [ "$got" = "$WANT_ENV" ] && break
    [ "$i" -lt "$TRIES" ] && sleep "$SLEEP_S"
  done

  if [ "$got" = "$WANT_ENV" ]; then
    echo "[verify] ✓ $host → env=$got"
  else
    echo "[verify] ❌ $host → env='${got:-<không có field env trong response>}', mong đợi '$WANT_ENV'"
    echo "[verify]    response: ${body:0:400}"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  cat <<'EOF'
[verify] ── Chẩn đoán ────────────────────────────────────────────────────────
[verify] Nhãn env sai nghĩa là domain đang được phục vụ bởi stack KHÁC, hoặc API
[verify] chạy bản cũ chưa có field `env` (deploy lại là hết), hoặc stack quên khai
[verify] biến APP_ENV (thiếu biến thì health cố tình trả `unknown`).
EOF
  echo "[verify] upstream mà Caddy phân giải được:"
  for name in ordbl_api ordbl_dev_api api; do
    echo "[verify]   $name → $(docker exec ordbl_caddy getent hosts "$name" 2>/dev/null | awk '{print $1}' || echo '(không phân giải được)')"
  done
  echo "[verify] container đang chạy:"
  docker ps --format '[verify]   {{.Names}}  {{.Status}}' 2>/dev/null
  echo "[verify] upstream khai trong Caddyfile ĐANG CHẠY (trong container, không phải trên đĩa):"
  docker exec ordbl_caddy grep -n 'reverse_proxy' /etc/caddy/Caddyfile 2>/dev/null | sed 's/^/[verify]   /'
  exit 1
fi

echo "[verify] ✓ tất cả host bắt buộc đều trả env=$WANT_ENV"
