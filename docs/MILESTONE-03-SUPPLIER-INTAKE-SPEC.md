# Milestone 3 — Nhập Hàng Nhà Cung Cấp & Danh Mục Nguyên Liệu

**Trạng thái:** ĐÃ IMPLEMENT cả 5 bước — 42 quyết định. Còn Q-7 (số dư đầu kỳ) là việc vận hành, và toàn bộ chưa chạy thử với MySQL/trình duyệt thật.
**Ngày chốt:** 2026-09-05
**Nguồn:** Phiên thảo luận trực tiếp với chủ quán (4 vòng hỏi–đáp)
**Nhánh git:** làm trên `feat/misa-sync-and-recipe` (spec này merge về từ `feat/supplier-portal`)
**Liên quan:** dùng chung module `ingredients` với tính năng MISA + định lượng — xem 5.1

---

## 1. Mục tiêu

Ghi nhận được **hàng hoá nhập vào từ 10–30 nhà cung cấp**, để:

1. Biết mỗi kỳ mua của ai bao nhiêu tiền.
2. **Phát hiện ngay khi NCC đổi giá** — đây là mối quan tâm số 1 của chủ quán.
3. Tạo nền dữ liệu đầu vào cho tính toán tồn kho và giá vốn món ăn (ghép với `recipe_lines`).

### Bài toán khó nhất

Chủ quán làm việc với nhiều NCC, phần lớn **không rành công nghệ**. Hai ràng buộc kéo ngược nhau:

- Bắt NCC tự nhập → dữ liệu vào sớm, nhưng NCC yếu CNTT sẽ bỏ cuộc.
- Nhân viên nhập hết → chắc chắn chạy, nhưng tốn công quán.

Cách giải: **làm cả hai, admin nhập hộ là đường mặc định, NCC tự nhập là đường tuỳ chọn**, dùng chung một màn hình.

---

## 2. Quyết định đã chốt (locked)

