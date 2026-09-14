#!/usr/bin/env bash
# Cài lịch báo cáo hàng tuần lên VPS — chạy TRÊN SERVER, một lần, bằng root:
#
#   bash /opt/orderquanbalun/scripts/install-weekly-report.sh
#
# Script này phải chạy lại sau mỗi lần VPS bị cài lại. Nó nằm trong git chính vì thế: cái gì
# chỉ tồn tại dưới dạng "hồi đó có gõ mấy lệnh trên server" thì lần cài lại sau là mất, và mất
# im lặng — thứ duy nhất báo cho biết là một buổi sáng thứ 2 không có báo cáo, mà không có báo
# cáo thì trông hệt như một tuần yên ổn. Cùng bài học với scripts/mysql-backup.sh.
#
# Dùng systemd timer chứ không phải crontab: timer có `Persistent=true` (VPS tắt đúng sáng thứ 2
# thì chạy bù ngay khi bật lại, crontab thì bỏ luôn kỳ đó), và `journalctl -u ordbl-report` cho
# xem lại lần chạy trước đã nói gì.
set -euo pipefail

REPO="${DEPLOY_PATH:-/opt/orderquanbalun}"
CONF=/etc/ordbl-report.env
UNIT=/etc/systemd/system/ordbl-report.service
TIMER=/etc/systemd/system/ordbl-report.timer

[ "$(id -u)" = 0 ] || { echo "❌ Phải chạy bằng root"; exit 1; }
[ -f "$REPO/scripts/weekly-report-send.sh" ] || { echo "❌ Không thấy $REPO/scripts/weekly-report-send.sh — sai DEPLOY_PATH?"; exit 1; }

# sysstat là nguồn DUY NHẤT cho phần CPU/RAM lịch sử. Thiếu nó báo cáo vẫn chạy nhưng mục 2
# trống trơn, nên cài luôn ở đây thay vì để người ta phát hiện sau 1 tuần.
if ! command -v sar >/dev/null 2>&1; then
  echo "▶ Cài sysstat…"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sysstat
fi
sed -i 's/^ENABLED=.*/ENABLED="true"/' /etc/default/sysstat
sed -i 's/^HISTORY=.*/HISTORY=30/' /etc/sysstat/sysstat
systemctl enable --now sysstat >/dev/null 2>&1 || true

if [ ! -f "$CONF" ]; then
  echo "▶ Tạo $CONF (cần điền token)…"
  cat > "$CONF" <<'ENVEOF'
# Bot Telegram nhận báo cáo hệ thống hàng tuần.
# Lấy token: nhắn @BotFather trên Telegram → /newbot → copy token.
# Lấy chat id: nhắn 1 câu bất kỳ cho bot vừa tạo, rồi mở
#   https://api.telegram.org/bot<TOKEN>/getUpdates
# và tìm "chat":{"id":<số này>}
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ENVEOF
  chmod 600 "$CONF"   # chứa bot token — không để user khác trên máy đọc được
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Báo cáo sức khoẻ hệ thống Quán Bà Lùn (hàng tuần)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $REPO/scripts/weekly-report-send.sh
# Báo cáo đọc docker + sar + /proc nên cần root. Không có gì ghi ra ngoài $REPO/reports.
User=root
TimeoutStartSec=600
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Chạy báo cáo hệ thống 10h sáng thứ 2 hàng tuần

[Timer]
# Giờ địa phương của server (đang là +07). `Mon *-*-* 10:05:00` = 10h05 thứ 2.
# 10:05 chứ không phải 10:00 tròn: backup DB và vài job khác hay đặt đúng phút tròn,
# lệch ra vài phút thì không ai giành I/O với ai.
OnCalendar=Mon *-*-* 10:05:00
# VPS tắt/khởi động lại đúng sáng thứ 2 thì chạy bù khi bật lên, không bỏ kỳ.
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

chmod +x "$REPO"/scripts/weekly-report.sh "$REPO"/scripts/weekly-report-send.sh
systemctl daemon-reload
systemctl enable --now ordbl-report.timer

echo
echo "✅ Đã cài. Lần chạy tới:"
systemctl list-timers ordbl-report.timer --no-pager | sed -n '1,2p'
echo
if ! grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$CONF"; then
  echo "⚠️ CÒN THIẾU: điền TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID vào $CONF"
  echo "   Rồi chạy thử: systemctl start ordbl-report && journalctl -u ordbl-report -n 20 --no-pager"
fi
