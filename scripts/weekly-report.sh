#!/usr/bin/env bash
# Báo cáo sức khoẻ hệ thống hàng tuần — chạy TRÊN VPS, in ra Markdown (stdout).
#
# Dùng:
#   bash scripts/weekly-report.sh              # in ra màn hình
#   bash scripts/weekly-report.sh > bc.md      # lưu file
#
# Vì sao script nằm trong repo chứ không phải gõ tay trên server: VPS này thỉnh thoảng bị cài
# lại (đổi cả IP lẫn mật khẩu). Mọi thứ gõ tay vào server đều mất theo, và mất IM LẶNG — cùng
# lý do mà backup MySQL được làm thành sidecar trong compose chứ không phải cron host
# (xem đầu scripts/mysql-backup.sh). Ở trong git thì `git pull` là nó có lại.
#
# Nguồn số liệu, và vì sao chọn nguồn đó:
#   - CPU/RAM 7 ngày: sar (gói sysstat, cài 2026-09-14, thu mỗi 10 phút, giữ 30 ngày).
#     Trước khi có sysstat, câu hỏi "tuần qua server có gánh nổi không" KHÔNG trả lời được —
#     chỉ đọc được snapshot tại thời điểm gõ lệnh, mà lúc gõ thì luôn là giờ vắng khách.
#   - MySQL: SHOW GLOBAL STATUS là bộ đếm CỘNG DỒN từ lúc mysqld khởi động, nên số thô vô
#     nghĩa cho báo cáo "trong tuần". Script lưu giá trị lần chạy trước vào STATE_FILE rồi
#     báo cáo phần CHÊNH. Lần chạy đầu tiên không có mốc so → in "lần đầu, chưa có mốc".
#   - Tải nghiệp vụ: đếm thẳng trong DB. Đây mới là thứ nói được "server chịu tải tốt không"
#     có ý nghĩa — CPU 5% khi quán ế không chứng minh được gì.
set -uo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/orderquanbalun}"
STATE_FILE="${STATE_FILE:-/var/lib/ordbl-weekly-report.state}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-ordbl_mysql}"
API_CONTAINER="${API_CONTAINER:-ordbl_api}"
CADDY_CONTAINER="${CADDY_CONTAINER:-ordbl_caddy}"
DB_NAME="${DB_NAME:-order_quan_balun}"

# Ngưỡng cảnh báo. Đặt thành biến để sau này chỉnh mà không phải lần trong thân script.
WARN_CPU_PCT="${WARN_CPU_PCT:-70}"      # %util trung bình giờ cao điểm
WARN_RAM_PCT="${WARN_RAM_PCT:-85}"      # %memused đỉnh
WARN_SWAP_MB="${WARN_SWAP_MB:-1024}"    # swap đang dùng
WARN_DISK_PCT="${WARN_DISK_PCT:-80}"
WARN_CONN_PCT="${WARN_CONN_PCT:-70}"    # Max_used_connections / max_connections

WARNINGS=()
warn() { WARNINGS+=("$1"); }

# Nhóm hàng nghìn kiểu Việt (1.234.567). printf "%'d" phụ thuộc locale, mà script cố tình
# chạy dưới LC_ALL=C để sar in ổn định — nên tự nhóm bằng sed.
fmt() { echo "${1:-0}" | sed -e :a -e 's/\(.*[0-9]\)\([0-9]\{3\}\)/\1.\2/;ta'; }

# Chạy 1 câu SQL, trả về dòng thô (không header). Nuốt dòng "Using a password..." của client.
sql() {
  docker exec "$MYSQL_CONTAINER" bash -c \
    "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" ${2:-} -N -B -e \"$1\"" 2>/dev/null \
    | grep -v '^mysql: \[Warning\]' || true
}
sqldb() { sql "$1" "$DB_NAME"; }

# Bộ đếm SHOW GLOBAL STATUS theo tên.
gstatus() { sql "SHOW GLOBAL STATUS LIKE '$1'" | awk '{print $2}'; }
gvar()    { sql "SELECT @@$1"; }

