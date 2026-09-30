// Nhật ký HOÁ ĐƠN TỰ DO (M6.D-06) — khối cuối của màn Cài đặt → Máy in, chỉ admin thấy.
//
// Vì sao khối này bắt buộc phải có: tờ hoá đơn tự do in ra KHÔNG mang dấu gì phân biệt với hoá
// đơn thật (chủ quán chốt 2026-09-30). Nếu hệ thống cũng không ghi lại gì thì một tờ giấy như
// vậy là thứ không tồn tại ở đâu cả — không đối chiếu được, không truy được ai in, không trả lời
// được câu hỏi "tờ này ở đâu ra" khi nó xuất hiện trên quầy.
//
// Tách khỏi `PrintersPanel.tsx` vì file đó đã 620 dòng và ba khối của nó đang vừa đủ đọc.
import { useCallback, useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';

type ReceiptItem = { name: string; qty: number; unit_price: number; note: string | null };

type ReceiptRow = {
  id: string;
  code: string;
  header_note: string;
  items: ReceiptItem[];
  ship_fee: number;
  transfer_amount: number;
  total: number;
  created_by_full_name: string | null;
  created_at: number;
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

const card: React.CSSProperties = {
  background: C.cardBg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};

export function CustomReceiptsLog() {
  const toast = useToast();
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: { items: ReceiptRow[] } }>('/custom-receipts?limit=50');
      setRows(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
      setRows([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const reprint = async (r: ReceiptRow) => {
    if (reprinting) return;
    setReprinting(r.id);
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/custom-receipts/${r.id}/print`, {});
      if (res.data.data.queued) {
        toast.push('success', `Đang in lại hoá đơn #${r.code}`);
      } else {
        toast.push('error', 'Chưa bật in hoá đơn — bật công tắc ở khối trên rồi thử lại');
      }
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setReprinting(null);
    }
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Hoá đơn tự do đã in</h3>
      <p style={{ color: C.muted, fontSize: 13, margin: '0 0 12px' }}>
        Những tờ in ra từ màn <strong>Hoá đơn tự do</strong>. Chúng không nằm trong doanh thu, và
        đây là chỗ duy nhất đối chiếu được tờ giấy đang cầm với hệ thống.
      </p>

      {rows === null && <p style={{ color: C.muted, fontSize: 14 }}>Đang tải…</p>}
      {rows?.length === 0 && (
        <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>Chưa có tờ nào được in.</p>
      )}

      {rows?.map((r) => (
        <div
          key={r.id}
          style={{
            border: `1px solid ${C.borderSoft}`,
            borderRadius: 8,
            padding: 10,
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <code style={{ color: C.muted, fontSize: 13 }}>#{r.code}</code>{' '}
              <strong>{r.header_note || '(không ghi chú)'}</strong>
              <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
                {clockTime(r.created_at)}
                {r.created_by_full_name && ` · ${r.created_by_full_name}`}
                {` · ${r.items.length} dòng`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <strong style={{ alignSelf: 'center' }}>{fmt(r.total)}</strong>
              <button
                type="button"
                className="secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => setOpenId((id) => (id === r.id ? null : r.id))}
              >
                {openId === r.id ? 'Ẩn' : 'Chi tiết'}
              </button>
              <button
                type="button"
                className="secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                disabled={reprinting === r.id}
                onClick={() => reprint(r)}
              >
                In lại
              </button>
            </div>
          </div>

          {openId === r.id && (
            <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8 }}>
              {r.items.map((it, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0' }}
                >
                  <span>
                    {it.qty} × {it.name}
                    {it.note && <span style={{ color: C.muted }}> · {it.note}</span>}
                  </span>
                  <span>{fmt(it.unit_price * it.qty)}</span>
                </div>
              ))}
              {r.ship_fee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: C.muted }}>Phí giao hàng</span>
                  <span>{fmt(r.ship_fee)}</span>
                </div>
              )}
              {r.transfer_amount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: C.muted }}>Chuyển khoản</span>
                  <span>{fmt(r.transfer_amount)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
