# CLAUDE.md — Order Quán Bà Lũn

Bối cảnh dự án cho Claude Code. File này nạp tự động MỌI phiên, mọi agent, mọi worktree.
Giữ ngắn: chỉ ghi thứ **không đọc ra được từ code** hoặc thứ **đọc nhầm sẽ hỏng việc**.

---

## 1. Dự án là gì

Web app quản lý quán ăn nhỏ ở Việt Nam. Người dùng thật là **chủ quán và nhân viên phục vụ,
phần lớn lớn tuổi, dùng điện thoại**. Ba mặt:

| App | Cổng dev | Ai dùng | Domain thật |
|---|---|---|---|
| `apps/web` | 5173 | Nhân viên + chủ quán (POS, bếp, kho, báo cáo) | `admin.quanbalun.site` |
| `apps/shop` | 5174 | Khách (đặt online, quét QR gọi món tại bàn) | `quanbalun.site` |
| `apps/api` | 3001 | NestJS — phục vụ cả hai | — |

**Hệ quả lên mọi quyết định UI:** chữ to, nút to, ít bước, không có tooltip/hover. Nếu thấy một
màn có cỡ chữ/nút lớn bất thường (vd màn "Nguyên liệu món") thì đó là **cố ý**, đừng "đồng bộ
về chuẩn app".

Ngôn ngữ: **tiếng Việt** ở UI, comment, commit message, tên biến nghiệp vụ.

---

## 2. Cấu trúc

```
apps/api/      NestJS 10 + TypeORM + MySQL 8
  src/modules/       18 module nghiệp vụ (auth, orders, menu, suppliers, payments, printing…)
  src/common/        filters, guards, middleware dùng chung
  src/cli/           seed + cron chạy tay
  src/data-source.ts ⚠ DANH SÁCH ENTITY TƯỜNG MINH — xem §5
apps/web/      React 19 + Vite — trang quản lý
apps/shop/     React 19 + Vite — trang khách
packages/schemas/  Zod schema dùng chung FE↔BE (nguồn sự thật của kiểu dữ liệu)
packages/utils/    tiện ích dùng chung
docs/          Spec từng milestone (xem §7)
```

Monorepo pnpm + Turborepo. Thay đổi `packages/*` thì **phải build lại** trước khi typecheck app
mới thấy (xem bẫy Turbo cache ở §5).

---

## 3. Lệnh hay dùng

```bash
pnpm dev                 # chạy cả 3 app (turbo)
pnpm typecheck           # bắt buộc chạy trước khi commit
pnpm test                # vitest toàn repo
pnpm build

pnpm --filter @order/api test       # chỉ test BE
pnpm --filter @order/api schema:verify
pnpm db:up                          # MySQL local qua docker
```

**KHÔNG chạy `pnpm format` / prettier.** Repo không có `.prettierrc`, prettier mặc định sẽ
reformat cả codebase và tạo diff rác. Bám style của file đang sửa.

---

## 4. Nhánh và deploy — ĐỌC KỸ

```
feat/* hoặc fix/*  →  develop  →  production
```

| Nhánh | Push vào là gì | Thời gian |
|---|---|---|
| `develop` | GitHub Actions **tự deploy** lên server dev (`dev.quanbalun.site`) | ~4m40s |
| `production` | GitHub Actions **tự deploy** lên PRODUCTION THẬT | ~4m40s |

**Push = đã deploy.** Đừng bao giờ nói "code xong rồi, chưa deploy" mà không kiểm `gh run list`.

Quy tắc bắt buộc:

- **Không tự ý commit / push / deploy.** Chỉ sửa file local, đợi user yêu cầu rõ ràng.
- **Không test trên production.** Không curl, không mô phỏng đơn lên `quanbalun.site`.
  Muốn thử thì dựng local hoặc dùng server dev.
- **Cắt nhánh mới luôn từ `origin/develop`** — `git fetch` trước. Có nhiều worktree chạy song
  song nên `develop` local thường cũ.