echo "# Báo cáo hệ thống — Quán Bà Lùn"
echo
echo "**Chạy lúc:** $(date '+%A, %d/%m/%Y %H:%M %Z')  "
echo "**Kỳ báo cáo:** 7 ngày gần nhất"
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 1. Máy chủ"
echo
UP=$(uptime -p 2>/dev/null || uptime)
CORES=$(nproc)
echo "- Uptime: ${UP#up }"
echo "- CPU: ${CORES} nhân — $(lscpu | sed -n 's/^Model name: *//p' | head -1)"
echo "- Load average: $(awk '{print $1", "$2", "$3}' /proc/loadavg) (trên ${CORES} nhân)"
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 2. CPU & RAM 7 ngày qua"
echo
if ! command -v sar >/dev/null 2>&1; then
  echo "> ⚠️ Chưa cài \`sysstat\` — không có dữ liệu lịch sử. Cài: \`apt install sysstat\`"
  warn "Chưa cài sysstat, không đo được CPU/RAM lịch sử"
else
  SA_DIR=/var/log/sysstat
  [ -d "$SA_DIR" ] || SA_DIR=/var/log/sa
  export LC_ALL=C   # ép sar in giờ 24h + dấu chấm thập phân, để awk cắt cột đoán được
  echo "| Ngày | CPU tb | CPU đỉnh | RAM đỉnh | Swap đỉnh |"
  echo "|---|---|---|---|---|"
  PEAK_CPU=0; PEAK_RAM=0
  for i in 6 5 4 3 2 1 0; do
    LABEL=$(date -d "$i days ago" '+%d/%m') || continue
    # sysstat đổi cách đặt tên file theo HISTORY: ≤28 ngày thì `saDD` (ghi đè theo vòng tháng),
    # >28 ngày thì `saYYYYMMDD`. HISTORY ở máy này là 30 nên là dạng thứ hai — nhưng thử cả
    # hai, vì cấu hình có thể bị đổi lại mà không ai sửa script.
    F="$SA_DIR/sa$(date -d "$i days ago" '+%Y%m%d')"
    [ -f "$F" ] || F="$SA_DIR/sa$(date -d "$i days ago" '+%d')"
    [ -f "$F" ] || { echo "| $LABEL | _chưa có dữ liệu_ | | | |"; continue; }

    # Dòng dữ liệu nhận diện bằng cột 1 là mốc giờ HH:MM:SS — cách này loại sạch dòng tiêu đề,
    # dòng "LINUX RESTART" và dòng trống mà không phải đếm số dòng.
    T='$1 ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/'
    CPU_AVG=$(sar -u -f "$F" 2>/dev/null | awk '/^Average:/ {printf "%.1f", 100-$NF}')
    CPU_MAX=$(sar -u -f "$F" 2>/dev/null | awk "$T"' && $2=="all" {u=100-$NF; if(u>m) m=u} END{printf "%.1f", m}')
    RAM_MAX=$(sar -r -f "$F" 2>/dev/null | awk "$T"' && $5 ~ /^[0-9.]+$/ {if($5+0>m) m=$5+0} END{printf "%.1f", m}')
    SWAP_MAX=$(sar -S -f "$F" 2>/dev/null | awk "$T"' && $3 ~ /^[0-9]+$/ {if($3+0>m) m=$3+0} END{printf "%.0f", m/1024}')

    echo "| $LABEL | ${CPU_AVG:-?}% | ${CPU_MAX:-?}% | ${RAM_MAX:-?}% | ${SWAP_MAX:-?} MB |"
    awk -v a="${CPU_MAX:-0}" -v b="$PEAK_CPU" 'BEGIN{exit !(a>b)}' && PEAK_CPU=${CPU_MAX:-0}
    awk -v a="${RAM_MAX:-0}" -v b="$PEAK_RAM" 'BEGIN{exit !(a>b)}' && PEAK_RAM=${RAM_MAX:-0}
  done
  echo
  awk -v v="$PEAK_CPU" -v t="$WARN_CPU_PCT" 'BEGIN{exit !(v>t)}' \
    && warn "CPU đỉnh tuần ${PEAK_CPU}% vượt ngưỡng ${WARN_CPU_PCT}%"
  awk -v v="$PEAK_RAM" -v t="$WARN_RAM_PCT" 'BEGIN{exit !(v>t)}' \
    && warn "RAM đỉnh tuần ${PEAK_RAM}% vượt ngưỡng ${WARN_RAM_PCT}%"
fi

