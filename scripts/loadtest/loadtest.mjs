// Máy sinh tải cho API đặt hàng online — Node 20+ thuần, KHÔNG dependency.
//
// Vì sao không dùng k6/autocannon: cả hai đều phải cài lên VPS production. Script này chạy được
// trong một container `node:20-alpine` dùng-rồi-xoá, không để lại gì trên host.
//
// ĐIỂM MẤU CHỐT — vì sao phải chạy TRÊN VPS chứ không phải từ máy lập trình:
//   Caddyfile đặt `header_up X-Forwarded-For {remote_host}`, tức Caddy GHI ĐÈ header này bằng IP
//   thật của client. Bắn 100 "user" từ 1 máy qua HTTPS thì API vẫn thấy đúng 1 IP, và
//   `@Throttle({ limit: 10, ttl: 60_000 })` trên POST /api/public/orders sẽ chặn từ đơn thứ 11 —
//   bạn đo được rate limiter chứ không đo được server.
//   Đánh thẳng vào api:3001 (bỏ qua Caddy) thì header XFF ta tự đặt sống sót, và
//   `app.set('trust proxy', 1)` trong main.ts khiến Express lấy đúng nó làm req.ip.
//   => mỗi VU = 1 IP riêng = mô phỏng đúng 100 người khác nhau.
//
// Ràng buộc nghiệp vụ đã tính vào script (đọc submit-order.ts trước khi sửa các con số này):
//   - `hasOpenOrderForPhoneLocked` — mỗi SĐT chỉ được có 1 đơn WAITING => mỗi VU 1 SĐT riêng.
//   - PHONE_MAX_ORDERS_PER_WINDOW = 3 / PHONE_WINDOW_MS = 1h => tối đa 3 đơn/SĐT/giờ.
//   - CsrfOriginGuard đòi header Origin khớp ALLOWED_ORIGIN => luôn gửi ORIGIN.
//
// Cấu hình qua env: xem DEFAULTS bên dưới.

