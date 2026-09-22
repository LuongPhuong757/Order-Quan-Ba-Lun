# Đối soát chuyển khoản tự động qua SePay

Tài liệu vận hành. Code nằm ở `apps/api/src/modules/payments/`.

## Vấn đề tính năng này giải

Trước đây con số "chuyển khoản" ở màn đối soát là **số nhân viên tự ghi**, và bằng chứng duy nhất
là **ảnh bill do khách đưa** — có thể là ảnh cũ hoặc ảnh chỉnh. Quán không có cách nào biết tiền
có thật sự về hay không.

Đây là đường duy nhất trong hệ thống mà dữ liệu đi từ phía **ngân hàng** vào.

## Trước khi bật: chọn tài khoản

⚠ **SePay không đọc được mọi tài khoản.** Kiểm trước khi hứa với ai:

| Tài khoản | SePay đọc được? |
|---|---|
| MB, ACB, VietinBank, OCB, BIDV, TPBank, VPBank, Sacombank, MSB, KienLongBank — **cá nhân** | ✅ API chính thức |
| **Vietcombank cá nhân** | ❌ chỉ còn đường SMS (có phí, nội dung CK có thể bị cắt ngắn) |
| Vietcombank **hộ kinh doanh / doanh nghiệp** | ✅ nhưng phải ký hợp đồng OneQR ở quầy, chờ 3–7 ngày |
| Nam A Bank | ❌ không có API |
| **MoMo** | ❌ không có đường nào — vĩnh viễn nằm ngoài, phải dò tay |

Tài khoản không nối được thì **vẫn thu tiền bình thường**, chỉ là khối "Ngân hàng đã báo về" không
biết gì về chúng.

## Biến môi trường

Đặt trong `.env` của container API:

| Biến | Bắt buộc | Nghĩa |
|---|---|---|
| `SEPAY_WEBHOOK_KEY` | ✅ | Khoá webhook. **Khác nhau giữa dev và production** — dùng chung là ai có khoá dev bắn giả được vào prod. Thiếu biến này thì API **từ chối mọi webhook** (cấu hình thiếu phải biểu hiện thành "không nhận được gì", không thành một endpoint mở toang). |
| `SEPAY_API_TOKEN` | không | Bật job quét bù. Không có thì chỉ còn webhook. |
| `SEPAY_API_URL` | không | Mặc định `https://my.sepay.vn/userapi/transactions/list` (API v1). Để ngoài env là để đổi sang v2 mà không sửa code. |

Số tài khoản và mã ngân hàng **không** nằm trong env: chúng đọc từ bảng mã QR ở màn
**Cài đặt → Mã QR nhận tiền**, nơi chủ quán vốn đã quản lý.

## Cấu hình trên my.sepay.vn

1. Liên kết tài khoản ngân hàng.
2. Tạo webhook:
   - URL: `https://<domain>/webhooks/sepay`
   - Kiểu xác thực: **API Key**, header `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`
   - Chọn đúng tài khoản ngân hàng, **chỉ tiền vào**
3. Tạo API token (nếu muốn quét bù) → điền `SEPAY_API_TOKEN`.

### ⚠ Whitelist IP cho fail2ban

VPS đang bật `fail2ban`. SePay dồn retry sau mỗi lần deploy (container chết ~4 phút rưỡi) rất dễ
tự ăn ban, và lúc đó **mất giao dịch thật**. Whitelist dải IP của SePay **trước** khi bật webhook.

## Luồng chạy

```
Khách chuyển tiền
   └─ SePay phát hiện → POST /webhooks/sepay
        ① kiểm khoá  ② INSERT IGNORE vào bank_transactions  ③ trả {"success":true} + HTTP 200
        ④ bóc mã DHxxxxxx từ nội dung → khoá hàng payment_intents → cộng dồn → đủ thì gắn cờ
```

SePay chỉ tính **thành công** khi nhận đủ HTTP 200 + body đúng + **trong 30 giây**; thiếu một là
nó gửi lại. Vì vậy webhook chỉ ghi rồi trả lời, mọi việc nặng hơn phải đẩy ra khỏi đường trả lời.

## Ranh giới: máy chỉ gắn cờ

**Không dòng nào** trong module này sửa `orders.transfer_amount`, `closed_at` hay `is_paid`. Con số
tiền vẫn là thứ nhân viên ghi; cái thêm vào chỉ là câu trả lời cho *"ngân hàng đã báo về chưa"*.

Hệ quả có lợi: kể cả khi khoá webhook lộ, kẻ gọi được endpoint cũng chỉ tạo ra một dấu ✅ sai, chứ
không sửa được tiền trên đơn.

Ngoại lệ **duy nhất**: đơn online trả trước — đủ tiền thì `online_order_requests.paid_at` được ghi,
vì đó chính là mục đích của luồng đó.

## ⚠ Tiền tố bắt buộc của ngân hàng (SEVQR)

Một số ngân hàng chỉ đẩy biến động số dư sang SePay khi nội dung chuyển khoản **bắt đầu bằng** một
từ khoá của họ. Tài liệu SePay, mục VietinBank cá nhân:

