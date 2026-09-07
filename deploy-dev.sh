#!/usr/bin/env bash
# Deploy STACK DEVELOP lên cùng VPS với production, tách hoàn toàn: checkout riêng
# (/opt/ordbl-dev), MySQL + volume riêng, container ordbl_dev_*, và một hàng rào
# basic auth trước mọi request. Xem DEPLOY.md mục 11.
#
# Credentials SSH dùng chung .env.deploy với deploy.sh (gitignored).
#
# Cách dùng:
#   ./deploy-dev.sh --init              # lần đầu: clone + sinh .env.dev + đặt mật khẩu
#   ./deploy-dev.sh                     # deploy nhánh mặc định (develop)
#   ./deploy-dev.sh feat/abc            # deploy một nhánh khác
#   ./deploy-dev.sh --logs              # 60 dòng log build gần nhất
#   ./deploy-dev.sh --status            # docker compose ps + trạng thái Caddy
#   ./deploy-dev.sh --api-logs          # log runtime của API dev (OTP in ra ở đây)
#   ./deploy-dev.sh --allow-setup       # mở /setup cho IP hiện tại của máy này
#   ./deploy-dev.sh --caddy             # chỉ render lại site block + reload Caddy
#   ./deploy-dev.sh --passwd            # đổi mật khẩu basic auth
#   ./deploy-dev.sh --down              # tắt stack dev (giữ nguyên data)
#   ./deploy-dev.sh --nuke              # XOÁ HẲN stack dev + DB dev + site block
#
# Yêu cầu máy local: sshpass (brew install hudochenkov/sshpass/sshpass)
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env.deploy ]]; then echo "❌ Thiếu .env.deploy (xem README/skill deploy-vps)"; exit 1; fi
# shellcheck disable=SC1091
source .env.deploy
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:?}" "${DEPLOY_PASS:?}" "${DEPLOY_PATH:?}"

# Checkout của stack dev — TÁCH khỏi $DEPLOY_PATH (checkout prod). Dùng chung một thư
# mục là mỗi lần deploy dev lại kéo prod sang nhánh develop, tức là đẩy code chưa
# duyệt lên trang quán. Override được trong .env.deploy.
DEV_PATH="${DEPLOY_DEV_PATH:-/opt/ordbl-dev}"
DEV_BRANCH_DEFAULT="${DEPLOY_DEV_BRANCH:-develop}"
DEV_NETWORK=ordbl_dev_frontend
DC="docker compose -f docker-compose.dev.yml --env-file .env.dev"
BUILD_LOG=/tmp/deploy-dev-build.log
POST_SCRIPT=/tmp/ordbl-dev-post.sh

# SSH có retry — sshd VPS đôi khi rate-limit khi kết nối liên tiếp (fail2ban).
# Script chạy từ stdin (`bash -s`) để không phải escape nhiều tầng dấu nháy.
rrun() {
  local script="$1" out
  for i in 1 2 3 4 5; do
    out=$(SSHPASS="$DEPLOY_PASS" sshpass -e ssh -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=20 -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "bash -s" \
      <<< "$script" 2>&1) && { echo "$out"; return 0; }
    if echo "$out" | grep -q "Permission denied (publickey,password"; then
      echo "  … lần $i bị từ chối, đợi 8s" >&2; sleep 8; continue
    fi
    echo "$out"; return 1
  done
  echo "❌ SSH thất bại sau 5 lần (kiểm tra mật khẩu / fail2ban)"; return 1
}

require_stack() {
  rrun "test -f $DEV_PATH/.env.dev" >/dev/null 2>&1 || {
    echo "❌ Chưa có stack dev ở $DEV_PATH. Chạy: ./deploy-dev.sh --init"; exit 1; }
}

