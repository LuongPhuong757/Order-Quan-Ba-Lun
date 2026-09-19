#!/usr/bin/env node
// Dò tìm máy in trong mạng LAN của quán.
//
//   node find-printer.js
//
// Chạy được trên máy tính bảng (Termux) hoặc máy tính — chỉ dùng module có sẵn của Node,
// không cài gì thêm, đúng tinh thần `bridge.mjs`.
//
// Cách làm: thử mở cổng in 9100 trên từng địa chỉ của dải mạng hiện tại. Máy in nào đang bật
// và nối mạng sẽ nhận kết nối; mọi thiết bị khác từ chối hoặc im lặng. Đây là cách dò đáng tin
// hơn quét ping, vì nhiều thiết bị chặn ping nhưng vẫn phải mở cổng in để làm việc của nó.
//
// Hai biến môi trường khi cần:
//   SCAN_BASE=192.168.1   ép dải mạng, dùng khi máy có nhiều card mạng và tự dò ra dải sai
//   PRINTER_PORT=9100     đổi cổng, gần như không bao giờ cần

const net = require('net');
const os = require('os');

const PORT = Number(process.env.PRINTER_PORT || 9100);
/** Chờ mỗi địa chỉ. Thiết bị trong LAN trả lời trong vài chục ms; 1.2 giây là rộng rãi cho
 *  Wi-Fi yếu mà vẫn quét xong cả dải trong khoảng một giây (254 địa chỉ chạy song song). */
const TIMEOUT_MS = 1200;

let base = process.env.SCAN_BASE;
if (!base) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      // Bỏ qua `internal` (loopback 127.x) — máy in không bao giờ nằm ở đó.
      if (n.family === 'IPv4' && !n.internal) base = n.address.split('.').slice(0, 3).join('.');
    }
  }
}

if (!base) {
  console.log('Không tìm thấy mạng nào. Máy tính bảng đã nối Wi-Fi chưa?');
  process.exit(1);
}

console.log(`Đang dò ${base}.1 → ${base}.254, cổng ${PORT} ...`);

const hits = [];
const probe = (ip) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: PORT });
    const done = (found) => {
      socket.destroy();
      if (found) hits.push(ip);
      resolve();
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });

Promise.all(Array.from({ length: 254 }, (_, i) => probe(`${base}.${i + 1}`))).then(() => {
  if (hits.length === 0) {
    console.log(`Không thấy máy in nào mở cổng ${PORT}.`);
    console.log('Kiểm: máy in đã bật chưa, dây mạng đã cắm chưa, và máy tính bảng có đang ở');
    console.log('cùng mạng với máy in không (không phải mạng khách / 4G).');
    return;
  }
  console.log('TÌM THẤY:');
  for (const ip of hits) console.log('   ' + ip);
  if (hits.length > 1) {
    console.log('\nCó nhiều hơn một thiết bị mở cổng in. Thử in thử vào từng địa chỉ để biết');
    console.log('cái nào là máy in của bạn (xem bước "In thử thẳng từ tablet" trong README).');
  }
});
