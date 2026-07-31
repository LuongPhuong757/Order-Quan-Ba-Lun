# Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-31
**Phase:** 09-Duyệt đơn, Thông báo & Theo dõi đơn
**Areas discussed:** Chuông báo đơn mới, Mất kết nối SSE, Lý do từ chối đơn, Auto-OFF và công tắc nhận đơn, Phân quyền trang hàng chờ, Phạm vi sửa Phase 8

---

## Bối cảnh trước khi thảo luận

Spec `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` đã chốt sẵn phần lớn phase 9 nên **không đưa ra
thảo luận lại**: công thức % (§6), 5 mốc stage, ngưỡng 90s/1800s, `SmsChannel` adapter với
console/esms driver, email chỉ dùng tổng hợp cuối ngày, cấp bàn `code` ASC + tự tạo bàn + row lock,
cột `orders.ship_fee`, re-check tồn kho lúc duyệt, trang `/admin/online-orders`, và 2 cron chết
(`cron-audit-retention.ts` + `cron-jti-cleanup.ts`).

Chỉ 4 chỗ spec không nói được mang ra hỏi, cả 4 đều đụng vào lời hứa cốt lõi "không bao giờ bỏ lọt
đơn".

---

## Phân quyền trang hàng chờ

Chủ dự án chủ động nêu giữa buổi, không nằm trong 4 area ban đầu.

**Yêu cầu nguyên văn:** *"ở phần duyệt đơn và quản lý đơn này chỉ xuất hiện ở phần quản lý và có 1
page riêng, tất cả các role đều xem được page này"*

| Option | Description | Selected |
|--------|-------------|----------|
| Giữ nguyên: chỉ admin duyệt | 3 role xem, chỉ `admin` bấm được; giữ đúng M2.D-33 và success criterion 1 | |
| admin + order duyệt được | `kitchen` chỉ xem | |
| Cả 3 role đều duyệt được | Ai đang ở máy thì duyệt | ✓ |

**User's choice:** Cả 3 role (`admin`, `order`, `kitchen`) đều duyệt được
**Notes:** Claude nêu xung đột: quyết định này phủ định success criterion 1 của Phase 9 trong
ROADMAP (*"role `order` ... gọi API confirm/reject trực tiếp vẫn bị chặn"*), nghĩa là verifier sẽ
đánh trượt phase dù code đúng ý. Chủ dự án chọn **sửa ROADMAP theo ý mới** thay vì lùi lại. Hệ quả
được ghi vào CONTEXT D-02: audit log phải ghi rõ ai duyệt đơn nào, đây là thứ thay cho lớp bảo vệ
mà M2.D-33 từng cung cấp.

---

## Chuông báo đơn mới

### Xử lý autoplay bị trình duyệt chặn

| Option | Description | Selected |
|--------|-------------|----------|
| Nút "Bật chuông" bắt buộc 1 lần | Banner đỏ chiếm chỗ rõ khi chưa mở khoá âm thanh; bấm 1 lần mở khoá cả phiên | ✓ |
| Thử phát, hỏng thì báo nhẹ | Dòng chữ nhỏ nhắc bấm để bật; dễ bị bỏ qua | |
| Bỏ chuông, chỉ badge + title tab | Không bao giờ bị chặn, nhưng admin ở tab khác không biết | |

**User's choice:** Nút "Bật chuông" bắt buộc 1 lần

### Kiểu kêu

| Option | Description | Selected |
|--------|-------------|----------|
| Lặp tới khi hết đơn chờ (~20-30s/lần) | Khó bỏ lọt nhất, nhưng giờ cao điểm có thể phiền | ✓* |
| Kêu 1 lần mỗi đơn | Không phiền, nhưng rời máy lúc chuông kêu là lỡ đơn | |
| Lặp, nhưng tắt tiếng được | Ai tắt rồi quên bật lại thì quay về đúng bài toán bỏ lọt | |

**User's choice:** Lặp tới khi hết đơn chờ — nhưng **chu kỳ đổi thành 5 phút**, không phải 20-30s
như Claude đề xuất.

### Chuông kêu cho ai

| Option | Description | Selected |
|--------|-------------|----------|
| Chỉ role duyệt được | Role chỉ-xem không bị âm thanh làm phiền | ✓* |
| Cả 3 role đều nghe | Toàn quán biết, nhưng bếp dễ tắt tiếng vĩnh viễn | |
| Mỗi người tự chọn | Mặc định BẬT cho role duyệt được, TẮT cho role chỉ-xem | |

**User's choice:** Ban đầu chọn "chỉ role duyệt được" — nhưng vì quyết định trước đó cho **cả 3
role đều duyệt được**, hai câu trả lời cộng lại thành "cả 3 role đều nghe". Claude nêu lại điểm này
và hỏi xác nhận; chủ dự án khẳng định: *"Cả 3 đều nhận được chuông, lặp lại liên tục mỗi lần cách
nhau 5p"*.

