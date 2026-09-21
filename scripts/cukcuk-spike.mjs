#!/usr/bin/env node
/**
 * Script THỬ TAY cổng CUKCUK Open Platform — KHÔNG phải code sản phẩm.
 * Mục đích duy nhất: trả lời 3 câu hỏi mà tài liệu không trả lời được:
 *   1. Công thức SignatureInfo của api/Account/Login là gì? (tài liệu không công bố)
 *   2. Đẩy order-onlines/create với PaymentStatus=2 thì CukCuk sinh ra CÁI GÌ —
 *      đơn chờ nhận, hay hoá đơn (SAInvoice) luôn?
 *   3. Món/đơn vị tính bên CukCuk có mã ra sao để ánh xạ với menu của app?
 *
 * Chạy (từ gốc repo):
 *   cp scripts/cukcuk.env.example scripts/cukcuk.env   # rồi điền mã bảo mật
 *   set -a; . scripts/cukcuk.env; set +a
 *   node scripts/cukcuk-spike.mjs <lệnh>
 *
 * (Đừng dùng `node --env-file=` — Node 20.11 trên máy này báo "not found" với đường dẫn tuyệt đối.)
 *
 * Lệnh:
 *   login      Dò công thức chữ ký rồi lấy token. In ra công thức nào đúng.
 *   branches   Liệt kê chi nhánh (lấy BranchId cho bước push).
 *   items      Liệt kê món + đơn vị tính (Id, Code, ItemType, UnitID, UnitName).
 *   push       Đẩy MỘT đơn thử đã-thanh-toán. CẢNH BÁO: ghi vào dữ liệu thật.
 *   invoices   Liệt kê hoá đơn hôm nay — dùng để xem đơn vừa đẩy có thành hoá đơn không.
 *
 * Biến môi trường bắt buộc:
 *   CUKCUK_DOMAIN      tên miền quán, phần trước .cukcuk.vn (vd: quanonglun)
 *   CUKCUK_APP_ID      vd: CUKCUKOpenPlatform
 *   CUKCUK_SECRET_KEY  mã bảo mật (dùng mã MỚI sau khi bấm "Tạo lại mã")
 * Tuỳ chọn (bước push):
 *   CUKCUK_BRANCH_ID   lấy từ lệnh branches
 *   CUKCUK_TEST_ITEM   JSON một món lấy từ lệnh items
 */
import { createHmac } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const BASE = 'https://graphapi.cukcuk.vn';
const TOKEN_FILE = new URL('./cukcuk-token.json', import.meta.url).pathname;  // gitignored

const DOMAIN = process.env.CUKCUK_DOMAIN;
const APP_ID = process.env.CUKCUK_APP_ID;
const SECRET = process.env.CUKCUK_SECRET_KEY;

