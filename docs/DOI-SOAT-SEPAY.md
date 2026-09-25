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

**Không có ngoại lệ nào** (từ 2026-09-25). Trước đó luồng khách đặt online trả trước có ghi
`online_order_requests.paid_at`; luồng đó đã gỡ, nên module chỉ còn ghi vào đúng hai bảng của
chính nó.

## ⚠ Tiền tố bắt buộc của ngân hàng (SEVQR)

Một số ngân hàng chỉ đẩy biến động số dư sang SePay khi nội dung chuyển khoản **bắt đầu bằng** một
từ khoá của họ. Tài liệu SePay, mục VietinBank cá nhân:

> *"Để SePay có thể nhận thông báo biến động số dư từ giao dịch của VietinBank, bắt buộc mọi giao
> dịch có nội dung thanh toán phải bắt đầu bằng từ khóa **SEVQR**."*

Thiếu nó thì **tiền vẫn về tài khoản thật, nhưng SePay không thấy gì** — không webhook, không lỗi,
không dấu vết ở đâu cả. Đã mất một buổi vì chuyện này khi chạy thử 2026-09-22.

Khai ở **Cài đặt → Mã QR nhận tiền → ô "Tiền tố nội dung"**. Màn này tự gợi ý và có nút *Điền giúp*
cho ngân hàng đã biết (hiện mới VietinBank — bảng tra `NOTE_PREFIX_BY_BIN` ở
`packages/schemas/src/payment-code.ts`, thêm ngân hàng mới thì sửa đúng một chỗ đó).

Ngân hàng **không** nằm trong bảng đó nghĩa là *chưa ai kiểm*, không phải *đã xác nhận là không
đòi*. Cách duy nhất để biết là bài thử 10.000đ ở mục **Thêm một tài khoản mới** bên dưới.

## Ai thu tiền chuyển khoản

**Chỉ nhân viên, tại màn thu tiền.** Mở bàn → Thanh toán → Chuyển khoản → chọn mã QR → khách quét.

Đơn ship đi **cùng đường đó**: shipper giao xong, mở đúng bàn của đơn rồi thu như mọi đơn khác.
Khách đặt online **không** có chỗ nào tự trả trước — khối QR trên trang tra đơn đã gỡ 2026-09-25,
vì khách chuyển tiền rồi mà đơn bị từ chối thì quán phải hoàn thủ công, việc quán không có quy
trình nào.

Hệ quả cho người đọc code: mọi `payment_intents` đều là `target_type = 'POS'`.

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

## Thêm một tài khoản mới

Quy trình dưới đây viết khi mở thêm **TPBank**, **Vietcombank hộ kinh doanh** và **MB Bank**
(2026-09-23), nhưng áp dụng cho mọi tài khoản về sau.

**Không phải sửa code.** BIN của cả ba đã nằm trong `VIETQR_BANKS`, và hệ thống vốn đã nhiều tài
khoản từ 2026-09-14. Việc còn lại là bốn bước, làm **riêng cho từng tài khoản** — bước 4 là bước
duy nhất không được bỏ.

### Bước 1 — ở phía ngân hàng

| Tài khoản | Phải làm gì | Chờ bao lâu |
|---|---|---|
| **TPBank** cá nhân | Không gì cả. SePay đọc qua API chính thức, chỉ cần đăng nhập internet banking lúc liên kết. | ngay |
| **MB Bank** cá nhân | Như TPBank. | ngay |
| **Vietcombank hộ kinh doanh** | **Phải ký hợp đồng OneQR tại quầy.** Mang giấy phép hộ kinh doanh + CCCD chủ hộ. | 3–7 ngày |

⚠ **Vietcombank đứng tên CÁ NHÂN không đi được đường này.** Nếu tài khoản định thêm là VCB cá
nhân thì chỉ còn đường SMS: có phí hằng tháng, và nội dung chuyển khoản **bị cắt ngắn** nên mã đơn
có thể rụng mất — tức là tiền về nhưng cột "Xác thực" vẫn trống và phải đối soát tay. Kiểm tên chủ
tài khoản trên hợp đồng **trước** khi hứa ngày bật.

### Bước 2 — trên my.sepay.vn

1. **Tài khoản ngân hàng → Thêm**, liên kết từng tài khoản một.
2. **Webhook: KHÔNG cần tạo cái mới cho mỗi tài khoản.** Mở webhook đang có, tick thêm các tài
   khoản mới vào danh sách tài khoản của nó. Cùng URL, cùng `SEPAY_WEBHOOK_KEY`.
   Nếu giao diện SePay bắt tạo riêng từng cái thì tạo nhiều webhook **cùng URL, cùng key** cũng
   chạy đúng: chống trùng nằm ở khoá `(gateway, gateway_txn_id)` dưới DB, nên webhook về hai lần
   cũng chỉ ra một dòng.
3. **Job quét bù không phải đụng gì.** Nó gọi `/transactions/list` bằng `SEPAY_API_TOKEN` của cả
   tài khoản SePay, nên tự kéo về mọi ngân hàng đã liên kết.
4. **fail2ban**: đã whitelist dải IP của SePay từ lần bật đầu tiên thì không phải làm lại.

### Bước 3 — trong app: Cài đặt → Mã QR nhận tiền → Thêm

