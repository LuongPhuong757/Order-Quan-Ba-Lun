# OrderQuanBaLun

**Locked:** 2026-05-08T03:51:34Z
**Foundation:** see `.vg/FOUNDATION.md` (8 dimensions + 15 F-XX decisions + §9 Architecture Lock)
**Config:** see `.claude/vg.config.md` (auto-derived from FOUNDATION)
**Security plan:** see `.vg/SECURITY-TEST-PLAN.md`

## 1. Mục tiêu

Web app giúp quán ăn của gia đình tự quản lý order — thay thế việc ghi tay / dùng phần mềm POS đắt đỏ. Một quán, một chủ, vài nhân viên. Phục vụ khách tại bàn (`dine-in`), khách mang về (`takeaway`), khách order ship (`delivery`).

## 2. Người dùng

- **Chủ quán** — duyệt auto-pay end-of-day, xem báo cáo, quản lý menu.
- **Nhân viên (3-10 người, ~20 đồng thời tối đa)** — gọi món, chuyển bàn, đánh dấu giao món, thanh toán. Không có RBAC ở giai đoạn đầu (xem F-06 + audit log compensating control).
- **Bếp** — đổi trạng thái món (đang làm / xong / hết nguyên liệu).
- **Khách** — KHÔNG truy cập trực tiếp app (giai đoạn 1). Tương lai có thể mở "khách tự gọi qua QR" — Open Question.

## 3. Yêu cầu nghiệp vụ chính (foundation-level)

| ID | Nhóm | Mô tả tóm tắt |
|---|---|---|
| **REQ-A** | Quản lý món ăn | Import hàng loạt; cấu trúc: Loại hàng / Loại thực đơn / Nhóm hàng (3 cấp) / Mã hàng / Tên hàng hóa / Giá bán / ĐVT / Hình ảnh (nhiều URL). |
| **REQ-B** | Quản lý bàn | Sơ đồ bàn (vị trí), order theo bàn, **chuyển bàn** (không tách/gộp). 3 loại: dine-in / takeaway / delivery. |
| **REQ-C** | Quản lý nhân viên | Login để biết "ai làm gì", audit log. KHÔNG RBAC ở phase 1. |
| **REQ-D** | Vòng đời món | `gọi → báo bếp → đang làm → xong → giao bàn`. Trạng thái phụ: `CANCELLED`, `OUT_OF_STOCK`, `RETURNED_TO_KITCHEN`. Huỷ sau khi báo bếp = thêm 1 bước xác nhận. |
| **REQ-E** | Hết nguyên liệu | Bếp đánh dấu món hết → menu **highlight đỏ**. Order đã báo bếp mà hết → nhân viên xoá tay. Thông báo khách bằng miệng. |
| **REQ-F** | Auto-close bàn | Sau 10h từ lúc tạo bàn → đánh dấu `pending-review` (KHÔNG tự chốt tiền) — chủ quán duyệt cuối ngày. |
| **REQ-G** | Audit log | Log mọi mutation (cancel/edit/payment/transfer/auto-pay) với `actor_name + IP + timestamp + before/after`, retention 90 ngày. |
| **REQ-H** | Báo cáo cuối ngày | Dựa trên "món đã commit vào bàn". Không tính món chỉ ở trạng thái `gọi` chưa vào bàn. |

## 4. Milestones

### Milestone 1 — MVP (Minimum Viable Product / Sản phẩm tối thiểu khả dụng)

**Mục tiêu:** quán có thể bỏ hệ thống ghi tay và dùng web app cho mọi order. Tất cả REQ-A..H ở mức cơ bản. Chưa tích hợp VAT (`F-10`, deferred to Milestone 2).

**Phạm vi:**
- REQ-A bulk import (CSV/Excel)
- REQ-B sơ đồ bàn cố định, chuyển bàn
- REQ-C login đơn giản, audit log
- REQ-D vòng đời đầy đủ với confirm-step + manual cancel
- REQ-E menu highlight đỏ
- REQ-F auto-close pending-review
- REQ-G audit log infra
- REQ-H báo cáo daily basic (tổng đơn / tổng tiền / theo nhân viên)

**Deferred sang Milestone 2+:**
- Tích hợp hoá đơn điện tử VAT (Open Question Q-01)
- Khách tự gọi qua QR
- Phân tích sâu báo cáo (theo món / theo giờ peak)
- Multi-tenant (nhiều chi nhánh)
- RBAC chi tiết

## 5. Open Questions

- **Q-01** — VAT e-invoice timing & retry semantics. Quyết ở phase tích hợp VAT (Milestone 2). Default đề xuất: outbox + idempotency_key=payment_id, alert nếu PENDING > 30 phút.

## 6. Acknowledged Tradeoffs

- **No RBAC ở phase 1** — quán nhỏ tin nhau. Compensating: audit log đầy đủ, retention 90d. Sẽ revisit nếu mở chi nhánh hoặc nhân viên >20.
- **Auto-pay 10h** — pending-review thay vì chốt thật. Owner duyệt end-of-day chốt cuối.
- **Backup weekly only** — accepted risk: mất tới 6 ngày dữ liệu nếu DB crash giữa tuần. Recommend: manual snapshot trước Tết / lễ.

---

**Pipeline gợi ý kế tiếp:** `/vg:roadmap` để derive phases từ FOUNDATION + REQ-A..H ở trên.
