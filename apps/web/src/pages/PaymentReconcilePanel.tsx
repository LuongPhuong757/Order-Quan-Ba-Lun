// Hai mảnh đối soát tiền của màn Lịch sử (2026-09-14).
//
// `PaymentSummaryBox` — "két phải có bao nhiêu, ngân hàng phải về bao nhiêu", tách theo từng mã
// QR. Đây là lý do cả tính năng chuyển khoản tồn tại: có ba tài khoản thì cuối ngày mở ba sao kê,
// mỗi cái chỉ dò đúng phần của nó thay vì dò chéo tất cả.
//
// `PaymentPhotos` — ảnh bill khách đưa. Tải TRỄ, chỉ khi người ta mở chi tiết một đơn: kéo ảnh
// của cả trang danh sách là hàng chục tấm không ai nhìn.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

type Summary = {
  total: number;
  cash: number;
  transfer: number;
  orders: number;
  by_account: Array<{ account_id: string | null; label: string; amount: number; orders: number }>;
};

/** Nhận NGUYÊN chuỗi query đã dựng bằng `historyQuery` của màn Lịch sử, không tự ghép lại từ
 *  from/to: docblock của `historyQuery` ghi rõ ba khối `URLSearchParams` chép tay ở màn này đã
 *  từng lệch nhau ở khoảng ngày. Khối đối soát nói về tiền — lệch ngày ở đây là lệch cả con số
 *  người ta mang đi đếm két. `filterKey` là deps để đổi trang không bắt tải lại. */
