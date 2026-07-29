> ## ✅ ĐÃ GIẢI QUYẾT — 2026-07-29, commit `3ac6ab5`
>
> Cả 6 điểm bên dưới đã được chủ dự án quyết, `/gsd:ingest-docs` chạy xong, `PROJECT.md` /
> `REQUIREMENTS.md` / `ROADMAP.md` / `STATE.md` / `config.json` đã sinh.
> **File này giữ lại làm lịch sử — đừng hỏi lại 6 câu này.** Trạng thái hiện tại đọc ở `STATE.md`.
>
> Quyết định cuối: (1) dùng bản dựng lại — `.vg/ROADMAP.md` **chưa bao giờ** có Phase 07 nên không có bản gốc ·
> (2) ảnh mobile đã cung cấp 2026-07-29 → `docs/design-refs/lotteria/README.md`, gate còn lại chỉ là logo/màu ·
> (3) 5 criteria production → deferred UAT · (4) tách hàm thuần + harness integration MySQL ·
> (5) mở rộng M2.D-67 sang so khớp host chính xác (C-SEC-01) · (6) `@nestjs/schedule` in-process.
>
> Bước tiếp: `/gsd:plan-phase 7`.

---

# Điểm dừng — GSD ingest Milestone 2

**Dừng lúc:** 2026-07-29, giữa `/gsd:ingest-docs` (bước `conflict_gate`)
**Nhánh:** `feat/online-ordering`
**Ràng buộc user đã chốt:** toàn bộ M2 làm **LOCAL ONLY** — không deploy, không đụng VPS production. Push GitHub thì được (repo không có CI/CD nên push không kích hoạt gì).

---

## Đã xong

- `.planning/codebase/` — 7 tài liệu map codebase (4 mapper agent song song). Commit `ada1bc6`.
- `.planning/intel/` — synthesize xong từ `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`:
  - 71 quyết định M2.D-01..71 (giữ nguyên tiếng Việt, 2 chuỗi supersession)
  - 9 requirements (REQ-Q, I, J, K, L, M, N, O, P)
  - 22 constraints (14 từ spec + 8 chỉ phát hiện được từ codebase)
- `.planning/INGEST-CONFLICTS.md` — 0 blocker, 6 warning, 12 auto-resolved.

## CHƯA xong

`PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` **chưa sinh** — safety gate của GSD đang giữ, vì 6 warning cần anh quyết trước khi `gsd-roadmapper` chạy.

---

## 6 việc cần anh quyết để chạy tiếp

Đọc chi tiết ở `.planning/INGEST-CONFLICTS.md`. Tóm tắt:

**1. Success criteria của phase 07 nằm trong file đã xoá.**
Spec dòng 546 trỏ `.vg/ROADMAP.md § Phase 07`, file đó đã xoá khi gỡ VGFlow. Synthesizer đã dựng lại từ checklist §12 + 5 criteria bị xếp lầm vào phase 08 — nhưng đó là suy luận, không phải chữ gốc.
→ Chọn: (a) duyệt bản dựng lại trong `.planning/intel/requirements.md`, hoặc (b) lấy lại bản gốc `git show <commit>:.vg/ROADMAP.md` rồi ingest lại.

**2. Ảnh design ref bản mobile — spec tự mâu thuẫn.**
M2.D-71 (LOCKED) nói phải có ảnh **trước khi** làm phase 08 và gọi thiếu ảnh mobile là "rủi ro lớn nhất vì khách gần như 100% vào bằng điện thoại". Nhưng §11 lại xếp đúng mấy ảnh đó vào danh sách "không block phase 07/08". `docs/design-refs/lotteria/` chưa tạo. Màu thương hiệu vẫn là `#E4453A` của Lotteria, chờ logo quán.
→ Chọn: (a) chụp ảnh + chốt logo/màu trước, hoặc (b) chấp nhận làm phase 08 theo `apps/shop/src/styles/tokens.css` rồi re-skin sau. Phase 07 không ảnh hưởng.

**3. 5 criteria chỉ nghiệm thu được trên production, nhưng M2 là LOCAL ONLY.**
DNS `order.`, cert Caddy, `Permissions-Policy: geolocation=(self)` qua Caddy thật, cookie host-only qua 2 hostname thật, static routing đầu-cuối.
→ Đề xuất: mang sang dạng **deferred UAT** (`[PROD-UAT]`), thay bằng gate local: curl với `Host:` header, unit test cho origin allow-list, grep `/dashboard`+`/kitchen` trong bundle đã build, và sửa Caddyfile/Dockerfile/compose nhưng **không apply**.