> Mỗi quyết định có ID để phase artifacts tham chiếu. **Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`.

### Cách NCC tiếp cận hệ thống

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-01** | NCC đăng nhập bằng **tài khoản + mật khẩu**. Username = **số điện thoại**, mật khẩu = **PIN 6 chữ số**, bàn phím số. Không dùng email. | Chủ quán chọn (đã cân nhắc phương án link-token không mật khẩu và từ chối). SĐT thì NCC nào cũng nhớ; PIN số tránh phải gõ chữ hoa/ký tự đặc biệt trên điện thoại. |
| **M3.D-02** | Phiên đăng nhập dài (**90 ngày**), "ghi nhớ đăng nhập" mặc định BẬT. | Thực tế NCC chỉ đăng nhập 1 lần mỗi quý. Điểm rơi lớn nhất của nhóm không rành CNTT không phải lúc nhập liệu mà là lúc quên mật khẩu. |
| **M3.D-03** | Quên mật khẩu → **nút gọi điện cho quán**, chủ quán reset PIN trong admin và đọc lại qua điện thoại. **KHÔNG làm luồng reset qua email.** | NCC phần lớn không có/không nhớ email. Luồng email sẽ chặn đứng họ. |
| **M3.D-04** | Bù bảo mật cho PIN yếu: rate-limit + khoá 15 phút sau 5 lần sai, ghi audit log. NCC chỉ **xem** số liệu, không có thao tác liên quan tiền. | PIN 6 số entropy thấp; giới hạn thiệt hại thay vì tăng độ khó mật khẩu. |
| **M3.D-05** | **Admin nhập hộ được cho mọi NCC.** Đây là đường không bao giờ được tắt. | Trong 10–30 NCC chắc chắn có vài người không bao giờ dùng app. Thiếu đường này là hệ thống có lỗ hổng dữ liệu. |
| **M3.D-06** | Một màn nhập duy nhất, hai lối vào. Admin có thêm: chọn NCC, sửa ngày giao, sửa giá. NCC thì NCC cố định, ngày = hôm nay, giá theo gợi ý. | Không maintain hai UI. Nhân viên quán dùng chính màn đó hằng ngày → phát hiện chỗ khó dùng trước khi đưa cho NCC. |
| **M3.D-07** | Phiếu **admin nhập hộ** vào thẳng trạng thái `đã kiểm`. Phiếu **NCC gửi** phải qua bước quán kiểm. | Khi admin nhập thì chính nhân viên đang cầm hàng và đếm, không còn ai để kiểm. |
| **M3.D-08** | Phiếu do NCC gửi **KHÔNG tự động vào kho** — nó là *đề nghị*, quán duyệt mới cộng tồn. | Sai số của NCC sẽ phá nát báo cáo định lượng nguyên liệu. |
| **M3.D-09** | NCC **vẫn thấy** phiếu do quán nhập hộ, gắn nhãn "Quán nhập giúp". | Minh bạch hai chiều; là thứ khiến NCC dần muốn tự nhập. |
| **M3.D-10** | Ghi **nguồn phiếu** (`NCC tự nhập` / `nhân viên nhập hộ`) + người nhập + thời điểm trên mỗi phiếu. | Sáu tháng sau tranh cãi một phiếu, câu hỏi đầu tiên luôn là "ai nhập cái này?". |
| **M3.D-11** | Chống trùng: admin nhập cho NCC X mà NCC X đã gửi phiếu cùng ngày → cảnh báo đỏ + link mở phiếu đó. | Không có thì sinh phiếu đôi, tồn kho phồng lên. |

### Danh mục mặt hàng

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-12** | **Một danh mục nguyên liệu dùng chung toàn quán** (`ingredients`), không tách theo NCC. | Có dùng chung mới so được giá cùng một mặt hàng giữa các NCC — đây là chỗ ra tiền thật. |
| **M3.D-13** | Có **màn quản lý mặt hàng** riêng. Trong lúc nhập phiếu: gõ tên → gợi ý mặt hàng đã có → chọn, hoặc **tạo mới tại chỗ**. | Chủ quán chọn. Không bắt khai báo trước toàn bộ danh mục. |
| **M3.D-14** | Tìm kiếm mặt hàng **không dấu, không phân biệt hoa thường, có fuzzy**: gõ `rau muong` hoặc `rau muốn` đều phải ra `Rau muống`. Lưu cột `name_normalized`. | Chặn nguồn trùng lặp lớn nhất. |
| **M3.D-15** | Nút `＋ Tạo mặt hàng mới` nằm **CUỐI** danh sách gợi ý, không nổi bật. | Người dùng vội sẽ bấm cái đầu tiên nhìn thấy. Đặt cuối = mặc định là chọn cái có sẵn. |
| **M3.D-16** | Tạo mặt hàng mới bắt buộc **2 trường: tên + đơn vị tính**. Đơn vị không được để trống. | Thiếu đơn vị thì không định lượng, không cộng tồn kho được. Đây là trường bắt buộc duy nhất. |
| **M3.D-17** | Màn quản lý mặt hàng có chức năng **gộp mặt hàng trùng** (merge), gộp luôn lịch sử phiếu. | Không phải "nếu có trùng" mà là "khi có trùng". Có sẵn thì dọn 2 phút, không có thì phải sửa tay trong DB. |
| **M3.D-18** | Quan hệ "NCC nào bán mặt hàng gì, giá bao nhiêu" **tự sinh từ lịch sử nhập**, không khai báo trước. Lần sau nhập cho NCC đó thì gợi ý sẵn mặt hàng hay giao + giá lần trước. | Bỏ được toàn bộ công khai báo bảng giá. Càng dùng càng nhanh. |

### Cảnh báo đổi giá — trọng tâm của milestone

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-19** | **Giá tham chiếu = giá nhập gần nhất của cùng cặp (NCC, mặt hàng).** Không dùng bảng giá cố định khai báo tay. | Rau/thịt/cá biến động theo ngày. Bảng giá cố định sẽ sai liên tục → người dùng tập quen bỏ qua cảnh báo → cảnh báo mất tác dụng. |
| **M3.D-20** | Mỗi dòng nhập **tự điền sẵn giá lần trước**; người nhập chỉ sửa dòng nào khác. | Giảm thao tác, và biến "đổi giá" thành hành động có chủ đích thay vì gõ lại từ đầu mỗi lần. |
| **M3.D-21** | Bấm GỬI mà có dòng lệch giá → **popup chặn, chỉ liệt kê đúng những dòng lệch**, ẩn hết dòng bình thường. Chủ quán xác nhận rồi mới xử lý tiếp. | Chủ quán chốt trực tiếp. Nguyên tắc: **mặc định tin tưởng, chỉ soi ngoại lệ**. Phiếu 50 dòng mà bắt đọc cả 50 thì tuần thứ hai là bấm bừa. |
| **M3.D-22** | Ngưỡng giai đoạn 1: **lệch ≤10% im lặng** (chỉ hiện mũi tên nhỏ ▲▼ trên dòng), **>10% vào popup, duyệt được cả cụm**, **>30% bắt buộc bấm OK từng dòng**, không cho "Duyệt tất cả". | 5% quá nhạy với giá chợ Việt Nam, sẽ kêu mỗi ngày. 10% là mức chủ quán thật sự quan tâm; 30% là bất thường thật. |
| **M3.D-23** | **Không phân loại tay** mặt hàng cố định/thả nổi ở giai đoạn 1. Dùng một ngưỡng chung, cộng ô "ngưỡng riêng" trên từng mặt hàng, **mặc định trống = dùng ngưỡng chung**. | Bắt chủ quán gắn nhãn 200 mặt hàng trước khi dùng được = tính năng chết yểu. Nguyên tắc: **khai báo khi thấy đau, không khai báo trước.** |
| **M3.D-24** | Sau 2–3 tháng có lịch sử, **tự động suy ra biên độ dao động quen thuộc** của từng mặt hàng và cảnh báo theo đó, thay ngưỡng cứng. Giai đoạn sau. | Dữ liệu tự nói lên mặt hàng nào ổn định, mặt hàng nào theo mùa — không cần con người gắn nhãn. |
| **M3.D-25** | Mặt hàng **chưa có lịch sử** (lần nhập đầu): không cảnh báo, ghi nhận làm mốc. | Không có gì để so. Cảnh báo lúc này chỉ gây nhiễu. |
| **M3.D-26** | NCC tự nhập mà lệch giá → phiếu giữ ở trạng thái `Chờ quán duyệt giá`, quán đồng ý mới tính. | Không để NCC tự quyết giá mới. |
| **M3.D-27** | **Snapshot giá vào từng dòng phiếu** (`unit_price` lưu trên `supplier_delivery_lines`), không join ra bảng giá hiện hành. Lưu kèm `prev_unit_price` + `price_change_pct` ngay lúc nhập. | Đúng pattern snapshot giá/tên món đã có. Không snapshot thì sửa giá hôm nay làm sai báo cáo tháng trước. Lưu sẵn % thì màn thống kê biến động giá không phải tính lại. |

### Thống kê

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-28** | Số liệu tiền **chỉ hiển thị dạng thống kê ở màn quản lý NCC (phía admin)**, chưa show cho NCC. | Chủ quán chốt. |
| **M3.D-29** | ~~Chỉ làm "tổng mua theo kỳ"~~ → **NÂNG LÊN CÔNG NỢ THẬT** (chủ quán yêu cầu 2026-09-05 vòng 4): hiển thị **số tiền quán còn phải trả từng NCC**. | Chủ quán chốt lại. Kéo theo M3.D-39→41 và một khoản việc vận hành bắt buộc: phải nhập số dư đầu kỳ và ghi nhận mỗi lần trả tiền, nếu không con số "còn phải trả" sai vĩnh viễn. |
| **M3.D-39** | Công thức: `Còn phải trả = số dư đầu kỳ + Σ phiếu đã duyệt − Σ đã thanh toán`. Bảng mới `supplier_payments`, cột mới `suppliers.opening_balance` + `opening_balance_date`. | Không có bảng thanh toán thì chỉ ra được "đã mua bao nhiêu", không ra được "còn nợ bao nhiêu" — hai con số khác nhau. |
| **M3.D-40** | **Số dư đầu kỳ nhập một lần khi khai NCC**, sau đó **chỉ owner sửa được** và mỗi lần sửa ghi audit log. | Đây là con số duy nhất trong hệ thống không kiểm chứng được từ dữ liệu; sửa lung tung thì mọi báo cáo công nợ mất giá trị. |
| **M3.D-41** | Phiếu chỉ vào công nợ khi ở trạng thái **đã duyệt**. Phiếu `NCC gửi` / `Chờ quán duyệt giá` KHÔNG tính. | Cùng nguyên tắc M3.D-08: số NCC tự khai không được tự động thành nợ của quán. |
| **M3.D-42** | Có **thống kê mặt hàng nhập** (mục 3.3): theo kỳ, cho từng NCC và cho toàn quán — số lượng, số lần nhập, tổng tiền, giá bình quân. | Chủ quán yêu cầu. Bổ khuyết cho biến động giá: giá tăng 5% mà lượng nhập tăng gấp đôi thì tiền đội lên nhiều hơn hẳn, chỉ nhìn % giá không thấy. |
| **M3.D-30** | Có **màn "Biến động giá" tổng hợp toàn bộ NCC × mặt hàng** (mục 4 dưới đây) — không chỉ popup lúc nhập. | Chủ quán chốt. Popup chỉ bắt được cú nhảy đột ngột của **một phiếu**; kiểu tăng nguy hiểm hơn là tăng 2%/tháng suốt 6 tháng — không lần nào chạm ngưỡng, cuối năm đắt hơn 13%. |

### Đơn vị mua & chuẩn hoá đơn giá

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-33** | Thêm khái niệm **đơn vị mua + hệ số quy đổi** cho từng cặp (NCC, mặt hàng): *1 thùng = 12.000 ml*, *1 bao = 25.000 g*. Đơn vị mua là **chuỗi tự do** do người nhập gõ. | Chủ quán chốt (phương án B). NCC báo hàng theo `thùng`/`bao`/`kiện`/`khay`/`vỉ`/`can` — những từ này KHÔNG có trong `parseUnit()`. |
| **M3.D-34** | **KHÔNG thêm các từ đó vào `COUNT_UNITS`** trong `ingredient-units.ts`. File đó giữ nguyên. | Đây là lý do chọn B thay vì A: "1 thùng" không quy về `ml` được, nên nếu để nó thành đơn vị đếm hợp lệ thì `toBaseQty` trả về số vô nghĩa và **báo cáo tiêu hao ở nhánh MISA đứt gãy**. Đơn vị mua sống ở tầng nhập hàng, không lọt vào tầng định lượng. |
| **M3.D-35** | Hệ số quy đổi phải quy về **đúng đơn vị gốc của `ingredients.unit`** và **cùng nhóm** (`mass`/`volume`/`count`, theo `parseUnit().kind`). Nguyên liệu đo bằng `g` thì không cho khai "1 thùng = 12.000 ml". | Sai nhóm đơn vị là sai số liệu gấp 1000 lần mà không ai nhìn ra — cùng lý do `toBaseQty()` đã chặn. |
| **M3.D-36** | Lưu **`unit_price_base` = đồng / đơn vị gốc** (đồng/g, đồng/ml). **Mọi so sánh và cảnh báo giá chạy trên cột này**; hiển thị thì vẫn theo đơn vị NCC báo. | Giải Q-5. Lần trước nhập theo `kg`, lần này NCC báo theo `thùng` → so trực tiếp `unit_price` thì popup M3.D-21 báo động sai hàng loạt, người dùng mất tin và bấm bừa. |
| **M3.D-37** | **Đổi hệ số quy đổi cũng phải vào popup cảnh báo** như đổi giá, và tính ra % thay đổi của `unit_price_base`. | Đây là kiểu tăng giá ngụy trang: NCC giữ nguyên "180.000/thùng" nhưng thùng từ 24 chai xuống 20 chai = **tăng thật 20%**. Chỉ canh `unit_price` thì không bao giờ thấy. |
| **M3.D-38** | Ma trận so giá (4.2) hiển thị theo **đơn vị gốc đã chuẩn hoá** (đồng/kg, đồng/lít), kèm chú thích đơn vị NCC báo. | NCC A báo *180.000/thùng*, NCC B báo *16.000/chai* — không quy về cùng thước thì không so được, mà so được mới là chỗ ra tiền. |

### Giao diện

| ID | Quyết định | Lý do |
|---|---|---|
| **M3.D-31** | NCC có **màn riêng `/suppliers`** (`SuppliersPage.tsx`), KHÔNG nhét thành tab trong `/menu`. Chi tiết ở mục 3. | Chủ quán chốt. `/menu` đang là màn của món ăn/công thức — việc nhập hàng là nghiệp vụ hằng ngày của người khác, tần suất khác, quyền khác. Nhét chung thì cả hai màn đều rối. |
| **M3.D-32** | Tab "Mặt hàng" trong `/suppliers` **mở lại đúng `IngredientsPanel` đang có**, không viết panel thứ hai. | Danh mục nguyên liệu là MỘT (M3.D-12). Hai UI cùng sửa một bảng là nguồn bug và lệch hành vi. Panel đã là component độc lập có `onClose` → dùng được ở cả `/menu` lẫn `/suppliers`. |

---

## 3. Màn Quản lý nhà cung cấp — `/suppliers` (M3.D-31)

Một route riêng, lazy-load + `RoleGate` theo đúng lệ `App.tsx` (cùng nhóm quyền với `/menu`). Bốn tab:

| Tab | Nội dung | Ghi chú |
|---|---|---|
| **1. Nhà cung cấp** | Danh sách NCC: tên, SĐT, số phiếu kỳ này, **tổng mua kỳ này** (M3.D-29), lần giao gần nhất. Bấm một dòng → chi tiết NCC. | Đây là màn mặc định khi vào `/suppliers` |
| **2. Phiếu nhập** | Danh sách phiếu mọi NCC: ngày, NCC, số tiền, trạng thái, **nguồn** (NCC tự nhập / quán nhập hộ — M3.D-10). Lọc theo NCC / kỳ / trạng thái. Nút `＋ Nhập hàng` nổi bật. | Việc làm hằng ngày → phải bấm được từ đây trong 1 chạm |
| **3. Biến động giá** | Toàn bộ mục 4 dưới đây | Trọng tâm của milestone |
| **4. Mặt hàng** | Mở lại `IngredientsPanel` đang có (M3.D-32) | Không viết panel mới |

> **Sửa khi implement (2026-09-05):** "Mặt hàng" là **nút**, không phải tab. `IngredientsPanel`
> đang là modal toàn màn (`.modal-overlay`) nên đặt làm nội dung tab thì nó che luôn thanh tab
> vừa bấm. Giữ quyết định quan trọng hơn (M3.D-32 — dùng lại đúng panel đó) và đổi lối vào; sửa
> panel thành inline sẽ kéo theo đổi hành vi màn `/menu` đang chạy.

### 3.1 Chi tiết một NCC

Bấm vào một NCC ở tab 1 → trang chi tiết, gồm:

- **Đầu trang**: tên, SĐT, ghi chú, trạng thái tài khoản (`chưa có tài khoản` / `đã phát PIN` / `đang khoá`), nút **Reset PIN** (M3.D-03).
- **Ba số lớn**: `Còn phải trả` (M3.D-39) · `Đã mua kỳ này` · `Đã trả kỳ này`. Con số "còn phải trả" đặt to nhất và đầu tiên.
- **Tổng mua theo kỳ**: 6 tháng gần nhất, dạng cột.
- **Mặt hàng NCC này hay giao** — bảng của mục 3.3 lọc theo NCC này.
- **Lịch sử phiếu** của NCC này.
- **Lịch sử thanh toán** + nút `＋ Ghi nhận thanh toán`.

### 3.2 Bảng giá mặt hàng của NCC này

Tự sinh từ lịch sử nhập (M3.D-18), một dòng cho mỗi mặt hàng NCC này từng giao:

| Mặt hàng | Đơn vị mua | Giá gần nhất | Quy về | Ngày | So lần trước | Xu hướng 6 lần |
|---|---|---|---|---|---|---|
| Nước mắm | thùng (24×500ml) | 180.000 | 15,0 đ/ml | 03/09 | ▲ 7,1% | ▁▁▂▃▃▅ |
| Rau muống | bó | 12.000 | 12.000 đ/bó | 05/09 | — | ▃▂▃▂▃▃ |
| Thịt ba chỉ | kg | 145.000 | 145 đ/g | 05/09 | ▲ 7,4% | ▁▂▃▅▆▆ |

Cột `Quy về` là `unit_price_base` (M3.D-36) — đây là con số duy nhất so sánh được qua thời gian và qua NCC. Cột `So lần trước` cũng tính trên nó, nên đổi cỡ đóng gói vẫn hiện ra (M3.D-37).

**Đây là bảng chủ quán mở ra trước khi gọi điện đặt hàng.** Bấm một dòng → lịch sử giá đầy đủ của mặt hàng đó (mục 4.3).

### 3.3 Thống kê mặt hàng nhập (M3.D-42)

Cùng một bảng, dùng ở hai nơi: trong chi tiết NCC thì lọc sẵn theo NCC đó, ở tab "Phiếu nhập" thì gộp toàn quán.

| Mặt hàng | NCC | Số lần nhập | Lượng nhập | Tổng tiền | Giá bình quân | Giá gần nhất |
|---|---|---|---|---|---|---|
| Thịt ba chỉ | NCC A | 8 | 245 kg | 34.775.000 | 141,9 đ/g | 145 đ/g |
| Rau muống | NCC B | 26 | 520 bó | 6.240.000 | 12.000 đ/bó | 12.000 đ/bó |

- **Giá bình quân** = `Σ tiền ÷ Σ lượng` (bình quân gia quyền, không phải trung bình các đơn giá) — mua 200kg giá thấp và 5kg giá cao thì bình quân phải nghiêng về giá thấp.
- Sắp mặc định theo `Tổng tiền` giảm dần: mặt hàng ngốn nhiều tiền nhất nằm trên.
- Lọc theo kỳ; xuất Excel.
- Dòng tổng cuối bảng: tổng tiền nhập trong kỳ, khớp với `Đã mua kỳ này` ở mục 3.1.

Lý do bảng này cần tồn tại song song với biến động giá: **giá tăng 5% mà lượng nhập tăng gấp đôi thì tiền đội lên nhiều hơn hẳn**, mà nhìn cột % giá không thấy gì.

### 3.4 Nút `＋ Nhập hàng`

Có ở cả tab 1 (trong chi tiết NCC, NCC điền sẵn) và tab 2 (phải chọn NCC). Mở đúng màn nhập của M3.D-06 — cùng một màn NCC dùng, admin chỉ thêm quyền chọn NCC / sửa ngày / sửa giá.

### 3.5 Ghi nhận thanh toán (M3.D-39)

Màn nhỏ: NCC · ngày trả · số tiền · hình thức (tiền mặt / chuyển khoản) · ghi chú. Không gán vào phiếu cụ thể — chỉ trừ vào tổng nợ của NCC.

Cố ý **không** làm đối chiếu từng phiếu với từng lần trả: quán trả tiền theo đợt, gộp nhiều phiếu, và bắt gán từng phiếu là tự tạo ra một module kế toán mà không ai duy trì nổi.

---

## 4. Tab "Biến động giá" (M3.D-30)

Một màn duy nhất, ba cách nhìn cùng bộ dữ liệu.

### 4.1 Bảng biến động (mặc định)

Toàn bộ cặp (NCC × mặt hàng) có giá thay đổi trong kỳ:

| Mặt hàng | NCC | Giá kỳ trước | Giá hiện tại | % | Sản lượng kỳ | **Tiền ảnh hưởng** | Xu hướng |
|---|---|---|---|---|---|---|---|
| Thịt ba chỉ | NCC A | 135.000 | 145.000 | ▲ 7,4% | 245 kg | **+2.450.000** | ▁▂▃▅▆ |
| Cà chua | NCC B | 22.000 | 28.000 | ▲ 27,3% | 30 kg | +180.000 | ▁▇▂▇▃ |
| Hành lá | NCC B | 15.000 | 12.000 | ▼ 20,0% | 40 kg | −120.000 | ▅▃▂▁▁ |

**Sắp xếp mặc định: theo `Tiền ảnh hưởng` giảm dần — KHÔNG theo %.**
Tăng 27% mặt hàng mua 600k không bằng tăng 7% mặt hàng mua 35 triệu. Sắp theo % luôn đẩy thứ vặt lên đầu.

`Tiền ảnh hưởng = (giá hiện tại − giá kỳ trước) × sản lượng nhập trong kỳ`

**Bộ lọc:** kỳ (tháng này / tháng trước / quý / tuỳ chọn) · NCC · nhóm mặt hàng · chỉ tăng / chỉ giảm / cả hai · ngưỡng % tối thiểu.

**Dòng tổng ở đầu bảng:** *"Kỳ này chi phí nguyên liệu tăng thêm 3.180.000đ so với kỳ trước — do 7 mặt hàng."* Đây là con số chủ quán cần nhất, phải nằm trên cùng.

### 4.2 Ma trận so giá giữa các NCC

Hàng = mặt hàng, cột = NCC, ô = giá nhập gần nhất. **Tô đậm ô rẻ nhất mỗi hàng**, ô đắt hơn ≥15% so với rẻ nhất thì tô đỏ nhạt.

| Mặt hàng | NCC A | NCC B | NCC C | Chênh |
|---|---|---|---|---|
| Rau muống | 12.000 | **9.500** | 11.000 | 26% |
| Thịt ba chỉ | **145.000** | — | 152.000 | 4,8% |

Cột `Chênh` = (đắt nhất − rẻ nhất) / rẻ nhất, sắp giảm dần. Đây là danh sách việc cần đàm phán, xếp sẵn theo thứ tự ưu tiên.

Chỉ so được vì M3.D-12 dùng chung một danh mục mặt hàng.

### 4.3 Lịch sử giá một mặt hàng

Bấm vào tên mặt hàng bất kỳ → biểu đồ đường theo thời gian, **mỗi NCC một màu**, chấm tại từng lần nhập. Nhìn ra ngay NCC nào trượt giá đều đặn thay vì nhảy đột ngột.

Dưới biểu đồ: bảng từng lần nhập (ngày, NCC, số lượng, đơn giá, ai nhập, phiếu số) — bấm ra phiếu gốc.

### 4.4 Xuất Excel

Cả ba cách nhìn đều xuất được ra Excel. Chủ quán hay cần mang số đi đàm phán với NCC.

---

## 5. Mô hình dữ liệu

> Project dùng `synchronize: true` — **không viết migration file** (cùng quy ước M2.D-07).

### 5.1 Phần đã có sẵn — TÁI DÙNG, không làm lại

Nhánh `feat/misa-sync-and-recipe` đã implement `apps/api/src/modules/ingredients/`. Bốn quyết định của spec này **đã tồn tại trong code**:

| Quyết định | Đã có ở đâu | Ghi chú |
|---|---|---|
| M3.D-12 danh mục dùng chung | `entities/ingredient.entity.ts` | Comment đầu file chốt đúng nguyên tắc này |
| M3.D-14 tìm không dấu, chặn trùng | `ingredient-units.ts` → `normalizeName()`, cột `name_key` UNIQUE | Chặn trùng **chính tả**; trùng ngữ nghĩa vẫn cần `merge` |
| M3.D-16 bắt buộc đơn vị | `parseUnit()` + cột `unit` | **Chặt hơn spec**: đơn vị phải thuộc whitelist, quy về đơn vị gốc (`g`/`ml`/đơn vị đếm) trước khi lưu |
| M3.D-17 gộp mặt hàng trùng | `IngredientsService.merge` + `merged_into_id` | Xoá mềm, giữ vết truy ngược |

Cần **thêm** vào `ingredients`: cột `price_alert_threshold_pct NULL` (M3.D-23).

### 5.2 Bảng mới

```
suppliers
  id, name, phone, note, is_active,
  opening_balance, opening_balance_date            -- M3.D-40, chỉ owner sửa, có audit log