---

## Mất kết nối SSE

### Nối lại thì thấy gì

| Option | Description | Selected |
|--------|-------------|----------|
| Tải lại toàn bộ hàng chờ từ DB | DB là nguồn sự thật; đúng kể cả khi API restart hay sửa dữ liệu tay | ✓ |
| Phát lại event đã lỡ (Last-Event-ID) | Đúng bài SSE hơn nhưng phải giữ buffer, restart API là mất | |
| Poll định kỳ song song SSE | Lưới an toàn 30s kể cả khi SSE chết im lặng | |

**User's choice:** Tải lại toàn bộ hàng chờ từ DB

### Báo cho admin biết đang đứt

| Option | Description | Selected |
|--------|-------------|----------|
| Chấm trạng thái + banner khi đứt | Đứt >~10s thì chấm đỏ + banner chiếm chỗ rõ | ✓ |
| Chỉ chấm trạng thái nhỏ | Gọn mắt nhưng dễ không ai để ý | |
| Không báo, tự nối lại ngầm | Chỉ hợp lý nếu chọn poll song song ở câu trên | |

**User's choice:** Chấm trạng thái + banner khi đứt

---

## Lý do từ chối đơn

### Cách nhập lý do

| Option | Description | Selected |
|--------|-------------|----------|
| Chọn từ danh sách + ô ghi chú riêng | ~5 lý do soạn sẵn cho khách; ghi chú tự do chỉ nội bộ | ✓ |
| Gõ tự do, gửi nguyên văn | Linh hoạt nhưng chữ gõ vội đi thẳng tới khách | |
| Chọn danh sách, sửa được trước khi gửi | Dung hoà, nhưng vẫn có đường để chữ vội tới khách | |

**User's choice:** Chọn từ danh sách + ô ghi chú riêng
**Notes:** Điểm quyết định là `reject_reason` nằm trong response công khai `/o/:token` — khách đọc
được nguyên văn.

### Báo khách khi bị từ chối

| Option | Description | Selected |
|--------|-------------|----------|
| Chỉ hiện trên /o/:token | Không tốn SMS; khách đóng tab thì không biết | ✓ |
| SMS cho khách khi bị từ chối | Đóng đúng lỗ hổng "khách chờ vô vọng" nhưng tốn tin nhắn | |
| Bạn quyết | | |

**User's choice:** Chỉ hiện trên /o/:token

---

## Auto-OFF và công tắc nhận đơn

Đây là area gây thay đổi lớn nhất buổi.

### Câu hỏi ban đầu: auto-OFF rồi ai biết?

| Option | Description | Selected |
|--------|-------------|----------|
| SMS báo chính chủ quán | Kênh duy nhất tới được người không ngồi trước máy | ✓ |
| Banner đỏ ở Dashboard + audit log | Người đã không trực máy 30 phút cũng không thấy banner | |
| Cả hai | | |

**User's choice:** SMS báo chính chủ quán *(về sau thành moot vì auto-OFF bị bỏ hẳn)*

### Câu hỏi kèm theo: đơn WAITING tồn trong lúc auto-OFF xử lý sao?

Chủ dự án **không chọn phương án nào**, mà đưa yêu cầu mới hoàn toàn:

> *"Với việc ON-OFF, kể cả ON-OFF thì hệ thống vẫn cho đặt đơn bình thường, và sẽ có thông báo cố
> định kiểu 'Hiện chúng tôi đang đóng cửa đơn của quý khách cứ tiếp tục đặt và chúng tôi sẽ xử lý
> sớm nhất có thể'. Và khi đặt hàng xong thay vì báo đặt hàng thành công thì lại hiển thị 'Chúng
> tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại'. Các text này để có thể sửa linh động
> được"*

**Claude nêu phản đối trước khi ghi nhận**, chỉ ra rằng yêu cầu này phủ định:
- M2.D-27 (chặn 2 lớp: FE ẩn nút VÀ BE reject 409) — đã ship ở `order-guard.ts:29-30` và
  `submit-order.ts:89,93`, có test riêng
- M2.D-26 (khi OFF khoá nút đặt)
- Success criterion "chặn 2 lớp" của Phase 8 — đã ghi `passed` trong `08-VERIFICATION.md` **cùng
  ngày**
- Bước 5–9 của UAT Phase 8 mà chính chủ dự án **vừa duyệt vài giờ trước**, trong đó có chạy curl
  xác nhận API trả 409

và cảnh báo hệ quả: công tắc OFF không còn chặn gì, chỉ đổi chữ; auto-OFF 30 phút mất tác dụng thật
vì đơn vẫn chảy vào lúc không ai trực — đúng tình huống nó sinh ra để chặn.

