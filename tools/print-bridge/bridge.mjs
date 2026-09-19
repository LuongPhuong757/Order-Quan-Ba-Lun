#!/usr/bin/env node
// CẦU IN — chạy trên máy tính bảng Android đặt ở quầy (Termux).
//
// Nhiệm vụ: hỏi server "có hoá đơn nào cần in không", nhận về một mảng byte đã dựng sẵn, đổ
// vào máy in qua TCP cổng 9100, rồi báo lại kết quả. Hết.
//
// ⚠ KHÔNG THÊM `npm install` VÀO ĐÂY. File này cố ý chỉ dùng module có sẵn của Node
// (`node:net`, `node:http`, `node:https`). Đây là thứ duy nhất trong cả hệ thống sống trên một
// thiết bị không ai quản trị, không có CI, và sẽ không được cập nhật trong nhiều tháng. Một
// `node_modules` trên máy đó là một thứ sẽ mục đi trong im lặng. Không dependency thì cài một
// lần là xong vĩnh viễn.
//
// Vì sao mọi thứ khó đều nằm ở server chứ không ở đây: dựng ảnh hoá đơn, bố cục, tiếng Việt,
// luật tính tiền — tất cả ở VPS. File này chỉ chuyển byte. Nhờ vậy sửa mẫu hoá đơn là deploy
// như bình thường, KHÔNG bao giờ phải trèo lại vào Termux của tablet.
//
// Cách chạy:
//   API_URL=https://quanbalun.vn PRINT_TOKEN=<token> node bridge.mjs
//
// Xem `docs/IN-HOA-DON-LAN.md` để biết cách cài trên Termux và cho tự chạy khi mở máy.
// (Tài liệu để ở `docs/` vì `.gitignore` của repo bỏ qua mọi *.md ngoài `docs/` và `.planning/`.)

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.PRINT_TOKEN ?? '';
/** Nhịp hỏi server. 2 giây là mức khách ở quầy không nhận ra độ trễ, mà vẫn chỉ 30 request/phút. */
const POLL_MS = Number(process.env.POLL_MS ?? 2000);
/** Chờ server trả lời. Dài hơn nhiều so với thời gian thật cần, để mạng 4G lúc yếu không bị
 *  coi là lỗi và sinh ra một dòng log hoảng loạn mỗi hai giây. */
const HTTP_TIMEOUT_MS = 15000;
/** Chờ kết nối tới máy in trong LAN. Máy in cùng mạng thì trả lời trong vài chục ms; quá 5
 *  giây gần như luôn có nghĩa là sai IP hoặc máy in đang tắt. */
const PRINTER_TIMEOUT_MS = 5000;
/** Chờ máy in trả lời câu hỏi trạng thái. Máy không hỗ trợ sẽ im lặng — đó là trường hợp
 *  BÌNH THƯỜNG, không phải lỗi, nên hết giờ thì cứ in tiếp. */
const STATUS_TIMEOUT_MS = 700;

if (!API_URL || !TOKEN) {
  console.error('Thiếu cấu hình. Cần: API_URL=https://... PRINT_TOKEN=...');
  process.exit(1);
}

