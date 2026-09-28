# Ghi nợ khách khi thanh toán — spec chốt 2026-09-25

Nhánh `feat/no-tien`. Chủ quán chốt 5 điểm qua thảo luận, ghi lại đây để code và để người sau
hiểu vì sao làm thế này chứ không làm cách khác.

## Quyết định

**D-01 — Nợ là nợ TOÀN BỘ bill, bàn trả ngay.** Khách không trả đồng nào lúc rời bàn; bàn phải
trống cho lượt sau. Vì nợ hết nên "tiền mặt / chuyển khoản / cả hai" không còn ý nghĩa lúc ghi nợ
→ giao diện là **nút thứ 4 "Ghi nợ"** ở màn "Khách trả bằng gì?", không phải ô tích đi kèm ba nút
kia. Bắt buộc gõ tên khách (hoặc ghi chú nhận diện) — nợ mà không biết ai nợ thì không đòi được.

**D-02 — Lưu bằng mốc thời gian, không lưu số tiền nợ.** Nợ toàn bộ nên số nợ = tổng thu của đơn,
mà tổng thu vốn KHÔNG lưu ở cột nào (tính từ `order_items` + `ship_fee`, xem `checkout-total.ts`).
Thêm `debt_amount` là dựng nguồn sự thật thứ hai — đúng thứ docblock `payment_method` trong
`order.entity.ts` đã từ chối. Cột mới, CHỈ THÊM (C-SCHEMA-07, `synchronize: true`):

| Cột | Kiểu | Nghĩa |
|---|---|---|
| `debt_at` | datetime NULL | Lúc ghi nợ. NULL = đơn này chưa từng nợ |
| `debt_note` | varchar(255) NULL | Tên khách / ghi chú nhận diện |
| `debt_paid_at` | datetime NULL | Lúc thu được nợ. NULL + `debt_at` có = ĐANG NỢ |
| `debt_paid_by_user_id` / `debt_paid_by_full_name` | snapshot | Ai thu nợ, cùng lệ `checked_out_by_*` |

**D-03 — Doanh thu CHỈ tính khi thu được nợ.** Bốn trạng thái kết đơn (trước là ba):

| Trạng thái | `closed_at` | `is_paid` | `debt_at` | Doanh thu |
|---|---|---|---|---|
| Đang dùng | NULL | – | – | không |
| Đã thanh toán | có | 1 | NULL hoặc có | có |
| **Đang nợ** | có | 0 | có | **không** |
| Đã huỷ | có | 0 | NULL | không |

`PAID_SQL` giữ nguyên (`closed_at IS NOT NULL AND is_paid = 1`) nên mọi báo cáo món / nguyên liệu /
top-dishes tự loại đơn đang nợ. `CANCELLED_SQL` phải thêm `AND debt_at IS NULL`, nếu không đơn
nợ hiện thành "Đã huỷ".