- **Kiểm HEAD trước khi merge.** Worktree chính không cố định ở `develop`; phiên song song hay
  đổi nhánh. `git status` sạch KHÔNG chứng minh đang đúng nhánh.
- **`develop` có thể dịch chuyển giữa chừng.** Kiểm `git log origin/production..origin/develop`
  NGAY TRƯỚC lệnh merge, không phải lúc bắt đầu task.
- **Đóng băng production 17:00–08:00.** Hook `.claude/hooks/prod-merge-freeze.sh` chặn
  merge/push vào `production` ngoài giờ. Override: `PROD_FREEZE_OVERRIDE=1`.
  ⚠ Hook này **không được git track** (xem §9) → nó CHỈ chạy ở worktree chính
  `~/Desktop/OrderQuanBaLun`. Ở worktree khác không có gì chặn, phải tự giữ giờ.

Đổi tên nhánh `production` thì phải sửa đủ **4 chỗ** — xem đầu file
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

---

## 5. Bẫy đã dẫm phải — đọc trước khi debug

### Vite proxy là danh sách CỨNG
[apps/web/vite.config.ts](apps/web/vite.config.ts) liệt kê tay từng tiền tố route BE. Thêm
controller mới mà quên thêm vào đây → dev server nuốt request, trả `index.html`, axios nhận HTML,
**màn hình vỡ trong khi log API sạch bong** vì request chưa từng tới BE.

Hai app khai proxy **khác nhau**, đừng chép qua lại:
- `apps/web` → 9 tiền tố **trần**, KHÔNG có `/api` (`/auth`, `/admin`, `/orders`, `/menu`,
  `/tables`, `/payments`, `/print`…).
- `apps/shop` → chỉ `/api` và `/uploads`, vì trang khách chỉ gọi `/api/public/*` và `/api/admin/*`.

`/uploads` ở cả hai app cố ý **không** dùng `apiProxy()`: luật `bypass()` của nó trả `index.html`
cho mọi request `Accept: text/html`, mà mở ảnh ở tab mới chính là loại request đó → ảnh hiện
trong `<img>` nhưng bấm phóng to ra "không tìm thấy trang". Chỉ lộ ở máy dev, prod qua Caddy nên
không thấy.

### `synchronize` xoá cột của nhánh khác
Không có migration — TypeORM `synchronize` dựng schema từ mảng entity **tường minh** trong
[apps/api/src/data-source.ts](apps/api/src/data-source.ts). Hai hệ quả:

1. Entity mới không khai ở đây → `tsc` vẫn xanh, bảng không được tạo, runtime gãy.
2. DB dev **dùng chung giữa các worktree**. Sync từ nhánh thiếu entity = **drop cột** của nhánh
   khác. Luôn sync từ nhánh tổng hợp nhất.

Test API đỏ kiểu `Unknown column` → DB dev chưa có cột, chạy sync.
Test API đỏ kiểu `expected 37 to be 36` → chạy song song / dev server đang sống, **không phải
lỗi code**.

### `curl` API cần header `Origin`
Thiếu `Origin` thì mọi `POST`/`PATCH` trả **403 CSRF** — nhìn hệt như lỗi code.

### Turbo cache dùng chung giữa worktree
`typecheck` ở worktree mới có thể ăn cache hit của worktree khác. Tự kiểm `dist/` có thật không.

### Đơn vị: DB lưu `g`/`ml`, màn nhập hiện `KG`/`L`
Server tự quy đổi hệ số. Phiếu tạo trước 2026-09-07 còn sai 1000×. Sửa phiếu nhập thì phải
chạy `price-replay.ts` phát lại **cả chuỗi** của nhà cung cấp, đừng tính lẻ một phiếu.

### CSS
- Hộp thoại dùng `vh` **trôi mất đỉnh trên iPhone** → dùng `dvh`.
- `.ncc-ui` là `flex column`; overlay mang class này phải khai `flex-direction: row`, không thì
  hộp thoại bị cắt đỉnh mà computed CSS trông vẫn đúng.
