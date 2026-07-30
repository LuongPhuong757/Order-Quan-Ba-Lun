#!/bin/sh
# Post-merge gate — chạy sau mỗi wave của execute-phase, và trước khi push.
#
# Vì sao là script chứ không phải gõ tay: phase 08 lặp đúng chuỗi này 7 lần.
# Gõ tay thì sớm muộn cũng bỏ sót một lệnh, mà lệnh bị bỏ sót thường là lệnh
# quan trọng nhất (schema:verify — xem bên dưới).
#
# Vì sao dùng `corepack pnpm` chứ không phải `pnpm`: binary pnpm global cần
# Node >= 22.13, còn worktree của executor chạy Node 20.11. `corepack pnpm`
# dùng version pinned trong package.json nên chạy được ở cả hai.
#
# Vì sao có schema:verify: dự án dùng TypeORM `synchronize: true`, KHÔNG có
# migration (C-SCHEMA-07). typecheck và build sẽ PASS dù database chưa có bảng
# nào, vì type đến từ file entity chứ không từ DB thật. Không có bước này thì
# verification là dương tính giả. Bỏ qua bằng SKIP_SCHEMA=1 khi không có MySQL.
#
# Dùng: sh scripts/gate.sh
#       SKIP_SCHEMA=1 sh scripts/gate.sh   # bỏ bước cần MySQL

set -e
cd "$(dirname "$0")/.."

PNPM="corepack pnpm"
fail=0
step() { printf '\n──── %s ────\n' "$1"; }

step "1/5 install (frozen lockfile)"
$PNPM install --frozen-lockfile

step "2/5 typecheck (mọi project)"
$PNPM -r typecheck

step "3/5 test api + shop"
$PNPM --filter @order/api test
# apps/shop có test từ plan 08-06 trở đi; trước đó chưa có script test.
if $PNPM --filter @order/shop run 2>/dev/null | grep -q '^  test'; then
  $PNPM --filter @order/shop test
else
  echo "SKIP: @order/shop chưa có script test"
fi

step "4/5 build shop + bundle guard"
$PNPM --filter @order/shop build
sh scripts/check-shop-bundle.sh

step "5/5 schema verify (bảng phase 8 tồn tại thật trong MySQL)"
if [ -n "$SKIP_SCHEMA" ]; then
  echo "SKIP: SKIP_SCHEMA được đặt — KHÔNG coi đây là gate đã đạt"
  fail=1
else
  $PNPM --filter @order/api schema:verify
fi

printf '\n'
if [ "$fail" = "0" ]; then
  echo "GATE OK — cả 5 bước đạt"
else
  echo "GATE PARTIAL — có bước bị skip, đọc log ở trên trước khi coi là xong"
  exit 2
fi