> *"Để SePay có thể nhận thông báo biến động số dư từ giao dịch của VietinBank, bắt buộc mọi giao
> dịch có nội dung thanh toán phải bắt đầu bằng từ khóa **SEVQR**."*

Thiếu nó thì **tiền vẫn về tài khoản thật, nhưng SePay không thấy gì** — không webhook, không lỗi,
không dấu vết ở đâu cả. Đã mất một buổi vì chuyện này khi chạy thử 2026-09-22.

Khai ở **Cài đặt → Mã QR nhận tiền → ô "Tiền tố nội dung"**. Màn này tự gợi ý và có nút *Điền giúp*
cho ngân hàng đã biết (hiện mới VietinBank — bảng tra ở `suggestedNotePrefix`, thêm ngân hàng mới
thì sửa đúng một chỗ đó).

## Nội dung chuyển khoản

`SEVQR BAN05ABC LUONG THUY` — vừa đúng 25 ký tự, trần của trường 62.08 (EMVCo).

```
SEVQR   BAN05   ABC     LUONG THUY
  │       │      │          │
  │       │      │          └── người thu (bị cắt trước nếu tên quá dài)
  │       │      └───────────── 3 chữ cái ngẫu nhiên (bỏ I và O cho khỏi lẫn 1 và 0)
  │       └──────────────────── bàn 05 — đơn online là DON00
  └──────────────────────────── tiền tố ngân hàng bắt buộc
```

**Mã bàn nằm TRONG mã** chứ không tách ra một từ riêng. Hai cái lợi: đọc sao kê bằng mắt thấy ngay
bàn nào, và phạm vi phải duy nhất thu hẹp xuống **một bàn trong một ngày** (2–3 đơn) thay vì cả
quán — nên ba chữ cái là quá đủ.

Thứ tự là thứ tự ưu tiên, vì trần 25 ký tự cắt từ đuôi: tiền tố (thiếu là cổng không thấy giao
dịch) → mã (thiếu là không khớp tự động được) → tên người thu (thiếu vẫn tra được từ đơn).

## Duy nhất theo NGÀY, không phải vĩnh viễn

Khoá `UNIQUE(code, code_day)` ở `payment_intents` biến "gần như không trùng" thành "không thể
trùng" trong phạm vi một ngày. Sang hôm sau mã tái sử dụng.

⚠ **Bỏ `code_day` khỏi khoá đó là hỏng ngầm**: mã sẽ phải duy nhất vĩnh viễn với chỉ 13.824 khả
năng cho mỗi bàn, và vài tháng sau là đụng mã liên tục.

Đánh đổi đã biết: giao dịch về **muộn qua ngày** có thể rơi vào mã đã tái sử dụng. Bộ khớp chặn
phần lớn ca đó bằng cửa sổ 36 giờ + so số tiền, và khi còn mơ hồ thì **không đoán** — dòng tiền nằm
lại nhóm "chưa khớp" ở màn đối soát.

⚠ **Thêm khoá duy nhất lên bảng ĐANG CÓ DỮ LIỆU sẽ làm API chết lúc khởi động** (`Duplicate entry`).
Gặp thật khi đổi khuôn mã 2026-09-22. Trên production hai bảng này chưa tồn tại nên không vướng;
nếu về sau đổi khuôn mã lần nữa thì phải dọn dữ liệu cũ trước.

Khách **sửa được** nội dung trước khi bấm chuyển. Mã là công cụ trợ giúp, **không phải bằng
chứng** — mất mã thì đơn rơi về đối soát tay, ảnh bill vẫn còn đó.

## Thử sau khi bật

Theo đúng thứ tự này:

1. `curl` payload giả vào dev kèm header `Authorization: Apikey …` → `bank_transactions` có dòng.
   Không cần header `Origin` vì `/webhooks/*` nằm ngoài `/api/public/*` — và đó là chủ ý.
2. Bắn **hai lần cùng `id`** → vẫn đúng một dòng. Đây là test quan trọng nhất.
3. Chuyển thật **10.000đ** với nội dung `DH` + mã của một đơn test, bấm đồng hồ xem bao lâu tiền về.
4. **Quét thử QR bằng app ngân hàng thật.** Test tự động chỉ phủ được cấu trúc chuỗi EMVCo và CRC,
   không thay được một lần quét thật.

## Khi có gì đó không khớp

| Triệu chứng | Nguyên nhân hay gặp |
|---|---|
| Webhook 403, log không nhắc gì tới CSRF | Endpoint bị đặt nhầm dưới `/api/public/*` |
| Mọi webhook bị từ chối, log ghi "thiếu SEPAY_WEBHOOK_KEY" | Chưa khai biến trong container |
| Tiền về nhưng nằm ở nhóm "tiền lạ" | Khách sửa/xoá nội dung CK — đối soát tay bằng ảnh bill |
| Giờ giao dịch lệch 7 tiếng | Ai đó bỏ mất `+07:00` trong `parseVnTime` |
| `bank_transactions` trống dù đã chuyển tiền | ① thiếu tiền tố bắt buộc (SEVQR) ở đầu nội dung — kiểm nhật ký tunnel/webhook xem SePay có gọi tới không; ② fail2ban đã ban IP SePay |
