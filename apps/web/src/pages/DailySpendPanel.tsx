// Chi tiêu nhập hàng theo NGÀY (2026-09-06, chủ quán yêu cầu).
//
// Câu hỏi màn này trả lời mà bốn tab kia không trả lời được: "hôm đó tiêu bao nhiêu, và tiêu vào
// đâu". Tab "Mặt hàng nhập" gộp cả lịch sử theo mặt hàng nên một ngày mua dồn bất thường chìm
// mất; tab "Phiếu nhập" liệt kê từng phiếu nên một ngày ba NCC giao là ba dòng rời, không cộng
// lại thành con số của ngày.
//
// Bấm một ngày là xổ ra các NCC đã giao hôm đó — hai mức trong một bảng, không phải nhảy màn.
//
// 2026-09-07: panel này KHÔNG còn là một tab riêng. Nó nằm trong tab "Thống kê", dưới biểu đồ
// cột, ở dạng thu gọn — biểu đồ trả lời "hình chi tiêu trông thế nào", bảng này trả lời "hôm đó
// tiêu vào NCC nào". Gộp một chỗ vì đó là hai câu hỏi liền nhau của cùng một lần nhìn.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';

export type DailyRow = {
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  amount: number;
  deliveries: number;
};

type Day = {
  date: string;
  amount: number;
  deliveries: number;
  bySupplier: DailyRow[];
};

const vnd = (n: number) => n.toLocaleString('vi-VN');

export function DailySpendPanel({
  supplierId,
  from,
  to,
  hideSummary = false,
  rows: given,
}: {
  supplierId?: string;
  /** Khoảng ngày đang lọc, 'YYYY-MM-DD'. Bỏ trống đầu nào = không chặn đầu đó. */
  from?: string;
  to?: string;
  /** Ẩn thẻ tổng ở trên. Bật khi panel nằm dưới một khối tổng khác (tab Thống kê) — hai khối
   *  nói cùng một con số cạnh nhau chỉ làm người xem nghi là có hai con số khác nhau. */
  hideSummary?: boolean;
  /** Dữ liệu người gọi ĐÃ CÓ. Truyền vào thì panel không gọi API nữa.
   *
   *  Cần thiết vì tab Thống kê đã tải đúng dữ liệu này để vẽ biểu đồ cột — để panel tự gọi lại
   *  là gọi hai lần cùng một endpoint cùng tham số cho một lần mở tab, và bảng còn hiện "Đang
   *  tải…" trong khi biểu đồ ngay trên nó đã vẽ xong. */
  rows?: DailyRow[];
}) {
  const toast = useToast();
  const [fetched, setFetched] = useState<DailyRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = given ?? fetched;

  const load = useCallback(() => {
    if (given) return;
    setFetched(null);
    api
      .get<{ data: { items: DailyRow[] } }>('/supplier-reports/daily', {
        params: { supplier_id: supplierId, from: from || undefined, to: to || undefined },
      })
      .then((r) => setFetched(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setFetched([]);
      });
  }, [given, supplierId, from, to, toast]);

  useEffect(load, [load]);

  // Server trả từng cặp (ngày, NCC); gộp lên mức ngày ở đây để giữ được CẢ hai mức.
  const days = useMemo<Day[]>(() => {
    const map = new Map<string, Day>();
    for (const r of rows ?? []) {
      let d = map.get(r.delivery_date);
      if (!d) {
        d = { date: r.delivery_date, amount: 0, deliveries: 0, bySupplier: [] };
        map.set(r.delivery_date, d);
      }
      d.amount += r.amount;
      d.deliveries += r.deliveries;
      d.bySupplier.push(r);
    }
    for (const d of map.values()) d.bySupplier.sort((a, b) => b.amount - a.amount);
    return [...map.values()];
  }, [rows]);

  const total = days.reduce((s, d) => s + d.amount, 0);
  // Ngày mua nhiều nhất — mốc để tô thanh nền, cho phép liếc qua là thấy ngày nào dồn bất thường
  // mà không phải đọc từng con số.
  const peak = days.reduce((m, d) => Math.max(m, d.amount), 0);

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (days.length === 0) {
    return <div className="empty-state card">Không có phiếu nhập nào đã duyệt trong khoảng này.</div>;
  }

  return (
    <>
      {!hideSummary && (
        <div className="card" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 15 }}>
            {days.length} ngày có nhập hàng · tổng{' '}
            <strong style={{ fontSize: 22 }}>{vnd(total)}đ</strong>
          </span>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 8 }}>Ngày</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Phiếu</th>
              <th style={{ padding: 8, textAlign: 'right' }}>NCC</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Tổng tiền</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const isOpen = open === d.date;
              return (
                <Fragment key={d.date}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : d.date)}
                    style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                  >
                    <td style={{ padding: 8, whiteSpace: 'nowrap', position: 'relative' }}>
                      {/* Thanh nền tỉ lệ với ngày mua nhiều nhất — nằm DƯỚI chữ, không đẩy layout. */}
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: `${peak ? (d.amount / peak) * 100 : 0}%`,
                          background: '#ccfbf1',
                          borderRadius: 4,
                          zIndex: 0,
                        }}
                      />
                      <span style={{ position: 'relative', zIndex: 1 }}>{d.date}</span>
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{d.deliveries}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{d.bySupplier.length}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                      {vnd(d.amount)}đ
                    </td>
                    <td style={{ padding: 8, color: C.muted, width: 24 }}>{isOpen ? '▾' : '▸'}</td>
                  </tr>
                  {isOpen &&
                    d.bySupplier.map((r) => (
                      <tr key={`${d.date}-${r.supplier_id}`} style={{ background: '#f9fafb' }}>
                        <td style={{ padding: '6px 8px 6px 24px', color: C.mutedOnTint }} colSpan={2}>
                          {r.supplier_name}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: C.mutedOnTint }}>
                          {r.deliveries} phiếu
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{vnd(r.amount)}đ</td>
                        <td />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
