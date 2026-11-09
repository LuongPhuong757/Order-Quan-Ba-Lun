# Rà soát UI/UX + Lộ trình đồng bộ giao diện

Ngày rà soát: 2026-11-09 · nhánh `feat/ui-ux-dong-bo` · số liệu đếm bằng grep trên `origin/develop` 6fa51ae.
Mỗi vấn đề giao diện mới → thảo luận qua skill `/ui-ux`, chốt spec ở `docs/UI-UX/<màn>.md`, cập nhật file này.

## Quyết định đã chốt (2026-11-09)

| # | Quyết định |
|---|---|
| Q1 | Bỏ hẳn bản thiết kế lại `ui2` (27/10). Làm mới từ đầu. |
| Q2 | Hai app **chung nền móng** (font, cỡ chữ, khoảng cách, bo góc, đổ bóng, nút, ô nhập, hộp thoại, icon). **Khác màu chính**: admin xanh ngọc `#0f766e`, khách đỏ ớt + kem. |
| Q3 | Sửa **toàn bộ**, kể cả Order / Bếp / Lịch sử. Ba màn này làm **sau cùng**; giữ vị trí nút quen tay, chỉ đổi lớp áo trừ khi bàn riêng. |
| Q4 | Cuốn chiếu: nền móng → component → từng màn; mỗi đợt lên develop cho chủ quán dùng thử rồi mới làm đợt sau. |

## 1. Hiện trạng — vì sao trông "không đồng nhất"

### Trang quản lý (`apps/web`)
| Hạng mục | Hiện trạng | Mức |
|---|---|---|
| Token | **Không có `:root`**. 175 mã hex khác nhau, 1081 lần hex viết inline. 4 bộ token cục bộ song song (`.ncc-ui`, `.sx`, `.nv-ui`, `--kds-*`) | 🔴 |
| Cỡ chữ | 26 cỡ trong CSS (cả 12.5 / 13.5 / 14.5px), 849 `fontSize` inline; **~45% chữ < 14px**; nhãn thanh dưới **10px** | 🔴 |
| Bo góc / bóng / padding | 25 / 24 / 113 giá trị khác nhau | 🟠 |
| Bề rộng trang | 480 / 960 / 1200 / 1240 / 1360px tuỳ màn | 🟠 |
| Nút | ≥ 3 hệ nút song song + nhiều class lẻ; ~140 chỗ ép nút < 44px (26–42px) | 🔴 |
| Hộp thoại | ~10 cách làm khác nhau, 11 kiểu nền mờ, 30 giá trị z-index, nút đóng ✕/✗/"Đóng". (`vh`→`dvh`: kiểm lại 2026-11-09 — hộp thoại chính ĐÃ có `dvh`, chỉ còn 3 danh sách cuộn bên trong 50–55vh, không đáng kể) | 🔴 |
| Style inline | 2102 `style={{` (OnlineOrders 160, History 140, OrderDrawer 131…) | 🟠 |
| Responsive | 17 mốc @media mâu thuẫn (639/640, 719/720, 899/900, 1000/1001/1024). Tài khoản 480px trên máy tính; bảng không co trên điện thoại | 🔴 |
| Trạng thái | Không có Loading/Empty/Error chung; "Đang tải…" vs "Đang tải..." | 🟠 |
| Thông báo | **100 thông báo "đã lưu" KHÔNG hiện lên màn** (chỉ ghi vào chuông 🔔); lỗi tự tắt sau 3 giây | 🔴 UX |
| Icon | 683 emoji (98 loại) + SVG chỉ ở màn NCC; ✓/✗/✕/✅/❌ lẫn lộn | 🟠 |
| Ô nhập | ~13 ô đặt 13–15px (5 ô lọc Lịch sử, ô tìm Menu/Món online/Bếp/Nguyên liệu, ô NCC…). **Kiểm lại 2026-11-09:** dưới 640px đã có luật ép 16px (styles.css ~1452) nên iPhone dọc KHÔNG bị zoom; còn nhỏ trên iPad/máy tính và iPhone xoay ngang. `maximum-scale=1` chặn Android phóng to; giá món dùng `type=number` không có dấu chấm; ~22 hàm định dạng tiền tự viết | 🔴 |
| Điều hướng | Nhãn viết tắt khó đọc: "L/sử", "N/viên", "H/đơn", "B/cáo"…; admin 9 mục, phần sau bị khuất ngoài mép phải; nhãn khác tiêu đề trang; trang 404 trỏ `/dashboard` mà Order/Bếp không vào được | 🔴 |
| Chữ | "Huỷ" 66 / "Hủy" 2; xoá ảnh chuyển khoản không hỏi xác nhận; còn 1 `window.prompt` (Lịch sử → ghi nợ) | 🟡 |

