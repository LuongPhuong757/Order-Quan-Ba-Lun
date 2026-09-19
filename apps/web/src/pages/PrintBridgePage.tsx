// CẦU IN chạy trong trình duyệt — dành cho máy POS Android nối máy in bằng dây USB.
//
// Mở trang này trên Chrome của máy POS, dán token thiết bị một lần, bấm "Kết nối máy in".
// Từ đó nó hỏi server mỗi 2 giây và đẩy hoá đơn sang máy in qua WebUSB.
//
// Trang này KHÔNG cần đăng nhập, và đó là chủ ý: nó sống trên một máy đặt ở quầy, chạy suốt
// ngày. Bắt nó mượn phiên của một nhân viên nghĩa là tài khoản người đó đăng nhập vĩnh viễn
// trên thiết bị ai cũng chạm được, và mọi thao tác của máy sẽ mang tên họ trong nhật ký.
// Lớp bảo vệ ở đây là token thiết bị — thu hồi được riêng, không dính tới ai cả.
//
// Vì sao mọi thứ hiển thị to và thô: không ai ngồi đọc trang này. Nó nằm úp ở góc quầy và chỉ
// được liếc qua khi hoá đơn không ra. Câu trả lời "còn sống hay không" phải đọc được từ xa.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToBytes,
  buildLocalTestBytes,
  getGrantedPrinter,
  openPrinter,
  requestPrinter,
  sendToPrinter,
  usbSupported,
  type UsbDevice,
} from '../lib/webusb-printer.ts';

const TOKEN_KEY = 'ordbl.print-bridge.token';
const POLL_MS = 2000;
const MAX_LOG = 20;

type Job = {
  job_id: string;
  connection: string;
  host: string;
  port: number;
  bytes_b64: string;
};

type LogLine = { at: string; text: string; bad?: boolean };

const clock = () => new Date().toTimeString().slice(0, 8);

