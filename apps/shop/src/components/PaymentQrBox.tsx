// Màn trả tiền của khách đặt online (2026-09-22).
//
// BA ĐIỀU LÀM NÊN MÀN NÀY, đọc trước khi sửa:
//
// 1. **Chỉ hiện sau khi quán đã xác nhận đơn.** Trước đó phí ship chưa chốt nên số tiền sẽ sai,
//    và đơn còn có thể bị từ chối — tiền đã vào tài khoản thì phải hoàn thủ công, việc mà quán
//    không có quy trình nào để làm. Điều kiện này cũng được ép ở phía server.
//
// 2. **Nội dung chuyển khoản in to và nói rõ đừng sửa.** Khách sửa được nội dung ở app ngân hàng
//    của họ, và mất mã là đơn rơi khỏi đối soát tự động — không mất tiền, nhưng mất khả năng tự
//    biết tiền đã về.
//
// 3. **Hỏi lại mỗi 3 giây trong lúc màn đang mở, và CHỈ lúc đang mở.** Tiền về qua webhook nên
//    trang không có cách nào biết ngoài việc hỏi. Hỏi nền khi khách đã đóng màn là nã vào server
//    cho một câu trả lời không ai đọc.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type PaymentState = {
  code: string;
  note: string;
  amount: number;
  qr_payload: string | null;
  expires_at: number;
  paid_at: number | null;
  received_amount: number;
};

const formatVnd = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

export function PaymentQrBox({ token }: { token: string }) {
  const [state, setState] = useState<PaymentState | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mở màn = xin mã. Gọi lại nhiều lần vẫn ra CÙNG một mã (server tìm-hoặc-tạo), nên khách F5
  // thoải mái mà mã đã nằm trong app ngân hàng của họ không thành mồ côi.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/public/payments/${encodeURIComponent(token)}`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => alive && (setState(j.data), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, token]);

  // Hỏi lại cho tới khi thấy tiền về. Dừng hẳn khi đã trả — không còn gì để đợi.
  useEffect(() => {
    if (!open || !state || state.paid_at) return;
    const timer = setInterval(() => {
      fetch(`/api/public/payments/${encodeURIComponent(token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data && setState(j.data))
        .catch(() => {
          /* mạng chập chờn ở quán là bình thường — lần sau hỏi lại, không báo gì cho khách */
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [open, token, state]);

  useEffect(() => {
    if (!state?.qr_payload || !canvasRef.current) return;
    const el = canvasRef.current;
    // Nạp TRỄ thư viện vẽ: nó chỉ cần khi khách thật sự mở màn trả tiền, để trong bundle
    // tải-lần-đầu là bắt mọi người xem menu cũng tải theo.
    import('qrcode')
      .then((m) => m.default.toCanvas(el, state.qr_payload!, { width: 260, margin: 1 }))
      .catch(() => {
        /* vẽ hỏng thì khối dưới vẫn còn số tài khoản và nội dung để khách tự gõ */
      });
  }, [state?.qr_payload]);

  if (!open) {
    return (
      <button type="button" style={openBtn} onClick={() => setOpen(true)}>
        Chuyển khoản trước
      </button>
    );
  }

  if (failed) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>
          Chưa lấy được mã thanh toán. Bạn cứ trả khi nhận hàng, hoặc thử lại sau.
        </p>
      </div>
    );
  }

  if (!state) return <div style={box}>Đang lấy mã…</div>;

  if (state.paid_at) {
    return (
      <div style={{ ...box, borderColor: '#15803d', background: '#f0fdf4' }}>
        <p style={{ margin: 0, fontWeight: 700, color: '#15803d' }}>
          ✅ Quán đã nhận được {formatVnd(state.received_amount)}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#4b5563' }}>
          Cảm ơn bạn. Không cần làm gì thêm.
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      <p style={{ margin: '0 0 10px', fontWeight: 700 }}>Quét mã để chuyển {formatVnd(state.amount)}</p>

      {state.qr_payload ? (
        <canvas ref={canvasRef} style={{ display: 'block', margin: '0 auto' }} />
      ) : (
        <p style={{ margin: 0, fontSize: 14 }}>
          Quán chưa cài mã QR nhận tiền. Bạn trả khi nhận hàng giúp quán nhé.
        </p>
      )}

      {/* Nội dung là thứ DUY NHẤT nối tiền của bạn với đơn của bạn — nên nó to hơn cả số tiền. */}
      <div style={noteBox}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Nội dung chuyển khoản</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{state.note}</div>
        <div style={{ fontSize: 13, color: '#b45309', marginTop: 4 }}>
          Vui lòng <strong>không sửa nội dung</strong> — quán dựa vào đó để biết tiền của đơn nào.
        </div>
      </div>

      {state.received_amount > 0 && state.received_amount < state.amount && (
        <p style={{ margin: '10px 0 0', fontSize: 14, color: '#b45309' }}>
          Quán đã nhận {formatVnd(state.received_amount)}, còn thiếu{' '}
          {formatVnd(state.amount - state.received_amount)}.
        </p>
      )}

      <p style={{ margin: '10px 0 0', fontSize: 13, color: '#6b7280' }}>
        Chuyển xong giữ màn này vài giây, quán nhận được sẽ tự báo ở đây.
      </p>
    </div>
  );
}

const box: CSSProperties = {
  border: '2px solid #0369a1',
  borderRadius: 12,
  padding: 16,
  margin: '12px 0',
  background: '#fff',
  textAlign: 'center',
};

const noteBox: CSSProperties = {
  marginTop: 12,
  padding: 10,
  background: '#f9fafb',
  borderRadius: 8,
};

const openBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '14px 16px',
  margin: '12px 0',
  fontSize: 17,
  fontWeight: 700,
  color: '#fff',
  background: '#0369a1',
  border: 'none',
  borderRadius: 12,
  cursor: 'pointer',
};
