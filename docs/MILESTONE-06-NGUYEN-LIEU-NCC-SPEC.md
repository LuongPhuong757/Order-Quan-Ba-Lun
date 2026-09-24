# Milestone 6 — Nguyên Liệu Gắn Nhà Cung Cấp & Giá Vốn Món

**Trạng thái:** ĐANG LÀM — spec chốt. Bước bảng quan hệ hoá ra đã xong từ M3 (xem M6.D-04).
**Ngày chốt:** 2026-09-24
**Nguồn:** Phiên thảo luận trực tiếp với chủ dự án (5 vòng hỏi–đáp)
**Nhánh git:** `feat/nguyen-lieu-ncc`, cắt từ `feat/thiet-ke-lai-man-quan-ly-menu`
**Liên quan:** nối hai nhánh dữ liệu đã có sẵn từ Milestone 3 — phiếu nhập NCC (`supplier_delivery_lines`) và công thức món (`recipe_lines`) — qua bảng `supplier_items` đã có sẵn từ chính Milestone 3.

---

## 1. Mục tiêu

Trả lời được hai câu của chủ quán, bằng dữ liệu đã có:

1. **"Nhập một cân thì bán được bao nhiêu phần?"**
2. **"Mặt hàng này mua ở đâu, ai rẻ hơn?"**

Và dựng xong bất biến làm nền cho mọi thứ sau: **nguyên liệu là thứ đã từng mua từ một nhà cung cấp.**

### Vì sao bây giờ

Milestone 3 đã dựng xong nhánh nhập hàng (26 dòng phiếu, 14 mặt hàng, 6 NCC trên DB dev). Milestone công thức đã dựng xong nhánh định lượng. **Hai nhánh chưa bao giờ gặp nhau**: không có chỗ nào nối giá mua với định lượng để ra giá vốn, và không có chỗ nào nói mặt hàng này mua của ai.

### Điều KHÔNG làm ở milestone này

| Không làm | Vì sao |
|---|---|
| **Tồn kho** | Chủ quán chốt: thực tế chưa nắm được số tồn thật. Tồn kho tính toán mà không có kiểm kê đối chiếu sẽ trôi xa thực tế sau vài tuần mà không ai biết. |
| **Lô hàng / FIFO** | Chỉ cần khi làm tồn kho theo từng NCC. Bếp lấy miếng thịt nào trong tủ thì hệ thống không biết — con số sẽ là suy diễn, không phải sự thật. |
| **Kiểm kê định kỳ** | Chủ quán chốt: không tính vội. |
| **Tỉ lệ hao hụt sơ chế** | Chủ quán chốt: không kê khai được. Giải bằng quy ước M6.D-13 thay vì bằng dữ liệu. |

---

## 2. Quyết định đã chốt (locked)