| Ô | TPBank | Vietcombank HKD | MB Bank |
|---|---|---|---|
| Loại mã | Tài khoản ngân hàng | Tài khoản ngân hàng | Tài khoản ngân hàng |
| Ngân hàng | TPBank (`970423`) | Vietcombank (`970436`) | MB Bank (`970422`) |
| Tên gợi nhớ | thứ người thu nhìn để chọn lúc khách đứng đợi — đặt theo người, đừng theo số |
| Số tài khoản | đúng từng ký tự | đúng từng ký tự | đúng từng ký tự |
| Tên chủ tài khoản | khách soi tên này trước khi bấm chuyển | | |
| Tiền tố nội dung | **để trống** | **để trống** | **để trống** |
| Thứ tự | xem cảnh báo ngay dưới | | |

Để trống ô tiền tố ở cả ba là **có chủ ý**: tài liệu SePay không nhắc từ khoá bắt buộc nào cho ba
ngân hàng này. Nhưng "tài liệu không nhắc" chưa phải "đã kiểm" — bước 4 mới là chỗ biết chắc.

⚠ **Thứ tự (`sort_order`) quyết định tài khoản nhận tiền của ĐƠN ONLINE.** Khách đặt online không
được chọn tài khoản; `resolveAccount()` lấy **mã đang bật có `sort_order` nhỏ nhất**. Xếp một mã
QR dạng ảnh (MoMo) hoặc một tài khoản chưa nối cổng lên đầu là mọi đơn online mất đối soát tự
động — và không có triệu chứng nào ngoài việc cột "Xác thực" trống mãi. Đặt tài khoản nối cổng
đáng tin nhất ở vị trí đầu.

### Bước 4 — bài thử bắt buộc, làm RIÊNG cho từng tài khoản

Bỏ bước này thì không có cách nào biết ngân hàng có đòi tiền tố hay không, mà triệu chứng của việc
thiếu tiền tố là **im lặng tuyệt đối**: tiền về tài khoản thật, không webhook, không lỗi, không
dấu vết ở đâu cả (xem mục SEVQR ở trên — đã mất một buổi vì đúng chuyện này).

1. Mở một đơn test, chọn **Chuyển khoản**, chọn đúng mã QR vừa thêm.
2. Quét bằng **app ngân hàng thật**, chuyển **10.000đ**, **giữ nguyên nội dung** hệ thống điền sẵn.
3. Trong vòng 2 phút, màn thu tiền phải hiện dải xanh **"Đã thanh toán thành công"**.
4. Vào **Lịch sử → 🏦 Sổ webhook ngân hàng**, lọc đúng ngân hàng đó → phải thấy dòng 10.000đ.

Nếu sau ~2 phút vẫn không thấy gì, dò theo đúng thứ tự này:

| Kiểm | Kết luận và cách chữa |
|---|---|
| my.sepay.vn → **Giao dịch**: SePay có thấy khoản 10.000đ không? | **KHÔNG thấy** → ngân hàng không đẩy sang SePay, nhiều khả năng đòi tiền tố. Điền `SEVQR` vào ô "Tiền tố nội dung" của mã đó rồi thử lại 10.000đ. Chạy được thì thêm **một dòng** vào `NOTE_PREFIX_BY_BIN` trong `packages/schemas/src/payment-code.ts` để lần sau màn Cài đặt tự gợi ý — và sửa test `payment-code.test.ts` cho khớp. |
| SePay thấy nhưng app không có dòng | Webhook không tới nơi. `docker logs ordbl_api \| grep webhook`; kiểm fail2ban đã ban IP SePay chưa; kiểm webhook trên SePay đã tick tài khoản này chưa. |
| App có dòng nhưng cột "Xác thực" vẫn trống | Nội dung CK bị sửa hoặc bị cắt → mất mã đơn. Đọc nội dung nguyên văn trong sổ webhook để biết rụng ở đâu. |

⚠ Tiền tố ăn vào trần **25 ký tự** của nội dung: thêm `SEVQR ` là cắt mất 6 ký tự ở đuôi, tức cụt
tên người thu. Đánh đổi đã chấp nhận — thiếu tiền tố thì mất cả giao dịch, còn cụt tên người thu
thì vẫn tra ngược được từ đơn.

### Sau khi cả ba tài khoản chạy

- Người thu giờ có 4+ nút chọn ở màn QR. Xếp lại thứ tự cho mã hay dùng nhất lên đầu, nhớ cảnh báo
  `sort_order` ở bước 3.
- **Mã QR dạng ảnh (MoMo, QR in giấy) không chạy xác thực** (sửa 2026-09-23): không có cổng nào
  đứng sau chúng, nên hỏi bao lâu cũng không có câu trả lời. Màn thu tiền đi thẳng qua bước chụp
  bill như trước, không hiện dải xanh lẫn dải đỏ. Đừng chờ dải xanh ở đó.
- **Khách chuyển đúng mã đơn nhưng vào tài khoản khác trong số 4 cái**: vẫn tính là đã trả — tiền
  đã về tài khoản thật của quán. Nhưng log ghi cảnh báo và `payment_intents.needs_review` bật, để
  cuối ngày còn giải thích được vì sao sao kê TPBank thiếu một khoản mà MB lại thừa. Tìm bằng
  `docker logs ordbl_api | grep "nhưng QR chìa ra"`.

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