### Trang khách (`apps/shop`)
| Hạng mục | Hiện trạng | Mức |
|---|---|---|
| Token | **Tốt**: `tokens.css` đủ màu/chữ/khoảng cách/bo góc/bóng, có kiểm WCAG | ✅ |
| Gọi món tại bàn | `MenuOrderPage` + `DineInSheets` khai lại token bằng hex (116 dòng), chữ 10–13px ở chip/giá | 🟠 |
| iPad / máy tính | Giỏ, Thanh toán, Theo dõi đơn: một cột điện thoại kéo dài 1200px; trang tại bàn không có breakpoint | 🟠 |
| Luồng đặt | 4–5 màn, 6–8 chạm; địa chỉ ở Giỏ còn tên/SĐT ở Thanh toán (nhập 2 chỗ) | 🟡 logic |
| Dùng chung | `packages/` không có token hay component UI chung giữa 2 app | 🟠 |

## 2. Đề xuất — Lộ trình 5 đợt

### Đợt 0 — Nền móng (người dùng KHÔNG thấy khác) · công sức M
1. `packages/ui-tokens/` (CSS thuần) để hai app dùng chung, gồm:
   - **Cỡ chữ 5 bậc**: 15 / 16 / 18 / 22 / 28, số tiền lớn 34. Sàn chữ là 15px, riêng nhãn phụ ở trang khách cho 13px.
   - **Khoảng cách** theo bậc 4: 4 / 8 / 12 / 16 / 24 / 32.
   - **Bo góc**: 8 / 12 / 16 / tròn hẳn.
   - **Đổ bóng** 3 mức.
   - **z-index** 5 tầng: nội dung / dính đáy / hộp thoại / xác nhận / thông báo.
   - **Màu ngữ nghĩa**: thành công / cảnh báo / lỗi / thông tin / nợ.
   - **Chiều cao nút**: 48, nút chính 56.
2. Mỗi app một file `brand.css` chỉ đổi màu chính: admin xanh ngọc, khách đỏ ớt + kem. Font chung là **Be Vietnam Pro**, đã tự host ở trang khách.
3. **3 mốc màn hình**: < 768 điện thoại · 768–1279 iPad · ≥ 1280 máy tính. Thay dần 17 mốc cũ.
4. Sửa nhanh các lỗi kỹ thuật:
   - mọi ô nhập ≥ 16px;
   - bỏ `maximum-scale=1`;
   - `vh` → `dvh`;
   - một hàm `formatVnd()` dùng chung trong `packages/utils`.

### Đợt 1 — Bộ component chung · công sức L
| Component | Thay cho |
|---|---|
| `Button` (chính / phụ / nguy hiểm / chỉ chữ; to 56 · thường 48) | 3 hệ nút + class lẻ |
| `Dialog` (điện thoại: trượt từ đáy · iPad/máy tính: giữa màn) + `ConfirmDialog` | ~10 kiểu hộp thoại |
| `Field`, `MoneyInput` (tự thêm dấu chấm), `Select`, `Chip` | ô nhập rời rạc, `type=number` |
| `Toast`: **"đã lưu" hiện 2 giây, lỗi hiện tới khi bấm tắt** | thông báo thành công đang bị ẩn |
| `PageHeader`, `Card`, `EmptyState`, `Loading`, `ErrorState`, `DataTable` (bảng tự thành thẻ trên điện thoại) | mỗi màn tự làm |
| `Icon`: bộ SVG nét đều (Lucide, chỉ nhúng icon dùng) | 683 emoji |

Có trang mẫu `/dev/ui` liệt kê mọi component ở 3 bề rộng để chủ quán duyệt trước khi áp vào màn.

### Đợt 2 — Điều hướng · công sức M (cần bàn: đụng thói quen)
- **Điện thoại**: thanh dưới tối đa **5 mục**, nhãn đủ chữ (không viết tắt), chữ ≥ 13px kèm icon. Mục thứ 5 là "Thêm" mở danh sách các màn còn lại.
- **iPad / máy tính**: thanh bên trái cố định, hiện đủ tất cả mục.
- Mục hiện theo role. Trang 404 về màn đầu tiên của role đó.

