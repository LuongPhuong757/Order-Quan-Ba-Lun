#!/usr/bin/env bash
# Backup MySQL tự động — chạy như sidecar container (service `mysql-backup` ở
# docker-compose.prod.yml), KHÔNG dùng cron của host.
#
# Vì sao sidecar chứ không phải cron host: VPS thỉnh thoảng bị cài lại. Cron nằm ở host thì
# mất theo, và mất im lặng — không ai biết cho tới hôm cần restore. Sidecar nằm trong compose
# nên `docker compose up -d` là nó sống lại cùng cả stack.
#
# Mỗi ngày một lần: mysqldump → gzip → /backups/ordbl-<UTC timestamp>.sql.gz
# Cấu hình qua env (xem .env.production.example): BACKUP_HOUR_UTC, BACKUP_MINUTE,
# BACKUP_RETENTION_DAYS, BACKUP_KEEP_MIN.
set -euo pipefail

DIR="${BACKUP_DIR:-/backups}"
: "${MYSQL_ROOT_PASSWORD:?thiếu MYSQL_ROOT_PASSWORD}"
: "${MYSQL_DATABASE:?thiếu MYSQL_DATABASE}"
# Mặc định `mysql` = tên service trong compose. Tham số hoá để chạy thử được script ngoài stack.
DB_HOST="${MYSQL_HOST:-mysql}"
HOUR="${BACKUP_HOUR_UTC:-20}"
MINUTE="${BACKUP_MINUTE:-30}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"

log() { echo "[backup $(date -u '+%Y-%m-%d %H:%M:%S')Z] $*"; }

# Mật khẩu đi qua defaults-file chứ không qua tham số dòng lệnh: tham số hiện trong `ps` của
# mọi tiến trình cùng container, và mysqldump cũng cảnh báo về nó.
CNF=/tmp/backup.cnf
umask 077
cat > "$CNF" <<EOF
[client]
host=${DB_HOST}
user=root
password="${MYSQL_ROOT_PASSWORD}"
EOF

run_backup() {
  local ts tmp final
  ts=$(date -u +%Y%m%d-%H%M%S)
  # Tên tạm có tiền tố dấu chấm để vòng dọn dẹp không bao giờ đụng vào file đang ghi dở.
  tmp="$DIR/.in-progress-$ts.sql.gz"
  final="$DIR/ordbl-$ts.sql.gz"

  log "bắt đầu dump $MYSQL_DATABASE"
  # --single-transaction: snapshot nhất quán trên InnoDB mà KHÔNG khoá bảng — quán vẫn nhận
  #   đơn bình thường trong lúc dump chạy. Bỏ cờ này là backup lúc 3h sáng có thể chặn đơn.
  # --default-character-set=utf8mb4: tên món và địa chỉ khách là tiếng Việt có dấu; sai
  #   charset ở bước dump thì lúc restore mới phát hiện chữ đã hỏng, quá muộn.
  # --no-tablespaces: tránh cần quyền PROCESS trên MySQL 8.
  # set -o pipefail ở đầu file lo phần mysqldump chết giữa chừng mà gzip vẫn trả 0.
  if ! mysqldump --defaults-extra-file="$CNF" \
      --single-transaction --quick --routines --events \
      --no-tablespaces --set-gtid-purged=OFF \
      --default-character-set=utf8mb4 \
      "$MYSQL_DATABASE" | gzip -c > "$tmp"; then
    log "LỖI: mysqldump thất bại — giữ nguyên các bản backup cũ"
    rm -f "$tmp"
    return 1
  fi

  # Hai lớp kiểm tra trước khi công nhận bản dump. Đây là phần quan trọng nhất của script:
  # một file .sql.gz cụt vẫn trông như backup hợp lệ khi `ls`, và chỉ lộ ra đúng lúc restore.
  if ! gzip -t "$tmp" 2>/dev/null; then
    log "LỖI: file gzip hỏng — bỏ"
    rm -f "$tmp"
    return 1
  fi
  # mysqldump ghi "-- Dump completed on ..." ở dòng cuối. Có marker này nghĩa là dump chạy
  # tới hết, không phải bị cắt giữa chừng vì hết đĩa hay mất kết nối.
  if ! gzip -dc "$tmp" | tail -c 4096 | grep -q "Dump completed"; then
    log "LỖI: thiếu marker 'Dump completed' — dump bị cắt giữa chừng, bỏ"
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$final"
  log "xong: $(basename "$final") ($(du -h "$final" | cut -f1))"
}

prune() {
  # Dọn dẹp CHỈ chạy sau khi đã có bản mới hợp lệ (xem vòng lặp bên dưới) — không bao giờ xoá
  # bản cũ trước khi bản mới nằm chắc trên đĩa.
  local total
  total=$(find "$DIR" -maxdepth 1 -name 'ordbl-*.sql.gz' | wc -l)
  if [ "$total" -le "$KEEP_MIN" ]; then
    log "còn $total bản (tối thiểu giữ $KEEP_MIN) — không dọn"
    return 0
  fi
  # Giữ KEEP_MIN bản mới nhất bất kể tuổi: nếu stack chết một tháng rồi sống lại, quy tắc
  # "quá N ngày thì xoá" sẽ quét sạch mọi thứ đúng lúc ta cần chúng nhất.
  local candidates
  candidates=$(find "$DIR" -maxdepth 1 -name 'ordbl-*.sql.gz' -mtime "+$RETENTION_DAYS" | sort)
  local allowed=$((total - KEEP_MIN))
  local n=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ "$n" -ge "$allowed" ] && break
    rm -f "$f" && log "dọn bản cũ: $(basename "$f")"
    n=$((n + 1))
  done <<< "$candidates"
}

seconds_until_next_run() {
  local now target
  now=$(date -u +%s)
  target=$(date -u -d "today ${HOUR}:${MINUTE}:00" +%s 2>/dev/null || echo 0)
  # Đã qua giờ hẹn hôm nay → hẹn sang mai.
  if [ "$target" -le "$now" ]; then
    target=$(date -u -d "tomorrow ${HOUR}:${MINUTE}:00" +%s)
  fi
  echo $((target - now))
}

mkdir -p "$DIR"
log "sidecar khởi động — lịch chạy hằng ngày ${HOUR}:${MINUTE} UTC, giữ ${RETENTION_DAYS} ngày (tối thiểu ${KEEP_MIN} bản)"

# Chạy ngay một lần lúc khởi động: sau khi deploy hoặc dựng lại VPS, ta muốn có bản backup
# trong tay ngay chứ không phải chờ tới sáng hôm sau.
if run_backup; then prune; fi

while true; do
  wait_s=$(seconds_until_next_run)
  log "ngủ ${wait_s}s tới lần chạy kế tiếp"
  # Tính lại khoảng chờ mỗi vòng thay vì `sleep 86400`: cách kia trôi dần theo thời gian dump
  # và mỗi lần restart, sau vài tháng là backup rơi vào giờ cao điểm.
  sleep "$wait_s"
  if run_backup; then prune; fi
done