> Mỗi quyết định có ID để phase artifacts tham chiếu. **Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`.

### Quan hệ nguyên liệu ↔ nhà cung cấp

| ID | Quyết định | Lý do |
|---|---|---|
| **M6.D-01** | Một mặt hàng **mua được ở nhiều nơi**. Quan hệ nguyên liệu × NCC là **nhiều-nhiều**, KHÔNG phải một-một. | Dữ liệu thật đã vi phạm ràng buộc một-một ngay từ đầu: 5/14 nguyên liệu (rau muống, hành lá, cá lóc, tôm sú, xà lách) đã nhập từ 2 NCC. Ép một-một thì phải tạo "Rau muống (chị Tư)" và "Rau muống (anh Minh)" — phá chính cái `name_key` UNIQUE sinh ra để giải, và mất luôn khả năng so giá giữa các nơi. |
| **M6.D-02** | **Nguyên liệu = mặt hàng đã từng mua từ một NCC.** Không có nguyên liệu nào tồn tại ngoài quan hệ đó. | Bất biến kiểm tra được, và dập nguồn rác: muốn tạo rác thì phải lập hẳn một phiếu nhập cho nó. 14/14 nguyên liệu hiện có đều đã có phiếu nhập nên bất biến đúng ngay từ ngày đầu, không có dòng mồ côi cần dọn. |
| **M6.D-03** | **Bỏ mọi đường tạo nguyên liệu trừ phiếu nhập.** Bỏ nút "+ Tạo mới" ở màn Công thức và nút "Thêm nguyên liệu" ở màn Nguyên liệu. | Hệ quả trực tiếp của M6.D-02. Luồng còn lại đọc lên tự nhiên: mua hàng về → khai vào phiếu → thứ đó thành nguyên liệu → công thức chọn từ những thứ mình thật sự có mua. **Thay thế quyết định cũ ngày 2026-09-05** ("tự tạo nguyên liệu từ màn Công thức"). |
| **M6.D-04** | **Dùng lại bảng `supplier_items` đã có** (M3.D-18). KHÔNG tạo bảng mới, KHÔNG backfill. | Chủ dự án chốt hướng "có bảng sẵn thay vì join mỗi lần" — và bảng đó đã tồn tại từ Milestone 3 với đúng các cột cần: cặp (NCC, nguyên liệu) UNIQUE, `purchase_unit`, `qty_base_per_unit`, `last_unit_price`, `last_unit_price_base`, `last_delivery_date`. Trên DB dev nó đang có **19 dòng**, khớp chính xác số cặp mô phỏng từ lịch sử phiếu. |
| **M6.D-05** | Nghĩa vụ cập nhật `supplier_items` ở mọi luồng phiếu nhập **đã được implement sẵn** ở M3.D-18/19/20 — dòng tự sinh lần đầu nhập, tự cập nhật mỗi lần sau. | Không phải làm gì thêm. Đây vốn là rủi ro lớn nhất của phương án "có bảng" (quên cập nhật một luồng là số lệch âm thầm), và Milestone 3 đã gánh xong. |
| **M6.D-06** | Đơn vị mua + hệ số quy đổi khai **một lần cho mỗi cặp (nguyên liệu, NCC)**, phiếu sau tự áp — cũng đã có sẵn (M3.D-20, điền sẵn ô nhập từ `supplier_items`). | Dập nguồn lỗi thật đã xảy ra: khai mặt hàng theo "KG" trong khi đơn vị gốc là `g` làm giá gốc lệch đúng 1000 lần mà phiếu vẫn hiện đúng. |

### Giá vốn

| ID | Quyết định | Lý do |
|---|---|---|
| **M6.D-07** | Giá vốn dùng **giá của lần nhập gần nhất**, bất kể NCC nào. | Chủ dự án chọn, sau khi cân với bình quân gia quyền 30 ngày. Con số luôn giải thích được: bấm vào là ra đúng phiếu nào. Hệ quả đã biết: **mua một lần đắt bất thường là giá vốn mọi món chứa nó nhảy theo ngay**, kể cả khi lần sau mua lại rẻ. |
| **M6.D-08** | Giá vốn hiển thị **kèm mốc thời gian**: "129.700đ · theo giá nhập tới 23/09". | Không có mốc thì vài tuần sau không ai biết con số đó cũ hay mới. |
| **M6.D-09** | Nhãn phải là **"giá vốn nguyên liệu chính — chưa gồm gia vị, dầu mỡ"**, không được rút gọn thành "giá vốn". | Hệ quả bắt buộc của M6.D-10: con số này luôn thấp hơn chi phí thật cỡ 3–8%. Ai nhìn nó rồi tính lãi sẽ tính dư. Một chữ "chính" và một dòng chú thích là đủ để không ai hiểu nhầm về sau. |

### Phạm vi công thức

| ID | Quyết định | Lý do |
|---|---|---|
| **M6.D-10** | **Gia vị nhỏ không khai vào công thức.** Thêm cờ `ingredients.track_in_recipe` (mặc định `true`); `false` thì không hiện trong ô gợi ý màn Công thức. | Chủ quán chốt. Nước mắm, muối, tiêu, dầu ăn vẫn nhập hàng bình thường, vẫn có công nợ, vẫn so giá — chỉ không vào công thức. Cần một cờ chứ không phải trí nhớ, nếu không thì hai người sẽ nhớ khác nhau. |
| **M6.D-11** | Mặc định của cờ là **`true`** (có khai), không phải `false`. | Thứ quên phân loại thì hiện ra trong công thức — thấy được, sửa được. Nếu mặc định ẩn thì người khai tìm mãi không thấy tôm đâu mà không hiểu vì sao. |
| **M6.D-12** | Ranh giới "nhỏ quá": **thứ nào khi nấu không đong đếm thì không khai.** Nêm nếm theo tay — bỏ. Cân, đếm, múc theo định lượng — khai. | Quy tắc dùng được mà không cần tra bảng, và khớp đúng thực tế bếp. Theo đó: nước mắm, muối, bột ngọt bỏ; nhưng nước dùng xương (múc theo tô), sả, lá chanh (đếm cây, đếm lá) thì khai dù nghe cũng "nhỏ". **Không có ngoại lệ cho nhóm nhỏ-mà-đắt** (nghệ tây, nấm hương khô) — một quy tắc có ngoại lệ là một quy tắc sẽ bị quên. |
| **M6.D-13** | Định lượng trong công thức ghi theo nguyên liệu **NGUYÊN TRẠNG LÚC MUA**: "tôm sú 150g" = 150g tôm như mua ở chợ, chưa bóc vỏ. | Giải bài toán hao hụt **bằng quy ước thay vì bằng cột dữ liệu**, sau khi chủ quán chốt không kê khai hao hụt được. Hao hụt tự nằm trong con số định lượng, và phép chia "1 cân ra mấy phần" tự khắc đúng vì cùng thước đo với phiếu nhập. |
| **M6.D-14** | Câu quy ước M6.D-13 phải in **ngay trên màn Công thức**, chỗ người ta đang gõ. | Rủi ro duy nhất của M6.D-13 là người khai lẫn lộn hai cách — món này ghi tôm nguyên con, món kia ghi tôm đã bóc. Không có gì phát hiện được, số liệu chỉ lệch âm thầm. Câu quy ước nằm trong tài liệu thì không ai đọc. |

---

## 3. Bảng quan hệ: dùng lại `supplier_items`

Bảng đã có từ Milestone 3, không đụng schema:

| Cột | Dùng cho việc gì ở milestone này |
|---|---|
| `supplier_id` + `ingredient_id` (UNIQUE) | "Mặt hàng này mua ở đâu" — đọc ngược lại ra "NCC này bán những gì" |
| `purchase_unit`, `qty_base_per_unit` | Quy "1 kg" ra "1000 g" để tính số phần |
| `last_unit_price_base` | Giá vốn (M6.D-07), và so giá giữa các NCC của cùng một mặt hàng |
| `last_delivery_date` | Mốc thời gian bắt buộc của M6.D-08 |

**Không cần backfill.** Dòng tự sinh từ lần nhập đầu tiên, nên dữ liệu đã đầy đủ ngang với lịch sử phiếu.

Bốn rủi ro của backfill nêu ở bản spec trước (hệ số sai 1000×, nguyên liệu đã gộp, NCC xoá mềm, rác test) **không còn áp dụng** — không có bước ghi hàng loạt nào để mà sai. Riêng rác test ("Aaa" từ NCC "Test", đơn vị `KG` viết hoa) vẫn nên dọn tay trên dev.

### Chỗ duy nhất còn đụng schema

Cột `ingredients.track_in_recipe` (M6.D-10) — một boolean, mặc định `true`.

## 4. Thứ tự làm

| Bước | Nội dung | Phụ thuộc |
|---|---|---|
| ~~1~~ | ~~Bảng quan hệ + backfill~~ — **đã có sẵn** (`supplier_items`, M3.D-18) | — |
| 1 | Cột `track_in_recipe` + API `/ingredients` trả kèm NCC, giá, ngày | — |
| 2 | Màn Nguyên liệu: hiện nơi bán + giá gần nhất; bỏ nút "Thêm"; ô phân loại gia vị trong form Sửa | 1 |
| 3 | Màn Công thức: bỏ "+ Tạo mới", gợi ý kèm NCC/giá, lọc theo `track_in_recipe`, dòng quy ước M6.D-13 | 1 |
| 4 | Giá vốn nguyên liệu chính mỗi phần + "1 kg ≈ mấy phần" từng dòng + % trên giá bán | 1, 3 |

**Hai điều chỉnh so với dự kiến, phát hiện khi dựng thật:**

- **"1 kg ≈ mấy phần" nằm ở màn Công thức, không phải màn Nguyên liệu.** Một nguyên liệu dùng ở
  nhiều món với định lượng khác nhau nên ở danh mục nó không có một đáp án; chỉ khi đứng cạnh
  một dòng công thức cụ thể thì con số mới có nghĩa. Đặt nó ngay dưới định lượng vừa gõ cũng là
  chỗ duy nhất người khai nhận ra mình nhầm đơn vị: gõ 250 kg thay vì 250 g thì dòng hiện
  "1 kg ≈ 0 phần", sai lộ ra ngay thay vì đợi tới lúc xem báo cáo.
- **Phân loại gia vị nằm trong form Sửa, không phải một nút trên mỗi dòng.** Hàng nút của mỗi
  dòng vốn đã có Sửa / Gộp / Xoá; đo ở khung 500px thì nút thứ tư bóp cột tên xuống ba dòng chữ.
  Phân loại lại một nguyên liệu là việc làm một lần rồi thôi.

---

## 5. Câu chưa trả lời

- **Nguyên liệu không mua qua NCC nào** (nước máy, đá tự làm, rau tự trồng): theo M6.D-02 thì không khai công thức được. Nhóm này phần lớn trùng với gia vị nên M6.D-10 đã gánh gần hết. Nếu còn sót, cách rẻ nhất là một NCC kỹ thuật tên "Mua lẻ / Tự có" — **chưa chốt, chờ gặp ca thật.**
- **Món chưa khai công thức không sinh tiêu hao và không có giá vốn** — hiện im lặng bỏ qua. Trên DB dev là 597/597 món. Cần một chỗ nói "bao nhiêu món chưa khai", nhưng chưa thuộc milestone này.
