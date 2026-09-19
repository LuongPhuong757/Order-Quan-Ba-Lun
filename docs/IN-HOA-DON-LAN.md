# Cầu in

Máy in không nói chuyện trực tiếp với điện thoại nhân viên được, nên cần một thiết bị đứng ở
quầy làm cây cầu: nó hỏi server có gì cần in không, rồi đẩy byte sang máy in.

Điện thoại của nhân viên — iPhone hay Android — **không cần cài gì cả**. Họ thanh toán như
bình thường, giấy tự ra ở quầy.

## Hai chế độ, chọn theo cách máy in nối vào mạng

| Máy in nối bằng | Cầu in là gì | Hướng dẫn |
|---|---|---|
| **Dây mạng (LAN)** | Script `bridge.mjs` chạy trong Termux trên máy tính bảng Android | Phần còn lại của file này |
| **Dây USB vào máy POS Android** | Trang web `/print-bridge` mở trong Chrome trên máy POS | [IN-HOA-DON-USB.md](IN-HOA-DON-USB.md) |

Chọn chế độ tương ứng ở **/admin → Cài đặt → Máy in → "Máy in nối vào đâu"**. Server dựng hoá
đơn giống hệt nhau ở cả hai chế độ; chỉ đoạn cuối cùng — từ cầu in tới máy in — là khác.

---

# Chế độ LAN — cài trên máy tính bảng

---

## 1. Chuẩn bị máy in

1. Cắm điện, nối máy in vào cùng mạng với máy tính bảng. Máy có **cổng LAN (网口 / RJ45)** thì
   cắm thẳng dây mạng vào router — nhanh và ổn định hơn Wi-Fi, và bỏ qua được toàn bộ phần
   cấu hình Wi-Fi rắc rối bên dưới.
2. Đặt **IP tĩnh** cho máy in ở trang quản trị router (gán theo địa chỉ MAC). Đặt ở router chứ
   đừng đặt trong máy in: máy in reset về mặc định là mất cấu hình, còn router thì không.
3. Ghi lại IP, ví dụ `192.168.1.50`.

Ba thứ hay làm hỏng bước này, nhìn bề ngoài giống hệt lỗi phần mềm:

- **Module Wi-Fi của Xprinter hầu hết chỉ chạy 2.4GHz.** Router đời mới thường gộp chung một
  tên mạng cho cả 2.4 và 5GHz, và máy in sẽ không vào được mà cũng không báo gì. Cách chữa:
  tách riêng một SSID 2.4GHz.
- **Chế độ cách ly thiết bị (AP isolation) / mạng khách.** Máy tính bảng vẫn vào được internet
  nhưng không thấy máy in. Cả hai phải nằm trên cùng một mạng và tắt cách ly.
- **Cấu hình Wi-Fi lần đầu cho máy in** thường phải làm qua cổng USB bằng công cụ Windows của
  Xprinter. Biết trước để khỏi mắc kẹt nếu trong nhà không có máy Windows.

## 2. Khai báo trên web

Vào **/admin → Máy in**:

1. Điền IP và cổng máy in (cổng mặc định `9100`).
2. Chọn **khổ giấy** — xem đáy máy in, dòng `热敏纸宽 / Paper width`. Máy để bàn thường 80mm,
   máy nhỏ/cầm tay 58mm. Chọn sai thì hoá đơn **vẫn in bình thường** nhưng chữ chỉ chiếm nửa
   trái tờ giấy, và không có thông báo lỗi nào — nên kiểm bằng tờ IN THỬ ở mục 5.
3. Chọn có dao cắt giấy hay không.
4. Bật công tắc **Bật in hoá đơn**.
5. Bấm **Thêm thiết bị**, đặt tên ("Tablet quầy"). Chép lại **token** hiện ra.

### Không biết IP máy in?

Ba cách, từ chắc chắn nhất:

1. **Tờ tự kiểm của máy in** — tắt máy, giữ nút FEED rồi bật điện. Máy tự in ra tờ giấy có IP
   và địa chỉ MAC. Đây là nguồn đáng tin nhất vì nó do chính máy in khai.
2. **Dò từ máy tính bảng** — sau khi đã cài Node ở mục 3:
   ```bash
   node ~/print-bridge/find-printer.js
   ```
3. **Trang quản trị router** — mục *DHCP client list* / *Thiết bị đã kết nối*, tìm dòng có tên
   kiểu `XPRINTER` hoặc khớp địa chỉ MAC trên tờ tự kiểm.

## 3. Cài trên máy tính bảng

Cài **Termux** từ **F-Droid** — không phải từ Google Play. Bản trên Play Store đã ngừng cập
nhật từ lâu và không chạy được; cài nhầm sẽ mất thời gian gỡ.

