# Chế độ USB — máy in cắm thẳng vào máy POS Android

Dùng khi máy in **không có cổng mạng**, hoặc bạn muốn bỏ chiếc máy tính bảng và để máy POS
đứng ở quầy làm luôn việc in.

Ở chế độ này cầu in **không phải** script Termux, mà là một trang web mở sẵn trong Chrome trên
máy POS. Nó đẩy byte sang máy in bằng **WebUSB**.

## Vì sao phải là trang web chứ không phải script

Trên Android không có đường nào cho một script thường ghi vào máy in USB. Nhân Linux có
`/dev/usb/lp0`, nhưng Android không mở quyền đó cho ứng dụng thường; Termux chỉ chạm được USB
qua `termux-usb`, mà đường đó cần libusb chứ không dùng được từ Node.

**WebUSB là API duy nhất** vừa nói được với máy in USB, vừa không đòi cài app hay root máy.

Cái giá phải trả, biết trước để khỏi bất ngờ: **trang phải mở và màn hình phải sáng.** Android
bóp cổ tab chạy nền. Trang có giữ Wake Lock, nhưng vẫn cần tắt chế độ ngủ màn hình của máy POS.

## Các bước

### 1. Cắm máy in vào máy POS bằng dây USB

Cắm điện cho máy in trước, rồi nối dây USB sang máy POS. Máy in phải có nguồn riêng — cổng USB
của máy POS không đủ điện nuôi đầu in nhiệt.

### 2. Khai báo trên web

Vào **/admin → Cài đặt → Máy in**:

1. **Máy in nối vào đâu** → chọn *Dây USB vào máy POS Android*. Ô địa chỉ IP sẽ biến mất, đó là
   đúng — máy in nối dây không có địa chỉ nào.
2. **Khổ giấy** → xem đáy máy in, dòng `热敏纸宽 / Paper width`.
3. Bật **Bật in hoá đơn**, bấm **Lưu**.
4. **Thêm thiết bị**, đặt tên ("Máy POS quầy"), chép token.

### 3. Mở cầu in trên máy POS

Mở **Chrome** trên máy POS — không dùng trình duyệt mặc định của máy, phần lớn không hỗ trợ
WebUSB. Vào địa chỉ:

```
https://<tên-miền-quán>/print-bridge
```

Rồi:

1. Dán token vào ô.
2. Bấm **Kết nối máy in** → Chrome hiện hộp thoại chọn thiết bị USB → chọn máy in → **Kết nối**.
3. Bấm **Bắt đầu**. Ô trạng thái phải chuyển sang nền xanh **● Đang chạy**.
4. Quay lại màn Máy in ở /admin, thiết bị phải hiện **● đang chạy**.
5. Bấm **In thử**.

Chrome nhớ quyền USB theo tên miền, nên **lần sau mở lại trang là nó tự nối lại máy in**, không
phải bấm chọn thiết bị nữa.

### 4. Giữ cho nó sống 24/7

Ba việc, thiếu cái nào cũng khiến hoá đơn ngừng ra sau vài giờ:

1. **Thêm trang vào màn hình chính** (Chrome → ⋮ → *Thêm vào Màn hình chính*). Mở từ biểu tượng
   đó thì trang chạy toàn màn hình, Android ít đẩy xuống nền hơn hẳn so với một tab thường.
2. **Tắt chế độ ngủ màn hình**: Cài đặt → Màn hình → Thời gian chờ → *Không bao giờ*.
3. **Cắm sạc thường trực.**

### 5. Khi hoá đơn không ra

Nhìn ô trạng thái to trên chính trang cầu in trước — nó nói thẳng nguyên nhân.

| Trên trang cầu in | Nghĩa là |
|---|---|
| Nền xám, **○ Chưa chạy** | Ai đó bấm Dừng, hoặc trang vừa tải lại mà chưa bấm Bắt đầu |
| **Token thiết bị sai hoặc đã bị thu hồi** | Token đã bị thu hồi ở /admin — tạo thiết bị mới, dán lại |
| **Trình duyệt này không hỗ trợ WebUSB** | Đang mở bằng trình duyệt mặc định của máy POS. Mở lại bằng Chrome |
| Nhật ký đỏ *In hỏng: …* | Máy in hết giấy, mở nắp, hoặc dây USB lỏng |
| Trang trắng / không còn mở | Android đã giết tab — xem lại 3 việc ở mục 4 |

Ở chế độ USB, cầu in **không đọc được** trạng thái hết giấy / mở nắp trước khi in như chế độ
LAN. Lỗi chỉ lộ ra khi máy in từ chối nhận dữ liệu. Đây là giới hạn của đường USB, không phải
thiếu sót có thể vá.

## Hạn chế so với chế độ LAN

| | LAN | USB |
|---|---|---|
| Cần thiết bị gì ở quầy | Máy tính bảng + Termux | Máy POS + Chrome |
| Tự chạy sau khi máy khởi động lại | Có (Termux:Boot) | **Không** — phải mở trang và bấm Bắt đầu |
| Màn hình phải sáng | Không | **Có** |
| Biết trước máy in hết giấy | Có (`DLE EOT`) | Không |
| Chạy nhiều thiết bị cùng lúc | Có | Có |

Nếu máy in của bạn có cổng mạng, chế độ LAN vẫn là lựa chọn ít hỏng hơn.

Chi tiết chế độ LAN: [IN-HOA-DON-LAN.md](IN-HOA-DON-LAN.md)
