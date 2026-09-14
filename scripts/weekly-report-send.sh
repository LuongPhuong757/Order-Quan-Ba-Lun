#!/usr/bin/env bash
# Chạy weekly-report.sh rồi gửi kết quả qua Telegram. Đây là thứ systemd timer gọi mỗi
# sáng thứ 2 (xem scripts/install-weekly-report.sh).
#
# Cấu hình đọc từ /etc/ordbl-report.env — KHÔNG nằm trong git, vì chứa bot token:
#   TELEGRAM_BOT_TOKEN=123456:ABC...
#   TELEGRAM_CHAT_ID=987654321
#
# Gửi làm HAI phần, có lý do:
#   1. Một tin nhắn ngắn: kết luận + danh sách cảnh báo. Đây là thứ đọc được trên màn hình
#      khoá điện thoại mà không cần mở gì.
#   2. File .md đính kèm: toàn bộ báo cáo. Telegram chặn tin nhắn quá 4096 ký tự, mà báo cáo
#      dài ~4-6KB — gửi thẳng là bị cắt cụt đúng phần bảng số liệu.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="${ORDBL_REPORT_ENV:-/etc/ordbl-report.env}"
OUT_DIR="${OUT_DIR:-/opt/orderquanbalun/reports}"

[ -f "$CONF" ] && { set -a; . "$CONF"; set +a; }

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "❌ Thiếu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID trong $CONF" >&2
  echo "   Báo cáo vẫn được ghi ra $OUT_DIR nhưng KHÔNG gửi đi đâu cả." >&2
  SEND=0
else
  SEND=1
fi

mkdir -p "$OUT_DIR"
STAMP=$(date '+%Y-%m-%d')
FILE="$OUT_DIR/bao-cao-$STAMP.md"

bash "$HERE/weekly-report.sh" > "$FILE" 2>"$FILE.err"
RC=$?
if [ $RC -ne 0 ] || [ ! -s "$FILE" ]; then
  # Script hỏng thì PHẢI báo, không được im lặng. Một báo cáo không tới nơi trông y hệt một
  # tuần yên ổn — đó đúng là kiểu hỏng mà cả hệ thống giám sát này sinh ra để tránh.
  MSG="⚠️ Báo cáo hệ thống Quán Bà Lùn CHẠY LỖI ($STAMP, mã thoát $RC). $(head -c 500 "$FILE.err" 2>/dev/null)"
  [ "$SEND" = 1 ] && curl -sS -m 30 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${MSG}" >/dev/null
  echo "$MSG" >&2
  exit 1
fi
rm -f "$FILE.err"

# Dọn báo cáo cũ — giữ 26 bản (nửa năm). Không giới hạn thì thư mục này phình mãi trên chính
# cái ổ mà báo cáo có nhiệm vụ cảnh báo khi sắp đầy.
ls -1t "$OUT_DIR"/bao-cao-*.md 2>/dev/null | tail -n +27 | xargs -r rm -f

# Phần tóm tắt: mục "## 8. Kết luận" trở xuống.
SUMMARY=$(sed -n '/^## 8\. Kết luận/,$p' "$FILE" | sed '1d' | sed '/^$/d' | head -20)
HEAD_LINE=$(sed -n '/^\*\*Chạy lúc:\*\*/p' "$FILE" | sed 's/\*\*//g;s/  $//')

if [ "$SEND" = 1 ]; then
  TEXT="📊 Báo cáo hệ thống Quán Bà Lùn
${HEAD_LINE}

${SUMMARY}

(Chi tiết đầy đủ ở file đính kèm)"
  curl -sS -m 30 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${TEXT}" \
    --data-urlencode "disable_web_page_preview=true" >/dev/null \
    || echo "⚠️ Gửi tin tóm tắt thất bại" >&2

  curl -sS -m 60 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
    -F "chat_id=${TELEGRAM_CHAT_ID}" \
    -F "document=@${FILE};filename=bao-cao-$STAMP.md" >/dev/null \
    || echo "⚠️ Gửi file báo cáo thất bại" >&2

  echo "✅ Đã gửi báo cáo $STAMP qua Telegram ($FILE)"
else
  echo "ℹ️ Đã ghi $FILE (chưa cấu hình Telegram nên không gửi)"
fi
