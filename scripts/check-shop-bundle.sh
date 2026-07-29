#!/bin/sh
# M2.D-64 — bundle của order.<domain> KHÔNG được chứa route/code trang quản lý.
#
# Lý do tách apps/shop khỏi apps/web không phải để gọn code, mà để khách KHÔNG TẢI ĐƯỢC
# code quản lý. Điều đó phải kiểm được lại bằng lệnh, không phải grep tay một lần rồi tin.
#
# Dùng:  pnpm --filter @order/shop build && sh scripts/check-shop-bundle.sh
# Exit:  0 = sạch, 1 = phát hiện rò (hoặc chưa build)

set -e

DIST="apps/shop/dist"

if [ ! -d "$DIST" ]; then
  echo "FAIL: chưa có $DIST — chạy 'pnpm --filter @order/shop build' trước."
  exit 1
fi

# Route + tên page CHỈ có ở trang quản lý.
# LƯU Ý: KHÔNG thêm 'HistoryPage' — apps/shop cũng có page tên đó (false positive).
FORBIDDEN="/dashboard
/kitchen
/admin/
DashboardPage
KitchenPage
TablesManagementPage
MenuManagementPage
AdminAuditPage
AdminUsersPage
SetupPage
RecoverPage"

FAIL=0
COUNT=0

for needle in $FORBIDDEN; do
  COUNT=$((COUNT + 1))
  HITS=$(grep -rIlF -- "$needle" "$DIST" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    echo "LEAK: '$needle' xuất hiện trong bundle khách:"
    echo "$HITS" | sed 's/^/       /'
    FAIL=1
  fi
done

if [ "$FAIL" = 0 ]; then
  echo "OK: bundle khách sạch (đã kiểm $COUNT chuỗi trong $DIST)"
else
  echo ""
  echo "M2.D-64 bị vi phạm: trang khách đang tải được code quản lý."
fi

exit $FAIL
