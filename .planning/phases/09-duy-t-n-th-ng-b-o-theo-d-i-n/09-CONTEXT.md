# Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Đơn khách gửi được duyệt nhanh, không bao giờ bị bỏ quên, và khách tự theo dõi được tiến độ mà
không thấy trạng thái từng món (REQ-M, REQ-N, REQ-O).

**Phase này ĐỒNG THỜI phải sửa lại một phần Phase 8 đã ship** (D-14 bên dưới): công tắc nhận đơn
đổi ngữ nghĩa hoàn toàn. Đây không phải scope creep — đây là hệ quả trực tiếp của quyết định D-09
mà chủ dự án chốt trong chính buổi discuss này, và để code mâu thuẫn với tài liệu qua một phase là
rủi ro lớn hơn việc phase 9 phình to.

**KHÔNG thuộc phase này:** analytics / phễu chuyển đổi (Phase 10), thanh toán, KiotViet.

</domain>

<decisions>
## Implementation Decisions

### Trang hàng chờ duyệt và phân quyền

- **D-01:** Hàng chờ duyệt là **1 trang riêng trong `apps/web`** tại `/admin/online-orders`
  (`OnlineOrdersQueuePage`), không nhúng vào Dashboard. Khớp spec §529.
- **D-02:** **Cả 3 role `admin` / `order` / `kitchen` đều XEM và ĐUYỆT được** (bấm Xác nhận và Từ
  chối). ⚠ **GHI ĐÈ M2.D-33** ("chỉ role `admin` được xác nhận/từ chối") và ghi đè phần phân quyền
  của M2.D-32. Lý do chủ dự án: ai đang ở máy thì duyệt, không để chủ quán thành nút thắt giờ cao
  điểm. Hệ quả bắt buộc: **audit log phải ghi rõ AI duyệt đơn nào** — đây là thứ thay thế cho lớp
  bảo vệ mà M2.D-33 cung cấp, nên test phải chứng minh nó, không chỉ chứng minh "duyệt được".
- **D-02b:** Success criterion 1 của Phase 9 trong ROADMAP.md hiện ghi *"role `order` xem được hàng
  chờ nhưng gọi API confirm/reject trực tiếp vẫn bị chặn"* — **tiêu chí này phải được sửa** theo
  D-02, nếu không verifier sẽ đánh trượt phase dù code làm đúng ý chủ dự án.

### Chuông báo đơn mới

- **D-03:** Trình duyệt chặn `Audio.play()` khi trang chưa có thao tác người dùng, nên trang hàng
  chờ phải có **nút "Bật chuông" bắt buộc**: khi âm thanh chưa được mở khoá, hiện **banner đỏ chiếm
  chỗ rõ** ("Chuông đang tắt — bấm để bật"), bấm 1 lần là mở khoá cho cả phiên. Không được để admin
  ngồi trước một trang câm mà tưởng nó đang hoạt động.
- **D-04:** Chuông **lặp mỗi 5 phút** chừng nào còn ít nhất 1 đơn `WAITING`; duyệt/từ chối hết thì
  im. **Cả 3 role đều nghe**, mặc định BẬT cho tất cả.
- **D-05:** Kèm badge số đơn chờ + đồng hồ đếm giây chờ từng đơn (spec §583).

### Mất kết nối SSE

- **D-06:** Khi SSE mở lần đầu **và mỗi lần nối lại**, FE gọi luôn
  `GET /api/admin/online-orders?status=WAITING` để **tải lại toàn bộ hàng chờ từ DB**. KHÔNG dùng
  `Last-Event-ID` / replay buffer. Lý do: DB là nguồn sự thật duy nhất, đúng kể cả khi API restart
  hay dữ liệu bị sửa tay, và không phải giữ lịch sử event trong bộ nhớ.
