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

Trỏ domain về IP VPS (qua A record):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `<IP_VPS>` | 300 |
| A | `www` | `<IP_VPS>` | 300 |

Đợi DNS propagate ~5-30 phút (`dig quanbalun.com` xác nhận).

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
