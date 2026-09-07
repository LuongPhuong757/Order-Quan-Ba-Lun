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
cert cho host đó, và quyển menu vẫn mở được ở `<domain>/thuc-don`. Khác hẳn `admin`: thiếu
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

## 11. Server develop (cùng VPS, DB riêng, chỉ mình chủ vào được)

Môi trường thử nghiệm chạy **cùng VPS** với production nhưng tách hẳn: checkout riêng,
MySQL riêng, volume riêng, container `ordbl_dev_*`. Không có bất cứ đường nào để dev
đọc hay ghi vào DB prod.

| | Production | Develop |
|---|---|---|
| Checkout | `$DEPLOY_PATH` (nhánh `main`) | `/opt/ordbl-dev` (nhánh `develop`) |
| Compose | `docker-compose.prod.yml` | `docker-compose.dev.yml` |
| Env | `.env.production` | `.env.dev` |
| Container | `ordbl_mysql` / `ordbl_api` | `ordbl_dev_mysql` / `ordbl_dev_api` |
| Volume DB | `mysql_data` | `mysql_dev_data` |
| Database | `order_quan_balun` | `order_quan_balun_dev` |
| Site khách | `<domain>` | `dev.<domain>` |
| Site quản lý | `admin.<domain>` | `admin.dev.<domain>` |
| Ai vào được | cả thế giới | chỉ ai biết basic auth |
| Backup | có sidecar hằng ngày | **không** (data vứt đi) |
| SMS | eSMS thật | `console` — OTP chỉ in ra log |

Caddy thì **dùng chung container của prod** (`ordbl_caddy`). Site block của dev được
`deploy-dev.sh` render ra `caddy-local/dev.caddy` trong checkout prod — đúng thư mục mà
`Caddyfile` đã `import` sẵn. Nghĩa là: gỡ server dev chỉ cần xoá một file, và một lỗi cú
pháp bên dev không bao giờ nằm trong `Caddyfile` của prod.

### 11.1 Dựng lần đầu

```bash
# 1) DNS — thêm 2 bản ghi A trỏ về IP VPS
#    dev.<domain>  và  admin.dev.<domain>
dig +short A dev.quanbalun.site admin.dev.quanbalun.site

# 2) Nhánh develop phải có trên GitHub
git checkout -b develop main && git push -u origin develop

# 3) Clone + sinh .env.dev (secrets random) + đặt mật khẩu basic auth
./deploy-dev.sh --init

# 4) Build + chạy
./deploy-dev.sh

# 5) Mở /setup cho IP hiện tại rồi tạo owner của môi trường dev
./deploy-dev.sh --allow-setup
# → https://admin.dev.<domain>/setup   (trình duyệt hỏi basic auth trước)
```

> ⚠️ Đợi DNS phân giải xong rồi mới chạy bước 4. Let's Encrypt giới hạn 5 cert trùng
> lặp mỗi tuần cho một domain — build lại nhiều lần lúc DNS chưa xong là tự khoá cả tuần,
> và giới hạn đó tính chung với `<domain>` của prod.

### 11.2 Dùng hằng ngày

```bash
./deploy-dev.sh                 # deploy nhánh develop
./deploy-dev.sh feat/abc        # deploy một nhánh bất kỳ để xem thử
./deploy-dev.sh --logs          # log build
./deploy-dev.sh --api-logs      # log runtime — OTP ở SMS_DRIVER=console in ra đây
./deploy-dev.sh --status        # container + network Caddy + site block
./deploy-dev.sh --caddy         # render lại site block + reload Caddy (sau khi DNS lên)
./deploy-dev.sh --passwd        # đổi mật khẩu basic auth (có hiệu lực ngay)
./deploy-dev.sh --allow-setup   # nhà đổi IP → mở lại /setup
./deploy-dev.sh --down          # tắt, giữ DB
./deploy-dev.sh --nuke          # xoá sạch stack dev
```

Biến trong `.env.dev` xem mẫu ở [docs/env.dev.example](docs/env.dev.example). File thật
nằm ở `/opt/ordbl-dev/.env.dev` trên VPS, `chmod 600`, không nằm trong git.

### 11.3 Ba điều dễ sai

1. **`docker compose` gõ tay trong `/opt/ordbl-dev` phải luôn có `-f docker-compose.dev.yml
   --env-file .env.dev`.** Thư mục dev là bản clone đầy đủ của repo nên `docker-compose.prod.yml`
   cũng nằm ở đó; gõ nhầm là dựng một stack production thứ hai đè lên tên container của prod.
2. **Deploy prod tạo lại container Caddy sẽ rụng network của dev.** `deploy-dev.sh` đã ghi
   `ordbl_dev_frontend` vào `caddy-extra-networks.txt`, và `deploy.sh` chạy
   [scripts/attach-caddy-networks.sh](scripts/attach-caddy-networks.sh) sau mỗi lần build để
   đấu lại. Nếu `dev.<domain>` trả 502 ngay sau một lần deploy prod, kiểm tra:
   ```bash
   docker inspect ordbl_caddy -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```
3. **`SMS_DRIVER=esms` trên dev là nhắn tin thật vào số thật và tốn tiền thật.** Mặc định
   `console` không phải để cho tiện — nó là để một vòng test tự động không bắn 200 tin nhắn
   vào khách hàng.

### 11.4 CI/CD cho nhánh `develop`

Push vào `develop` là tự chạy [.github/workflows/deploy-develop.yml](.github/workflows/deploy-develop.yml):
CI (build → schema:verify → typecheck → test → ngân sách bundle) → nếu xanh thì deploy lên
server dev → đợi build trên VPS xong và đọc mã thoát → kiểm tra site sống.

Định nghĩa CI nằm ở [.github/workflows/ci.yml](.github/workflows/ci.yml) và được **dùng chung**
với đường production. `develop` không được kiểm lỏng hơn `main`: kiểm lỏng hơn thì mọi thứ gãy
sẽ chỉ lộ ra lúc merge, đúng lúc muộn nhất.

| Secret / Variable | Bắt buộc | Dùng để |
|---|---|---|
| `DEPLOY_HOST` `DEPLOY_USER` `DEPLOY_PORT` `DEPLOY_PASS` `DEPLOY_PATH` | ✅ (dùng chung với prod) | SSH vào VPS |
| Variable `DEPLOY_DEV_PATH` | không (mặc định `/opt/ordbl-dev`) | checkout của stack dev |
| Variable `DEV_HEALTH_URL` | không | bỏ trống thì bỏ qua bước kiểm tra site |
| Secret `DEV_BASIC_AUTH` (`user:matkhau`) | không | có thì healthcheck đăng nhập thật và đòi 200; không có thì coi **401** là đạt — 401 chính là bằng chứng Caddy phục vụ đúng site và hàng rào còn nguyên |

CI truyền **commit SHA** chứ không phải tên nhánh cho `deploy-dev.sh`: giữa lúc job xếp hàng có
thể đã có commit mới hơn, và deploy "nhánh develop" khi đó là đẩy lên một commit mà job này chưa
từng chạy CI.

### 11.5 RAM

Stack dev ăn thêm khoảng **600–700MB** (MySQL 256M buffer pool + Node API). VPS 4GB chạy
được cả hai, nhưng nếu `free -h` cho thấy đang chạm đáy thì tắt dev khi không dùng:

```bash
./deploy-dev.sh --down     # bật lại: ./deploy-dev.sh
```

---

**Liên hệ hỗ trợ**: <chủ quán điền>
