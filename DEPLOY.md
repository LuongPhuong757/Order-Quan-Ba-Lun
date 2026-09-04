# Deploy guide — Order Quán Bà Lùn

Tài liệu deploy production lên VPS. Stack: **Caddy + NestJS API + MySQL 8** qua Docker Compose.

> Yêu cầu: VPS Ubuntu 22.04+ (2GB RAM 2 vCPU 50GB SSD), Docker + Docker Compose, domain trỏ về IP VPS.

---

## 1. Setup VPS

```bash
# SSH vào VPS
ssh root@<IP_VPS>

# Update + cài Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git

# Firewall (chỉ mở 22 SSH, 80/443 web)
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Swap 2GB (giảm risk OOM với VPS 2GB RAM)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. DNS

Trỏ domain về IP VPS (qua A record). **3 bản ghi đầu bắt buộc, bản ghi `menu` tuỳ chọn:**

| Type | Name | Value | TTL | Phục vụ |
|---|---|---|---|---|
| A | `@` | `<IP_VPS>` | 300 | Trang khách |
| A | `www` | `<IP_VPS>` | 300 | Trang khách |
| A | `admin` | `<IP_VPS>` | 300 | Trang quản lý |
| A | `menu` | `<IP_VPS>` | 300 | Quyển menu điện tử (2026-09-04) |

Apex dành cho **khách** (địa chỉ ngắn nhất, dùng cho QR và biển hiệu); nhân viên vào
`admin.<domain>`. API chọn bundle theo `Host` header ở [main.ts](apps/api/src/main.ts) —
host bắt đầu bằng `admin.` nhận `web-dist`, mọi host khác nhận `shop-dist`.

`menu.<domain>` cũng nhận `shop-dist` như apex; việc vẽ quyển menu thay vì màn đặt hàng do
[apps/shop/src/main.tsx](apps/shop/src/main.tsx) quyết định trong trình duyệt theo
`location.hostname`. Thiếu bản ghi này thì mọi thứ khác VẪN CHẠY — Caddy chỉ không xin được
cert cho host đó, và quyển menu vẫn mở được ở `<domain>/menu`. Khác hẳn `admin`: thiếu
`admin` là nhân viên mất đường vào POS.

Xác nhận trước khi build:

```bash
for h in quanbalun.site www.quanbalun.site admin.quanbalun.site menu.quanbalun.site; do
  echo "$h → $(dig +short A $h)"
done
```

> ⚠️ **Phải đợi `admin` phân giải xong rồi mới deploy.** Deploy khi bản ghi này còn thiếu
> nghĩa là apex đã chuyển sang trang khách trong khi `admin.<domain>` chưa tồn tại —
> nhân viên mất hẳn đường vào POS. Đây là lỗi khoá cửa, không phải lỗi hiển thị.
>
> Let's Encrypt cũng giới hạn 5 cert trùng lặp mỗi tuần cho một domain. Rebuild nhiều lần
> trong lúc DNS chưa xong là tự khoá mình cả tuần.

## 3. Clone code + setup env

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/LuongPhuong757/Order-Quan-Ba-Lun.git
cd Order-Quan-Ba-Lun

# Copy + sửa env
cp .env.production.example .env.production
nano .env.production
```

**Sửa các biến quan trọng:**

```bash
DOMAIN=quanbalun.com                    # domain thật
MYSQL_ROOT_PASSWORD=<random 64 chars>   # openssl rand -base64 48
MYSQL_PASSWORD=<random 32 chars>
JWT_SECRET=<random 64 chars>
SETUP_ALLOWED_IP=<IP nhà chủ quán>      # whatismyip.com — chỉ IP này được /setup
```

**Sinh secrets nhanh:**

```bash
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d /=+ | cut -c1-64)"
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -base64 48 | tr -d /=+ | cut -c1-32)"
echo "MYSQL_PASSWORD=$(openssl rand -base64 48 | tr -d /=+ | cut -c1-32)"
```

## 4. Build + chạy stack