echo "**Hiện tại:**"
echo '```'
free -h
echo '```'
SWAP_NOW=$(free -m | awk '/^Swap:/ {print $3}')
[ "${SWAP_NOW:-0}" -gt "$WARN_SWAP_MB" ] && warn "Swap đang dùng ${SWAP_NOW}MB (ngưỡng ${WARN_SWAP_MB}MB) — RAM đã chật"
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 3. Ổ đĩa"
echo
echo '```'
df -h / | sed -n '1p;2p'
echo '```'
DISK_PCT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
[ "${DISK_PCT:-0}" -gt "$WARN_DISK_PCT" ] && warn "Ổ đĩa đã dùng ${DISK_PCT}% (ngưỡng ${WARN_DISK_PCT}%)"
BK=$(ls -1 "$DEPLOY_PATH"/backups/*.sql.gz 2>/dev/null | wc -l)
BK_LAST=$(ls -1t "$DEPLOY_PATH"/backups/*.sql.gz 2>/dev/null | head -1)
if [ -n "$BK_LAST" ]; then
  echo "- Backup DB: **$BK** bản, mới nhất $(date -r "$BK_LAST" '+%d/%m %H:%M') ($(du -h "$BK_LAST" | cut -f1))"
  # Backup chạy hằng ngày; quá 48h không có bản mới là sidecar đã chết mà không ai biết.
  AGE_H=$(( ( $(date +%s) - $(date -r "$BK_LAST" +%s) ) / 3600 ))
  [ "$AGE_H" -gt 48 ] && warn "Backup DB mới nhất đã ${AGE_H} giờ trước — kiểm tra container ordbl_mysql_backup"
else
  warn "KHÔNG tìm thấy backup DB nào trong $DEPLOY_PATH/backups"
  echo "- Backup DB: ⚠️ không tìm thấy bản nào"
fi
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 4. Container"
echo
echo "| Container | Trạng thái | Số lần restart | RAM |"
echo "|---|---|---|---|"
for C in "$CADDY_CONTAINER" "$API_CONTAINER" "$MYSQL_CONTAINER" ordbl_mysql_backup; do
  docker inspect "$C" >/dev/null 2>&1 || { echo "| $C | ⚠️ không tồn tại | | |"; warn "Container $C không tồn tại"; continue; }
  ST=$(docker inspect "$C" --format '{{.State.Status}}')
  RC=$(docker inspect "$C" --format '{{.RestartCount}}')
  MEM=$(docker stats --no-stream --format '{{.MemUsage}}' "$C" 2>/dev/null | awk '{print $1}')
  MARK=""; [ "$ST" != "running" ] && { MARK=" ⚠️"; warn "Container $C đang ở trạng thái '$ST'"; }
  [ "${RC:-0}" -gt 0 ] && warn "Container $C đã restart ${RC} lần — kiểm tra log"
  echo "| $C | ${ST}${MARK} | ${RC} | ${MEM:-?} |"
done
echo
ERR=$(docker logs --since 168h "$API_CONTAINER" 2>&1 | grep -ci 'error\|exception' || true)
echo "- Log API 7 ngày: **${ERR}** dòng có \`error\`/\`exception\`"
[ "${ERR:-0}" -gt 100 ] && warn "Log API có ${ERR} dòng lỗi trong tuần"
OOM=$(dmesg -T 2>/dev/null | grep -ci 'out of memory\|killed process' || true)
echo "- OOM kill (từ lúc boot): **${OOM:-0}**"
[ "${OOM:-0}" -gt 0 ] && warn "Có ${OOM} lần OOM kill — RAM không đủ"
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 5. MySQL"
echo
MAXCONN=$(gvar max_connections)
USEDCONN=$(gstatus Max_used_connections)
Q=$(gstatus Questions); SLOW=$(gstatus Slow_queries); UPS=$(gstatus Uptime)
BPR=$(gstatus Innodb_buffer_pool_reads); BPRR=$(gstatus Innodb_buffer_pool_read_requests)
LOCKW=$(gstatus Table_locks_waited)

if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  # mysqld restart giữa hai lần chạy → bộ đếm về 0, phép trừ ra số âm vô nghĩa. Uptime nhỏ hơn
  # lần trước là dấu hiệu chắc chắn của việc đó.
  if [ "${UPS:-0}" -lt "${PREV_UPTIME:-0}" ]; then
    echo "> ℹ️ MySQL đã khởi động lại trong tuần — bộ đếm reset, không so được với tuần trước."
    warn "MySQL đã restart trong tuần (uptime ${UPS}s < tuần trước ${PREV_UPTIME}s)"
    DELTA_NOTE="(từ lúc MySQL khởi động lại)"
    DQ=$Q; DSLOW=$SLOW
  else
    DQ=$(( ${Q:-0} - ${PREV_Q:-0} )); DSLOW=$(( ${SLOW:-0} - ${PREV_SLOW:-0} ))
    DELTA_NOTE="(chênh so với báo cáo tuần trước)"
  fi
  SECS=$(( ${UPS:-0} - ${PREV_UPTIME:-0} )); [ "$SECS" -le 0 ] && SECS=${UPS:-1}
  echo "| Chỉ số | Trong kỳ $DELTA_NOTE |"
  echo "|---|---|"
  echo "| Truy vấn | $(fmt "$DQ") (~$(( DQ / (SECS>0?SECS:1) )) query/giây) |"
  echo "| Truy vấn chậm | $DSLOW |"
  [ "${DSLOW:-0}" -gt 500 ] && warn "Có $DSLOW truy vấn chậm trong kỳ"
else
  echo "> ℹ️ Lần chạy đầu tiên — chưa có mốc so sánh. Báo cáo tuần sau sẽ có phần chênh lệch."
  echo
  echo "| Chỉ số | Cộng dồn từ lúc MySQL khởi động |"
  echo "|---|---|"
  echo "| Truy vấn | $(fmt "${Q:-0}") |"
  echo "| Truy vấn chậm | ${SLOW:-0} |"
fi
# Ngoặc quanh (rr>0) là BẮT BUỘC: trong danh sách tham số của printf, awk đọc `>` là chuyển
# hướng output ra file chứ không phải phép so sánh — bỏ ngoặc là syntax error.
HIT=$(awk -v r="${BPR:-0}" -v rr="${BPRR:-1}" 'BEGIN{ if ((rr+0)>0) printf "%.3f", (1-r/rr)*100; else printf "0" }')
echo "| Kết nối đỉnh | ${USEDCONN:-?} / ${MAXCONN:-?} |"
echo "| Tỉ lệ trúng cache (buffer pool) | ${HIT}% |"
echo "| Chờ khoá bảng | ${LOCKW:-0} |"
echo "| Kích thước DB | $(sql "SELECT ROUND(SUM(data_length+index_length)/1024/1024,1) FROM information_schema.tables WHERE table_schema='$DB_NAME'") MB |"
echo
if [ -n "${USEDCONN:-}" ] && [ -n "${MAXCONN:-}" ] && [ "${MAXCONN:-0}" -gt 0 ]; then
  PCT=$(( USEDCONN * 100 / MAXCONN ))
  [ "$PCT" -gt "$WARN_CONN_PCT" ] && warn "Kết nối MySQL chạm ${PCT}% trần (${USEDCONN}/${MAXCONN}) — cân nhắc nâng max_connections"
fi
awk -v h="$HIT" 'BEGIN{exit !(h<99)}' && warn "Tỉ lệ trúng cache MySQL chỉ ${HIT}% — buffer pool có thể đã nhỏ so với dữ liệu"

# ─────────────────────────────────────────────────────────────────────────────
echo "## 6. Tải thực tế (đơn hàng)"
echo
echo "| Ngày | Đơn | Món |"
echo "|---|---|---|"
sqldb "SELECT DATE_FORMAT(CONVERT_TZ(o.opened_at,'+00:00','+07:00'),'%d/%m') d,
              COUNT(DISTINCT o.id),
              COUNT(i.id)
       FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
       WHERE o.opened_at >= NOW()-INTERVAL 7 DAY
       GROUP BY 1 ORDER BY MIN(o.opened_at)" \
  | awk -F'\t' '{printf "| %s | %s | %s |\n", $1, $2, $3}'
echo
echo "**Giờ cao điểm trong tuần:**"
echo
echo "| Giờ | Đơn |"
echo "|---|---|"
sqldb "SELECT CONCAT(LPAD(HOUR(CONVERT_TZ(opened_at,'+00:00','+07:00')),2,'0'),'h') h, COUNT(*) c
       FROM orders WHERE opened_at >= NOW()-INTERVAL 7 DAY
       GROUP BY 1 ORDER BY c DESC LIMIT 3" \
  | awk -F'\t' '{printf "| %s | %s |\n", $1, $2}'
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 7. Độ trễ HTTP"
echo
# Docker chỉ giữ log trong hạn mức json-file của container (200m×5 từ 2026-09-14 ≈ 2 ngày),
# nên đây KHÔNG phải số của cả tuần. Nói rõ khoảng thời gian thật thay vì để người đọc tưởng.
CADLOG=$(mktemp); docker logs --since 168h "$CADDY_CONTAINER" > "$CADLOG" 2>&1

# Lọc ra riêng lưu lượng PRODUCTION trước khi tính bất cứ con số nào. Container Caddy này phục
# vụ ba thứ trên cùng một máy: production, server dev (*.dev.quanbalun.site), và IP trần nơi
# bot quét cả ngày. Trộn chung thì:
#   - Dev trả 502 mỗi lần deploy — tuần nào cũng báo động giả, mà báo động giả đều đặn thì đến
#     lúc có sự cố thật cũng không còn ai buồn nhìn.
#   - Bot quét IP đẻ ra hàng trăm 404/308, và request của chúng nhanh bất thường (bị chặn ngay
#     ở tầng Caddy) nên còn kéo tụt cả p50/p95 xuống thành con số đẹp giả.
grep '"host": "[^"]*quanbalun' "$CADLOG" | grep -v '"host": "[^"]*dev\.quanbalun' > "$CADLOG.prod" || true

NREQ=$(grep -c 'handled request' "$CADLOG.prod" || true)
if [ "${NREQ:-0}" -gt 0 ]; then
  FIRST=$(grep -o '^[0-9/]* [0-9:]*' "$CADLOG" | head -1)
  LAST=$(grep -o '^[0-9/]* [0-9:]*' "$CADLOG" | tail -1)
  echo "Mẫu: **$(fmt "$NREQ")** request production, từ \`$FIRST\` đến \`$LAST\` (giờ UTC — log Caddy chỉ giữ được chừng này)."
  echo
  grep -o '"duration": [0-9.e-]*' "$CADLOG.prod" | awk '{print $2}' | sort -g \
    | awk '{a[NR]=$1} END{if(NR>0) printf "| p50 | p95 | p99 | Chậm nhất |\n|---|---|---|---|\n| %.0f ms | %.0f ms | %.0f ms | %.0f ms |\n", a[int(NR*0.5)]*1000, a[int(NR*0.95)]*1000, a[int(NR*0.99)]*1000, a[NR]*1000}'
  echo
  E5=$(grep -c '"status": 5[0-9][0-9]' "$CADLOG.prod" || true)
  E5DEV=$(grep '"host": "[^"]*dev\.quanbalun' "$CADLOG" | grep -c '"status": 5[0-9][0-9]' || true)
  E4=$(grep -c '"status": 4[0-9][0-9]' "$CADLOG.prod" || true)
  E4BOT=$(( $(grep -c '"status": 4[0-9][0-9]' "$CADLOG" || true) - E4 ))
  echo "- **Production** — lỗi 5xx: **$E5** · 4xx của khách: **$E4**"
  echo "- Bỏ qua: ${E4BOT} lỗi 4xx do bot quét IP, ${E5DEV} lỗi 5xx trên server dev (dev 502 mỗi lần deploy là bình thường)"
  [ "${E5:-0}" -gt 0 ] && warn "Có $E5 lỗi 5xx trên domain PRODUCTION — cần xem log API"
  P95=$(grep -o '"duration": [0-9.e-]*' "$CADLOG.prod" | awk '{print $2}' | sort -g | awk '{a[NR]=$1} END{printf "%.0f", a[int(NR*0.95)]*1000}')
  [ "${P95:-0}" -gt 500 ] && warn "p95 độ trễ ${P95}ms — chậm hơn bình thường (nền ~50ms)"
else
  echo "> Không đọc được log Caddy production."
fi
rm -f "$CADLOG" "$CADLOG.prod"
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "## 8. Kết luận"
echo
if [ ${#WARNINGS[@]} -eq 0 ]; then
  echo "✅ **Không có cảnh báo nào.** Mọi chỉ số nằm trong ngưỡng an toàn."
else
  echo "⚠️ **${#WARNINGS[@]} điểm cần để ý:**"
  echo
  for W in "${WARNINGS[@]}"; do echo "- $W"; done
fi
echo

# Lưu mốc cho lần chạy sau. Ghi CUỐI CÙNG và chỉ khi đọc được MySQL — ghi sớm mà script chết
# giữa chừng thì tuần sau so với mốc của một báo cáo chưa từng gửi đi.
if [ -n "${Q:-}" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  { echo "PREV_Q=${Q}"; echo "PREV_SLOW=${SLOW}"; echo "PREV_UPTIME=${UPS}"
    echo "PREV_AT=$(date +%s)"; } > "$STATE_FILE"
fi
