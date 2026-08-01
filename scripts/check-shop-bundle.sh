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

# ── Gate 2: kích thước JS — CẢNH BÁO, KHÔNG CHẶN (từ 2026-08-01) ─────────
#
# Chủ dự án quyết 2026-08-01: không để ngưỡng này chặn tiến độ phase 9; sẽ quay lại xét
# sau khi xong toàn bộ milestone. Ghi ở OVERRIDE-DEBT.md OD-12.
#
# Gate này KHÔNG bị xoá, chỉ đổi từ chặn sang cảnh báo — vì con số vẫn phải được ĐO và
# IN RA mỗi lần build. Xoá hẳn là mất luôn dữ liệu cho quyết định sau, và mất luôn cơ hội
# nhìn thấy lúc bundle nhảy vọt.
#
# ⚠ ĐỪNG LẪN 2 VIỆC KHI QUAY LẠI BÀN:
#   - Ngưỡng này là chi phí đặt lên ĐIỆN THOẠI KHÁCH (tiền 3G + thời gian parse JS trên
#     máy rẻ). Nâng VPS KHÔNG cải thiện được nó. VPS chỉ gửi file tĩnh đã gzip (103 kB).
#   - Đòn thật sự là tách chunk theo route (React.lazy) — hiện `apps/shop` có ĐÚNG 1 file
#     JS, không có dynamic import nào, nên khách chỉ xem menu vẫn tải cả checkout + trang
#     theo dõi đơn + lịch sử.
#   - Và chính cách đo dưới đây cũng cần sửa: nó CỘNG TỔNG mọi chunk, nên nếu tách route
#     thì con số không giảm một byte dù lần tải đầu của khách nhẹ đi hẳn. Muốn đo có nghĩa
#     thì đo chunk vào-đầu (entry + static import của nó), không phải tổng.
#
# Lịch sử con số (giữ lại để quyết định sau có dữ liệu):
# (a) Ở phase 07, apps/shop chưa có route nào (main.tsx render <BrandPreview/>
#     tĩnh) nên guard cũ chỉ có gate chuỗi cấm ở trên — không có gì để đo.
# (b) Phase 08 (plan 08-04) thêm BrowserRouter thật + zod (D-02: parse runtime
#     mọi response /api/public/*) + 5 trang vào bundle, nên kích thước JS tăng
#     là ĐÚNG DỰ KIẾN, không phải hồi quy.
# (c) Số đo thật tại thời điểm đóng plan 08-04 (lệnh `du -k apps/shop/dist/
#     assets/*.js` sau `pnpm --filter @order/shop build`): 244 kB.
# (d) Ngưỡng gốc 320 kB (244 + ~30%) chỉ còn dư 4 kB sau khi đóng plan 08-09
#     (316 kB — MenuPage + CardItem + CategoryRail + BannerNotice + lớp dữ liệu),
#     không đủ chỗ cho plan 08-11 (Stepper/StickyCta/CartPage/OrderTrackPage/
#     HistoryPage → đo thật 336 kB) lẫn plan 08-12 (`/checkout` — segmented
#     control, autofill, Geolocation API, xử lý 8 mã lỗi submit — quy mô tương
#     đương `CartPage.tsx`). Margin 30% ban đầu tính thiếu cho phần còn lại của
#     chính phase 8, không phải chỉ dành cho phase 9 như ghi chú cũ giả định.
# (e) MAX_JS_KB = 336 (đo thật sau plan 08-11) + ~10% chừa cho plan 08-12 ≈ 370.
#     Không nới thêm cho phase 9 ở đây — lúc đó đo lại số thật và ghi lý do mới.
# (f) Khách vào bằng 3G nên ngưỡng này là HỢP ĐỒNG HIỆU NĂNG, không phải số
#     tuỳ hứng: muốn nâng phải sửa số này VÀ ghi lý do ngay tại đây, không
#     được âm thầm nới ngưỡng ở nơi khác.
# (g) 2026-08-01: giữ nguyên 370 làm MỐC THAM CHIẾU (không nâng số, để còn thấy
#     bundle đã phình bao nhiêu so với lúc đóng phase 8), nhưng vượt thì chỉ WARN.
MAX_JS_KB=370

JS_KB=0
for f in "$DIST"/assets/*.js; do
  [ -f "$f" ] || continue
  SIZE=$(du -k "$f" | cut -f1)
  JS_KB=$((JS_KB + SIZE))
done

GZIP_KB=$(gzip -c "$DIST"/assets/*.js 2>/dev/null | wc -c | awk '{printf "%.0f", $1/1024}')
CHUNKS=$(ls "$DIST"/assets/*.js 2>/dev/null | wc -l | tr -d ' ')

if [ "$JS_KB" -gt "$MAX_JS_KB" ]; then
  # WARN, KHÔNG set FAIL — quyết định của chủ dự án 2026-08-01 (OD-12).
  echo "WARN: bundle JS ${JS_KB} kB > mốc ${MAX_JS_KB} kB (vượt $((JS_KB - MAX_JS_KB)) kB) — không chặn, xem OD-12"
else
  echo "OK: bundle JS ${JS_KB} kB (mốc ${MAX_JS_KB} kB, còn dư $((MAX_JS_KB - JS_KB)) kB)"
fi
# In kèm gzip + số chunk: đây là 2 số cần cho quyết định hiệu năng cuối milestone.
# gzip = khách thật tải bao nhiêu. chunk = 1 nghĩa là chưa tách route lần nào.
echo "     gzip ${GZIP_KB} kB · ${CHUNKS} chunk JS$([ "$CHUNKS" = 1 ] && echo ' (chưa tách route — khách xem menu vẫn tải cả checkout/tracking/history)')"

if [ "$FAIL" = 0 ]; then
  echo "OK: bundle khách sạch — $COUNT chuỗi cấm không xuất hiện trong $DIST"
else
  echo ""
  echo "M2.D-64 bị vi phạm: trang khách đang tải được CODE QUẢN LÝ."
  echo "Đây là gate bảo mật, KHÔNG phải gate hiệu năng — không được nới như OD-12."
fi

exit $FAIL