**4. Spec bắt buộc có test tự động, repo chưa có harness cho API.**
M2.D-23 "assert trong test", M2.D-01 đếm doanh thu, M2.D-06 2 request song song, M2.D-33 gọi API trực tiếp. Thực tế: cả repo 1 file test; `apps/api` có vitest nhưng 0 test; không có `vitest.config.ts`, không jsdom, không CI.
→ Chọn harness trước: `Test.createTestingModule` + mock repo cho phần thuần, **hay** harness integration MySQL thật (compose đã có mysql cổng 3307) cho M2.D-06 (row lock) và M2.D-01 (doanh thu) — 2 cái này không mock được. Nên tách hàm thuần (`computeProgress`, Haversine, giờ mở cửa, parse origin) để test kiểu zero-config như `apps/web`.

**5. M2.D-67 làm đúng chữ vẫn để hở lỗ prefix-spoofing.**
[csrf-origin.middleware.ts:26,35](../apps/api/src/common/middleware/csrf-origin.middleware.ts#L26) so bằng `origin.startsWith(allowed)`. Đổi thành danh sách mà giữ `startsWith` thì `https://quanbalun.site.evil.com` vẫn lọt. Hiện `SameSite=Strict` che nên chưa khai thác được, nhưng M2 chính là thay đổi thêm origin thứ hai + endpoint mutation công khai đầu tiên.
→ Đề xuất **mở rộng phạm vi M2.D-67**: parse `new URL()`, so `protocol + '//' + host` bằng chính xác. Đây là mở rộng một quyết định LOCKED, cần anh đồng ý, không cần viết lại spec. Ghi là C-SEC-01.

**6. Poller outbox 15s chưa có chỗ chạy.**
Spec §507 cần `cron-notification-outbox.ts` mỗi 15s. Nhưng 2 cron đang có (`cron-audit-retention`, `cron-jti-cleanup`) là CLI script **không được scheduler nào gọi** — không có entry trong `docker-compose.yml`, `docker-compose.prod.yml`, hay `Caddyfile`. Nếu ship kiểu đó nữa thì cả thang leo thang (SMS 90s, auto-OFF 1800s) im lặng không bao giờ chạy — đúng cái chủ quán làm tính năng này để tránh.
→ Chọn: `@nestjs/schedule` in-process (không đổi hạ tầng, đúng với LOCAL ONLY, giữ deploy 1 container) **hay** sidecar compose / crontab host (phải đụng config production, hiện ngoài phạm vi). Quyết định này cũng đồng thời sửa hoặc để mặc 2 cron cũ đang chết.

---

## Về nhà chạy lại thế nào

```bash
git checkout feat/online-ordering
git pull
```

Rồi nói với Claude: *"đọc .planning/INGEST-RESUME.md, tôi quyết 6 điểm như sau: ..."* — sau khi có 6 quyết định, bước tiếp là spawn `gsd-roadmapper` để sinh `PROJECT.md` / `REQUIREMENTS.md` / `ROADMAP.md` / `STATE.md`, rồi `/gsd:plan-phase 07`.

## Lưu ý khác

- **Phase 07 chưa xong, mới ~1/3.** Spec dòng 659 nói đã xong nhưng chỉ kể 4 việc; 5 việc còn lại chưa làm: `Host`-switch trong `main.ts`, stage `shop` trong `Dockerfile`, `ALLOWED_ORIGIN` dạng list, Caddy block `order.` + `geolocation=(self)`, DNS. Xem INFO thứ 6 trong `INGEST-CONFLICTS.md`.
- `OVERRIDE-DEBT.md` mà spec §28/§134 yêu cầu **chưa tồn tại**; chuỗi override M2.D-59/60 hiện ghi trong `.planning/intel/decisions.md`.
- `deploy.sh` vẫn **untracked** (cố ý — chưa commit vì anh chưa yêu cầu; nó đọc secret từ `.env.deploy` đang gitignore nên không có rủi ro lộ).
- §7 pseudo-code dòng 469 còn ghi `300s` cho auto-OFF trong khi M2.D-60 chốt `1800s` — chưa sửa trong file spec, đã ghi cảnh báo ở `constraints.md` C-FLOW-01.
