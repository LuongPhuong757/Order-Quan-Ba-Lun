<!-- Kế hoạch thi công M7. Spec: MILESTONE-07-GOI-MON-TAI-BAN-SPEC.md -->

# M7 — Kế hoạch thi công giai đoạn 1 → 4

> Lập bởi `ecc:planner` 2026-10-01 sau khi đọc spec và khảo sát code thật.
> **33 việc** — GĐ1: 9 · GĐ2: 12 · GĐ3: 7 · GĐ4: 5. Mỗi việc là một commit.
> Giai đoạn 5 (quyển menu) chưa lập kế hoạch — đang chờ bản thiết kế lại giao diện.

## GIAI ĐOẠN 1 — Schema + hàm thuần (9 việc, không chạm UI)

| # | Việc | File | Test viết TRƯỚC (phải đỏ) |
|---|---|---|---|
| **V1.1** | Hàm thuần chuẩn hoá số bàn khách gõ | + `public/table-input.ts` | `'5'`/`'05'`/`'bàn 5'`/`' Bàn  5 '` khớp bàn `code='B05'`; `B5`+`B05` cùng tồn tại → `AMBIGUOUS`; không chữ số → `NONE`; bàn takeaway/delivery/inactive không bao giờ khớp; chuỗi >16 ký tự → `NONE` |
| **V1.2** | Hàm thuần sinh mã bàn 4 số | + `public/guest-code.ts` | luôn 4 chữ số; `rng` ép ra `1234` → loại, thử tiếp; mã đã bị chiếm → thử tiếp; `rng` luôn trả mã đã chiếm → sau 50 lần trả `null`, **không lặp vô hạn** |
| **V1.3** | Hàm thuần tách `ok[]`/`skipped[]` | + `orders/split-available-items.ts` | món hết → `skipped` reason `OUT_OF_STOCK`; món ẩn/không có → `GONE`; **mọi món hỏng → `ok` rỗng** (caller phải biết để KHÔNG gọi `addItemsBulk`) |
| **V1.4** | 3 cột mới vào `orders` + cửa chắn schema | ~ `order.entity.ts`, `cli/verify-schema.ts` | `pnpm --filter @order/api schema:verify` → **exit 1**, in `orders thiếu cột guest_code` |
| **V1.5** | Entity `table_guest_sessions` | + `public/entities/table-guest-session.entity.ts`, ~ `data-source.ts`, `verify-schema.ts` | `schema:verify` exit 1 `table_guest_sessions không tồn tại` |
| **V1.6** | Entity `table_order_requests` + `..._items` | + 2 entity, ~ `data-source.ts`, `verify-schema.ts` | `schema:verify` exit 1 cho cả 2 bảng |
| **V1.7** | Hàm thuần "phiên khách còn sống không" | + `public/table-session.ts` | 4 nhánh phủ định + biên `expires_at === nowMs` + **phiên gắn đơn đã đóng → chết** (đây là nguồn của `410 SESSION_ENDED`) |
| **V1.8** | Hàm thuần trần giới hạn & cooldown | + `public/table-limits.ts` | 20 dòng pass / 21 fail; `qty` 20 pass / 21 fail / 0 fail / không nguyên fail; cooldown còn 1ms vẫn chặn, đúng 60.000ms thì mở |
| **V1.9** | Cửa chắn GĐ1 | — | `pnpm typecheck` · `pnpm --filter @order/api test` · `schema:verify` exit 0 |

**Vì sao V1.3 phải có TRƯỚC**: `addItemsBulk` **fail-fast** (`orders.service.ts:687-698`) — ném `NOT_FOUND` nếu có món bị ẩn, `CONFLICT` nếu có món hết. Duyệt một lượt khách dính một món hết thì **cả lượt hỏng**.