supplier_payments           -- M3.D-39
  id, supplier_id, paid_on, amount, method, note,
  created_by_user_id, created_at

supplier_users              -- giai đoạn 3 (M3.D-01)
  id, supplier_id, phone, pin_hash, failed_attempts, locked_until

supplier_deliveries
  id, supplier_id, delivery_date, status, source,   -- source: SUPPLIER | STAFF (M3.D-10)
  created_by_user_id, created_at, note, total_amount

supplier_items              -- cấu hình mặc định cho cặp (NCC, mặt hàng), TỰ SINH lần nhập đầu (M3.D-18)
  id, supplier_id, ingredient_id,
  purchase_unit,                                    -- chuỗi tự do NCC dùng: "thùng", "bao 25kg" (M3.D-33)
  qty_base_per_purchase_unit,                       -- 1 đơn vị mua = bao nhiêu đơn vị gốc (M3.D-35)
  last_unit_price,                                  -- đồng / đơn vị mua, để điền sẵn (M3.D-20)
  last_unit_price_base,                             -- đồng / đơn vị gốc, để so sánh (M3.D-36)
  last_delivery_date
  UNIQUE (supplier_id, ingredient_id)

supplier_delivery_lines
  id, delivery_id, ingredient_id,
  ingredient_name_snapshot, unit_snapshot,          -- M3.D-27, unit_snapshot = đơn vị GỐC
  purchase_unit_snapshot,                           -- đơn vị NCC báo lúc đó
  qty_base_per_unit_snapshot,                       -- hệ số lúc đó — snapshot vì NCC đổi cỡ thùng (M3.D-37)
  qty_purchase, unit_price, amount,                 -- số thùng × đồng/thùng = tiền (số NCC nói)
  qty_base, unit_price_base,                         -- đã quy đổi (số hệ thống tính)
  prev_unit_price_base, price_change_pct,           -- so trên _base, KHÔNG so trên unit_price (M3.D-36)
  prev_qty_base_per_unit,                           -- để phát hiện đổi cỡ đóng gói (M3.D-37)
  price_approved_by_user_id
