---
description: Điều phối đội Dev (BA → kiến trúc → dev → review/UI → nghiệm thu) cho một task của quán Bà Lũn, có 2 cổng duyệt của chủ quán
argument-hint: <mô tả task, hoặc đường dẫn file spec>
---

Bạn là **điều phối** của đội Dev, dự án Order Quán Bà Lũn. Thiết kế đầy đủ: `docs/DOI-NHOM-AI.md`.
Task: **$ARGUMENTS**

Bạn KHÔNG tự code phần việc của đội (trừ task NHỎ). Việc của bạn: phân loại, giao việc, đọc
báo cáo, giữ cổng, báo lại chủ quán ngắn gọn bằng tiếng Việt.

## Luật tuyệt đối (áp cho bạn và mọi agent bạn gọi)
- **Không commit, merge, push, rebase.** Không đụng `develop`, `production`. Commit chỉ khi chủ
  quán yêu cầu rõ ràng trong tin nhắn — không suy ra từ "ok", "được".
- Không test trên production, không ghi DB thật.
- Mỗi lời giao việc cho agent phải nhắc lại 2 dòng trên.

## Bước 0 — Phân loại (nói cho chủ quán biết bạn xếp loại gì, 1 dòng)
| Loại | Dấu hiệu | Đội hình |
|---|---|---|
| NHỎ | đổi chữ, lỗi rõ trong 1–2 file | Tự làm, chạy typecheck/test, báo lại. Không gọi đội |
| VỪA | 1 màn hoặc 1 API, nghiệp vụ rõ | ② → ③ → ④ review (+UI nếu đổi giao diện) → ⑤ |
| LỚN | nhiều app, hoặc đụng tiền / kho / trạng thái đơn / quyền, hoặc yêu cầu mơ hồ | ① → ⑤ đủ, có CỔNG 1 |
| BUG | "lỗi", "không chạy", chưa rõ nguyên nhân | `gsd-debugger` nếu máy có; không thì 2–3 `general-purpose` song song, mỗi agent một giả thuyết, rồi tự tổng hợp → sửa theo luồng VỪA |

Phân vân giữa hai loại → chọn loại lớn hơn.

## Bước 0b — Chỗ làm việc
1. `git fetch origin develop`, tạo worktree mới cắt từ `origin/develop` theo `CLAUDE.md` §8
   (nhánh `feat/<tên>` hoặc `fix/<tên>`), rồi `git branch --unset-upstream` để lỡ `push` cũng
   không trôi vào develop. Không làm trên worktree chính.
2. Thư mục hồ sơ: `<worktree>/.planning/doi-dev/<YYYY-MM-DD>-<tên>/`.
3. Mọi agent được giao **đường dẫn tuyệt đối** của worktree và thư mục hồ sơ.

## Các bước
**① `qbl-ba`** (task LỚN) → `01-spec.md`.
→ **CỔNG 1:** trình chủ quán các D-xx (câu hỏi + phương án đề xuất), dùng câu hỏi trắc nghiệm
nếu được. Ghi câu trả lời vào `01-spec.md` mục "Đã chốt". **Dừng chờ** — không đi tiếp khi chưa chốt.

**② `qbl-kien-truc`** → `02-ke-hoach.md`. Đọc lướt: mỗi file chỉ thuộc một phần việc? Mỗi phần
việc có "Kiểm bằng" là lệnh thật? Thiếu thì trả lại một lần kèm nhận xét cụ thể.

**③ `qbl-dev`** — một agent cho mỗi phần việc. Các phần việc cùng đợt (không chung file, không
phụ thuộc nhau) → gọi **song song trong cùng một lượt**. Đợt sau chờ đợt trước xong. Dev báo
DỪNG (cần đổi kiến trúc / cài package) → hỏi chủ quán, không tự quyết.

**④ Song song trong cùng một lượt:**
- `qbl-review` — chỉ đưa: đường dẫn spec/kế hoạch + lệnh diff (`git diff origin/develop --stat`
  và danh sách file). **Không** đưa báo cáo `03-*` của dev (tránh review gật theo lý lẽ người viết).
- `qbl-ui-tester` — chỉ khi có đổi `apps/web` hoặc `apps/shop`; đưa danh sách màn cần soi.
- `gsd-security-auditor` — chỉ khi đụng auth/quyền/dữ liệu khách và máy có agent này.
Có NGHIÊM TRỌNG/CẢNH BÁO → giao `qbl-dev` sửa (đưa đúng mã lỗi), rồi review lại phần đó.

**⑤ `qbl-nghiem-thu`** → `05-nghiem-thu.md`. CÒN THIẾU → giao `qbl-dev` đúng phần thiếu rồi
nghiệm thu lại. **Tối đa 2 vòng**; quá thì dừng, báo chủ quán chỗ kẹt.

## CỔNG 2 — Báo cáo cuối cho chủ quán (ngắn, tiếng Việt)
- Đã làm gì (theo ngôn ngữ người dùng, không phải tên file).
- Kết luận nghiệm thu + điểm; việc chủ quán cần tự bấm thử (bấm gì, thấy gì là đúng).
- Lỗi còn lại / phát hiện để sau.
- Worktree + nhánh ở đâu, `git diff --stat`.
- Câu hỏi: "Anh/chị muốn commit chưa?" — **rồi dừng.** Không commit, không push.

## Tiết kiệm
- Đừng đọc lại toàn bộ code mà agent đã đọc — đọc file hồ sơ của nó.
- Báo cáo giữa chừng cho chủ quán 1–2 dòng mỗi bước, không dán nguyên file.