| Option | Description | Selected |
|--------|-------------|----------|
| Đổi hẳn: OFF chỉ đổi chữ, vẫn nhận đơn | Phải ghi đè M2.D-26/27, sửa ROADMAP cả phase 8 lẫn 9, sửa 08-VERIFICATION.md, viết lại order-guard.test.ts | ✓ |
| Thêm chế độ thứ 3 "Nhận đơn trước" | Giữ OFF cứng, thêm PRE_ORDER; Phase 8 không phải sửa | |
| Tạm giữ nguyên, bàn lại sau | Ghi vào Deferred, phase 9 làm đúng spec hiện tại | |

**User's choice:** Đổi hẳn — OFF chỉ đổi chữ, vẫn nhận đơn
**Notes:** Chủ dự án tái khẳng định sau khi nghe phản đối. Claude ghi nhận là quyết định của chủ dự
án và tiếp tục.

### Nơi lưu các câu chữ sửa được

| Option | Description | Selected |
|--------|-------------|----------|
| /admin/settings, lưu DB | Đổi là ăn ngay, không cần deploy — quan trọng vì đang cấm deploy production | ✓ |
| File cấu hình trong code | Phải build lại + deploy | |
| Bạn quyết | | |

**User's choice:** /admin/settings, lưu DB

### Auto-OFF còn làm gì sau khi OFF không chặn nữa?

| Option | Description | Selected |
|--------|-------------|----------|
| Chuyển sang chế độ đóng cửa + SMS | Tự đổi trạng thái sau 30 phút, bắn SMS, không tự bật lại | |
| Bỏ auto-OFF, chỉ giữ SMS leo thang | | |
| Giữ auto-OFF, chỉ đổi chữ ở /o/:token | | |

**User's choice (free text):** *"Hãy bỏ luôn chức năng auto OFF đi, nếu đặt đơn lúc quán OFF, gọi
xác nhận mà người nghe từ chối thì mình sẽ tiến hành huỷ đơn"*
**Notes:** Bỏ hẳn M2.D-60 và phần auto-OFF của M2.D-36. Xử lý đơn đặt lúc đóng cửa chuyển thành
quy trình người: gọi điện xác nhận, khách từ chối thì admin bấm Từ chối như đơn thường.

### Số trạng thái của công tắc

| Option | Description | Selected |
|--------|-------------|----------|
| 2 trạng thái: Mở / Đóng cửa | Cả hai đều nhận đơn; không còn cách chặn đơn hoàn toàn | ✓ |
| 3 trạng thái, giữ thêm TẮT HẲN | Giữ đường thoát khi cần chặn thật (nghỉ Tết, sửa bếp) | |
| Bạn quyết | | |

**User's choice:** 2 trạng thái: Mở / Đóng cửa

---

## Leo thang SMS sau khi bỏ auto-OFF

| Option | Description | Selected |
|--------|-------------|----------|
| Giữ nguyên SMS 90s | Lớp duy nhất còn lại tới được người không ngồi trước máy | ✓ |
| Giữ, và SMS lặp nếu vẫn không ai duyệt | Bù lại việc bỏ auto-OFF | |
| Bỏ luôn SMS | Thu hẹp REQ-N từ 4 lớp xuống 2 | |

**User's choice:** Giữ nguyên SMS 90s

---

## Phạm vi sửa Phase 8

| Option | Description | Selected |
|--------|-------------|----------|
| Gộp vào Phase 9 | Phase 9 phình to nhưng không có giai đoạn nào code mâu thuẫn tài liệu | ✓ |
| Phase 8.1 riêng, làm trước | Ranh giới sạch, dễ review, dễ revert | |
| Bạn quyết | | |

**User's choice:** Gộp vào Phase 9

---

## Claude's Discretion

- Chọn 5 lý do từ chối cụ thể (miễn trung tính, không đổ lỗi cho khách)
- Xoá hẳn hay giữ no-op cho setting `escalate_autooff_after_s`
- Có lặp SMS sau lần đầu ở 90s hay không
- Ngưỡng chính xác để coi là "SSE đứt" (gợi ý ~10s)

## Deferred Ideas

- **SMS báo khách khi đơn bị từ chối** — cân nhắc, bị loại. Hạ tầng đã sẵn nên mở lại rẻ.
- **Trạng thái thứ 3 "TẮT HẲN" (chặn 409 thật)** — bị loại khi chọn 2 trạng thái. Code chặn cũ nằm
  trong lịch sử git phase 8 nếu cần lấy lại.
- **Điền thông tin liên hệ quán** vào `apps/shop/src/lib/shop-contact.ts` — việc của chủ quán,
  không phải hạng mục kỹ thuật.