```bash
# Build images + start (lần đầu mất ~5 phút build)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Xem log lúc khởi động
docker compose -f docker-compose.prod.yml logs -f

# Kiểm tra container chạy
docker compose -f docker-compose.prod.yml ps
```

Sau khi tất cả `healthy`, mở **https://quanbalun.com** — Caddy sẽ auto-cấp Let's Encrypt cert (mất ~30 giây lần đầu).

## 5. Setup owner đầu tiên

Truy cập **https://quanbalun.com/setup** từ IP đã whitelist (`SETUP_ALLOWED_IP`).

Form yêu cầu: họ tên, username, password mạnh (≥ 12 ký tự).

Sau setup xong:
- **CHÉP `recovery_code`** ngay (chỉ hiện 1 lần — mất là không reset password owner được).
- Đăng nhập → tạo nhân viên + import menu Excel.

## 6. Operation thường ngày

### Xem log realtime

```bash
cd /opt/Order-Quan-Ba-Lun
docker compose -f docker-compose.prod.yml logs -f api      # API logs
docker compose -f docker-compose.prod.yml logs -f caddy    # HTTPS + access logs
docker compose -f docker-compose.prod.yml logs -f mysql    # DB logs
```

### Restart 1 service

```bash
docker compose -f docker-compose.prod.yml restart api
```

### Update code mới

```bash
cd /opt/Order-Quan-Ba-Lun
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# Downtime ~10 giây
```

### Kiểm tra dung lượng

```bash
docker system df                    # Image + volume size
du -sh uploads/                     # Menu images size
docker exec ordbl_mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD -e "SELECT table_schema,SUM(data_length+index_length)/1024/1024 size_mb FROM information_schema.tables GROUP BY table_schema"
```

### VPS này chạy chung Caddy với ứng dụng khác

Trên VPS hiện tại còn `ui2spec.pro.vn` (genspec) đi qua cùng container Caddy. Hai chỗ phải
giữ, nếu không mỗi lần deploy là site kia sập mà không có cảnh báo nào:

| Trên server (không nằm trong git) | Tác dụng |
|---|---|
| `caddy-local/*.caddy` | Site block của app khác — `Caddyfile` import vào |
| `caddy-extra-networks.txt` | Danh sách Docker network cần đấu lại cho `ordbl_caddy` |

`docker compose up` tạo lại container Caddy sẽ **mất hết** network từng đấu tay bằng
`docker network connect`. Caddy vẫn chạy, quán vẫn 200, nhưng app kia 502. `deploy.sh` tự chạy
[scripts/attach-caddy-networks.sh](scripts/attach-caddy-networks.sh) sau mỗi lần build để đấu lại.
Nếu phải chạy `docker compose up` bằng tay, nhớ chạy script đó theo sau.

Kiểm tra nhanh sau mỗi lần deploy — phải thấy đủ cả hai network:

```bash
docker inspect ordbl_caddy -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

### Backup MySQL

Service `mysql-backup` trong compose tự dump hằng ngày lúc `BACKUP_HOUR_UTC:BACKUP_MINUTE`
(mặc định 20:30 UTC = **03:30 sáng giờ VN**), ghi ra `./backups/ordbl-<timestamp>.sql.gz`,
giữ 14 ngày và luôn chừa lại tối thiểu 7 bản. Nó cũng chạy một lần ngay khi container khởi
động, nên sau mỗi lần deploy là có bản mới liền.

```bash
ls -lh backups/                                          # danh sách bản đã có
docker compose -f docker-compose.prod.yml logs mysql-backup | tail -20
```

Dump dùng `--single-transaction` nên **không khoá bảng** — quán vẫn nhận đơn bình thường
trong lúc backup chạy. Mỗi bản được kiểm tra gzip toàn vẹn và có marker `Dump completed`
trước khi được công nhận; bản lỗi bị bỏ và các bản cũ giữ nguyên.

**Chạy backup ngay lập tức** (không đợi tới giờ hẹn):

```bash
docker compose -f docker-compose.prod.yml restart mysql-backup
```

#### Restore

```bash
cd /opt/orderquanbalun
gunzip -c backups/ordbl-20260805-203000.sql.gz | \
  docker exec -i ordbl_mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" order_quan_balun
