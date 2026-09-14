// Hai mảnh đối soát tiền của màn Lịch sử (2026-09-14).
//
// `PaymentSummaryBox` — "két phải có bao nhiêu, ngân hàng phải về bao nhiêu", tách theo từng mã
// QR. Đây là lý do cả tính năng chuyển khoản tồn tại: có ba tài khoản thì cuối ngày mở ba sao kê,
// mỗi cái chỉ dò đúng phần của nó thay vì dò chéo tất cả.
//
// `PaymentPhotos` — ảnh bill khách đưa. Tải TRỄ, chỉ khi người ta mở chi tiết một đơn: kéo ảnh
// của cả trang danh sách là hàng chục tấm không ai nhìn.
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

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: Summary }>(`/orders/payment-summary?${query}`)
      .then((res) => alive && (setData(res.data.data), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  if (failed || !data) return null;
  // Chưa có đồng nào chuyển khoản trong khoảng này → khối này không nói thêm được gì so với ô
  // doanh thu vốn đã có ở trên. Ẩn hẳn thay vì hiện một bảng toàn số 0.
  if (data.transfer === 0) return null;

  return (
    <div
      className="card"
      style={{ padding: 14, marginBottom: 16, borderLeft: '4px solid #0369a1' }}
    >
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
        Số chuyển khoản ở đây là <strong>số nhân viên đã ghi nhận</strong>, không phải số ngân hàng
        xác nhận — app không đọc được sao kê. Dò lại bằng nội dung chuyển khoản và ảnh bill trong
        từng đơn.
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