const cfg = {
  base: process.env.BASE ?? 'http://api:3001',
  origin: process.env.ORIGIN ?? 'https://quanbalun.site',
  scenario: process.env.SCENARIO ?? 'mixed', // browse | order | track | mixed
  vus: Number(process.env.VUS ?? 100),
  durationS: Number(process.env.DURATION_S ?? 60),
  rampS: Number(process.env.RAMP_S ?? 0), // 0 = tất cả VU vào cùng lúc (spike)
  thinkMinMs: Number(process.env.THINK_MIN_MS ?? 1000),
  thinkMaxMs: Number(process.env.THINK_MAX_MS ?? 4000),
  // Tiền tố SĐT test. Phải khác mọi SĐT thật để lệnh dọn dẹp không xoá nhầm đơn của khách.
  phonePrefix: process.env.PHONE_PREFIX ?? '0999',
  timeoutMs: Number(process.env.TIMEOUT_MS ?? 15000),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

// ── Thu thập số liệu ────────────────────────────────────────────────────────────────────────
// Giữ toàn bộ mẫu latency để tính percentile thật, không xấp xỉ. 100 VU × 60s vẫn chỉ vài chục
// nghìn mẫu — thừa sức nằm trong RAM.
const stats = new Map(); // label -> { lat: number[], codes: Map<string,number>, errs: Map<string,number> }

function record(label, ms, code, errCode) {
  let s = stats.get(label);
  if (!s) {
    s = { lat: [], codes: new Map(), errs: new Map() };
    stats.set(label, s);
  }
  s.lat.push(ms);
  s.codes.set(String(code), (s.codes.get(String(code)) ?? 0) + 1);
  if (errCode) s.errs.set(errCode, (s.errs.get(errCode) ?? 0) + 1);
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────
// `fakeIp` đi vào X-Forwarded-For => trở thành req.ip => là khoá của throttler VÀ của
// `countRecentOtpsByIpHash`. Mỗi VU một IP nên các giới hạn theo-IP không nhiễu vào phép đo.
async function req(vu, label, method, path, body) {
  const t0 = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: cfg.origin, // CsrfOriginGuard: thiếu header này là 403 trên mọi mutation
        'x-forwarded-for': vu.ip,
        'user-agent': `loadtest-vu-${vu.id}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* HTML lỗi từ Caddy chẳng hạn — giữ nguyên null, status code đã đủ nói */
    }
    // Lỗi nghiệp vụ trả về trong body chứ không phải HTTP status, nên phải bóc riêng: một
    // request 400 vì RATE_LIMITED khác hẳn 400 vì VALIDATION_FAILED khi đọc kết quả.
    const errCode = res.ok ? null : (payload?.code ?? payload?.error?.code ?? `HTTP_${res.status}`);
    record(label, ms, res.status, errCode);
    return { ok: res.ok, status: res.status, payload, errCode };
  } catch (e) {
    const ms = performance.now() - t0;
    const code = e.name === 'AbortError' ? 'TIMEOUT' : (e.cause?.code ?? e.name ?? 'NETWORK');
    record(label, ms, 0, code);
    return { ok: false, status: 0, payload: null, errCode: code };
  } finally {
    clearTimeout(timer);
  }
}

// ── Kịch bản ────────────────────────────────────────────────────────────────────────────────
// Khách vào xem menu. Cả 3 endpoint đều `Cache-Control: no-store` nên mỗi lượt là một lượt
// xuống MySQL thật — đây là bài đo đường đọc.
async function browse(vu) {
  await req(vu, 'GET /store', 'GET', '/api/public/store');
  await sleep(jitter(200, 800));
  await req(vu, 'GET /menu', 'GET', '/api/public/menu');
  await sleep(jitter(200, 800));
  await req(vu, 'GET /top-dishes', 'GET', '/api/public/top-dishes');
}

// Đặt đơn. Trả về order_token nếu thành công để kịch bản `mixed` poll tiếp như khách thật.
async function placeOrder(vu, menuIds) {
  const n = 1 + Math.floor(Math.random() * 3);
  const items = [];
  const used = new Set();
  while (items.length < n && used.size < menuIds.length) {
    const id = menuIds[Math.floor(Math.random() * menuIds.length)];
    if (used.has(id)) continue;
    used.add(id);
    items.push({ menu_item_id: id, qty: 1 + Math.floor(Math.random() * 3) });
  }
  const r = await req(vu, 'POST /orders', 'POST', '/api/public/orders', {
    customer_token: vu.customerToken,
    customer_name: `Load Test ${vu.id}`,
    customer_phone: vu.phone,
    fulfillment_type: 'PICKUP', // PICKUP để khỏi cần địa chỉ + khỏi kéo theo tính phí ship
    customer_note: 'ĐƠN TEST TẢI — xoá được',
    items,
  });
  return r.ok ? (r.payload?.data?.order_token ?? null) : null;
}

// Khách giữ trang /o/:token mở, poll 8s một lần (OrderTrackPage.tsx POLL_MS = 8_000).
// Đây mới là hình dạng tải BỀN của một buổi tối đông, khác hẳn burst lúc đặt đơn.
async function track(vu, token, untilMs) {
  while (performance.now() < untilMs) {
    await req(vu, 'GET /orders/:token', 'GET', `/api/public/orders/${token}`);
    await sleep(8000);
  }
}

async function runVu(vu, menuIds, endAt) {
  if (cfg.rampS > 0) await sleep((vu.id / cfg.vus) * cfg.rampS * 1000);

  if (cfg.scenario === 'order') {
    await placeOrder(vu, menuIds);
    return;
  }

  if (cfg.scenario === 'browse') {
    while (performance.now() < endAt) {
      await browse(vu);
      await sleep(jitter(cfg.thinkMinMs, cfg.thinkMaxMs));
    }
    return;
  }

  // mixed = hành vi khách thật: xem menu → đặt đơn → ngồi theo dõi đơn tới hết bài test.
  // Đây là kịch bản sát thực tế nhất và cũng là kịch bản nặng nhất.
  await browse(vu);
  await sleep(jitter(cfg.thinkMinMs, cfg.thinkMaxMs));
  const token = await placeOrder(vu, menuIds);
  if (token) await track(vu, token, endAt);
  else while (performance.now() < endAt) { await browse(vu); await sleep(jitter(2000, 5000)); }
}

// ── Báo cáo ─────────────────────────────────────────────────────────────────────────────────
function report(wallS) {
  const rows = [];
  let total = 0;
  let failed = 0;
  for (const [label, s] of stats) {
    const sorted = [...s.lat].sort((a, b) => a - b);
    const n = sorted.length;
    const ok = (s.codes.get('200') ?? 0) + (s.codes.get('201') ?? 0);
    total += n;
    failed += n - ok;
    rows.push({
      label,
      n,
      ok,
      fail: n - ok,
      p50: Math.round(pct(sorted, 50)),
      p95: Math.round(pct(sorted, 95)),
      p99: Math.round(pct(sorted, 99)),
      max: Math.round(sorted[n - 1] ?? 0),
      codes: [...s.codes].map(([c, v]) => `${c}:${v}`).join(' '),
      errs: [...s.errs].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c}:${v}`).join(' '),
    });
  }

  const pad = (v, w) => String(v).padEnd(w);
  const lpad = (v, w) => String(v).padStart(w);
  console.log('\n' + '='.repeat(100));
  console.log(`KẾT QUẢ — ${cfg.scenario} · ${cfg.vus} VU · ${wallS.toFixed(1)}s`);
  console.log('='.repeat(100));
  console.log(
    pad('endpoint', 22) + lpad('n', 7) + lpad('ok', 7) + lpad('fail', 6) +
    lpad('p50', 8) + lpad('p95', 8) + lpad('p99', 8) + lpad('max', 8) + '  codes',
  );
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(
      pad(r.label, 22) + lpad(r.n, 7) + lpad(r.ok, 7) + lpad(r.fail, 6) +
      lpad(r.p50 + 'ms', 8) + lpad(r.p95 + 'ms', 8) + lpad(r.p99 + 'ms', 8) + lpad(r.max + 'ms', 8) +
      '  ' + r.codes,
    );
    if (r.errs) console.log(' '.repeat(22) + '↳ lỗi: ' + r.errs);
  }
  console.log('-'.repeat(100));
  console.log(
    `TỔNG ${total} request · ${failed} lỗi (${((failed / Math.max(total, 1)) * 100).toFixed(1)}%) · ` +
    `${(total / wallS).toFixed(1)} req/s`,
  );
  console.log('='.repeat(100) + '\n');
  return failed;
}