docker compose -f docker-compose.prod.yml restart api
```

Nên **thử restore vào một DB tạm ít nhất một lần** để biết chắc bản dump dùng được — backup
chưa từng restore thử thì chưa phải là backup.

#### Hai điều bản backup này KHÔNG lo được

1. **Nó nằm cùng ổ đĩa với database.** Hỏng ổ hoặc mất VPS là mất cả hai. Muốn an toàn thật
   thì phải copy ra ngoài, ví dụ kéo về máy ở nhà hằng ngày:
   ```bash
   rsync -avz -e ssh root@<IP_VPS>:/opt/orderquanbalun/backups/ ~/qbl-backups/
   ```
2. **Nó chỉ chứa database, không chứa ảnh món.** Thư mục `uploads/` phải copy riêng — nó cũng
   nằm trên host nên cùng nằm trong lệnh `rsync` trên nếu thêm đường dẫn.

### Reset toàn bộ (nuke data)

```bash
docker compose -f docker-compose.prod.yml down -v   # XOÁ luôn volume MySQL
rm -rf uploads/                                      # XOÁ menu images
```

## 7. Lock setup endpoint sau khi xong

Sau khi setup owner đầu tiên xong, sửa `.env.production`:

```bash
SETUP_ALLOWED_IP=127.0.0.1   # khoá hoàn toàn (chỉ localhost SSH vào mới setup được)
```

Rồi `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.

## 8. Monitor (free)

- **Uptime Robot** ([free 50 monitors](https://uptimerobot.com)): HTTPS check https://quanbalun.com mỗi 5 phút. Email/Telegram khi down.
- **VPS provider native monitoring**: DigitalOcean / Vietnix đều có dashboard CPU/RAM/disk.

```bash
# Cmd line monitor
docker stats                                # CPU + RAM realtime
htop                                        # process tree
df -h                                       # disk usage
free -h                                     # RAM usage
```

## 9. Trouble-shoot

### Caddy không cấp cert

- DNS chưa trỏ đúng IP: `dig quanbalun.com` phải trả IP VPS.
- Port 80/443 bị firewall chặn: `ufw status` xem có allow.
- Log: `docker compose logs caddy`.

### API trả 500

- Log stack: `docker compose logs api | tail -50`.
- DB connection: `docker compose exec api node -e "console.log('ok')"`.
- MySQL up: `docker compose ps`.

### Mất quyền truy cập owner

- Restore từ recovery_code: /recover với mã 16 ký tự đã chép lúc setup.
- Mất luôn recovery_code: SSH vào VPS, vào MySQL set lại password_hash thủ công.

```sql
-- SSH vào VPS, vào mysql
docker exec -it ordbl_mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD order_quan_balun

-- Set password = "Reset12345" (sẽ change ở UI sau)
-- Hash bcrypt cost 12 của "Reset12345":
UPDATE users
SET password_hash = '$2b$12$YOUR_BCRYPT_HASH_HERE',
    token_version = token_version + 1
WHERE is_owner = 1;
```

(Generate hash: chạy `pnpm node -e "import('bcrypt').then(b => b.hash('Reset12345', 12).then(console.log))"` ở máy có Node.)

## 10. Scaling sau này

Khi quán đông hơn (40-50 staff) hoặc mở chi nhánh:

| Bottleneck | Fix |
|---|---|
| RAM 2GB hit 85%+ | Resize VPS lên 4GB (DO: 5 phút downtime) |
| MySQL slow query | `EXPLAIN` query slow + thêm INDEX |
| Network latency cao | Đổi region (gần VN hơn) |
| Polling load cao | Implement WebSocket / SSE |

---

**Liên hệ hỗ trợ**: <chủ quán điền>