### Đợt 3 — Áp vào từng màn (cuốn chiếu, ít rủi ro trước)
1. **Tài khoản, Nhân sự, Bàn ăn**: ít dùng, thử nghiệm bộ component.
2. **Menu, Nhà cung cấp, Sổ tiền**: nhiều form và bảng. Màn "Nguyên liệu món" giữ chữ to.
3. **Báo cáo, Thống kê, Nhật ký**: bảng và biểu đồ, cần bố cục iPad/máy tính thật.
4. **Đơn online, Hoá đơn tự do.**

### Đợt 4 — Order · Bếp · Lịch sử (cuối cùng)
Đổi lớp áo theo token, giữ vị trí thao tác. Riêng màn Bếp cần chữ to, nhìn được từ xa. Làm màn nào thì bàn riêng màn đó qua `/ui-ux`.

### Đợt 5 — Trang khách
- Đưa phần gọi món tại bàn về dùng token, bỏ 116 dòng hex.
- Nâng chữ nhỏ lên ≥ 13px.
- iPad / máy tính: Giỏ + Thanh toán chia 2 cột (form bên trái, tóm tắt đơn bên phải).
- **(Đổi logic, cần bàn riêng)** gộp địa chỉ + tên/SĐT vào một màn để bớt một bước.

### Tiến độ Đợt 0 (cập nhật 2026-11-09)
| Phần | Trạng thái | Bằng chứng |
|---|---|---|
| 0. Nền móng vô hình: `packages/ui-tokens/foundation.css` (file CSS, KHÔNG là gói npm để khỏi sửa Dockerfile) + `apps/web/src/styles/tokens.css` (77 màu đặt tên theo bảng Tailwind) + thay 432 mã màu → `var()` trong 4 file CSS | ✅ code xong, chưa commit | Trang khách 133/133 biến giống hệt · thay ngược tên→mã ra đúng file cũ từng ký tự · Chrome đo 11.124 phần tử × 10 thuộc tính màu: 0 khác · typecheck/test (519 + 182)/build/ngân sách bundle xanh |
| Icon, dropdown, bộ lọc thời gian, lịch (user thêm vào Đợt 0) — **component chung** | ✅ code xong, chưa áp vào màn nào, chưa commit | `components/ui/` (Icon, Dropdown, Sheet, Calendar+DateField, TimeFilter), `lib/time-presets.ts` (19 test), trang mẫu `/mau-giao-dien` (admin). Chrome bấm thật ở 390/820/1280: mở đúng kiểu (tấm đáy / bung dưới ô), tìm bỏ dấu, chọn khoảng bấm ngược tự đảo, khoá ngày tương lai, ô 44px chữ 16px, không tràn ngang. Test 538/538, ngân sách bundle không đổi |
| Áp component vào TẤT CẢ màn (user chọn "làm hết rồi duyệt một lần") | ✅ code xong local, chờ duyệt | 6 nhóm file rời nhau: Lịch sử · Order+component chung · Bếp · Đơn online+Cài đặt+Thống kê · Menu+quản trị nhỏ · NCC+Sổ tiền. Bổ sung 13 ý icon (chuyển bàn, ca, tắt tiếng, có sẵn, chặn, combo, đẩy bán…). Bỏ `maximum-scale=1` cả 2 app + lưới an toàn `:where(input…) ≥16px` |

### Đánh giá ảnh hưởng (2026-11-09)
**Đổi HÀNH VI (không chỉ nhìn) — đã chốt trước:**
- Mặc định lọc: Sổ tiền 7 → 30 ngày; Thống kê online 7 → 30 ngày; Thống kê NCC/Trả tiền NCC thêm Hôm qua·Tháng này·Tháng trước·Tất cả; Lịch sử thêm Tháng này·Tháng trước·Chọn ngày.
- Đơn online hàng chờ (admin): bỏ "14 giờ/24 giờ", còn Hôm nay·7·30 ngày·Tháng này·Tất cả (quy ra giờ ở máy, API giữ nguyên `?hours=`). Thống kê online bỏ "90 ngày".
- Xoá ảnh bill chuyển khoản giờ hỏi xác nhận.
- Sổ tiền ẩn nút "Tất cả": API `/payments/transactions` thiếu `from` tự lùi về 7 ngày → nút sẽ nói dối. **CHỜ QUYẾT**: sửa API hay giữ ẩn.
- Android chụm 2 ngón phóng to được (bỏ `maximum-scale=1`).

**Không đổi:** query/tham số API, luồng thao tác, vị trí/thứ tự nút ở Order/Bếp, màu nền trạng thái, emoji nhóm món (dữ liệu chủ quán).

**Rủi ro đã xử lý:** `.rp-add input/button` trúng ô bên trong Dropdown → đổi sang `>`; `.ncc-ui button` reset đè nút `ds-` → nhóm NCC chặn bằng `:where(:not([class*="ds-"]))`.