- **D-07:** Trang hiện **chấm trạng thái kết nối**; đứt quá ~10s thì chấm chuyển đỏ **và hiện banner
  chiếm chỗ rõ** "Mất kết nối — đang thử nối lại". SSE chết là loại lỗi im lặng (trang trông bình
  thường, chỉ là không bao giờ có đơn mới) nên bắt buộc phải nhìn thấy được.

### Từ chối đơn

- **D-08:** Admin **chọn 1 lý do từ danh sách soạn sẵn** (~5 mục: hết nguyên liệu / ngoài vùng giao /
  quá tải / sai thông tin liên hệ / khác). **Chỉ câu soạn sẵn này đi tới khách** qua `reject_reason`
  trong response công khai `/o/:token`.
- **D-09:** Kèm **ô ghi chú tự do CHỈ lưu nội bộ** (DB + audit log), **tuyệt đối không** đưa vào
  response công khai. Lý do: `reject_reason` là field khách đọc được nguyên văn — chữ admin gõ vội
  giờ cao điểm không được đi thẳng tới khách.
- **D-10:** Khách bị từ chối **chỉ biết qua `/o/:token`** (hiện trạng thái từ chối + lý do + nút gọi
  quán). **Không** bắn SMS cho khách.

### Công tắc nhận đơn — ĐỔI NGỮ NGHĨA HOÀN TOÀN

- **D-11:** Công tắc còn đúng **2 trạng thái: Mở / Đóng cửa**, và **CẢ HAI ĐỀU NHẬN ĐƠN BÌNH
  THƯỜNG**. "Đóng cửa" chỉ đổi chữ hiển thị, không chặn gì.
  ⚠ **GHI ĐÈ M2.D-26 và M2.D-27** (chặn 2 lớp: FE ẩn nút VÀ BE reject `409`).
  - Trang khách khi Đóng cửa: banner cố định kiểu *"Hiện chúng tôi đang đóng cửa, đơn của quý khách
    cứ tiếp tục đặt và chúng tôi sẽ xử lý sớm nhất có thể"*.
  - Sau khi submit thành công lúc Đóng cửa: màn xác nhận đổi từ "Đặt hàng thành công" sang
    *"Chúng tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại"*.
- **D-12:** **Bỏ hẳn auto-OFF.** ⚠ **GHI ĐÈ M2.D-60** (auto-OFF sau 1800s) **và phần auto-OFF của
  M2.D-36**. Không còn cơ chế nào tự đổi trạng thái công tắc. Setting `escalate_autooff_after_s`
  thành chết — planner phải quyết định xoá hẳn hay giữ lại làm no-op, và ghi rõ lựa chọn.
- **D-13:** Đơn đặt trong lúc Đóng cửa xử lý **bằng người**: quán gọi điện xác nhận với khách; khách
  từ chối thì admin bấm Từ chối như đơn thường. Không có luồng tự động nào cho việc này.
- **D-14:** **Cả 2 câu chữ ở D-11 sửa được ở `/admin/settings`, lưu DB** (cùng tab công tắc nhận
  đơn đã có từ phase 8, cạnh ô lý do tạm ngưng đã tồn tại). Đổi chữ là ăn ngay, không cần build
  lại — quan trọng vì đang cấm deploy production. Đúng **2 key cấu hình mới**:
  1. `closed_banner_text` — banner trên trang khách khi Đóng cửa
  2. `closed_submit_confirm_text` — màn xác nhận sau submit khi Đóng cửa

  *(Bản đầu của file này ghi nhầm là "4 câu chữ" — lỗi đếm lúc soạn, không phải quyết định của chủ
  dự án. Sửa 2026-07-31 sau khi `gsd-ui-checker` phát hiện `09-UI-SPEC.md` chỉ định nghĩa được 2.
  Ô "lý do tạm ngưng" đã có sẵn từ phase 8 và KHÔNG tính vào 2 key này.)*

  ⚠ Cả 2 chuỗi do chủ quán tự nhập nên **độ dài không giới hạn** — layout phải co giãn, không
  ellipsis, không khoá 1 dòng.

### Leo thang thông báo