Mở Termux và gõ:

```bash
pkg update && pkg install nodejs -y
mkdir -p ~/print-bridge && cd ~/print-bridge
# chép `tools/print-bridge/bridge.mjs` của repo vào đây
# (gửi qua Zalo/Drive rồi cp từ ~/storage/downloads)
```

Tạo file khởi động `~/print-bridge/run.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/bash
export API_URL="https://quanbalun.vn"      # địa chỉ web của quán
export PRINT_TOKEN="dán-token-vừa-tạo"
termux-wake-lock                            # giữ CPU, không cho Android ru ngủ tiến trình
cd ~/print-bridge
while true; do
  node bridge.mjs
  echo "Cầu in thoát bất thường, chạy lại sau 5 giây..."
  sleep 5
done
```

```bash
chmod +x ~/print-bridge/run.sh
~/print-bridge/run.sh
```

Nếu chạy đúng, màn hình hiện `Cầu in khởi động · server https://...`.

Về `while true`: script trong này đã tự bắt lỗi mạng và thử lại, nên nó gần như không bao giờ
thoát. Vòng lặp ngoài là lớp cuối cùng — có nó thì một lỗi chưa lường trước cũng chỉ làm gián
đoạn năm giây thay vì làm chết cầu in cho tới khi có người để ý.

## 4. Cho nó sống 24/7

Thiếu bất kỳ bước nào dưới đây thì cầu in chạy vài tiếng rồi chết, và nhìn vào sẽ tưởng code sai.

1. **Tắt tối ưu pin cho Termux**: Cài đặt Android → Ứng dụng → Termux → Pin → *Không hạn chế*.
   Đây là bước hay bị bỏ qua nhất và cũng là nguyên nhân số một.
2. **Cài Termux:Boot** (cũng từ F-Droid) rồi tạo `~/.termux/boot/start-bridge.sh`:
   ```bash
   #!/data/data/com.termux/files/usr/bin/bash
   ~/print-bridge/run.sh
   ```
   `chmod +x` cho nó. Từ đó tablet khởi động lại là cầu in tự chạy.
3. **Cắm sạc thường trực.** Nếu là máy cũ thì thỉnh thoảng ngó pin — sạc liên tục nhiều năm
   dễ làm pin phồng.

## 5. Kiểm tra

Ở **/admin → Máy in** bấm **In thử**. Tờ giấy phải có:

- dấu tiếng Việt đầy đủ ("Mỳ Quảng ếch", "Ổi ươm");
- dòng **Khổ giấy** khớp với tờ giấy thật đang lắp trong máy;
- hai mốc `|◀ mép trái` và `mép phải ▶|` **chạm sát hai bên** tờ giấy.

Nếu chữ chỉ chiếm nửa trái tờ giấy thì khổ giấy đang đặt 58mm trong khi máy là 80mm — sửa ở ô
Khổ giấy rồi in thử lại.

Kiểm máy in có thông không, từ Termux:

```bash
# thấy "open" là mạng thông tới máy in
nc -vz 192.168.1.50 9100
```

## 6. Chạy cả hai máy tính bảng

Nên chạy **cả hai cùng lúc**, không cần để một máy dự phòng nguội. Server giao job bằng một
câu `UPDATE ... SKIP LOCKED` nguyên tử nên hai máy không bao giờ nhận cùng một job — một máy
chết thì máy kia gánh ngay mà không ai phải làm gì.

## 7. Khi giấy không ra

Xem cột **Trạng thái** ở màn Máy in trước — cầu in báo lại đúng nguyên nhân nó gặp.

| Hiện trên màn | Nghĩa là |
|---|---|
| `Máy in hết giấy` / `Nắp máy in đang mở` | Cầu in đọc được máy in và máy in đang có vấn đề vật lý |
| `Không kết nối được máy in …` | Sai IP, máy in tắt, hoặc tablet và máy in khác mạng |
| `Token thiết bị sai hoặc đã bị thu hồi` | Token đã bị thu hồi ở /admin — tạo thiết bị mới và dán lại |
| Thiết bị *không gọi về* quá vài phút | Tablet ngủ (xem mục 4), mất Wi-Fi, hoặc Termux bị tắt |

Job quá **30 phút** không ai in sẽ tự hết hạn và **không in nữa**. Đây là cố ý: cầu in chết
lúc 7 giờ tối mà sáng hôm sau mới cắm lại thì không ai muốn máy in nhả ra ba mươi tờ hoá đơn
của đêm qua. Cần tờ nào thì vào **Lịch sử** bấm **In lại**.