- Rule đụng `color`/`background` của nút secondary phải viết `button.<class>`, không thì
  `button.secondary` đè mất.

### Lỗi bị filter nuốt
`GlobalExceptionFilter` ghi đè message theo mã lỗi. Message có số liệu động phải dùng mã **ngoài**
`FRIENDLY_VN`, không thì user thấy câu chung chung.

---

## 6. Test

126 file test, vitest. Có **17 test tích hợp** nối MySQL **thật** (`*.integration.test.ts`,
`synchronize: false`) — CI dựng service MySQL riêng cho chúng.

CI (`ci.yml`) là một định nghĩa duy nhất dùng chung cho cả đường develop và production: cài →
dựng schema DB thật → typecheck → test → build → gác ngân sách bundle. **Develop không được kiểm
lỏng hơn production.**

---

## 7. Tài liệu tham chiếu

| Cần gì | Đọc |
|---|---|
| Bản đồ module, ai gọi ai | `docs/CODEMAPS/` |
| Spec đặt hàng online | [docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md](docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md) |
| Spec nhập hàng NCC | [docs/MILESTONE-03-SUPPLIER-INTAKE-SPEC.md](docs/MILESTONE-03-SUPPLIER-INTAKE-SPEC.md) |
| Spec QR gọi món tại bàn | [docs/MILESTONE-04-QR-DINE-IN-SPEC.md](docs/MILESTONE-04-QR-DINE-IN-SPEC.md) |
| Quy trình deploy | [DEPLOY.md](DEPLOY.md) |
| Nợ kỹ thuật đã biết | [OVERRIDE-DEBT.md](OVERRIDE-DEBT.md) |
| Stack, kiến trúc tổng | [README.md](README.md) |

Code trong repo này **comment rất dày bằng tiếng Việt, và comment giải thích VÌ SAO**. Trước khi
sửa một chỗ trông lạ, đọc comment quanh nó — phần lớn "chỗ lạ" là quyết định có chủ đích đã ghi lý do.

---

## 8. Quy ước làm việc

- Commit: `<type>(<scope>): <mô tả tiếng Việt>` — vd `feat(api): thêm lọc theo ca`.
  Có mã spec thì gắn vào cuối: `(M4.D-39)`.
- Một task = một nhánh = một worktree riêng. Worktree con đặt dưới `.worktrees/`
  (worktree anh em ngang hàng ở `~/Desktop` bị macOS chặn sau khi phiên restart).
- Worktree mới cần setup 3 bước — dùng skill `/new-worktree`.
- Trước khi push: `git diff --name-only <nhánh-đích> HEAD` để chắc không lẫn file lạ
  (`deploy.sh` từng bị lẫn vào nhánh fix vì thế).

---

## 9. ECC nằm ở đâu — và không nằm ở đâu

Repo dùng **ECC 2.2.2** cài ở mức project: `.claude/` (101 agent, 292 skill, 95 command,
4 hook, rules ở `.claude/rules/ecc/`).

**Chỉ `.claude/settings.json` được git track.** `.gitignore` loại `hooks/`, `agents/`,
`scripts/`, `commands/gsd/`, `gsd-core/`… Hệ quả:

- ECC **chỉ tồn tại ở worktree chính** `~/Desktop/OrderQuanBaLun`.
- Worktree khác (`.worktrees/*`, các thư mục anh em ở Desktop) **không có** agent, skill,
  hook của ECC — kể cả hook chặn đóng băng production ở §4.
- `CLAUDE.md` này thì **có** ở mọi worktree vì nó nằm ở gốc repo và được track. Đó là lý do
  mọi thứ quan trọng phải nằm ở đây chứ không phải trong cấu hình ECC.

GSD cài per-máy bằng `npx get-shit-done-cc --claude --local`, không theo repo.