**Còn để sau:** `window.prompt` ở Lịch sử (ghi nợ); hộp lịch sử giá NCC giữ chip "30/90 ngày/Tất cả" (bộ chung không có 90 ngày); Bếp vào Menu bị 403 2 API (có sẵn từ trước); thanh tiêu đề chồng nội dung khi cuộn (có sẵn); thanh dưới admin 9 mục bị khuất trên điện thoại (Đợt 2); tải lần đầu web 134 → 145 KB gzip (dưới ngưỡng theo dõi 150).
| 1–6. Ô nhập 16px theo từng màn (đã duyệt bản xem thử) | ⏳ chờ | — |
| 7. Bỏ `maximum-scale=1` | ⏳ chờ | — |

Ghi chú: KHÔNG thêm luật sàn 16px `!important` cho mọi máy cảm ứng như dự định ban đầu — nó sẽ ép cả các ô CỐ Ý to hơn 16px (vd "Nguyên liệu món") nhỏ lại trên iPad. Thay bằng sửa tường minh từng ô nhỏ.

### Quyết định icon / dropdown / lọc thời gian (chốt 2026-11-09, bản xem thử artifact 9f4b0e05)
- **Icon:** bộ nét mảnh một màu (kiểu Lucide, như màn NCC), màu theo chữ; màu chỉ cho trạng thái. Mỗi ý một icon (bảng quy ước 23 ý). Bỏ icon khỏi tiêu đề màn. Giữ emoji nhóm món (dữ liệu chủ quán). Áp cho CẢ Order/Bếp/Lịch sử, giữ màu nền trạng thái ở Bếp, không đổi vị trí nút.
- **Dropdown:** một component; nhãn chữ nằm trên, ô 44px chữ 16px; điện thoại trượt từ đáy, iPad/máy tính bung dưới ô; ≥ 8 lựa chọn tự có ô tìm; 2–4 lựa chọn hay dùng → hàng nút.
- **Lọc thời gian:** một bộ chung, thứ tự cố định: Ca này · Ca trước · Hôm nay · Hôm qua · 7 ngày · 30 ngày · Tháng này · Tháng trước · Tất cả · Chọn ngày. Màn CÓ ca ẩn Hôm nay/Hôm qua. Màn ẩn nút được, không đổi tên/thứ tự.
  - Đơn online: KHÔNG sửa API (chỉ hiểu `hours`) → chỉ hiện Hôm nay · 7 ngày · 30 ngày · Tháng này · Tất cả, quy ra số giờ ở máy.
  - Mặc định: màn có ca → Ca này; không ca → 30 ngày; NGOẠI LỆ hàng chờ đơn online giữ Tất cả (không sót đơn chờ).
  - Ô chọn ngày: tự vẽ lịch tiếng Việt (dd/mm/yyyy, thứ 2 đầu tuần) thay lịch của máy (máy tiếng Anh hiện mm/dd/yyyy, "Clear/Today").

### Thanh chuyển trang (chốt + làm 2026-11-09)
Thay 8 chỗ "Trước/Sau" bằng `ui/Pagination` (dãy số + lưới chọn trang); Lịch sử nhớ bộ lọc + trang.
Chi tiết: [UI-UX/phan-trang.md](UI-UX/phan-trang.md). Phát hiện kèm: bảng Lịch sử tràn ngang ở iPad (có sẵn, để Đợt 4).

## 3. Việc nhỏ làm được ngay, giá trị cao
1. Hiện thông báo "đã lưu" lên màn. Hiện người dùng bấm Lưu không thấy phản hồi gì.
2. Lỗi không tự tắt sau 3 giây.
3. Ô nhập < 16px → 16px (hết bị iPhone tự zoom).
4. Nhãn thanh dưới bỏ viết tắt, chữ to lên.
5. Xác nhận trước khi xoá ảnh chuyển khoản. Thay `window.prompt` ở Lịch sử bằng hộp thoại.
6. Thống nhất chữ: "Huỷ", "Đang tải…".
7. Trang 404 không trỏ về `/dashboard` cho role không có quyền vào.

## 4. Cần hỏi / chưa chốt
- Đợt 2 đổi thanh điều hướng: nhân viên đã quen vị trí → cần chủ quán duyệt bản phác.
- Mục §3.1 (hiện "đã lưu") là đổi hành vi: có màn nào cố ý im lặng không (vd màn Bếp giờ cao điểm)?
- Font Be Vietnam Pro cho admin làm nặng trang thêm ~60KB lần đầu → chấp nhận được?
