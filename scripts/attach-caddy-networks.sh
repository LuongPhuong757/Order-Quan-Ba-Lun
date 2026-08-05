#!/usr/bin/env bash
# Đấu lại container Caddy vào các Docker network của site KHÁC dùng chung VPS.
#
# Vì sao cần: Caddy này còn reverse-proxy cho ứng dụng khác (ui2spec.pro.vn / genspec) nằm ở
# network riêng của stack đó. `docker compose up` tạo lại container Caddy thì mọi network được
# đấu TAY bằng `docker network connect` đều mất — Caddy vẫn chạy, vẫn trả 200 cho quán, nhưng
# site kia lăn ra 502 và không có gì báo. Ngày 2026-08-05 đã dính đúng lỗi này.
#
# Danh sách network để ở `caddy-extra-networks.txt` (mỗi dòng một tên) — file này KHÔNG nằm
# trong git, giống ./caddy-local/: cấu hình riêng của server thì ở lại server. Không có file
# thì script không làm gì, nên VPS mới hoặc máy dev chạy vẫn bình thường.
set -uo pipefail
cd "$(dirname "$0")/.."

LIST=caddy-extra-networks.txt
CONTAINER=ordbl_caddy

[ -f "$LIST" ] || { echo "[caddy-net] không có $LIST — bỏ qua"; exit 0; }

while IFS= read -r net || [ -n "$net" ]; do
  net="${net%%#*}"                       # bỏ comment cuối dòng
  net="$(echo "$net" | tr -d '[:space:]')"
  [ -z "$net" ] && continue

  if ! docker network inspect "$net" >/dev/null 2>&1; then
    echo "[caddy-net] ⚠ network '$net' không tồn tại — bỏ qua (stack kia đã gỡ?)"
    continue
  fi

  # Đã đấu rồi thì `connect` báo lỗi; coi đó là trạng thái đúng, không phải thất bại.
  if docker network connect "$net" "$CONTAINER" 2>/dev/null; then
    echo "[caddy-net] ✓ đã đấu $CONTAINER vào $net"
  else
    echo "[caddy-net] = $CONTAINER đã nằm sẵn trong $net"
  fi
done < "$LIST"