```

**Bốn đẳng thức bất biến** (validate ở service, không tin client):

```
qty_base        = qty_purchase × qty_base_per_unit_snapshot
unit_price_base = unit_price   ÷ qty_base_per_unit_snapshot
amount          = qty_purchase × unit_price
còn phải trả    = opening_balance + Σ amount (phiếu ĐÃ DUYỆT) − Σ payments   -- M3.D-39, 41
```

`purchase_unit` chỉ là nhãn để đọc; **mọi phép tính đi qua `qty_base` / `unit_price_base`**. Đơn vị mua không bao giờ được truyền vào `toBaseQty()` (M3.D-34).

Index cần: `(ingredient_id, supplier_id, delivery_date)` trên `supplier_delivery_lines` join `supplier_deliveries` — dùng cho cả biến động giá (mục 4) và thống kê mặt hàng nhập (3.3). Thêm `(supplier_id, paid_on)` trên `supplier_payments`.

**Trạng thái phiếu:** `NCC gửi` 🟡 → `Chờ quán duyệt giá` 🟠 (nếu lệch) → `Đã kiểm` 🔵 → `Khớp` 🟢 / `Lệch` 🔴

Phiếu admin nhập hộ vào thẳng `Đã kiểm` (M3.D-07).

---

## 6. Lộ trình đề xuất

| Bước | Nội dung | Ghi chú |
|---|---|---|
| ✅ **1** | Route `/suppliers` + tab 1 (danh sách NCC) + tab 2 (phiếu nhập) + tab 4 (nối `IngredientsPanel`) + màn nhập phiếu admin + **popup cảnh báo giá** | Chạy được thật ngay, rủi ro gần bằng 0, bắt đầu sinh lịch sử giá. `ingredients` đã có sẵn (5.1). |
| ✅ **2** | **Thống kê mặt hàng nhập** (3.3) + bảng giá mặt hàng của NCC (3.2) + tab **Biến động giá** (4.1–4.4) | Cần dữ liệu của bước 1. 3.3 dùng được ngay từ phiếu đầu tiên; 4.1 cần ~2 kỳ nhập mới có nghĩa |
| ✅ **3** | **Công nợ**: `supplier_payments` + số dư đầu kỳ + màn ghi nhận thanh toán (M3.D-39→41, mục 3.5) | Tách riêng vì phụ thuộc **việc vận hành** — chủ quán phải đối chiếu số dư đầu kỳ với từng NCC trước khi bật (Q-7). Code xong mà chưa có số dư thì con số hiển thị vẫn sai. |
| ✅ **4** | Tài khoản NCC tự nhập (M3.D-01→04), phát PIN cho 3–5 NCC dễ tính nhất làm thử | Mở rộng dần; ai không dùng thì vĩnh viễn ở đường admin nhập hộ |
| ✅ **5** | Nối `ingredients` vào `recipe_lines` → **giá vốn món ăn theo thời gian thực** | Ghép với `feat/misa-sync-and-recipe` |

Bước 5 mới là câu trả lời cuối cùng cho "giá tăng thì sao": *"Bún chả — giá vốn 18.000 → 21.500, biên lợi nhuận còn 46%."*

---

## 7. Vấn đề còn treo

| # | Vấn đề | Ghi chú |
|---|---|---|
| ~~Q-1~~ | ~~Bảng `ingredients` chưa tồn tại~~ | **ĐÃ GIẢI QUYẾT 2026-09-05**: nhánh `feat/supplier-portal` đã dựng trên `feat/misa-sync-and-recipe`, module `ingredients` có sẵn. Xem 4.1. |
| ~~Q-2~~ | ~~Ngưỡng 10%/30%~~ | **CHỐT 2026-09-05** theo đề xuất: 10% vào popup, 30% bắt duyệt từng dòng. Chỉnh được sau qua `ingredients.price_alert_threshold_pct`, không ảnh hưởng cấu trúc dữ liệu. |
| ~~Q-3~~ | ~~"Kỳ trước" tính thế nào~~ | **CHỐT 2026-09-05** theo đề xuất: bảng 4.1 so **giá nhập cuối kỳ trước vs giá nhập cuối kỳ này** (ổn định hơn giá bình quân khi số lần nhập ít). Riêng cột `Giá bình quân` ở 3.3 vẫn là bình quân gia quyền theo lượng. |
| ~~Q-4~~ | ~~Đơn vị MUA khác đơn vị LƯU~~ | **ĐÃ CHỐT 2026-09-05 — phương án B**: thêm đơn vị mua + hệ số quy đổi, không đụng `ingredient-units.ts`. Xem M3.D-33→35. |
| ~~Q-5~~ | ~~Đơn giá so sánh phải chuẩn hoá~~ | **ĐÃ CHỐT 2026-09-05**: lưu `unit_price_base`, mọi so sánh chạy trên cột đó. Xem M3.D-36→38. |
| ~~Q-6~~ | ~~Nhãn đơn vị mua tự do sẽ sinh "thùng"/"Thùng"/"thung"~~ | **CHỐT 2026-09-05** theo đề xuất: so khớp nhãn qua `normalizeName()` có sẵn, và ô đơn vị mua gợi ý sẵn các `purchase_unit` NCC đó đã dùng. Không nguy hiểm như trùng mặt hàng vì mọi phép tính đi qua `qty_base`. |
| **Q-7** | **Số dư đầu kỳ (M3.D-40) chưa có số.** Con số "còn phải trả" chỉ đúng khi chủ quán nhập đúng số dư đang nợ từng NCC ở thời điểm bắt đầu dùng. | Đây là **việc của chủ quán, không phải việc của code**: phải đối chiếu với sổ/NCC một lần cho 10–30 NCC trước khi bật tính năng công nợ. Nếu chưa có số, để `opening_balance = 0` và hiểu con số hiển thị là "phát sinh từ ngày bắt đầu dùng", KHÔNG phải tổng nợ thật. |