# Mật khẩu đi vào remote script bên trong dấu nháy đơn — có ' là vỡ cú pháp.
# Từ chối thẳng thay vì escape cho khéo rồi sai âm thầm.
#
# Đặt sẵn biến môi trường DEV_PASSWORD thì bỏ qua phần hỏi — cần cho lúc chạy script
# từ chỗ không có terminal (CI, hoặc agent chạy hộ).
read_password() {
  if [[ -n "${DEV_PASSWORD:-}" ]]; then
    PW1="$DEV_PASSWORD"
  else
    read -rsp "  Mật khẩu: " PW1; echo
    read -rsp "  Nhập lại: " PW2; echo
    [[ "$PW1" == "$PW2" ]] || { echo "❌ Hai lần nhập khác nhau"; exit 1; }
  fi
  # Ngưỡng 12 ký tự là MẶC ĐỊNH, không phải luật: site dev nằm ngoài internet và basic auth là
  # hàng rào duy nhất của nó, nên mật khẩu đoán được là cửa mở. Ai cố ý muốn mật khẩu ngắn
  # (ví dụ dev/dev cho tiện gõ trên điện thoại) thì phải nói ra bằng ALLOW_WEAK_DEV_PASSWORD=1
  # — để lựa chọn đó nằm trong lệnh, chứ không nằm trong một dòng if bị sửa lặng lẽ.
  if [[ ${#PW1} -lt 12 && -z "${ALLOW_WEAK_DEV_PASSWORD:-}" ]]; then
    echo "❌ Phải ≥ 12 ký tự — đây là hàng rào DUY NHẤT của server dev."
    echo "   Vẫn muốn dùng mật khẩu ngắn: ALLOW_WEAK_DEV_PASSWORD=1 ./deploy-dev.sh --passwd"
    exit 1
  fi
  [[ ${#PW1} -ge 12 ]] || echo "⚠ Mật khẩu ngắn ($((${#PW1})) ký tự) — chấp nhận vì ALLOW_WEAK_DEV_PASSWORD=1"
  [[ "$PW1" != *"'"* ]] || { echo "❌ Không dùng dấu nháy đơn ( ' ) trong mật khẩu"; exit 1; }
}

# ── Render site block dev vào caddy-local của PROD + reload Caddy ────────────
# Sinh ra một script chạy trên server. Cả deploy lẫn --passwd đều dùng.
# `caddy reload` thất bại thì Caddy GIỮ NGUYÊN config đang chạy — trang quán không
# sập vì một lỗi cú pháp bên dev.
render_caddy_script() {
  cat <<REMOTE
set -euo pipefail
cd "$DEV_PATH"

# ĐỌC bằng grep, KHÔNG \`source\`. Hash bcrypt có dạng \$2a\$14\$… — \`source\` là bash bung
# \`\$2a\` và \`\$14\` thành tham số vị trí, và với \`set -u\` thì gãy ngay tại đó
# ("line 3: \$2: unbound variable"). Đây là env file, không phải script; đừng chạy nó.
# \\x27 / \\x22 = nháy đơn / nháy kép, viết dạng mã để KHÔNG có dấu nháy thật nào trong
# biểu thức — chuỗi này đi qua hai tầng heredoc trước khi tới server, và tầng escape đó
# đã một lần biến \\" thành \\\\" làm script gãy ở dòng này.
envget() { grep -E "^\$1=" .env.dev | head -1 | cut -d= -f2- | sed -e 's/^[\x27\x22]//' -e 's/[\x27\x22]\$//'; }
DOMAIN="\$(envget DOMAIN)"
DEV_AUTH_USER="\$(envget DEV_AUTH_USER)"
DEV_AUTH_HASH="\$(envget DEV_AUTH_HASH)"
: "\${DOMAIN:?thiếu DOMAIN trong .env.dev}"
: "\${DEV_AUTH_HASH:?thiếu DEV_AUTH_HASH — server dev không được chạy khi không có basic auth}"

# Chưa có DNS mà đã bật site block là Caddy lao vào xin cert rồi trượt liên tục — mỗi
# hostname chỉ được 5 lần thẩm định hỏng mỗi giờ. Cert của mỗi tên được xin RIÊNG, nên một
# tên chưa có DNS không kéo theo tên kia: có tên nào phân giải được thì cứ bật, chỉ cảnh
# báo tên còn thiếu. Không tên nào phân giải được thì bỏ qua hẳn, chưa có gì để phục vụ.
MISSING=""; RESOLVED=""
for H in "dev.\$DOMAIN" "admin.dev.\$DOMAIN"; do
  if getent hosts "\$H" >/dev/null 2>&1; then RESOLVED="\$RESOLVED \$H"; else MISSING="\$MISSING \$H"; fi
done
if [ -z "\$RESOLVED" ] && [ -z "\${ORDBL_FORCE_CADDY:-}" ]; then
  echo "[dev] ⏭  BỎ QUA phần Caddy — chưa phân giải được tên nào:\$MISSING"
  echo "[dev]    Thêm bản ghi A trỏ về IP VPS rồi chạy: ./deploy-dev.sh --caddy"
  exit 0
fi
[ -n "\$MISSING" ] && echo "[dev] ⚠ chưa có DNS cho:\$MISSING — tên này sẽ 'không mở được' cho tới khi thêm bản ghi A"

DEST="$DEPLOY_PATH/caddy-local/dev.caddy"
mkdir -p "$DEPLOY_PATH/caddy-local"
sed -e "s|__DOMAIN__|\$DOMAIN|g" \
    -e "s|__AUTH_USER__|\${DEV_AUTH_USER:-dev}|g" \
    -e "s|__AUTH_HASH__|\$DEV_AUTH_HASH|g" \
    Caddyfile.dev > "\$DEST"
echo "[dev] ✓ đã ghi caddy-local/dev.caddy"

# Ghi tên network vào danh sách của prod TRƯỚC khi connect: mỗi lần deploy prod tạo
# lại container Caddy là mọi network đấu tay biến mất, attach-caddy-networks.sh đọc
# file này để đấu lại. Thiếu bước này thì dev chết âm thầm sau lần deploy prod kế tiếp.
LIST="$DEPLOY_PATH/caddy-extra-networks.txt"
touch "\$LIST"
grep -qxF "$DEV_NETWORK" "\$LIST" || echo "$DEV_NETWORK" >> "\$LIST"
docker network connect "$DEV_NETWORK" ordbl_caddy 2>/dev/null \
  && echo "[dev] ✓ đã đấu ordbl_caddy vào $DEV_NETWORK" \
  || echo "[dev] = ordbl_caddy đã nằm sẵn trong $DEV_NETWORK"

# \`basic_auth\` là tên directive từ Caddy 2.8; bản cũ hơn gọi là \`basicauth\`.
# Validate trước, và chỉ khi Caddy chê đúng directive đó mới đổi tên — không đoán mò.
if ! OUT=\$(docker exec ordbl_caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then
  if echo "\$OUT" | grep -q "basic_auth"; then
    sed -i "s|basic_auth {|basicauth {|" "\$DEST"
    echo "[dev] ! Caddy đời cũ — đã đổi basic_auth → basicauth"
    docker exec ordbl_caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    echo "\$OUT"; echo "[dev] ❌ config Caddy không hợp lệ — gỡ dev.caddy để prod không bị ảnh hưởng"
    rm -f "\$DEST"; exit 1
  fi
fi

docker exec ordbl_caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
  && echo "[dev] ✓ Caddy đã reload" \
  || { echo "[dev] ❌ Caddy từ chối config mới — config cũ vẫn chạy, prod không sao."; exit 1; }
REMOTE
}

# Đẩy script hậu-build lên server rồi chạy nó (dùng khi không cần đợi build).
push_post_script() {
  local post; post="$(render_caddy_script)"
  rrun "cat > $POST_SCRIPT <<'ORDBL_POST_EOF'
$post
ORDBL_POST_EOF
chmod +x $POST_SCRIPT"
}

case "${1:-deploy}" in

  # ── Lần đầu ───────────────────────────────────────────────────────────────
  --init)
    echo "▶ Đặt mật khẩu basic auth cho server dev (chỉ mình bạn biết)"
    read_password
    if [[ -n "${DEV_USERNAME:-}" ]]; then DEV_USER="$DEV_USERNAME"
    else read -rp "  Username [dev]: " DEV_USER || true; fi
    DEV_USER="${DEV_USER:-dev}"

    echo "▶ Clone + dựng .env.dev trên VPS…"
    rrun "set -euo pipefail
ORIGIN=\$(git -C $DEPLOY_PATH remote get-url origin)
if [ ! -d $DEV_PATH/.git ]; then
  git clone \"\$ORIGIN\" $DEV_PATH
  echo \"[dev] ✓ đã clone \$ORIGIN → $DEV_PATH\"
else
  echo '[dev] = $DEV_PATH đã tồn tại, giữ nguyên'
fi
cd $DEV_PATH
mkdir -p uploads/menu

if [ -f .env.dev ]; then
  echo '[dev] = .env.dev đã có — KHÔNG ghi đè (secrets cũ giữ nguyên)'
else
  DOM=\$(grep -E '^DOMAIN=' $DEPLOY_PATH/.env.production | head -1 | cut -d= -f2- | tr -d '\"' | tr -d \"'\")
  : \"\${DOM:?không đọc được DOMAIN từ .env.production của prod}\"
  HASH=\$(docker run --rm caddy:2-alpine caddy hash-password --plaintext '$PW1')
  cat > .env.dev <<ENVEOF
DOMAIN=\$DOM
DEV_AUTH_USER=$DEV_USER
DEV_AUTH_HASH='\$HASH'
MYSQL_ROOT_PASSWORD=\$(openssl rand -base64 48 | tr -d /=+ | cut -c1-32)
MYSQL_DATABASE=order_quan_balun_dev
MYSQL_USER=ordbl_dev
MYSQL_PASSWORD=\$(openssl rand -base64 48 | tr -d /=+ | cut -c1-32)
JWT_SECRET=\$(openssl rand -base64 64 | tr -d /=+ | cut -c1-64)
JWT_LIFETIME_DAYS=7
COOKIE_NAME=ssp_token_dev
COOKIE_SECURE=true
ALLOWED_ORIGIN=https://dev.\$DOM,https://admin.dev.\$DOM
SETUP_ALLOWED_IP=127.0.0.1
IP_HASH_SALT=\$(openssl rand -base64 32 | tr -d /=+ | cut -c1-32)
SMS_DRIVER=console
OTP_CHANNEL=log
ENVEOF
  chmod 600 .env.dev
  echo '[dev] ✓ đã sinh .env.dev (secrets random, KHÁC prod)'
  grep '^DOMAIN=' .env.dev
fi"
    echo
    echo "✅ Xong bước init. Tiếp theo:"
    echo "   1. Tạo 2 bản ghi A trỏ về IP VPS:  dev.<domain>  và  admin.dev.<domain>"
    echo "   2. Đợi DNS phân giải xong:  dig +short A dev.<domain>"
    echo "   3. git push origin $DEV_BRANCH_DEFAULT   (nhánh phải có trên GitHub)"
    echo "   4. ./deploy-dev.sh"
    echo "   5. ./deploy-dev.sh --allow-setup   rồi mở https://admin.dev.<domain>/setup"
    ;;

  # ── Xem log / trạng thái ──────────────────────────────────────────────────
  --logs)     require_stack; rrun "tail -n 60 $BUILD_LOG" ;;
  --api-logs) require_stack; rrun "cd $DEV_PATH && $DC logs --tail 80 api" ;;
  --status)
    require_stack
    rrun "cd $DEV_PATH && $DC ps
echo
echo '── Caddy đang nằm trong những network nào ──'
docker inspect ordbl_caddy -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'
echo '── Site block dev ──'
ls -l $DEPLOY_PATH/caddy-local/dev.caddy 2>/dev/null || echo '(chưa có)'" ;;

  # ── Mở /setup cho IP hiện tại ─────────────────────────────────────────────
  --allow-setup)
    require_stack
    MYIP=$(curl -fsS --max-time 10 https://api.ipify.org)
    [[ -n "$MYIP" ]] || { echo "❌ Không lấy được IP công cộng"; exit 1; }
    echo "▶ IP hiện tại: $MYIP → cập nhật SETUP_ALLOWED_IP trên dev"
    rrun "set -euo pipefail
cd $DEV_PATH
sed -i 's|^SETUP_ALLOWED_IP=.*|SETUP_ALLOWED_IP=$MYIP,127.0.0.1|' .env.dev
grep '^SETUP_ALLOWED_IP=' .env.dev
$DC up -d api
echo '[dev] ✓ đã restart api với IP mới'"
    echo "✅ Mở https://admin.dev.<domain>/setup (nhập basic auth trước)"
    ;;

  # ── Chỉ dựng lại phần Caddy (dùng sau khi DNS đã lên) ─────────────────────
  --caddy)
    require_stack
    push_post_script
    rrun "ORDBL_FORCE_CADDY=${ORDBL_FORCE_CADDY:-} bash $POST_SCRIPT"
    ;;

  # ── Đổi mật khẩu basic auth ───────────────────────────────────────────────
  --passwd)
    require_stack
    echo "▶ Đổi mật khẩu basic auth"
    read_password
    rrun "set -euo pipefail
cd $DEV_PATH
HASH=\$(docker run --rm caddy:2-alpine caddy hash-password --plaintext '$PW1')
sed -i \"s|^DEV_AUTH_HASH=.*|DEV_AUTH_HASH='\$HASH'|\" .env.dev
echo '[dev] ✓ đã đổi hash trong .env.dev'"
    push_post_script
    rrun "bash $POST_SCRIPT"
    echo "✅ Mật khẩu mới có hiệu lực ngay."
    ;;

  # ── Tắt / xoá ─────────────────────────────────────────────────────────────
  --down)
    require_stack
    rrun "cd $DEV_PATH && $DC down && echo '[dev] ✓ đã tắt stack (volume DB giữ nguyên)'"
    ;;
  --nuke)
    echo "⚠️  Xoá HẲN: container dev, volume DB dev, uploads dev, site block dev."
    read -rp "   Gõ 'NUKE' để xác nhận: " C
    [[ "$C" == "NUKE" ]] || { echo "Huỷ."; exit 1; }
    rrun "set -uo pipefail