⚠ `V1.4`: **KHÔNG** `@Index({unique:true})` trên `guest_code`, **KHÔNG** đụng `source`. Dùng `dateToMsTransformer` như mọi cột datetime khác. Docblock nhắc lại C-SCHEMA-07 + R8.
⚠ `V1.5/V1.6`: phải thêm vào **mảng `entities` tường minh** của `data-source.ts` — thiếu ở đó thì `synchronize` bỏ qua bảng mà `tsc` vẫn xanh.
⚠ Bảng item **KHÔNG CÓ CỘT GIÁ** + `@Index('uq_tor_client', ['order_id','client_request_id'], {unique:true})` + `@Index('idx_tor_waiting', ['status','created_at'])`.

**Song song được**: V1.1 ∥ V1.2 ∥ V1.3 ∥ V1.7 ∥ V1.8. Tuần tự: V1.4 → V1.5 → V1.6 (cùng chạm `data-source.ts` + `verify-schema.ts`).

---

## GIAI ĐOẠN 2 — API (12 việc)

| # | Việc | Điểm chốt |
|---|---|---|
| **V2.1** | Hợp đồng zod dùng chung | + `packages/schemas/src/table-ordering.ts`; output schema khai **`.strict()`** (R7). Test: payload thừa field → ném |
| **V2.2** | Mapper `GET state` (R7 chống rò) | + `public/table-state.mapper.ts`, khuôn `public-menu.mapper.ts`. Test assert payload **không chứa** `id`, `order_id`, `created_by_full_name`, nhật ký bàn; bơm order có `debt_note`/`checked_out_by_full_name` → không lọt |
| **V2.3** | `POST /api/public/table/open` — **R1 tạo đơn LƯỜI** | **KHÔNG gọi `getOrCreateOpenOrder`**, không tạo dòng `orders` nào. Chỉ phân giải bàn + cấp `guest_token`. Trả `table_name` để FE hiện cỡ lớn. Test tích hợp: gọi `/open` **30 lần** với số bàn bịa → `COUNT(*) FROM orders` **không đổi** |
| **V2.4** | Chống dò mã 4 số (R2) | 5 sai/10 phút/IP → 403; 10 sai → khoá **theo bàn** 15 phút → 423 (tự mở). Test: **mã đúng ngay lần 1 → xoá bộ đếm** (gõ nhầm rồi gõ đúng không bị phạt tiếp) |
| **V2.5** | Sinh mã bàn idempotent (đua #2) | `SELECT ... WHERE closed_at IS NULL FOR UPDATE`; đơn đã có mã → **trả lại mã cũ**. Test tích hợp: 2 connection thật gọi song song cùng `order_id` → **cùng một mã** |
| **V2.6** | `POST /api/public/table/cart` (đua #1 + #3) | Gọi `getOrCreateOpenOrder` ⇒ chống đua #1 **miễn phí**. Đụng `UNIQUE(order_id, client_request_id)` → **trả lại `request_id` cũ với 200, KHÔNG 409**. Test tích hợp: gửi 2 lần cùng `client_request_id` → `COUNT(*)` = 1 |
| **V2.7** | `GET /api/public/table/state` | Token đọc từ **header** `X-Guest-Token`. Phiên gắn đơn đã `closed_at` → **410 `SESSION_ENDED`** |
| **V2.8** | `POST /api/public/table/call` + bảng `table_calls` | Cooldown 60s theo `(order_id, kind)` → **429 kèm `cooldown_until`** để màn khách hiện đồng hồ thay vì lỗi đỏ. Test: `kind` khác vẫn cho (cooldown theo cặp) |
| **V2.9** | ⚠ **Override `getTracker` (R6 — BẮT BUỘC)** | `read-only-throttler.guard.ts:85-88`. Path `/api/public/table/` → tracker `guest:<token>`; **không có token → `guestip:<ip>` ô RIÊNG**, tuyệt đối không rơi về `super.getTracker(req)` |
| **V2.10** | 4 endpoint nội bộ (đua #4 + #5) | Đặt trong **`OrdersModule`** để dùng thẳng `addItemsBulk`. Duyệt: `UPDATE ... WHERE id=? AND status='WAITING'`, kiểm **`affectedRows === 0` ⇒ 409** — tuyệt đối không `SELECT` rồi `UPDATE`. Đọc lại `closed_at` **trong cùng transaction**. `ok` rỗng → **không gọi `addItemsBulk`** |
| **V2.11** | Tiền tố proxy dev (bẫy đã biết) | ~ `apps/web/vite.config.ts` thêm `/table-requests`, `/table-calls`. Test khuyến nghị: đọc `vite.config.ts` bằng `fs.readFileSync` và assert đủ tiền tố — biến bẫy "màn rỗng mà log API sạch" thành cửa chắn tự động |
| **V2.12** | Mã bàn vào payload drawer (R10) | `localStorage` hỏng (Safari private ném cả khi ĐỌC) → khách mất token; nhân viên phải đọc lại được mã từ drawer |

**Test V2.9 phải chứng minh 4 điều** (thêm vào `read-only-throttler.integration.test.ts` đã có khuôn Nest thật + `listen(0)`):
1. `guest-token-A` bắn ngập quota → 429 sau limit
2. `guest-token-B` **cùng IP** → vẫn 200 (ô riêng)
3. sau khi IP đã cạn vì khách, **`/ping` với cookie nhân viên → vẫn 200** ⇐ *đây chính là bằng chứng "khách poll không giết nút Báo bếp"*
4. không token → `guestip:` cạn riêng, không kéo theo ô nhân viên

**Cửa chắn GĐ2**: `typecheck` · `test` (một mình) · `schema:verify`. Bốn test tích hợp **phải xanh, không được skip**: `table-open-no-order` · `table-guest-code` · `table-cart-dedup` · `table-approve-race`.
⚠ `curl` thử API phải kèm header `Origin` hợp lệ, không thì 403 CSRF trông như lỗi code.

---

## GIAI ĐOẠN 3 — Màn bếp, chưa có tiếng (7 việc)

> `KitchenPage.tsx` đang 2199 dòng (R11) ⇒ mọi logic ra module riêng, trang chỉ render + truyền props.
> Test web là **vitest môi trường node, không jsdom** ⇒ **mọi thứ cần test phải là hàm thuần trong `lib/`**; component không test tự động.

| # | Việc | Điểm chốt |
|---|---|---|
| **V3.1** | Hàm thuần dựng dữ liệu thẻ duyệt | + `web/src/lib/kds-guest-cards.ts`. `subtotal` theo **giá HIỆN TẠI**, bỏ dòng `gone`. Test: 179s → không nháy, **181s → nháy** (R7); món hết → `gone` và **không cộng** subtotal; payload lỗi → trả `[]`, **không ném** (poll không được chết vì endpoint mới) |
| **V3.2** | Request thứ ba vào `Promise.all` đang có | ~ `KitchenPage.tsx:377-384`. Bọc riêng `.catch(() => null)` để endpoint mới lỗi **không làm chết nhịp poll món**. Không thêm `setInterval`, không thêm kênh |
| **V3.3** | Component `GuestRequestCards.tsx` | Không tự fetch (R11). **Tên bàn là chữ to nhất thẻ (R1)**. Dòng `gone` gạch ngang + nhãn `hết — sẽ bỏ` |
| **V3.4** | CSS `.kds-guest-card` + chèn đầu panel PENDING | Chèn **trước** `cancelled.map(...)` (dòng 1391). Viền **xanh dương/tím** — không đỏ (đỏ = đã huỷ), không cam (cam = `KITCHEN`). Không đụng `.kds-top` |
| **V3.5** | Nút `✓ Duyệt cả lượt` + `✕ Bỏ lượt` | Xử lý 409 (người khác duyệt trước): toast **trung tính** "Lượt này vừa được người khác duyệt" + refresh, **không banner đỏ** |
| **V3.6** | Thẻ gọi `.kds-call-card` | `🔔 BÀN 5 — GỌI THÊM ĐỒ` / `💵 BÀN 5 — THANH TOÁN`, nút `Đã nghe` |
| **V3.7** | *(treo)* Badge lượt chờ trên nav máy Order | **Không làm** cho tới khi chủ quán trả lời (spec §6) |

---

## GIAI ĐOẠN 4 — Chuông đọc tiếng Việt (5 việc)

| # | Việc | Điểm chốt |
|---|---|---|
| **V4.1** | Hàm thuần dựng câu nói | + `web/src/lib/voice-text.ts`. `'B05' → 'Bàn 5'`, `'Bàn 5' → 'Bàn 5'` (**không nhân đôi chữ "Bàn"**). Gộp nhịp: 5 bàn cùng kind → **đúng 1 câu** |
| **V4.2** | Hàm thuần chống đọc lặp (5 lớp) | + `web/src/lib/voice-dedup.ts`. Test quan trọng nhất: **`localStorage` ném lỗi ở cả `getItem` lẫn `setItem` → vẫn chạy bằng Set trong RAM, không ném ra ngoài** (R10, Safari private) |
| **V4.3** | `web/src/lib/voice.ts` | Theo **đúng khuôn `bell.ts`**: `unlock/speak/dispose`, mọi hàm try/catch, **không bao giờ throw**. `getVoices()` rỗng lần đầu trên Chrome ⇒ chờ `voiceschanged`. **Docblock BẮT BUỘC (R9)**: nhiều máy bếp — công tắc mặc định TẮT, bật đúng một máy |
| **V4.4** | Công tắc `🔊 Đọc` trên `.kds-bar` | **Mặc định TẮT**, lưu localStorage theo máy. Tự mở khoá im lặng ở cú bấm đầu tiên bất kỳ |
| **V4.5** | Nối chuông + giọng vào thẻ gọi | **`bell.ring()` TRƯỚC `voice.speak()` LUÔN LUÔN** — kể cả khi không có giọng vi-VN. Thẻ chữ trên màn là nguồn sự thật, giọng là lớp phụ |

---

## Bản đồ 4 rủi ro CAO → việc → bằng chứng

| Rủi ro | Việc | Test chứng minh |
|---|---|---|
| **R1** gõ nhầm số bàn | V2.3 (tạo đơn lười) + V3.3/V3.4 (tên bàn to nhất thẻ) | `table-open-no-order.integration.test.ts` — 30 lần `/open` số bàn bịa, `COUNT(*) FROM orders` không đổi |
| **R6** rate limit IP giết cả quán | V2.9 | `read-only-throttler.integration.test.ts` — sau khi khách đốt cạn quota, `/ping` cookie nhân viên **vẫn 200** |
| **R7** nhân viên quên duyệt | V3.1 (đồng hồ + nháy 3 phút) + V4.2/V4.5 (nhắc 2 lần) + V3.7 (treo) | `kds-guest-cards.test.ts` 179s/181s; `voice-dedup.test.ts` nhắc đúng 2 lần cách 60s |
| **R8** `synchronize` drop bảng | V1.4/V1.5/V1.6 | `schema:verify` exit 0 — truy vấn `information_schema` thật, chạy lại ở cửa chắn **cả GĐ1 và GĐ2** vì worktree khác có thể drop giữa chừng |

---

## Nhắc môi trường (áp cho mọi việc)

- Mọi lệnh pnpm: `export PATH="/opt/homebrew/bin:$PATH"` trước.
- Test API chạy **một mình**, **dừng dev stack trước** — dùng chung DB dev, song song sẽ đỏ ngẫu nhiên (R12). Mỗi file test tích hợp dùng **tiền tố sentinel riêng**.
- `schema:verify` chỉ xanh sau khi API dev của **chính worktree này** boot một lần.
- **Không đưa `pnpm lint` vào cửa chắn** (eslint không khai ở package.json nào). **Không chạy prettier.**
- Turbo cache dùng chung giữa worktree — thấy "cache hit" đáng ngờ thì tự kiểm `dist/`.
- Chỉ sửa file local; không commit/push/deploy khi chưa được yêu cầu rõ.
