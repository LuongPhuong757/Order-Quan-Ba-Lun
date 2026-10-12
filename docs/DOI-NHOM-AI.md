# Đội nhóm AI — Dev · Kế toán · Marketing

Nhánh: `feat/doi-nhom-ai` (cắt từ `origin/develop` @ `c00878d`, 2026-10-12).
Trạng thái: **chưa commit, chưa push, không merge** — chủ dự án duyệt trước.

---

## 1. Vì sao có nhánh này

Trước đây mỗi task được "ném" cho một phiên Claude làm từ đầu tới cuối. Nhánh này dựng một
**đội agent có vai trò chuyên biệt**: người phân tích, người code, người kiểm là ba agent khác
nhau, có cổng duyệt của chủ dự án ở giữa.

Nguyên tắc: chỉ chia việc khi được ít nhất một trong ba lợi ích —
**ngữ cảnh sạch** (agent đọc nhiều, trả về ít), **song song** (api/web/shop cùng lúc),
**góc nhìn độc lập** (người kiểm không thấy lý lẽ của người viết). Task nhỏ thì KHÔNG gọi cả đội.

## 2. Ba đội ở đâu

| Đội | Chạy ở | Định nghĩa nằm ở |
|---|---|---|
| **Dev** (BA, Developer, Tester) | Claude Code — cả Windows lẫn Mac | `.claude/agents/qbl-*.md` + `/doi-dev` |
| **Kế toán** | Claude App trên Mac | Project "Kế toán QBL" + skill (giai đoạn 3) |
| **Marketing** | Claude App trên Mac | Project "Marketing QBL" + skill (giai đoạn 4) |

## 3. Nhánh này thay đổi gì (giai đoạn 1)

| File | Thay đổi |
|---|---|
| `.gitignore` | `.claude/agents/` → `.claude/agents/*`, thêm ngoại lệ `qbl-*.md` và `doi-dev.md` |
| `.claude/agents/qbl-ba.md` | Agent BA |
| `.claude/agents/qbl-kien-truc.md` | Agent lập kế hoạch |
| `.claude/agents/qbl-dev.md` | Agent Developer |
| `.claude/agents/qbl-review.md` | Tester — review code |
| `.claude/agents/qbl-ui-tester.md` | Tester — soi giao diện mobile |
| `.claude/agents/qbl-nghiem-thu.md` | Tester — chạy test thật, đối chiếu spec |
| `.claude/commands/doi-dev.md` | Lệnh điều phối `/doi-dev <task>` |
| `docs/DOI-NHOM-AI.md` | Tài liệu này |

**Không đụng** code app (`apps/*`, `packages/*`), không đụng DB, không sửa file `gsd-*`.

### Vì sao sửa `.gitignore`
Trước đây cả thư mục `.claude/agents/` bị ignore → agent chỉ tồn tại ở máy đã cài, worktree
mới không có. Agent `qbl-*` phải theo repo để máy Windows, máy Mac và mọi worktree dùng **cùng
một đội**. Agent GSD (`gsd-*`) vẫn bị ignore như cũ vì installer cài riêng từng máy.

### Vì sao tự viết mà không dùng thẳng GSD
- GSD cài theo máy, có thể thiếu ở máy/worktree → đội lõi phải tự đứng được.
- Agent GSD chung chung, không biết quy tắc quán (người dùng lớn tuổi, `develop`/`production`,
  bẫy `synchronize`, vite proxy, đơn vị g/ml…).
- Installer GSD có thể ghi đè file `gsd-*` → không sửa trực tiếp.
- Vẫn **mượn kỹ thuật tốt** của GSD (ép bằng chứng, kiểm theo mục tiêu, phân mức nghiêm trọng)
  và **vẫn gọi** `gsd-debugger`, `gsd-security-auditor`, `gsd-codebase-mapper` khi máy có.

## 4. Đội Dev — luồng làm việc

```
/doi-dev <mô tả task>
  │
  ├─ Điều phối phân loại: NHỎ / VỪA / LỚN / ĐIỀU TRA BUG
  │
  ① qbl-ba          → 01-spec.md        ──▶ [CỔNG 1: chủ dự án chốt spec]
  ② qbl-kien-truc   → 02-ke-hoach.md      (chia phần việc, không 2 người sửa cùng file)
  ③ qbl-dev ×N      → 03-<phan>.md        (song song khi các phần độc lập)
  ④ qbl-review + qbl-ui-tester (song song) → 04-review.md, 04-ui.md
  ⑤ qbl-nghiem-thu  → 05-nghiem-thu.md    (lệnh thật + output thật)
  │
  └─ Báo cáo ──▶ [CỔNG 2: chủ dự án quyết định commit/merge — đội KHÔNG tự làm]
```