- **D-15:** **Giữ nguyên SMS ở 90s** (M2.D-36 phần còn lại): đơn còn `WAITING` sau
  `escalate_sms_after_s` (mặc định 90) → bắn SMS tới `notify_sms_recipients` qua
  `notification_outbox` + `SmsChannel`. Sau khi bỏ auto-OFF, **đây là lớp duy nhất còn lại tới được
  người đang không ngồi trước máy** — không được cắt.
- **D-16:** Giữ nguyên M2.D-63 (`ConsoleSmsChannel` / `EsmsChannel` chọn bằng `SMS_DRIVER`) và
  M2.D-38 (Email **chỉ** dùng cho tổng hợp cuối ngày, không dùng cho đơn mới).

### Phạm vi sửa Phase 8

- **D-17:** Phần sửa lại Phase 8 do D-11/D-12 gây ra **gộp thẳng vào Phase 9**, không tách phase
  riêng. Chủ dự án chốt. Danh sách tối thiểu phải đụng tới:
  - `apps/api/src/modules/public/order-guard.ts` + `order-guard.test.ts` — bỏ nhánh
    `ONLINE_ORDERING_DISABLED` / `STORE_CLOSED` khỏi đường chặn submit
  - `apps/api/src/modules/public/submit-order.ts:89,93` — 2 case reject 409
  - `apps/api/src/modules/public/store-status.ts` — `evaluateOrderingStatus()`; xem lại OD-07
    (cơ chế "OFF đến hết hôm nay" tính-lúc-đọc vẫn dùng được, nhưng ngữ nghĩa đổi thành "đóng cửa
    đến hết hôm nay")
  - `apps/shop/src/pages/CheckoutPage.tsx` — banner + khoá nút submit
  - `apps/api/src/modules/settings/*` + `apps/web/src/pages/AdminSettingsPage.tsx` — 4 ô chữ mới
  - `.planning/ROADMAP.md` — success criteria của **cả Phase 8 lẫn Phase 9**
  - `.planning/phases/08-*/08-VERIFICATION.md` — đang ghi `passed` cho tiêu chí "chặn 2 lớp" nay
    không còn đúng; phải ghi chú lại chứ không được để nguyên
  - `OVERRIDE-DEBT.md` — entry mới cho M2.D-26, M2.D-27, M2.D-33, M2.D-36, M2.D-60
- **D-18:** **4 lớp chống lạm dụng của Phase 8 KHÔNG bị ảnh hưởng** và phải giữ nguyên xanh:
  1 đơn mở / SĐT, blacklist SĐT, rate-limit, hash IP. Chúng độc lập với công tắc nhận đơn.

### Hạ tầng

- **D-19:** Poller `notification_outbox` chạy mỗi 15s bằng `@nestjs/schedule` **in-process**, và
  **hồi sinh luôn 2 cron đang chết** cùng cơ chế đó: `apps/api/src/cli/cron-audit-retention.ts` và
  `apps/api/src/cli/cron-jti-cleanup.ts` (C-CRON-01, `.planning/codebase/CONCERNS.md:14-17` — chúng
  tồn tại dạng CLI script nhưng không có entry nào trong `docker-compose*.yml` gọi tới, tức là
  "tính năng có code nhưng không bao giờ chạy").
- **D-20:** SSE fan-out **in-process qua `@nestjs/event-emitter`**, KHÔNG giữ 1 DB connection cho
  mỗi subscriber (C-INFRA-01).
- **D-21:** Criterion 2 và 3 của ROADMAP (row lock cấp bàn, đơn WAITING không lẫn vào doanh thu)
  cần **harness integration MySQL thật** — mock không chứng minh được (C-TEST-01). Phase 8 đã có
  tiền lệ: `apps/api/src/modules/public/open-order-lock.integration.test.ts` chạy 2 connection MySQL
  thật; dùng lại đúng khuôn đó.

### Claude's Discretion

- Chọn 5 lý do từ chối cụ thể (D-08) — planner soạn, miễn là trung tính và không đổ lỗi cho khách.
- Xoá hẳn hay giữ no-op cho `escalate_autooff_after_s` (D-12).
- Có lặp SMS sau lần đầu ở 90s hay không — chủ dự án chọn "giữ nguyên SMS 90s", không nói về lặp.
- Ngưỡng chính xác để coi là "SSE đứt" (D-07 gợi ý ~10s).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec gốc Milestone 2
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §6 — công thức % tiến độ đầy đủ
  (`KITCHEN .15 / COOKING .45 / READY .80 / SERVED 1.00`, chặn 95%, đơn điệu qua
  `max_progress_shown`), shape response `/api/public/orders/:order_token`, và 5 mốc `stage`
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §7 (dòng ~460-510) — luồng xác nhận đơn chi tiết:
  cấp bàn trong transaction + row lock, tự tạo bàn khi hết, re-check tồn kho lúc duyệt (M2.D-61),
  ô phí ship (M2.D-62), danh sách cron cần thêm
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` dòng 389-393 — 4 endpoint admin online-orders + SSE
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` dòng 529 — màn hình `OnlineOrdersQueuePage`
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` dòng 583-599 — checklist nghiệm thu phase 9
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` dòng 287 — cột `max_progress_shown`
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` dòng 255-256 — `escalate_sms_after_s`,
  `escalate_autooff_after_s`

⚠ **Cảnh báo cho planner:** M2.D-26, M2.D-27, M2.D-33, M2.D-36 (phần auto-OFF) và M2.D-60 trong
spec này **đã bị ghi đè** bởi D-02/D-11/D-12 ở trên. Đọc spec để lấy chi tiết kỹ thuật, nhưng
quyết định trong CONTEXT.md này thắng khi mâu thuẫn.

### Kế hoạch dự án
- `.planning/ROADMAP.md` § Phase 9 — 5 success criteria (criterion 1 phải sửa, xem D-02b) và
  § Phase 8 (criterion "chặn 2 lớp" phải sửa, xem D-17)
- `.planning/REQUIREMENTS.md` — REQ-M (dòng 52), REQ-N (dòng 57), REQ-O (dòng 62)
- `.planning/PROJECT.md` — core value: "khách đặt được món từ xa mà quán không bao giờ bỏ lọt đơn,
  và đơn chưa duyệt không bao giờ lẫn vào bếp / sơ đồ bàn / doanh thu"

### Nợ và ràng buộc đã ghi
- `OVERRIDE-DEBT.md` — OD-01..OD-10 hiện có; phase 9 phải thêm entry cho các ghi đè ở D-02/D-11/D-12
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-CONTEXT.md` — 22 quyết định
  phase 8, đặc biệt D-10/D-11 (đã bị OD-09/OD-10 ghi đè) và các quyết định về giỏ hàng
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-VERIFICATION.md` — trạng thái
  `passed` của phase 8; phase 9 làm một tiêu chí trong đó hết đúng
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-UAT.md` — 5 hạng mục deferred
  còn treo; **test 1 (`docker build` + `sharp` trên alpine) là gate bắt buộc trước deploy
  production**
- `.planning/codebase/CONCERNS.md` dòng 14-17, 123 — 2 cron chết, không có scheduler wiring

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runWithRetry()` — đã có sẵn, spec chỉ đích danh dùng cho cấp bàn khi deadlock (M2.D-06)
- `apps/api/src/modules/public/open-order-lock.integration.test.ts` — khuôn test integration chạy
  2 connection MySQL thật, dùng lại cho test row lock cấp bàn và test doanh thu (D-21)
- `apps/api/src/modules/settings/settings.service.ts` + `settings.controller.ts` +
  `apps/web/src/pages/AdminSettingsPage.tsx` — trang cài đặt 2 tab đã có từ phase 8; 4 ô chữ mới
  (D-14) gắn vào đây, không dựng trang mới
- `apps/shop/src/pages/OrderTrackPage.tsx` — trang `/o/:token` phase 8 dựng tối giản đúng để phase
  9 điền nội dung đầy đủ (% + 5 mốc)
- `apps/shop/src/components/BannerNotice.tsx` — banner đã dùng cho tạm ngưng nhận đơn; dùng lại cho
  banner "đóng cửa" (D-11) và banner mất kết nối SSE (D-07)
- `apps/api/src/modules/public/store-status.ts` — `evaluateOrderingStatus()` thuần, có test qua nửa
  đêm; giữ cơ chế, đổi ngữ nghĩa

### Established Patterns
- **Route admin không có tiền tố `/api`** (OD-08): `@Controller('admin/...')`, và `apps/web` gọi
  thẳng `/admin/...`. Endpoint mới của phase 9 phải theo đúng nếp này, KHÔNG dùng `/api/admin/...`
  như spec ghi — nếu không sẽ lệch với `admin/users`, `admin/audit` đang chạy production.
- **3 role**: `ROLE_VALUES = ['admin', 'order', 'kitchen']` tại
  `apps/api/src/modules/admin/users.controller.ts:26`
- **Design token bắt buộc** cho `apps/shop`: không hardcode màu/px, luôn `var(--...)` từ
  `apps/shop/src/styles/tokens.css`. `apps/web` thì đang hardcode rải rác — đừng lây sang shop.
- **Gate bundle** `scripts/check-shop-bundle.sh`: ngưỡng 370 kB, hiện dùng 352 kB. Phase 9 thêm code
  vào `apps/shop` (trang tracking đầy đủ) phải để mắt tới ngưỡng này.

### Integration Points
- `apps/api/src/modules/public/order-guard.ts:19-30` và `submit-order.ts:89,93` — **2 điểm phải sửa**
  để bỏ chặn theo D-11
- `apps/api/src/cli/cron-audit-retention.ts`, `apps/api/src/cli/cron-jti-cleanup.ts` — 2 cron chết
  cần hồi sinh (D-19)
- Bảng staging `online_order_requests` (M2.D-01) là ranh giới cách ly: đơn `WAITING` không được lọt
  vào `orders`, nơi có 48 điểm query doanh thu / history / sơ đồ bàn / bếp

</code_context>

<specifics>
## Specific Ideas

- Câu chữ chủ dự án đọc nguyên văn cho trạng thái Đóng cửa (D-11), dùng làm giá trị mặc định của
  ô cấu hình:
  - Banner trang khách: *"Hiện chúng tôi đang đóng cửa, đơn của quý khách cứ tiếp tục đặt và chúng
    tôi sẽ xử lý sớm nhất có thể"*
  - Màn xác nhận sau submit: *"Chúng tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại"*
- Chuông lặp **đúng 5 phút** — con số chủ dự án đưa ra, không phải mình đề xuất (mình đề xuất
  20-30s và bị đổi).

</specifics>

<deferred>
## Deferred Ideas

- **Thông báo cho khách khi đơn bị từ chối bằng SMS** — cân nhắc và bị loại ở D-10 (chỉ hiện trên
  `/o/:token`). Nếu sau này thấy khách bỏ lỡ thông báo từ chối thì mở lại; hạ tầng `SmsChannel` +
  outbox đã sẵn nên chi phí thêm thấp.
- **Trạng thái thứ 3 "TẮT HẲN" (chặn 409 thật)** — chủ dự án chọn chỉ 2 trạng thái ở D-11. Nếu sau
  này cần chặn thật (nghỉ Tết, sửa bếp) thì đây là thứ phải thêm lại, và code chặn cũ nằm trong
  lịch sử git phase 8.
- **Điền thông tin liên hệ quán** vào `apps/shop/src/lib/shop-contact.ts` (đang rỗng nên footer tự
  ẩn hết) — việc của chủ quán, không phải hạng mục kỹ thuật của phase nào.

</deferred>

---

*Phase: 9-Duyệt đơn, Thông báo & Theo dõi đơn*
*Context gathered: 2026-07-31*