export function PrintBridgePage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [running, setRunning] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [printed, setPrinted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  // Giữ trong ref, không trong state: vòng lặp poll phải luôn thấy giá trị MỚI NHẤT. Đọc từ
  // state trong closure của setTimeout là cách kinh điển để cầu in vẫn dùng token cũ sau khi
  // người ta vừa sửa token.
  const deviceRef = useRef<UsbDevice | null>(null);
  const claimedRef = useRef<Awaited<ReturnType<typeof openPrinter>> | null>(null);
  const tokenRef = useRef(token);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const say = useCallback((text: string, bad = false) => {
    setLog((prev) => [{ at: clock(), text, bad }, ...prev].slice(0, MAX_LOG));
  }, []);

  // ── Giữ màn hình sáng ─────────────────────────────────────────────────────
  // Android bóp cổ tab chạy nền, và màn hình tắt là tab thành nền. Không có Wake Lock thì cầu
  // in "chạy" được vài phút rồi ngủ, mà nhìn vào màn hình vẫn thấy chữ "đang chạy" của lần
  // vẽ cuối cùng — hỏng kiểu tệ nhất: im lặng và trông như bình thường.
  const keepAwake = useCallback(async () => {
    try {
      const wl = (navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      }).wakeLock;
      if (wl) wakeRef.current = await wl.request('screen');
    } catch {
      // Trình duyệt từ chối (tab chưa được tương tác, hoặc không hỗ trợ) — không phải lỗi chặn
      // việc in. Người dùng vẫn tự tắt được chế độ ngủ trong Cài đặt Android.
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && runningRef.current) void keepAwake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [keepAwake]);

  // ── Gọi server ────────────────────────────────────────────────────────────
  const apiPost = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-print-token': tokenRef.current },
      body: JSON.stringify(body ?? {}),
    });
    if (res.status === 401) throw new Error('TOKEN_SAI');
    if (!res.ok) throw new Error(`Server trả lỗi ${res.status}`);
    return res.json();
  }, []);

  // ── Một nhịp ──────────────────────────────────────────────────────────────
  const tick = useCallback(async (): Promise<boolean> => {
    const body = await apiPost('/print/next', {});
    const job: Job | null = body?.data ?? null;
    if (!job) return false;

    // Đối xứng với bản LAN: server đang đặt chế độ LAN mà cầu in này là bản USB thì nói thẳng,
    // đừng đẩy byte sang một máy in rồi để người ta ngồi đoán vì sao hai nơi in ra hai kiểu.
    if (job.connection === 'LAN') {
      const message = 'Cầu in này chạy chế độ USB nhưng server đang đặt chế độ LAN';
      say(message, true);
      await apiPost(`/print/jobs/${job.job_id}/fail`, { error: message }).catch(() => {});
      return true;
    }

    const device = deviceRef.current;
    const claimed = claimedRef.current;
    if (!device || !claimed) {
      await apiPost(`/print/jobs/${job.job_id}/fail`, { error: 'Cầu in chưa kết nối máy in USB' });
      return true;
    }
    try {
      await sendToPrinter(device, claimed, base64ToBytes(job.bytes_b64));
      await apiPost(`/print/jobs/${job.job_id}/ack`, {});
      setPrinted((n) => n + 1);
      say(`In xong ${job.job_id.slice(0, 8)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFailed((n) => n + 1);
      say(`In hỏng: ${message}`, true);
      // Báo về server là BẮT BUỘC: không báo thì job nằm ở trạng thái "đang giữ" tới lúc hết
      // giờ, và màn Máy in không nói được vì sao giấy không ra.
      await apiPost(`/print/jobs/${job.job_id}/fail`, { error: message }).catch(() => {});
    }
    return true;
  }, [apiPost, say]);

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    try {
      const hadJob = await tick();
      // Có job thì hỏi lại NGAY: hàng đợi hay dồn nhiều tờ một lúc (thanh toán mấy bàn liền
      // nhau), đợi thêm 2 giây mỗi tờ là khách bàn cuối đứng chờ vô cớ.
      timerRef.current = window.setTimeout(loop, hadJob ? 0 : POLL_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'TOKEN_SAI') {
        runningRef.current = false;
        setRunning(false);
        setFatal('Token thiết bị sai hoặc đã bị thu hồi. Tạo thiết bị mới ở Cài đặt → Máy in.');
        return;
      }
      say(`Không hỏi được server: ${message}`, true);
      timerRef.current = window.setTimeout(loop, POLL_MS);
    }
  }, [tick, say]);

  // ── Nối máy in ────────────────────────────────────────────────────────────
  /** Khởi động vòng lặp. Tách khỏi nút bấm để phần TỰ ĐỘNG dùng lại được y nguyên — hai đường
   *  vào mà hai đoạn code riêng là cách chắc chắn để một đường quên mất một bước. */
  const startLoop = useCallback(
    async (rawToken: string) => {
      const t = rawToken.trim();
      if (!t) {
        setFatal('Chưa dán token thiết bị.');
        return;
      }
      localStorage.setItem(TOKEN_KEY, t);
      tokenRef.current = t;
      setFatal(null);
      runningRef.current = true;
      setRunning(true);
      await keepAwake();
      void loop();
    },
    [keepAwake, loop],
  );

  const attach = useCallback(
    async (device: UsbDevice) => {
      claimedRef.current = await openPrinter(device);
      deviceRef.current = device;
      setDeviceName(device.productName || device.manufacturerName || 'Máy in USB');
    },
    [],
  );

  /** Người dùng đã tự tay bấm Dừng trong phiên này — đừng tự chạy lại sau lưng họ. */
  const stoppedByUserRef = useRef(false);

  /** Nối máy in rồi TỰ CHẠY luôn nếu đã có token.
   *
   *  Đây là thứ biến việc mở trang thành thao tác thủ công DUY NHẤT còn lại mỗi sáng. Chrome
   *  bắt buộc một cú bấm cho lần `requestDevice()` đầu tiên — luật bảo mật, không lách được —
   *  nhưng sau đó quyền được nhớ theo tên miền, nên `getDevices()` trả lại máy in mà không cần
   *  hỏi ai. Còn việc bấm "Bắt đầu" thì chẳng có luật nào bắt cả: nó chỉ là trạng thái của
   *  trang, và để người ta phải nhớ bấm là mời một buổi sáng không có hoá đơn nào in ra. */
  const attachAndMaybeStart = useCallback(
    async (device: UsbDevice, why: string) => {
      try {
        await attach(device);
        const saved = (localStorage.getItem(TOKEN_KEY) ?? '').trim();
        if (saved && !runningRef.current && !stoppedByUserRef.current) {
          await startLoop(saved);
          say(`${why} — cầu in đang chạy`);
        } else {
          say(why);
        }
      } catch (err) {
        say(`Không mở được máy in: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
    [attach, say, startLoop],
  );

  useEffect(() => {
    if (!usbSupported()) return;
    void (async () => {
      const device = await getGrantedPrinter();
      if (device) await attachAndMaybeStart(device, 'Đã tự nối lại máy in');
    })();
  }, [attachAndMaybeStart]);

  // Máy in bị rút dây / tắt nguồn rồi bật lại. Không có hai lắng nghe này thì sau khi bật lại
  // máy in buổi sáng, trang vẫn giữ một handle đã chết và mọi hoá đơn đều hỏng — mà ô trạng
  // thái vẫn xanh, vì vòng lặp hỏi server không hề biết gì về USB.
  useEffect(() => {
    const u = (navigator as unknown as {
      usb?: { addEventListener: (t: string, f: (e: { device: UsbDevice }) => void) => void;
              removeEventListener: (t: string, f: (e: { device: UsbDevice }) => void) => void };
    }).usb;
    if (!u) return;
    const onConnect = (e: { device: UsbDevice }) => {
      void attachAndMaybeStart(e.device, 'Máy in vừa được cắm lại');
    };
    const onDisconnect = () => {
      deviceRef.current = null;
      claimedRef.current = null;
      setDeviceName(null);
      say('Máy in bị rút hoặc tắt nguồn', true);
    };
    u.addEventListener('connect', onConnect);
    u.addEventListener('disconnect', onDisconnect);
    return () => {
      u.removeEventListener('connect', onConnect);
      u.removeEventListener('disconnect', onDisconnect);
    };
  }, [attachAndMaybeStart, say]);

  const pickPrinter = async () => {
    try {
      const device = await requestPrinter();
      await attach(device);
      say('Đã kết nối máy in');
    } catch (err) {
      // Người dùng bấm Huỷ ở hộp thoại cũng rơi vào đây — không phải lỗi, chỉ ghi nhận.
      say(`Chưa chọn được máy in: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  /** In một tờ thử THẲNG từ trang này, không hỏi server, không cần token.
   *
   *  Đây là cách tách bạch hai nguồn hỏng: tờ này ra giấy = đường POS → USB → máy in đã thông,
   *  mọi trục trặc còn lại nằm ở server hoặc token. Dùng được NGAY sau khi cắm dây, trước cả
   *  khi app được deploy. */
  const testLocal = async () => {
    const device = deviceRef.current;
    const claimed = claimedRef.current;
    if (!device || !claimed) {
      say('Chưa kết nối máy in — bấm "Kết nối máy in" trước', true);
      return;
    }
    try {
      await sendToPrinter(device, claimed, buildLocalTestBytes());
      say('Đã gửi tờ in thử tại chỗ — giấy phải ra ngay');
    } catch (err) {
      say(`In thử hỏng: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };


  const start = async () => {
    stoppedByUserRef.current = false;
    await startLoop(token);
    say('Cầu in bắt đầu chạy');
  };

  const stop = () => {
    stoppedByUserRef.current = true;
    runningRef.current = false;
    setRunning(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    say('Đã dừng cầu in');
  };

  useEffect(() => () => {
    runningRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const ok = running && deviceName && !fatal;
  const bg = fatal ? '#7f1d1d' : ok ? '#064e3b' : '#374151';

  return (
    <div style={{ minHeight: '100vh', background: bg, color: '#fff', padding: 20, fontSize: 17 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>Cầu in</h1>
        <p style={{ margin: '0 0 20px', opacity: 0.75, fontSize: 15 }}>
          Để trang này mở và màn hình sáng. Đóng trang là hoá đơn ngừng ra.
        </p>

        {!usbSupported() && (
          <div style={{ background: '#7f1d1d', padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <strong>Trình duyệt này không hỗ trợ WebUSB.</strong> Mở trang bằng <b>Chrome</b> trên
            máy POS Android. Safari và trình duyệt mặc định của một số máy POS đều không chạy được.
          </div>
        )}

        {/* Trạng thái cỡ lớn — thứ duy nhất đọc được khi liếc từ xa. */}
        <div
          style={{
            background: 'rgba(0,0,0,.25)',
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.2 }}>
            {fatal ? '✕ Có lỗi' : ok ? '● Đang chạy' : '○ Chưa chạy'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            {deviceName ? `Máy in: ${deviceName}` : 'Chưa kết nối máy in'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            Đã in {printed} · Hỏng {failed}
          </div>
        </div>

        {fatal && (
          <div style={{ background: '#991b1b', padding: 14, borderRadius: 10, marginBottom: 16 }}>
            {fatal}
          </div>
        )}

        {/* Bẫy đã gặp thật: bấm "In thử tại chỗ" thấy giấy ra rồi bỏ đi, tưởng xong. Nút đó đẩy
            byte THẲNG sang máy in, không đi qua server, nên nó chạy được cả khi vòng lặp chưa
            bật — và hoá đơn thật thì không in. Bình thường trang tự chạy, nên dải này chỉ hiện
            khi ai đó bấm Dừng hoặc chưa có token. */}
        {deviceName && !running && !fatal && (
          <div
            style={{
              background: '#78350f',
              border: '1px solid #b45309',
              padding: 14,
              borderRadius: 10,
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            <strong>Máy in đã nối nhưng cầu in CHƯA CHẠY.</strong> Hoá đơn thanh toán sẽ không tự
            in ra. {token.trim() ? 'Bấm "Bắt đầu".' : 'Dán token rồi bấm "Bắt đầu".'}
          </div>
        )}

        {/* `color` phải khai TƯỜNG MINH. `styles.css` có luật `label { color: #374151 }` ở tầng
            element, mà #374151 đúng bằng màu nền của trang này khi chưa chạy — nhãn thành chữ
            đen trên nền đen, biến mất hoàn toàn. Style nội tuyến không kế thừa màu của thẻ cha
            nếu một luật element đã đặt màu cho chính thẻ đó. */}
        <label style={{ display: 'block', marginBottom: 6, color: '#fff', opacity: 0.8, fontSize: 14 }}>
          Token thiết bị (lấy ở Cài đặt → Máy in)
        </label>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value.trim())}
          placeholder="dán token vào đây"
          disabled={running}
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: 8,
            border: 'none',
            marginBottom: 14,
            boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <button
            type="button"
            onClick={pickPrinter}
            disabled={!usbSupported()}
            style={{ padding: '14px 20px', fontSize: 17 }}
          >
            {deviceName ? 'Chọn máy in khác' : 'Kết nối máy in'}
          </button>
          <button
            type="button"
            onClick={testLocal}
            disabled={!deviceName}
            style={{ padding: '14px 20px', fontSize: 17 }}
          >
            In thử tại chỗ
          </button>
          {running ? (
            <button type="button" onClick={stop} style={{ padding: '14px 20px', fontSize: 17 }}>
              Dừng
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!deviceName}
              style={{ padding: '14px 20px', fontSize: 17 }}
            >
              Bắt đầu
            </button>
          )}
        </div>

        <div style={{ background: 'rgba(0,0,0,.25)', borderRadius: 10, padding: 12 }}>
          <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 8 }}>Nhật ký gần đây</div>
          {log.length === 0 && <div style={{ opacity: 0.6, fontSize: 14 }}>Chưa có gì.</div>}
          {log.map((l, i) => (
            <div
              key={i}
              style={{ fontSize: 14, lineHeight: 1.7, color: l.bad ? '#fca5a5' : 'inherit' }}
            >
              <span style={{ opacity: 0.6 }}>{l.at}</span> {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