if (!DOMAIN || !APP_ID || !SECRET) {
  console.error('Thiếu CUKCUK_DOMAIN / CUKCUK_APP_ID / CUKCUK_SECRET_KEY.');
  console.error('Chạy: set -a; . scripts/cukcuk.env; set +a; node scripts/cukcuk-spike.mjs <lệnh>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ĐÃ XÁC NHẬN 2026-09-21: tổ hợp đúng là tổ hợp ĐẦU TIÊN bên dưới —
 *   HMAC-SHA256( JSON.stringify({AppID, Domain, LoginTime}), SECRET )  →  hex thường
 * Giữ nguyên vòng dò để còn dùng lại nếu MISA đổi cổng. LoginTime KHÔNG bị soi định dạng. */

/** Các cách định dạng LoginTime có thể đúng — tài liệu chỉ nói "string (giờ UTC date)". */
const timeFormats = {
  'iso-ms-Z': (d) => d.toISOString(),
  'iso-no-ms-Z': (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  'dotnet-T': (d) => d.toISOString().replace(/Z$/, ''),
  'space-sec': (d) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
};

/** Các chuỗi có thể là thứ được ký. Thứ tự khoá JSON là thứ đáng ngờ nhất. */
const payloadShapes = {
  'json-AppID-Domain-LoginTime': (t) =>
    JSON.stringify({ AppID: APP_ID, Domain: DOMAIN, LoginTime: t }),
  'json-Domain-AppID-LoginTime': (t) =>
    JSON.stringify({ Domain: DOMAIN, AppID: APP_ID, LoginTime: t }),
  'concat-Domain-AppID-Time': (t) => `${DOMAIN}${APP_ID}${t}`,
  'concat-AppID-Domain-Time': (t) => `${APP_ID}${DOMAIN}${t}`,
};

const encodings = {
  hex: (h) => h.digest('hex'),
  HEX: (h) => h.digest('hex').toUpperCase(),
  base64: (h) => h.digest('base64'),
};

function sign(text, enc) {
  return encodings[enc](createHmac('sha256', SECRET).update(text, 'utf8'));
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* giữ nguyên text để in ra */ }
  return { http: res.status, json, text };
}

async function getJson(path, headers) {
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* giữ nguyên text */ }
  return { http: res.status, json, text };
}

/** ErrorType 4 = "chữ ký không hợp lệ, timeout" → công thức sai, thử tiếp.
 *  ErrorType 0 + Success = đúng. Mã khác (2, 3, 7) là lỗi cấu hình, dừng ngay. */
async function discoverSignature() {
  console.log('Dò công thức chữ ký (mỗi lần thử cách nhau 400ms để tránh lỗi 102)...\n');
  for (const [shapeName, shape] of Object.entries(payloadShapes)) {
    for (const [fmtName, fmt] of Object.entries(timeFormats)) {
      for (const encName of Object.keys(encodings)) {
        const loginTime = fmt(new Date());
        const toSign = shape(loginTime);
        const body = {
          Domain: DOMAIN,
          AppID: APP_ID,
          LoginTime: loginTime,
          SignatureInfo: sign(toSign, encName),
        };
        const { http, json, text } = await postJson('/api/Account/Login', body);
        const et = json?.ErrorType;
        const label = `${shapeName} | ${fmtName} | ${encName}`;

        if (json?.Success && json?.Data?.AccessToken) {
          console.log(`\n✅ ĐÚNG: ${label}`);
          console.log(`   Chuỗi được ký: ${toSign}`);
          return { recipe: { shape: shapeName, format: fmtName, encoding: encName }, data: json.Data };
        }
        if (et === 4 || et === undefined) {
          console.log(`   ✗ ${label}  (ErrorType=${et ?? '?'} http=${http})`);
        } else {
          // Lỗi cấu hình chứ không phải chữ ký — dừng, đừng đốt thêm request.
          console.log(`\n⛔ Dừng: ${label} trả ErrorType=${et} — đây KHÔNG phải lỗi chữ ký.`);
          console.log(`   ErrorType 2 = mã nhà hàng không tồn tại (sai CUKCUK_DOMAIN)`);
          console.log(`   ErrorType 3 = AppID không tồn tại`);
          console.log(`   ErrorType 7 = kết nối đang ở trạng thái NGẮT — vào web CukCuk bấm "Cho phép kết nối"`);
          console.log(`   Phản hồi thô: ${text.slice(0, 400)}`);
          process.exit(2);
        }
        await sleep(400);
      }
    }
  }
  console.log('\n❌ Đã thử hết 48 tổ hợp, không cái nào đúng. Cần hỏi MISA công thức SignatureInfo.');
  process.exit(3);
}

async function login() {
  const { recipe, data } = await discoverSignature();
  writeFileSync(TOKEN_FILE, JSON.stringify({ recipe, data, at: Date.now() }, null, 2));
  console.log('\nCompanyCode:', data.CompanyCode);
  console.log('Environment:', data.Environment);
  console.log('AccessToken: (đã lưu vào cukcuk-token.json, không in ra)');
  console.log('\nGhi công thức này vào spec rồi chạy tiếp: branches');
  return data;
}

async function auth() {
  if (existsSync(TOKEN_FILE)) {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    // Token sống 1 ngày theo tài liệu; dùng lại nếu còn mới.
    if (Date.now() - saved.at < 20 * 3600 * 1000) return saved.data;
  }
  return await login();
}

function headers(d) {
  return { Authorization: `Bearer ${d.AccessToken}`, CompanyCode: d.CompanyCode };
}

async function branches() {
  const d = await auth();
  const r = await getJson('/api/v1/branchs/all', headers(d));
  console.log(JSON.stringify(r.json, null, 2));
  console.log('\n→ Lấy "Id" của chi nhánh bán hàng, gán vào CUKCUK_BRANCH_ID.');
}

async function items() {
  const d = await auth();
  const r = await postJson('/api/v1/inventoryitems/paging',
    { Page: 1, Limit: 50, includeInactive: false }, headers(d));
  const list = r.json?.Data ?? [];
  if (!Array.isArray(list)) { console.log(JSON.stringify(r.json, null, 2)); return; }
  console.log(`Tổng: ${r.json?.Total}. 50 món đầu:\n`);
  for (const it of list) {
    console.log([
      `Id=${it.Id}`, `Code=${it.Code}`, `Name=${it.Name}`,
      `ItemType=${it.ItemType}`, `UnitID=${it.UnitID ?? it.UnitId}`,
      `UnitName=${it.UnitName}`, `Price=${it.Price}`,
    ].join('  '));
  }
  console.log('\n→ Chọn MỘT món rẻ, gán vào CUKCUK_TEST_ITEM dạng JSON, ví dụ:');
  console.log(`CUKCUK_TEST_ITEM='{"Id":"...","Code":"...","Name":"...","ItemType":1,"UnitID":"...","UnitName":"...","Price":10000}'`);
}

async function push() {
  const branchId = process.env.CUKCUK_BRANCH_ID;
  const itemRaw = process.env.CUKCUK_TEST_ITEM;
  if (!branchId || !itemRaw) {
    console.error('Cần CUKCUK_BRANCH_ID (lệnh branches) và CUKCUK_TEST_ITEM (lệnh items).');
    process.exit(1);
  }
  const item = JSON.parse(itemRaw);
  const d = await auth();

  const orderId = crypto.randomUUID().toUpperCase();
  const qty = 1;
  const amount = Number(item.Price) * qty;

  const body = {
    OrderId: orderId,
    OrderCode: '',
    // 1 = tự đến lấy. CukCuk không có "ăn tại bàn" cho đơn online;
    // 1 là cái gần nhất vì không cần địa chỉ và không sinh phí ship.
    OrderType: 1,
    BranchId: branchId,
    CustomerName: 'Khách lẻ (THỬ - XOÁ)',
    CustomerTel: '0000000000',
    ShippingTimeType: 0,
    OrderNote: 'ĐƠN THỬ TÍCH HỢP — XOÁ SAU KHI KIỂM TRA',
    TotalAmount: amount,
    Amount: amount,
    DeliveryAmount: 0,
    DiscountAmount: 0,
    PaymentStatus: 2,  // 2 = đã thanh toán — đây là thứ cần kiểm chứng
    OrderSource: 2,    // 2 = App riêng nhà hàng
    OrderItems: [{
      Id: item.Id,
      Code: item.Code,
      ItemType: item.ItemType,
      Name: item.Name,
      Price: Number(item.Price),
      UnitID: item.UnitID,
      UnitName: item.UnitName,
      Quantity: qty,
    }],
  };

  console.log('Gửi đơn thử:\n', JSON.stringify(body, null, 2), '\n');
  const r = await postJson('/api/v1/order-onlines/create', body, headers(d));
  console.log('Phản hồi:\n', JSON.stringify(r.json ?? r.text, null, 2));
  console.log(`\nOrderId đã gửi: ${orderId}`);
  console.log('\nBÂY GIỜ MỞ CUKCUK VÀ TRẢ LỜI 3 CÂU:');
  console.log('  1. Đơn này nằm ở đâu — danh sách "đơn online chờ nhận", hay đã thành hoá đơn?');
  console.log('  2. Nó có hiển thị là ĐÃ THANH TOÁN không?');
  console.log('  3. Thu ngân còn phải bấm gì nữa để ra hoá đơn xuất thuế?');
  console.log('\nRồi chạy lệnh `invoices` để xem nó có xuất hiện trong danh sách hoá đơn không.');
}

async function invoices() {
  const d = await auth();
  // sainvoices/paging không nhận khoảng ngày — chỉ Page/Limit/BranchId/HaveCustomer.
  // Hoá đơn mới nhất nằm đầu danh sách, đủ để tìm đơn vừa đẩy.
  const body = { Page: 1, Limit: 20 };
  if (process.env.CUKCUK_BRANCH_ID) body.BranchId = process.env.CUKCUK_BRANCH_ID;
  const r = await postJson('/api/v1/sainvoices/paging', body, headers(d));
  const list = r.json?.Data ?? [];
  if (!Array.isArray(list)) { console.log(JSON.stringify(r.json, null, 2)); return; }
  console.log(`Tổng hoá đơn: ${r.json?.Total}. 20 bản ghi đầu:\n`);
  for (const inv of list) {
    console.log(`RefNo=${inv.RefNo}  RefDate=${inv.RefDate}  OrderId=${inv.OrderId ?? '-'}  Tổng=${inv.TotalAmount}  PaymentStatus=${inv.PaymentStatus}  Bàn=${inv.TableName ?? '-'}`);
  }
  console.log('\n→ Nếu OrderId của đơn vừa đẩy CÓ trong danh sách: CukCuk tự chốt hoá đơn, tự động hoàn toàn.');
  console.log('→ Nếu KHÔNG: thu ngân vẫn phải bấm hoàn tất trong CukCuk.');
}

const cmd = process.argv[2];
const commands = { login, branches, items, push, invoices };
if (!commands[cmd]) {
  console.error(`Lệnh không hợp lệ. Dùng một trong: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
await commands[cmd]();