export function PaymentSummaryBox({ query, filterKey }: { query: string; filterKey: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * MẶC ĐỊNH ĐÓNG (chủ quán chốt 2026-09-14), cùng nếp với khối biểu đồ thống kê ngay trên.
   *
   * Lý do không chỉ là gọn màn hình: đây là con số tiền của cả ca, bày sẵn nghĩa là ai đứng cạnh
   * liếc qua vai cũng đọc được. Mở ra là một hành động có chủ ý.
   */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Đóng thì KHÔNG gọi API: con số này không hiện ra đâu cả, mà mỗi lần đổi bộ lọc lại nã một
    // truy vấn quét toàn bộ đơn trong khoảng — trả tiền cho thứ không ai nhìn.
    if (!open) return;
    let alive = true;
    api
      .get<{ data: Summary }>(`/orders/payment-summary?${query}`)
      .then((res) => alive && (setData(res.data.data), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, open]);

  // Nút bấm LUÔN hiện, kể cả khi chưa tải hay không có dữ liệu — nút biến mất theo dữ liệu thì
  // người dùng không hiểu vì sao lúc có lúc không, và cũng không còn đường nào để thử mở lại.
  const toggle = (
    <button
      className="secondary"
      onClick={() => setOpen((v) => !v)}
      style={{ marginBottom: 10, padding: '6px 12px', fontSize: 13 }}
    >
      {open ? '▲ Ẩn đối soát tiền' : '▼ Hiện đối soát tiền'}
    </button>
  );

  if (!open) return <div style={{ marginBottom: 16 }}>{toggle}</div>;

  if (failed || !data) {
    return (
      <div style={{ marginBottom: 16 }}>
        {toggle}
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {failed ? 'Không tải được số liệu đối soát.' : 'Đang tải…'}
        </div>
      </div>
    );
  }

  // Chưa có đồng nào chuyển khoản trong khoảng này → bảng chỉ toàn số 0, nói thẳng ra một câu
  // còn hơn bày một bảng rỗng.
  if (data.transfer === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        {toggle}
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Khoảng đang xem không có đơn nào thu bằng chuyển khoản.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
    {toggle}
    <div className="card" style={{ padding: 14, borderLeft: '4px solid #0369a1' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Đối soát tiền</div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label="💵 Tiền mặt (phải có trong két)" value={fmt(data.cash)} color="#0f766e" />
        <Tile label="🏦 Chuyển khoản (phải về ngân hàng)" value={fmt(data.transfer)} color="#0369a1" />
        <Tile label="Tổng thu" value={fmt(data.total)} color="#374151" />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>Tiền về từng tài khoản</div>
        {data.by_account.map((a) => (
          <div
            key={a.account_id ?? a.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '6px 0',
              borderBottom: '1px solid #f3f4f6',
              fontSize: 14,
            }}
          >
            <span>
              {a.label} <span style={{ color: '#9ca3af' }}>({a.orders} đơn)</span>
            </span>
            <strong style={{ color: '#0369a1' }}>{fmt(a.amount)}</strong>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
        Số chuyển khoản ở đây là <strong>số nhân viên đã ghi nhận</strong>. Ngân hàng có xác nhận
        hay không nằm ở khối <strong>“Ngân hàng đã báo về”</strong> ngay dưới — và khối đó chỉ biết
        về tài khoản đã nối với SePay, các tài khoản còn lại vẫn phải dò tay bằng ảnh bill.
      </div>
    </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: '1 1 160px', background: '#f9fafb', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

type Reconcile = {
  confirmed: number;
  pending: Array<{ code: string; target_type: string; target_id: string; amount: number; received: number }>;
  unknown: Array<{ amount: number; content: string; occurred_at: number; account_no: string | null }>;
};

/**
 * "Ngân hàng đã báo về chưa" (2026-09-22) — khối DUY NHẤT trên màn này nói bằng dữ liệu từ phía
 * ngân hàng, mọi con số còn lại đều là thứ người trong quán tự ghi.
 *
 * Bày đúng hai danh sách, và thứ tự là cố ý:
 *  1. **chưa thấy tiền** — câu hỏi khiến chủ quán mở màn này ra;
 *  2. **tiền lạ** — tiền về mà không mang mã đơn nào (khách xoá nội dung, chuyển nhầm, hoặc tiền
 *     riêng của chủ vào cùng tài khoản).
 *
 * KHÔNG có nút nào sửa đơn ở đây, và đó là chủ ý (chủ quán chốt 2026-09-21: máy chỉ gắn cờ,
 * người quyết). Khối này trả lời, không hành động.
 */
export function BankReconcileBox({ query, filterKey }: { query: string; filterKey: string }) {
  const [data, setData] = useState<Reconcile | null>(null);
  const [failed, setFailed] = useState(false);
  // Mặc định ĐÓNG, cùng nếp với khối đối soát ngay trên: đây là tiền của cả ca.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const p = new URLSearchParams(query);
    const range = new URLSearchParams();
    // Chỉ lấy đúng hai tham số khoảng thời gian: các bộ lọc khác của màn Lịch sử (bàn, nhân viên)
    // không có nghĩa với bảng mã thanh toán, gửi kèm chỉ khiến BE phải biết về chúng.
    if (p.get('from')) range.set('from', p.get('from')!);
    if (p.get('to')) range.set('to', p.get('to')!);
    api
      .get<{ data: Reconcile }>(`/payments/reconcile?${range.toString()}`)
      .then((res) => alive && (setData(res.data.data), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, open]);

  const toggle = (
    <button
      className="secondary"
      onClick={() => setOpen((v) => !v)}
      style={{ marginBottom: 10, padding: '6px 12px', fontSize: 13 }}
    >
      {open ? '▲ Ẩn đối chiếu ngân hàng' : '▼ Ngân hàng đã báo về'}
    </button>
  );

  if (!open) return <div style={{ marginBottom: 16 }}>{toggle}</div>;

  if (failed || !data) {
    return (
      <div style={{ marginBottom: 16 }}>
        {toggle}
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {failed ? 'Không tải được đối chiếu ngân hàng.' : 'Đang tải…'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {toggle}
      <div className="card" style={{ padding: 14, borderLeft: '4px solid #15803d' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Ngân hàng đã báo về</div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Tile label="✅ Đã thấy tiền về" value={String(data.confirmed)} color="#15803d" />
          <Tile label="🔴 Chưa thấy tiền" value={String(data.pending.length)} color="#b91c1c" />
          <Tile label="❓ Tiền lạ" value={String(data.unknown.length)} color="#b45309" />
        </div>

        {data.pending.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
              Đã chìa mã QR nhưng chưa thấy tiền
            </div>
            {data.pending.map((p) => (
              <div key={p.code} style={rowStyle}>
                <span>
                  <strong>DH{p.code}</strong>{' '}
                  <span style={{ color: '#9ca3af' }}>
                    {p.target_type === 'ONLINE' ? 'đơn online' : 'tại quán'}
                  </span>
                </span>
                <strong style={{ color: '#b91c1c' }}>
                  {p.received > 0 ? `${fmt(p.received)} / ${fmt(p.amount)}` : fmt(p.amount)}
                </strong>
              </div>
            ))}
          </div>
        )}

        {data.unknown.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
              Tiền về không mang mã đơn
            </div>
            {data.unknown.map((u, i) => (
              <div key={`${u.occurred_at}-${i}`} style={rowStyle}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {new Date(u.occurred_at).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  <span style={{ color: '#9ca3af' }}>{u.content || '(không có nội dung)'}</span>
                </span>
                <strong style={{ color: '#b45309' }}>{fmt(u.amount)}</strong>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          Chỉ phản ánh tài khoản đã nối với SePay. Máy <strong>không tự sửa đơn</strong> — số tiền
          trên đơn vẫn là số người thu đã ghi.
        </div>

        {/* Đường vào sổ giao dịch. Đặt Ở ĐÂY chứ không nhét thêm một mục vào nav: người ta cần sổ
            đúng lúc đang nhìn một con số đáng ngờ trên khối này. */}
        <a
          href="/admin/bank-ledger"
          style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 600 }}
        >
          Mở sổ giao dịch ngân hàng →
        </a>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 0',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 14,
};

type Photo = { id: string; url: string; created_at: number; created_by_full_name: string | null };

export function PaymentPhotos({ orderId }: { orderId: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: Photo[] } }>(`/orders/${orderId}/payment-photos`)
      .then((res) => alive && setPhotos(res.data.data.items))
      .catch((e) => alive && setErr(extractError(e).message));
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (err) return <div style={{ fontSize: 13, color: '#dc2626' }}>Không tải được ảnh bill: {err}</div>;
  if (!photos || photos.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Ảnh bill khách đưa</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          // Mở tấm gốc ở tab mới để phóng to đọc số tiền và mã giao dịch — đó là việc duy nhất
          // người ta làm với mấy tấm ảnh này.
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
            <img
              src={p.url}
              alt={`Ảnh bill ${i + 1}`}
              style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Badge hình thức thanh toán của MỘT đơn (2026-09-14, chủ quán: "để rõ hơn").
 *
 * Ba lựa chọn thiết kế, đều có lý do:
 *
 *  1. MÀU NỀN là tín hiệu chính, emoji chỉ phụ hoạ. Ở cỡ chữ nhỏ trong bảng, 💵 và 🏦 gần như
 *     không phân biệt được — nhất là trên điện thoại và với người mắt kém, vốn là người dùng
 *     thật của app này. Ba mảng màu khác hẳn nhau thì liếc là thấy.
 *  2. CHỮ ĐẦY ĐỦ, không viết tắt "CK". Bản đầu dùng "🏦 CK" cỡ 11px và đó chính là cái bị chê
 *     không rõ.
 *  3. Hiện cho MỌI đơn đã thu, kể cả tiền mặt. Bản đầu chỉ hiện khi có chuyển khoản, nghĩa là
 *     "không có badge" = tiền mặt — một quy ước ngầm mà người đọc bảng phải tự biết. Nói thẳng
 *     ra thì không phải đoán.
 *
 * KHÔNG hiện với đơn chưa thu hoặc đơn huỷ: chúng chưa có hình thức thanh toán nào cả.
 */
export function PaymentMethodBadge({ total, transferAmount }: { total: number; transferAmount: number }) {
  const style = {
    display: 'inline-block',
    marginTop: 3,
    padding: '1px 6px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.5,
  };
  if (!transferAmount || transferAmount <= 0) {
    return <span style={{ ...style, background: '#d1fae5', color: '#065f46' }}>💵 Tiền mặt</span>;
  }
  if (transferAmount >= total) {
    return <span style={{ ...style, background: '#e0f2fe', color: '#075985' }}>🏦 Chuyển khoản</span>;
  }
  // Cam, KHÔNG phải một sắc xanh thứ ba: đây là trường hợp người đếm két phải để ý nhất — chỉ
  // một phần số tiền nằm trong két — nên nó cần nhảy ra khỏi hai màu kia.
  return <span style={{ ...style, background: '#ffedd5', color: '#9a3412' }}>💵+🏦 Cả hai</span>;
}