const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(`[${ts()}]`, ...a);
const warn = (...a) => console.warn(`[${ts()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Gọi server ──────────────────────────────────────────────────────────────

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL + path);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          'x-print-token': TOKEN,
        },
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 401) return reject(new Error('Token thiết bị sai hoặc đã bị thu hồi'));
          if (!res.statusCode || res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            // Nhận HTML thay vì JSON gần như luôn có nghĩa API_URL trỏ nhầm chỗ (vào trang web
            // thay vì vào API). Nói thẳng ra thay vì ném một lỗi parse khó hiểu.
            reject(new Error('Server trả về thứ không phải JSON — kiểm tra lại API_URL'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Server không trả lời kịp')));
    req.on('error', reject);
    req.end(payload);
  });
}

// ── Nói chuyện với máy in ───────────────────────────────────────────────────

/** `DLE EOT n` — hỏi trạng thái thời gian thực. Máy in trả lời ngay cả khi đang bận in. */
const queryStatus = (n) => Buffer.from([0x10, 0x04, n]);

/** Byte trạng thái ESC/POS luôn có bit0=0, bit1=1. Dùng để loại byte rác. */
const isStatusByte = (b) => (b & 0b11) === 0b10;

/**
 * Đọc tình trạng máy in TRƯỚC khi gửi hoá đơn.
 *
 * Vì sao bắt buộc phải hỏi: cổng 9100 là đường một chiều. Ghi byte vào socket luôn "thành
 * công" kể cả khi khay giấy rỗng hay nắp đang mở — server sẽ thấy màu xanh trong khi thực tế
 * không có tờ giấy nào ra. Câu hỏi này là cách duy nhất biết được sự thật.
 *
 * Máy không hỗ trợ thì im lặng, và ta coi như bình thường: thà in mù còn hơn từ chối in trên
 * một chiếc máy hoàn toàn khoẻ mạnh chỉ vì nó không biết cách tự khai bệnh.
 */
function readStatus(socket) {
  return new Promise((resolve) => {
    const got = {};
    let stage = 2; // hỏi DLE EOT 2 (nguyên nhân offline) trước, rồi DLE EOT 4 (cảm biến giấy)
    const onData = (buf) => {
      for (const b of buf) {
        if (!isStatusByte(b)) continue;
        got[stage] = b;
        if (stage === 2) {
          stage = 4;
          socket.write(queryStatus(4));
          return;
        }
        cleanup();
        return resolve(got);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(got);
    }, STATUS_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
    }
    socket.on('data', onData);
    socket.write(queryStatus(2));
  });
}

function describeStatus(got) {
  const off = got[2] ?? 0;
  const paper = got[4] ?? 0;
  if (off & 0x04) return 'Nắp máy in đang mở';
  if (off & 0x20 || (paper & 0x60) === 0x60) return 'Máy in hết giấy';
  if (off & 0x40) return 'Máy in báo lỗi (kẹt giấy hoặc kẹt dao cắt)';
  if ((paper & 0x0c) === 0x0c) return null; // sắp hết giấy: nhắc thôi, vẫn in được
  return null;
}

/** Mở socket, kiểm trạng thái, bắn byte, đóng. Ném lỗi nếu không in được. */
function printBytes(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve(value);
    };

    socket.setTimeout(PRINTER_TIMEOUT_MS);
    socket.on('timeout', () => done(new Error(`Máy in ${host}:${port} không phản hồi`)));
    socket.on('error', (err) => done(new Error(`Không kết nối được máy in ${host}:${port} — ${err.message}`)));

    socket.on('connect', async () => {
      try {
        const status = await readStatus(socket);
        const blocking = describeStatus(status);
        if (blocking) return done(new Error(blocking));
        socket.write(bytes, (err) => {
          if (err) return done(new Error(`Gửi dữ liệu tới máy in thất bại: ${err.message}`));
          // Đợi một nhịp cho firmware nuốt hết buffer trước khi đóng socket. Đóng ngay lập tức
          // sau khi write() gọi callback đã khiến một số máy in cắt mất phần cuối tờ hoá đơn.
          setTimeout(() => done(null, true), 300);
        });
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

// ── Vòng chính ──────────────────────────────────────────────────────────────

let lastStatusSent = 'OK';
let quietErrors = 0; // để không spam log khi mạng rớt kéo dài

async function tick() {
  const res = await apiPost('/print/next', { printer_status: lastStatusSent });
  const job = res?.data;
  if (!job) return false;

  // Server đang ở chế độ USB mà cầu in này là bản LAN: nói thẳng ra thay vì thử kết nối tới
  // một `host` rỗng rồi trả về một lỗi DNS khó hiểu. Đây là tình huống có thật — đổi chế độ ở
  // /admin mà quên tắt cầu in cũ đang chạy trên máy tính bảng.
  if (job.connection === 'USB') {
    const message = 'Cầu in này chạy chế độ LAN nhưng server đang đặt chế độ USB';
    warn(`✗ ${message}`);
    lastStatusSent = message;
    await apiPost(`/print/jobs/${job.job_id}/fail`, { error: message }).catch(() => {});
    return true;
  }

  log(`Nhận job ${job.job_id} → ${job.host}:${job.port} (${job.bytes_b64.length} ký tự base64)`);
  const bytes = Buffer.from(job.bytes_b64, 'base64');
  try {
    await printBytes(job.host, job.port, bytes);
    await apiPost(`/print/jobs/${job.job_id}/ack`, {});
    lastStatusSent = 'OK';
    log(`✓ Đã in job ${job.job_id}`);
  } catch (err) {
    const message = err?.message ?? String(err);
    lastStatusSent = message;
    warn(`✗ In hỏng job ${job.job_id}: ${message}`);
    // Báo lỗi về server là việc BẮT BUỘC, không phải tuỳ chọn: không báo thì job nằm ở trạng
    // thái "đang giữ" cho tới khi hết giờ, và màn Máy in không nói được vì sao giấy không ra.
    await apiPost(`/print/jobs/${job.job_id}/fail`, { error: message }).catch(() => {});
  }
  return true;
}

async function main() {
  log(`Cầu in khởi động · server ${API_URL} · hỏi mỗi ${POLL_MS}ms`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const hadJob = await tick();
      quietErrors = 0;
      // Có job thì hỏi lại NGAY: hàng đợi thường dồn nhiều tờ một lúc (thanh toán mấy bàn liền
      // nhau), đợi thêm 2 giây mỗi tờ là khách bàn cuối đứng chờ vô cớ.
      if (!hadJob) await sleep(POLL_MS);
    } catch (err) {
      quietErrors++;
      // Mất mạng thì mỗi 2 giây một dòng log sẽ lấp đầy màn hình và che mất lỗi thật. Kêu 3
      // lần đầu, sau đó chỉ nhắc mỗi phút một lần cho tới khi nối lại được.
      if (quietErrors <= 3 || quietErrors % 30 === 0) {
        warn(`Không hỏi được server (lần ${quietErrors}): ${err?.message ?? err}`);
      }
      await sleep(POLL_MS);
    }
  }
}

process.on('SIGINT', () => {
  log('Dừng cầu in.');
  process.exit(0);
});

main();