**Mốc tiền = `COALESCE(debt_paid_at, closed_at)`.** Đơn nợ hôm 20, trả hôm 25 thì doanh thu và
két/ngân hàng rơi vào ngày 25 — đúng ngày tiền vào. Mọi bộ lọc ngày và trục "giờ thanh toán" ở
Lịch sử / đối soát / thống kê đổi sang mốc này. `closed_at` vẫn là lúc trả bàn (các query "đơn
đang mở" không đổi).

**D-04 — Thu nợ MỘT LẦN đủ, ghi lên chính đơn.** Với D-01 + D-03 thì bảng phiếu trả nợ riêng
(như sổ trả tiền NCC) không cần: không có trả góp, không có doanh thu một phần. Thu nợ đi lại đúng
hộp thoại thu tiền (tiền mặt / CK / cả hai, chọn mã QR, chụp bill) và ghi vào `transfer_amount`,
`paid_to_account_id`, `payment_qr_label`, `transfer_note` như checkout thường. Nếu sau này cần trả
dần thì mở bảng `order_debt_payments` — cột `debt_paid_at` vẫn dùng làm mốc "trả xong".

**D-05 — Quyền.** Ghi nợ và thu nợ: mọi role đang được thu tiền (`admin`, `order`); phần chuyển
khoản vẫn qua công tắc "Thu CK" per-nhân-viên. Chuyển đơn ĐÃ THU thành nợ (bấm nhầm): chỉ admin,
luôn ghi nhật ký bàn.

**D-06 — Admin nhìn ra bàn nào đang nợ.** Ở Lịch sử: tab "Đang nợ", badge trên dòng đơn, con số
tổng đang nợ MỌI THỜI GIAN (không theo bộ lọc ngày — nợ tháng trước vẫn là nợ), nút "Thu nợ" trên
đơn nợ, nút "Chuyển sang nợ" (admin) trên đơn đã thu.

## API

- `POST /orders/:id/checkout` thêm `debt: true` + `debt_note`. Khi `debt`: bỏ qua `transfer_*`,
  set `closed_at`, `is_paid = false`, `debt_at`, `debt_note`. Vẫn chốt món SERVED, vẫn in hoá đơn
  (tờ in mang dòng "GHI NỢ — chưa thu").
- `POST /orders/:id/settle-debt` body = body checkout (transfer_amount, mã QR, misa). Chỉ nhận
  đơn đang nợ. Set `is_paid = true`, `debt_paid_at`, `debt_paid_by_*`, phần CK. Ghi nhật ký.
- `PATCH /orders/:id/debt` (AdminGuard) body `{ debt_note }`: đơn đã thu → đang nợ. Xoá
  `transfer_amount` và các cột mã QR (tiền đó không có thật), giữ `checked_out_by_*` (người trả
  bàn), `debt_at = now`. Từ chối nếu đơn chưa kết hoặc đã huỷ. Ghi nhật ký.
- `GET /orders/history?status=debt` và `GET /orders/stats?status=debt`.
- `GET /orders/payment-summary` thêm `debt_outstanding: { orders, amount }` mọi thời gian.

## Không làm ở nhánh này

- Trả dần / trả một phần (D-04).
- Xoá nợ khi khách bùng — đơn cứ nằm ở "Đang nợ" cho tới khi admin quyết.
- Sổ nợ theo khách (gom theo tên) — tab "Đang nợ" đủ cho quán hiện tại.
- Đẩy sang CukCuk / GA4: không đụng.

## Bàn lại 2026-09-28 (nhánh `feat/ghi-no-khach`, cắt từ develop đã có SePay)

Chủ quán chốt thêm 4 điểm, ghi để người port code không mở lại:

**D-07 — Không đụng SePay / cột "Xác thực".** Thu nợ bằng CK chỉ ghi `transfer_amount` + mã QR
như checkout thường; không xoá/sinh lại `payment_intent`, không sửa cờ "ngân hàng đã báo về".
Lý do: quán chưa dùng SePay. Nếu sau này bật thì xét lại intent tái dùng theo `(code, code_day)`.

**D-08 — Báo cáo món / nguyên liệu: không đụng.** Chưa làm mảng đó, giữ nguyên `PAID_SQL` là đủ
(đơn đang nợ tự bị loại, thu nợ xong thì vào theo mốc `COALESCE(debt_paid_at, closed_at)`).

**D-09 — Không chống gian lận nội bộ.** Không báo Telegram, không giới hạn admin. Chủ quán tự
nhìn tab "Đang nợ" biết bàn nào / ai ghi (`checked_out_by_*`) rồi xử lý người đó. D-05 giữ nguyên.

**D-10 — Không có hạn nợ.** Tab "Đang nợ" không cần số ngày nợ, không sắp theo nợ lâu nhất,
không nhắc. Sắp theo `closed_at` mới nhất như các tab khác.

Khách bùng (huỷ đơn nợ) vẫn nằm ở "Không làm ở nhánh này".

**D-11 — "Chuyển sang nợ" và "In lại hoá đơn" nằm trong menu ⋯ của dòng đơn (2026-09-28).**
Lần đầu bày nút "→ Nợ" thường trực thì cột thao tác có 4 thứ và vỡ trên điện thoại; chủ quán bảo
bỏ, rồi bảo làm lại nhưng gom vào ⋯. Thường trực chỉ còn Misa và "Thu nợ" (việc làm mỗi đơn);
⋯ hiện với đơn đã thu, mục "Chuyển sang nợ" chỉ admin thấy. Endpoint `PATCH /orders/:id/debt`
không đổi.