cd $DEV_PATH && $DC down -v
rm -rf $DEV_PATH/uploads
rm -f $DEPLOY_PATH/caddy-local/dev.caddy
sed -i '/^$DEV_NETWORK\$/d' $DEPLOY_PATH/caddy-extra-networks.txt 2>/dev/null || true
docker network rm $DEV_NETWORK 2>/dev/null || true
docker exec ordbl_caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo '[dev] ✓ đã dọn sạch'"
    ;;

  -*)
    echo "Dùng: ./deploy-dev.sh [nhánh|--init|--logs|--api-logs|--status|--caddy|--allow-setup|--passwd|--down|--nuke]"
    exit 1 ;;

  # ── Deploy (mặc định) ─────────────────────────────────────────────────────
  *)
    require_stack
    REF="${1:-$DEV_BRANCH_DEFAULT}"
    echo "▶ Ref: $REF → $DEV_PATH"
    # Nhận CẢ tên nhánh lẫn commit SHA. CI truyền SHA vì giữa lúc job xếp hàng có thể đã có
    # commit mới hơn — deploy "nhánh develop" khi đó là đẩy lên một commit chưa qua CI.
    rrun "set -euo pipefail
cd $DEV_PATH
git fetch origin --prune --tags
if git rev-parse --verify --quiet origin/$REF >/dev/null; then
  git checkout -B $REF origin/$REF
  git reset --hard origin/$REF
elif git cat-file -e '$REF^{commit}' 2>/dev/null; then
  git checkout --detach $REF
else
  echo '❌ Không tìm thấy nhánh lẫn commit \"$REF\" trên origin — push lên GitHub trước'; exit 1
fi
git log --oneline -1"

    # Render Caddy chạy SAU khi build xong (cùng tiến trình nền), giống cách deploy.sh
    # gọi attach-caddy-networks.sh: có upstream rồi mới cho Caddy trỏ vào.
    push_post_script

    echo "▶ Build + start (chạy nền, log $BUILD_LOG)…"
    rrun "cd $DEV_PATH && rm -f $BUILD_LOG && nohup bash -c '$DC up -d --build > $BUILD_LOG 2>&1; rc=\$?; if [ \$rc -eq 0 ]; then bash $POST_SCRIPT >> $BUILD_LOG 2>&1 || rc=\$?; fi; echo DEPLOY_DEV_DONE_EXIT=\$rc >> $BUILD_LOG' </dev/null >/dev/null 2>&1 & echo BUILD_STARTED"

    echo "✅ Đã start build. Theo dõi: ./deploy-dev.sh --logs   |   Kiểm tra: ./deploy-dev.sh --status"
    ;;
esac
