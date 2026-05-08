# Roadmap — OrderQuanBaLun

**Generated:** 2026-05-08T06:43:31Z
**Total:** 6 phases, 8 requirements mapped (Milestone 1 — MVP)
**Foundation:** see `.vg/FOUNDATION.md` (15 F-XX decisions + §9 Architecture Lock)

---

## Phase 01: Foundation & Auth Infrastructure
**Goal:** Cài đặt nền tảng auth (login, session) và audit log infrastructure để mọi phase sau có thể capture actor + log mutation.
**Requirements:** REQ-C, REQ-G
**Depends on:** None
**Size:** M
**Success criteria:**
- Login form hoạt động với cookie HttpOnly+Secure+SameSite=Strict, lifetime 12h, password bcrypt cost 10 (≥8 chars).
- Failed login attempt logged + rate-limit cơ bản chống brute-force.
- `audit_log` table schema khớp §9.5 (actor_id, actor_name, ip, ts_ms, before, after, action_kind), retention 90 ngày qua cron job.
- Owner UI xem audit log có filter theo actor / action_kind / date range; export CSV.
- Audit log immutable (no edit/delete from any UI surface).
- Logout clear cookie + ghi audit log entry.
**Plans:** 0/0
**Status:** planned

---

## Phase 02: Menu Management & Bulk Import
**Goal:** Quản lý món ăn với bulk import CSV/Excel, cây nhóm hàng 3 cấp, hỗ trợ nhiều hình ảnh URL.
**Requirements:** REQ-A
**Depends on:** 01
**Size:** M
**Success criteria:**
- Import CSV/Excel với 8 cột (Loại hàng / Loại thực đơn / Nhóm hàng 3 cấp / Mã hàng / Tên / Giá / ĐVT / Hình ảnh) tạo món thành công, lỗi từng dòng được liệt kê (không abort batch).
- Nhóm hàng 3 cấp lưu dạng cây (parent → child → grandchild), UI tree explorer.
- Hình ảnh URL list không giới hạn số URL, UI carousel hiển thị tất cả.
- Mã hàng unique trong toàn hệ thống (1 quán); trùng mã reject + báo lỗi cụ thể.
- ĐVT free-text (phần / cốc / kg / chai...) không enum cố định.
**Plans:** 0/0
**Status:** planned

---

## Phase 03: Table Management & Layout
**Goal:** Sơ đồ bàn ăn với vị trí cố định, chuyển bàn (không tách/gộp), 3 loại bàn dine-in/takeaway/delivery với driver assignment.
**Requirements:** REQ-B
**Depends on:** 01
**Size:** M
**Success criteria:**
- Sơ đồ bàn render bằng 1 trang dashboard với vị trí (x,y) cố định cho từng bàn.
- Click bàn → modal/drawer hiện danh sách order hiện tại; KHÔNG tách/gộp ở phase này.
- Chuyển bàn (vd 1→2): tất cả order chuyển sang bàn mới atomically + audit log entry.
- 3 loại bàn (dine-in / takeaway / delivery) phân biệt rõ trong UI và DB.
- Bàn delivery có thêm địa chỉ ship + driver field + status (đang ship / đã giao).
**Plans:** 0/0
**Status:** planned

---

## Phase 04: Order Lifecycle & Stock-out Handling
**Goal:** Vòng đời order với state machine (4 chính + 3 phụ), confirm-step khi huỷ sau báo bếp, xử lý hết nguyên liệu (highlight đỏ + manual remove).
**Requirements:** REQ-D, REQ-E
**Depends on:** 01, 02, 03
**Size:** L
**Success criteria:**
- State machine có 4 trạng thái chính (`gọi → báo bếp → đang làm → xong → giao bàn`) + 3 phụ (`CANCELLED`, `OUT_OF_STOCK`, `RETURNED_TO_KITCHEN`); transition matrix valid.
- Huỷ trước báo bếp = 1 click; huỷ sau báo bếp = 2 clicks (1 click + confirm dialog "đã báo bếp rồi, xác nhận huỷ?").
- Đổi món = 2 thao tác riêng (huỷ cũ + thêm mới), không phải 1 atomic.
- Mọi state change ghi audit log với before/after snapshot.
- Bếp UI mark món "hết nguyên liệu" / "có lại"; menu UI tự động highlight đỏ (poll mỗi 30s hoặc real-time).
- Order chưa báo bếp + món hết → user UI cảnh báo, không cho gọi mới với món đó.
- Order đã báo bếp + món hết → KHÔNG auto-cancel, nhân viên xoá tay; audit ghi rõ lý do.
**Plans:** 0/0
**Status:** planned

---

## Phase 05: Auto-close Bàn (Pending-Review Workflow)
**Goal:** Cron job đánh dấu bàn `pending-review` sau 10h, owner UI duyệt cuối ngày để chốt thật (không bao giờ tự chốt tiền).
**Requirements:** REQ-F
**Depends on:** 01, 03, 04
**Size:** S
**Success criteria:**
- Cron job (BullMQ deferred — phase 1 dùng systemd timer hoặc setInterval) chạy mỗi 30 phút, scan bàn `created_at + 10h < now()`, set state = `auto-flagged-after-10h`.
- Owner UI có "Pending review" list, mỗi item có button "Confirm payment" hoặc "Re-open table".
- Confirm payment → state = closed + audit log với actor = chủ quán.
- Re-open → state = open lại, không tính auto-close cho đến lần kế tiếp.
- KHÔNG bao giờ tự chốt tiền mà không có owner action explicit.
**Plans:** 0/0
**Status:** planned

---

## Phase 06: Báo Cáo Cuối Ngày
**Goal:** Báo cáo daily theo timezone Asia/Ho_Chi_Minh, lọc trên "món đã commit vào bàn", aggregation theo nhân viên, drill-down + export PDF/Excel.
**Requirements:** REQ-H
**Depends on:** 01, 04, 05
**Size:** M
**Success criteria:**
- Cutoff theo Asia/Ho_Chi_Minh (00:00 → 23:59:59).
- Tổng đơn (committed_to_table = true) + tổng tiền + breakdown theo nhân viên (ai gọi nhiều nhất / thanh toán nhiều nhất).
- Loại trừ order chỉ ở trạng thái `gọi` chưa commit (drafted but never sent).
- Export PDF + Excel với layout in được.
- Drill-down: click 1 đơn → xem chi tiết món + audit history.
**Plans:** 0/0
**Status:** planned

---

## Dependency Graph

```
                          ┌── 02 (Menu) ──┐
01 (Auth + Audit) ────────┤                ├── 04 (Order + StockOut) ──── 05 (AutoClose) ──── 06 (Report)
                          └── 03 (Table) ──┘
                          (audit chain feeds all downstream phases)
```

Critical path: 01 → 02|03 → 04 → 05 → 06 (5 hops linear).
Parallelizable: 02 và 03 độc lập, có thể chạy song song sau khi 01 xong.

---

## Notes

- Tất cả 6 phase đều `must-have` cho Milestone 1 MVP. Không có phase nice-to-have ở roadmap này.
- VAT integration / RBAC / multi-tenant / khách tự gọi qua QR sẽ là phase mới ở Milestone 2 (xem PROJECT.md "Deferred sang Milestone 2+").
- Khi tới Milestone 2 chạy `/vg:project --milestone` rồi `/vg:roadmap --from-existing` để append phase mới.
