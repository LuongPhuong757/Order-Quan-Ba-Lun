# Milestone 06 — Hoá đơn tự do

**Chốt với chủ quán 2026-09-30.** Nhánh `feat/in-hoa-don-bat-ky`.

## Vì sao có tính năng này

Quán cần in ra một tờ hoá đơn **không gắn với đơn nào trong hệ thống**: khách xin tờ giấy cho
món mua ngoài sổ, in lại tờ cho một bàn đã xoá, gộp/tách hoá đơn theo yêu cầu của khách. Tờ giấy
phải trông **y hệt** hoá đơn thật, nhưng **không được đụng vào bất cứ con số nào** của quán.

Ranh giới quan trọng nhất của milestone này, và mọi quyết định dưới đây đều phục vụ nó:

> Hoá đơn tự do **không tạo `orders`, không tạo `order_items`, không trừ kho, không vào doanh
> thu, không vào báo cáo, không vào nhật ký bàn, không đẩy sang MISA/CukCuk.**
> Nó chỉ tạo ra giấy.

## Ai dùng được

`admin` · `order` · `kitchen`. Role `report` KHÔNG (tài khoản chỉ để xem số).
Role `print` (cầu in) đương nhiên không — nó bị `isBlockedForPrintRole` chặn mọi thứ ngoài `/print/*`.

## D-01 — Tờ giấy dựng bằng đúng `buildReceipt` của hoá đơn thật

KHÔNG viết hàm dựng tờ giấy thứ hai. Hoá đơn tự do dựng một **đơn ảo** (object trong bộ nhớ,
không chạm DB) rồi đưa qua đúng `buildReceipt()` mà `checkout` đang dùng.

Lý do: yêu cầu là "giống y hệt". Hai hàm dựng song song thì chúng giống nhau đúng một ngày —
ngày viết xong. Lần sau chủ quán đổi chữ trên hoá đơn thì tờ tự do lặng lẽ khác đi, và không có
test nào bắt được vì cả hai đều "đúng" theo test của mình.

Đơn ảo ánh xạ như sau:

| Trường của `ReceiptInput['order']` | Lấy từ đâu |
|---|---|
| `id` | id của `custom_receipts` → `shortCode()` in ra `#A3F2C1` |
| `table_code` | ô ghi chú đầu tờ người dùng gõ (rỗng được) |
| `fulfillment_type` | `null` — luôn đi nhánh "tại quán" |
| `ship_fee` | ô phí giao hàng (rỗng = 0, không in dòng nào) |
| `transfer_amount` | ô chuyển khoản (rỗng = 0 → in "Tiền mặt") |
| `payment_qr_label` | đọc từ cài đặt quán, giống hoá đơn thật |
| `closed_at` | thời điểm bấm In |
| `is_paid` / `debt_at` | `true` / `null` — tờ tự do không bao giờ là giấy ghi nợ |
| `checked_out_by_full_name` | **tên người đang đăng nhập** |
| `customer_*` | `null` |

### Ô ghi chú đầu tờ

Hoá đơn thật in `Bàn 5        #A3F2C1`. Tờ tự do in đúng chỗ đó: ô người dùng gõ (`Bàn 5`,
`Mang về`, tên khách...) và mã 6 ký tự. **Để trống ô thì dòng đó chỉ còn mã** — `describeTarget`
trả `Bàn ` với `table_code` rỗng nên phải xử lý, không để in ra chữ "Bàn" cụt.

## D-02 — Bảng `custom_receipts`

Cầu in dựng byte **lúc nó tới lấy job** (~2 giây sau khi bấm), không phải lúc bấm. Hoá đơn thật
dựng lại được vì đọc `orders`; tờ tự do không có đơn nào để đọc, nên nội dung **bắt buộc** nằm
trong DB.

```
custom_receipts
  id                    uuid, PK
  header_note           varchar(64)   -- ô đầu tờ, rỗng được
  items                 json          -- [{ name, qty, unit_price, note }]
  ship_fee              int           default 0
  transfer_amount       int           default 0
  items_total           int           -- CHỐT lúc tạo, xem ghi chú dưới
  total                 int           -- CHỐT lúc tạo
  created_by_user_id    varchar(36)
  created_by_full_name  varchar(128)
  created_at            datetime(6)
```

`items` là JSON chứ không phải bảng con: các dòng này **không tham chiếu `menu_items`** — giá và
tên được chụp lại tại chỗ, món có thể không tồn tại trong menu. Một bảng con chỉ để lưu 3 con số
không khoá ngoại với cái gì là bảng con vô ích.

`items_total` / `total` lưu sẵn dù tính lại được: màn danh sách hiện tổng tiền của 200 tờ mà phải
parse JSON từng dòng để cộng là chỗ chậm không cần thiết.

