# Requirements — OrderQuanBaLun

**Generated:** 2026-05-08T06:39:38Z
**Source:** Auto-extracted from PROJECT.md REQ-A..H (locked at /vg:project Round 9)
**Format:** vgflow REQUIREMENTS schema v1 (consumed by /vg:roadmap → /vg:specs)

---

## Summary

| Stat | Count |
|---|---|
| Total requirements | 8 |
| Must-have (Milestone 1 MVP) | 8 |
| Should-have | 0 |
| Nice-to-have | 0 |
| Phase-assigned | 8 (filled by /vg:roadmap) |

> Tất cả 8 REQ thuộc Milestone 1 (MVP). Future REQ (VAT integration, khách tự gọi qua QR, RBAC, multi-tenant) đã được ghi vào PROJECT.md mục **"Deferred sang Milestone 2+"** và sẽ thêm khi tới Milestone đó.

---

## Requirements (Milestone 1 — MVP)

| REQ ID | Category | Requirement | Priority | Phase | Status |
|--------|----------|-------------|----------|-------|--------|
| REQ-A | Menu Mgmt | Quản lý món ăn với import hàng loạt; cấu trúc 8 trường: Loại hàng / Loại thực đơn / Nhóm hàng (3 cấp) / Mã hàng / Tên hàng hóa / Giá bán / ĐVT / Hình ảnh (nhiều URL). | must-have | 02 | planned |
| REQ-B | Table Mgmt | Sơ đồ bàn (vị trí), order theo bàn, **chuyển bàn** (không tách/gộp). 3 loại bàn: dine-in / takeaway / delivery (D2 — driver assigned + status). | must-have | 03 | planned |
| REQ-C | Auth & Staff | Login đơn giản (no RBAC) capture actor identity cho audit log. Mọi nhân viên cùng quyền (F-06). | must-have | 01 | planned |
| REQ-D | Order Lifecycle | Vòng đời 4 trạng thái chính `gọi → báo bếp → đang làm → xong → giao bàn`; trạng thái phụ `CANCELLED / OUT_OF_STOCK / RETURNED_TO_KITCHEN`. Huỷ sau khi báo bếp = thêm 1 bước xác nhận. | must-have | 04 | planned |
| REQ-E | Stock-out Handling | Bếp đánh dấu món hết → menu highlight đỏ. Order đã báo bếp mà hết → nhân viên xoá tay. Thông báo khách bằng miệng (không qua app). | must-have | 04 | planned |
| REQ-F | Auto-close Table | Sau 10h từ lúc tạo bàn → đánh dấu `pending-review` (KHÔNG tự chốt tiền). Chủ quán duyệt cuối ngày để chốt thật (challenger #2 mitigation). | must-have | 05 | planned |
| REQ-G | Audit Log | Log mọi mutation (cancel/edit/payment/transfer/auto-pay) với `actor_name + actor_id + IP + ts_ms + before/after`, retention 90 ngày (F-06 + §9.5 compensating control). | must-have | 01 | planned |
| REQ-H | Daily Report | Báo cáo cuối ngày dựa trên "món đã commit vào bàn"; KHÔNG tính món chỉ ở trạng thái `gọi` chưa vào bàn. Theo timezone Asia/Ho_Chi_Minh (F-15). | must-have | 06 | planned |

---

## Acceptance Criteria

### REQ-A — Menu Mgmt
- AC-A1: Import file CSV hoặc Excel với 8 cột đúng tên → tạo món thành công, lỗi từng dòng được liệt kê (không abort cả batch).
- AC-A2: Nhóm hàng 3 cấp lưu được dạng cây (parent → child → grandchild) và hiển thị dạng tree trong UI.
- AC-A3: Hình ảnh URL list không giới hạn số URL; UI carousel hiển thị tất cả.
- AC-A4: ĐVT (đơn vị tính) là free-text (vd: phần / cốc / kg / chai).
- AC-A5: Mã hàng unique trong toàn hệ thống (1 quán). Trùng mã → reject + báo lỗi.

### REQ-B — Table Mgmt
- AC-B1: Sơ đồ bàn có vị trí (x,y) cố định, render được bằng 1 trang dashboard.
- AC-B2: Click bàn → thấy danh sách order hiện tại của bàn đó.
- AC-B3: Chuyển bàn (1→2): tất cả order chuyển sang bàn mới, audit log ghi lại.
- AC-B4: Phân biệt 3 loại bàn dine-in / takeaway / delivery; bàn delivery có thêm địa chỉ ship + driver assignment + status (đang ship / đã giao).
- AC-B5: KHÔNG có chức năng tách/gộp bàn ở phase này.

### REQ-C — Auth & Staff
- AC-C1: Login form `username + password`, lifetime 12h, cookie HttpOnly+Secure+SameSite=Strict (§9.5).
- AC-C2: Password bcrypt cost 10, length ≥ 8 (§9.5).
- AC-C3: Logout clear cookie + ghi audit log.
- AC-C4: Mọi nhân viên có cùng quyền (no role separation).
- AC-C5: Failed login attempt logged (audit log + rate-limit basic).

### REQ-D — Order Lifecycle
- AC-D1: State machine với 4 trạng thái chính + 3 phụ; transition matrix valid.
- AC-D2: Huỷ trước báo bếp = 1 click; huỷ sau báo bếp = 2 clicks (1 click + confirm dialog "đã báo bếp rồi, xác nhận huỷ?").
- AC-D3: Đổi món = 2 thao tác riêng (huỷ cũ + thêm mới), không phải 1 atomic operation.
- AC-D4: State change ghi audit log với before/after.
- AC-D5: UI hiển thị trạng thái món bằng màu/icon rõ ràng cho nhân viên + bếp.

### REQ-E — Stock-out Handling
- AC-E1: Bếp có UI để mark món "hết nguyên liệu" / "có lại".
- AC-E2: Khi marked hết, menu UI tự động highlight đỏ (real-time hoặc poll mỗi 30s).
- AC-E3: Order chưa báo bếp + món hết → user UI cảnh báo, không cho tạo order mới với món đó.
- AC-E4: Order đã báo bếp + món hết → KHÔNG auto-cancel, nhân viên phải xoá tay; audit log ghi rõ "removed due to out-of-stock".

### REQ-F — Auto-close Table
- AC-F1: Cron job (BullMQ deferred — phase 1 dùng setInterval đơn giản hoặc systemd timer) chạy mỗi 30 phút, scan bàn `created_at + 10h < now()`, set state = `auto-flagged-after-10h`.
- AC-F2: Owner UI có "Pending review" list, mỗi item có button "Confirm payment" hoặc "Re-open table".
- AC-F3: Confirm payment → state = closed + ghi audit log với actor = chủ quán.
- AC-F4: Re-open → state = open lại, không tính auto-close.
- AC-F5: KHÔNG bao giờ tự chốt tiền mà không có owner action.

### REQ-G — Audit Log
- AC-G1: Mỗi mutation tạo 1 row trong `audit_log` table với fields đúng schema §9.5.
- AC-G2: Retention 90 ngày — cron job xoá row cũ hơn.
- AC-G3: UI cho owner xem audit log có filter theo actor / action_kind / table / date range.
- AC-G4: Export audit log dạng CSV (cho điều tra gian lận).
- AC-G5: KHÔNG cho phép edit/delete audit log từ UI (immutable).

### REQ-H — Daily Report
- AC-H1: Báo cáo daily cutoff theo Asia/Ho_Chi_Minh (00:00 → 23:59:59).
- AC-H2: Tổng đơn (committed_to_table = true), tổng tiền, theo nhân viên (ai gọi nhiều nhất / thanh toán nhiều nhất).
- AC-H3: Loại trừ order chỉ ở trạng thái `gọi` chưa được commit (drafted but never sent).
- AC-H4: Export PDF/Excel.
- AC-H5: Drill-down: click 1 đơn → xem chi tiết món + audit history.

---

## Traceability Matrix

| REQ ID | Phase | Tasks | Verified |
|--------|-------|-------|----------|
| REQ-A | 02 | — | — |
| REQ-B | 03 | — | — |
| REQ-C | 01 | — | — |
| REQ-D | 04 | — | — |
| REQ-E | 04 | — | — |
| REQ-F | 05 | — | — |
| REQ-G | 01 | — | — |
| REQ-H | 06 | — | — |

---

## Dependencies (informational — /vg:roadmap will refine)

- **REQ-G (audit log)** là foundational — REQ-C, REQ-D, REQ-F, REQ-B đều WRITE vào nó. Phase chứa audit log infra phải đến trước hoặc gộp với REQ-C.
- **REQ-C (auth)** bắt buộc cho mọi REQ capture `actor_id` (REQ-D, REQ-F, REQ-G, REQ-B chuyển bàn).
- **REQ-A (menu)** phải đến trước REQ-D (order lifecycle reference menu items) và REQ-E (stock-out highlights menu).
- **REQ-B (table)** phải đến trước REQ-D + REQ-F (orders attach to tables; auto-close acts on tables).
- **REQ-H (report)** phụ thuộc vào các REQ producing data (D, F, G).

---

## Notes

- Future REQs (VAT integration, RBAC, multi-tenant) sẽ được thêm ở `/vg:project --milestone` khi mở Milestone 2.
- Khi `/vg:roadmap` chạy, cột `Phase` + Traceability Matrix sẽ được auto-fill.