| Loại task | Đội hình |
|---|---|
| Nhỏ (đổi chữ, lỗi 1 file) | Điều phối tự làm, không gọi đội |
| Vừa (1 màn, 1 API) | ② → ③ → ④ review → ⑤ |
| Lớn / đụng tiền, kho, đơn | ① → ⑤ đủ, có cổng 1 |
| Điều tra bug | `gsd-debugger` hoặc nhiều agent mỗi agent một giả thuyết |

Hồ sơ bàn giao nằm ở `.planning/doi-dev/<ngày>-<tên-task>/` — agent sau đọc file của agent
trước, chủ dự án duyệt bằng cách đọc file, phiên đứt giữa chừng thì làm tiếp được.

Model: BA, kiến trúc, review = Opus · dev, UI, nghiệm thu = Sonnet.

### Quy tắc tuyệt đối (ghi cứng trong mọi agent)
- Không commit, merge, push. Không đụng `develop`, `production`.
- Không test trên production, không ghi DB thật.
- Một task = một nhánh = một worktree.

## 5. Đội Kế toán (giai đoạn 3) — thiết kế đã chốt

**Lấy số:** tài khoản role `report` (chỉ đọc — mọi request ghi bị chặn ở `JwtAuthGuard`) qua
Claude in Chrome, trong **Chrome profile riêng "Claude-Report"** (không bao giờ đăng nhập admin ở đó).
Không ghi mật khẩu vào prompt/skill.

**Nguyên tắc:** AI không tự nhẩm số. Số do server tính, AI đọc - đối chiếu - diễn giải - cảnh báo.

**Kỳ:** tuần Thứ Hai → Chủ Nhật.

**Chủ dự án cần biết:**
1. Nguyên liệu nhập vào: số lượng, đơn giá, thành tiền, NCC.
2. Từ mỗi nguyên liệu: các món dùng nó bán ra bao nhiêu phần.
3. Tổng doanh thu, tổng chi phí nhập.
4. **Giữa 2 lần nhập** — vd nhập 48 lon coca ngày 01, ngày 04 nhập tiếp: 3 ngày đó bán được
   bao nhiêu, theo sổ còn bao nhiêu lúc nhập tiếp → nhập dư hay thất thoát.
5. **Tăng giá:** nguyên liệu tăng **≥5%** so với lần nhập trước → báo kèm các món liên quan;
   **≥10%** → đề xuất điều chỉnh giá món (giá vốn cũ/mới, % lãi cũ/mới).

**Giới hạn phải luôn nêu kèm báo cáo:**
- Chưa có kiểm kê → chỉ là **tồn sổ sách**; không biết tồn trước lần nhập đầu.
- Món chưa khai định lượng → không trừ được nguyên liệu; phải liệt kê.
- Định lượng tinh/thô chưa chốt → hàng nguyên đơn vị (coca, bia) chính xác, hàng sơ chế thì chưa.
- Tiêu hao chỉ có từ ngày bật tính năng; phiếu nhập trước 2026-09-07 sai 1000×.

## 6. Đội Marketing (giai đoạn 4) — thiết kế đã chốt

**Kênh:** Google Ads. **Mục tiêu:** khách **đặt online** trên quanbalun.site.

**Lỗ hổng đo lường đã phát hiện:** analytics chỉ lưu `referrer_host` — không có `gclid`/`utm`
→ không tách được quảng cáo trả tiền với tìm kiếm tự nhiên, không biết quảng cáo ra bao nhiêu đơn.
Cần task Dev 2 (bên dưới).

**Vai trò:** Phân tích → Chiến lược (≤3 phương án, mỗi phương án có chỉ số đo) → Phản biện
(đối chiếu % lãi từ Kế toán, không đẩy món vừa tăng giá vốn) → Nội dung (skill
`quan-doc-quang-cao`, `quan-lap-khung-gio`) → tuần sau đo lại.

**Google Ads:** user quyền **Read only**; ưu tiên báo cáo định kỳ xuất ra Google Sheets thay vì
đọc giao diện Ads.

## 7. Lộ trình

| Giai đoạn | Việc | Ở đâu |
|---|---|---|
| 1 | Dựng đội Dev | nhánh này |
| 2 | Chạy thử đội Dev bằng **task 1: trang "Báo cáo tuần"** cho role report (5 bảng + tải Excel) | nhánh riêng |
| 2b | **Task 2:** lưu `gclid`/`utm`, gắn nguồn vào đơn online | nhánh riêng |
| 3 | Đội Kế toán trên Claude App | Project + skill |
| 4 | Đội Marketing trên Claude App | Project + skill |
| Sau | Màn kiểm kê tồn; connector (MCP) thay cho đọc trình duyệt | — |

## 8. Cách thử sau khi duyệt

1. Mở Claude Code trong worktree này (Windows hoặc Mac).
2. Gõ `/agents` → thấy 6 agent `qbl-*`.
3. Gõ `/doi-dev <một task vừa>` → xem điều phối phân loại, giao việc, dừng ở cổng.