Nội dung **bất biến sau khi tạo** — không có API sửa. In lại một tờ cũ phải ra tờ giống hệt;
cho sửa là mở đường cho hai tờ khác nhau cùng mang một mã.

## D-03 — Hàng đợi: `print_jobs.kind = 'CUSTOM'`

Tái dùng nguyên hàng đợi hiện có (hết hạn 10 phút, thử lại 3 lần, `SKIP LOCKED`, dedupe).

- `order_id` chứa **id của `custom_receipts`**. Cột giữ nguyên tên (không thêm cột mới): nó đã là
  "id của thứ cần in", và `kind` nói rõ thứ đó là gì. Đổi tên cột là đụng vào bảng đang chạy
  production để đổi một cái tên.
- `dedupe_key`: `CUSTOM:<id>:<timestamp>` — bấm In lại 3 lần phải ra 3 tờ, giống `TEST`.
- `reason`: `CHECKOUT` cho lần in đầu, `REPRINT` cho lần in lại.
  ⚠ `REPRINT` làm `buildReceipt` đóng dấu **"(BẢN IN LẠI hh:mm)"** lên giấy — đúng như hoá đơn
  thật, và đúng ý "giống y hệt".
- `recentJobs()` join `orders` theo `order_id` → job CUSTOM không tìm thấy đơn và trả `null`.
  Đã đúng sẵn, nhưng màn Máy in phải hiện "Hoá đơn tự do" thay vì ô trống.

## D-04 — API

| Method | Đường | Quyền | Việc |
|---|---|---|---|
| POST | `/custom-receipts` | admin·order·kitchen | Tạo bản ghi + xếp job in. Trả `{ id, code, queued }` |
| POST | `/custom-receipts/:id/print` | admin·order·kitchen | In lại tờ cũ (`reason=REPRINT`) |
| GET | `/custom-receipts?limit=` | **admin** | Danh sách đã in, mới nhất trước |
| GET | `/custom-receipts/:id` | **admin** | Chi tiết một tờ |

`queued: false` = công tắc in đang tắt hoặc chưa khai máy in — trả 200 kèm cờ, **không** ném lỗi,
theo đúng lệ của `/orders/:id/print`. Bản ghi vẫn được tạo: người ta bật công tắc rồi In lại là xong.

Giới hạn đầu vào: tối đa 50 dòng · `qty` 1..99 · `unit_price` 0..99.999.999 · tên dòng ≤ 120 ký tự
· ghi chú ≤ 255 · `header_note` ≤ 64. Phải có ít nhất 1 dòng.

## D-05 — Màn "Hoá đơn tự do" (`/custom-receipt`)

Mục mới trong nav dưới của cả 3 role, icon 🧾, nhãn `H/đơn`.

Nội dung màn:

1. Ô ghi chú đầu tờ (placeholder: `Bàn 5, Mang về, tên khách... — bỏ trống cũng được`)
2. Danh sách dòng đã thêm: tên · SL · đơn giá (sửa được tại chỗ) · thành tiền · nút xoá
3. Nút **+ Chọn món** → mở `MenuPickerModal` có sẵn (không sửa component đó)
4. Nút **+ Dòng tự gõ** → thêm một dòng trống, tên/giá gõ tay (món ngoài menu)
5. Ô Phí giao hàng · ô Chuyển khoản — cả hai để trống là bình thường
6. TỔNG CỘNG tính tại chỗ theo đúng `computeCheckoutTotals`
7. Nút **In hoá đơn**

Sau khi in xong: **màn xoá trắng** để làm tờ tiếp theo (chủ quán chốt). Toast báo
`Đang in hoá đơn #A3F2C1` — mã hiện ra để người ta tìm lại được ở màn Máy in nếu giấy kẹt.

## D-06 — Bảng "Hoá đơn tự do đã in" ở Cài đặt → Máy in

Chỉ admin. Mỗi dòng: giờ · người in · ghi chú đầu tờ · tổng tiền · nút **In lại**. Bấm vào dòng
thì mở chi tiết các món.

Đây là chỗ duy nhất đối chiếu được tờ giấy đang cầm với hệ thống. Giấy không có dấu gì phân biệt
với hoá đơn thật (chủ quán chốt), nên nếu cả nhật ký cũng không có thì một tờ hoá đơn tự do là
thứ không tồn tại ở đâu cả.

## D-07 — Kiểm chứng "không đụng doanh thu"

Test tích hợp bắt buộc, không phải tuỳ chọn: tạo hoá đơn tự do rồi khẳng định `orders` và
`order_items` **không đổi số dòng**, và các con số của `/orders/stats` giữ nguyên.

Đây là lời hứa trung tâm của milestone. Một lời hứa không có test là một lời hứa sẽ bị phá vào
lần refactor thứ ba, im lặng, và chỉ lộ ra khi báo cáo cuối tháng lệch.