// ── Chạy ────────────────────────────────────────────────────────────────────────────────────
const menuRes = await fetch(cfg.base + '/api/public/menu', { headers: { origin: cfg.origin } });
if (!menuRes.ok) {
  console.error(`❌ Không lấy được menu từ ${cfg.base} (HTTP ${menuRes.status}). Sai BASE hay sai network?`);
  process.exit(1);
}
const menu = await menuRes.json();
const menuIds = (menu.data?.groups ?? [])
  .flatMap((g) => g.items ?? [])
  .filter((i) => !i.is_out_of_stock)
  .map((i) => i.id);
if (menuIds.length === 0) {
  console.error('❌ Menu không có món nào còn hàng — không đặt đơn được.');
  process.exit(1);
}

console.log(`▶ ${cfg.scenario} · ${cfg.vus} VU · ${cfg.durationS}s · ${menuIds.length} món khả dụng`);
console.log(`  target=${cfg.base} origin=${cfg.origin} SĐT=${cfg.phonePrefix}xxxxxx`);

const vus = Array.from({ length: cfg.vus }, (_, i) => ({
  id: i,
  // 10.x.y.z — dải private, chắc chắn không đụng IP thật nào trong log.
  ip: `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${(i % 256) + 1}`,
  phone: cfg.phonePrefix + String(i).padStart(10 - cfg.phonePrefix.length, '0'),
  customerToken: `loadtest${String(i).padStart(4, '0')}${'x'.repeat(24)}`,
}));

const t0 = performance.now();
const endAt = t0 + cfg.durationS * 1000;
await Promise.all(vus.map((vu) => runVu(vu, menuIds, endAt)));
const failed = report((performance.now() - t0) / 1000);
process.exit(failed > 0 ? 1 : 0);
