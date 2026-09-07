// Giá vốn món ăn (bước 5) — câu trả lời cuối cùng cho "NCC tăng giá thì sao".
//
// Bảng này không phải báo cáo để ngắm: nó nói món nào đang mỏng lãi, và nguyên liệu nào trong
// món đó ngốn tiền nhất — tức là nên gọi điện mặc cả cái gì trước.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';

type Component = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  qty_per_serving: number;
  unit_price_base: number | null;
  cost: number | null;
  share_pct: number | null;
};

type FoodCostRow = {
  menu_item_id: string;
  menu_item_name: string;
  sell_price: number;
  cost: number;
  missing: string[];
  complete: boolean;
  margin_amount: number | null;
  margin_pct: number | null;
  components: Component[];
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });

/** Màu theo biên lợi nhuận. Ngưỡng 25% / 50% là mức thường thấy ở quán ăn — dưới 25% là mỏng tới
 * mức một lần NCC tăng giá là lỗ. */
function marginColor(pct: number | null): string {
  if (pct === null) return C.muted;
  if (pct < 25) return '#b91c1c';
  if (pct < 50) return '#b45309';
  return '#15803d';
}

export function FoodCostPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<FoodCostRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    api
      .get<{ data: { from: string; items: FoodCostRow[] } }>('/supplier-reports/food-cost')
      .then((r) => {
        setRows(r.data.data.items);
        setFrom(r.data.data.from);
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [toast]);

  useEffect(load, [load]);

  // Món mỏng lãi nhất nằm trên. Món chưa đủ giá nguyên liệu xuống cuối — con số của chúng chưa
  // dùng để ra quyết định được, để lẫn lên đầu chỉ gây hiểu nhầm.
  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) => {
        if (a.complete !== b.complete) return a.complete ? -1 : 1;
        return (a.margin_pct ?? 999) - (b.margin_pct ?? 999);
      }),
    [rows],
  );

  const incomplete = sorted.filter((r) => !r.complete);

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (rows.length === 0) {
    return (
      <div className="empty-state card">
        Chưa món nào có công thức. Khai công thức ở màn Menu rồi quay lại đây.
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 14, color: C.mutedOnTint, margin: '0 0 12px' }}>
        Giá vốn tính theo <strong>giá mua bình quân</strong> từ {from} tới nay — không phải giá lần
        nhập cuối, để một đợt mua lẻ đắt đỏ không kéo lệch cả bảng.
      </p>

      {incomplete.length > 0 && (
        // Nói thẳng ra, không giấu: giá vốn thiếu nguyên liệu luôn THẤP hơn thật, tức biên lợi
        // nhuận đẹp hơn thật.
        <div className="card" style={{ marginBottom: 12, background: '#fffbeb' }}>
          <strong>{incomplete.length} món chưa đủ giá nguyên liệu</strong>
          <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 4 }}>
            Những món đó chưa tính được biên lợi nhuận. Nhập một phiếu có nguyên liệu còn thiếu là
            bảng tự đủ.
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 8 }}>Món</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Giá bán</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Giá vốn</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Lãi/phần</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Biên LN</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <>
                <tr
                  key={r.menu_item_id}
                  onClick={() => setOpen(open === r.menu_item_id ? null : r.menu_item_id)}
                  style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                >
                  <td style={{ padding: 8 }}>
                    {open === r.menu_item_id ? '▾ ' : '▸ '}
                    {r.menu_item_name}
                    {!r.complete && (
                      <div style={{ fontSize: 12, color: '#b45309' }}>
                        thiếu giá: {r.missing.join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{vnd(r.sell_price)}đ</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                    {vnd(r.cost)}đ{!r.complete && <span style={{ color: '#b45309' }}> +?</span>}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {r.margin_amount === null ? '—' : `${vnd(r.margin_amount)}đ`}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      fontWeight: 800,
                      color: marginColor(r.margin_pct),
                    }}
                  >
                    {r.margin_pct === null ? '—' : `${r.margin_pct.toLocaleString('vi-VN')}%`}
                  </td>
                </tr>
                {open === r.menu_item_id && (
                  <tr key={`${r.menu_item_id}-d`}>
                    <td colSpan={5} style={{ padding: '0 8px 12px', background: '#f9fafb' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {/* Sắp theo phần đóng góp giảm dần — nguyên liệu đáng đàm phán nằm trên. */}
                          {[...r.components]
                            .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
                            .map((c) => (
                              <tr key={c.ingredient_id}>
                                <td style={{ padding: '4px 8px' }}>{c.ingredient_name}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: C.mutedOnTint }}>
                                  {num(c.qty_per_serving)} {c.base_unit}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: C.mutedOnTint }}>
                                  {c.unit_price_base === null ? (
                                    <span style={{ color: '#b45309' }}>chưa có giá</span>
                                  ) : (
                                    `${num(c.unit_price_base)} đ/${c.base_unit}`
                                  )}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
                                  {c.cost === null ? '—' : `${vnd(c.cost)}đ`}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', width: 56, color: C.muted }}>
                                  {c.share_pct === null ? '' : `${c.share_pct}%`}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
