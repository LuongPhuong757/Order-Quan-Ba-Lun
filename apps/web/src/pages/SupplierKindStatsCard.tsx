// Khối "Nguyên liệu chính / phụ" của tab Thống kê (2026-10-22, chủ quán yêu cầu).
//
// Trả lời ba câu: kỳ này chi bao nhiêu cho đồ phụ (gas, hành lá, đá…) so với nguyên liệu chính,
// đồ phụ ngốn bao nhiêu % doanh thu, và món phụ nào tốn nhất. Đồ phụ không nằm trong công thức
// món nên trước tính năng này nó chỉ là một phần không tên trong "Tổng nhập".
//
// File riêng chứ không viết thẳng vào `SupplierStatsPanel`: file đó đã gần 900 dòng, và khối này
// có nguồn dữ liệu riêng (`/supplier-reports/by-kind`) không dính gì tới sáu lượt gọi của nó.
//
// KHÔNG theo bộ lọc NCC của trang: % phụ / doanh thu là câu hỏi của CẢ QUÁN — chia tiền phụ của
// một NCC cho doanh thu cả quán ra một con số không nói lên gì. Gợi ý dưới tiêu đề nói rõ điều đó.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { ChartCard, StackedBarChart, type LineSeries } from '../components/Charts.tsx';
import type { DayRange } from '../lib/date-range.ts';
import { buildSpendChart, luongGon, tienGon } from '../lib/supplier-stats.ts';

type ByKind = {
  daily: Array<{ delivery_date: string; main: number; secondary: number; resale?: number }>;
  total_main: number;
  total_secondary: number;
  /** Hàng bán nguyên (2026-10-28). `?` vì bản API cũ chưa trả trường này. */
  total_resale?: number;
  revenue: number;
  secondary_pct_of_revenue: number | null;
  top_secondary: Array<{ ingredient_id: string; ingredient_name: string; unit: string; qty_base: number; amount: number }>;
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
// Cùng hai màu với nhãn Chính / Phụ (`.ing-kind--*` trong styles.css) — nhìn nhãn ở danh mục là
// biết cột nào trên biểu đồ.
const MAU_CHINH = '#059669';
const MAU_PHU = '#ea580c';
const MAU_BAN = '#7c3aed';

export function SupplierKindStatsCard({ range }: { range: DayRange }) {
  const toast = useToast();
  const [data, setData] = useState<ByKind | null>(null);

  useEffect(() => {
    let huy = false;
    setData(null);
    api
      .get<{ data: ByKind }>('/supplier-reports/by-kind', {
        params: { from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => !huy && setData(r.data.data))
      .catch((err) => {
        if (huy) return;
        toast.push('error', extractError(err).message);
        setData({ daily: [], total_main: 0, total_secondary: 0, total_resale: 0, revenue: 0, secondary_pct_of_revenue: null, top_secondary: [] });
      });
    return () => {
      huy = true;
    };
  }, [range.from, range.to, toast]);

  // Dùng lại `buildSpendChart` (vốn vẽ mỗi NCC một chuỗi) với hai "NCC" giả là Chính và Phụ: trục
  // ngang và cách gộp ngày/tuần/tháng nhờ vậy GIỐNG HỆT các biểu đồ khác của tab, đọc chéo được.
  const chart = useMemo(() => {
    const rows = (data?.daily ?? []).flatMap((d) => [
      { delivery_date: d.delivery_date, supplier_id: 'chinh', supplier_name: 'Nguyên liệu chính', amount: d.main, deliveries: 0 },
      { delivery_date: d.delivery_date, supplier_id: 'phu', supplier_name: 'Nguyên liệu phụ', amount: d.secondary, deliveries: 0 },
      { delivery_date: d.delivery_date, supplier_id: 'ban', supplier_name: 'Hàng bán nguyên', amount: d.resale ?? 0, deliveries: 0 },
    ]);
    return buildSpendChart(rows, { from: range.from, to: range.to });
  }, [data, range.from, range.to]);

  const series: LineSeries[] = useMemo(
    () =>
      // Chính nằm dưới, bán nguyên giữa, phụ chồng trên cùng — phần phụ là thứ đang được hỏi nên
      // để ở đỉnh cột. Kỳ không nhập hàng bán nguyên nào thì bỏ chuỗi đó, khỏi chú thích thừa.
      (['chinh', 'ban', 'phu'] as const).flatMap((id) => {
        const s = chart.series.find((x) => x.supplier_id === id);
        if (!s || (id === 'ban' && !(data?.total_resale ?? 0))) return [];
        const color = id === 'phu' ? MAU_PHU : id === 'ban' ? MAU_BAN : MAU_CHINH;
        return [{ id, name: s.supplier_name, color, values: s.values }];
      }),
    [chart, data],
  );

  if (data === null) return <p style={{ color: C.muted, marginTop: 12 }}>Đang tải nguyên liệu chính / phụ…</p>;

  const chuaDanhDau = data.total_secondary === 0;

  return (
    <div style={{ marginTop: 12 }}>
      <ChartCard
        title="🧂 Nguyên liệu chính / bán nguyên / phụ"
        hint="Tính cho CẢ QUÁN, không theo nhà cung cấp đang lọc. Doanh thu = tiền món đã bán của đơn đã thu, không gồm phí ship."
      >
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
          <So nhan="Nguyên liệu chính" giatri={`${vnd(data.total_main)}đ`} mau={MAU_CHINH} />
          <So nhan="Hàng bán nguyên" giatri={`${vnd(data.total_resale ?? 0)}đ`} mau={MAU_BAN} />
          <So nhan="Nguyên liệu phụ" giatri={`${vnd(data.total_secondary)}đ`} mau={MAU_PHU} />
          <So
            nhan="Phụ / doanh thu"
            giatri={data.secondary_pct_of_revenue === null ? '—' : `${data.secondary_pct_of_revenue.toLocaleString('vi-VN')}%`}
          />
          <So nhan="Doanh thu" giatri={`${vnd(data.revenue)}đ`} />
        </div>

        {chuaDanhDau && (
          <div style={{ background: '#fff7ed', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 14 }}>
            Chưa có khoản nào tính là <strong>nguyên liệu phụ</strong> trong kỳ này. Đánh dấu "Phụ" cho gas,
            hành lá, đá… ở Danh mục nguyên liệu, tab Mặt hàng nhập, hoặc ngay lúc nhập phiếu.
          </div>
        )}

        {series.length === 0 ? (
          <p style={{ color: C.muted, margin: 0 }}>Chưa có phiếu nhập đã duyệt trong kỳ này.</p>
        ) : (
          <StackedBarChart
            labels={chart.labels}
            series={series}
            formatValue={(v) => `${tienGon(v)}đ`}
            ariaLabel={`Tiền nhập nguyên liệu chính, bán nguyên và phụ theo ${chart.labels.length} mốc thời gian`}
          />
        )}

        {data.top_secondary.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>Mặt hàng phụ tốn nhất</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
              <tbody>
                {data.top_secondary.map((r, i) => (
                  <tr key={r.ingredient_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 6px', width: 28, color: C.muted }}>{i + 1}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>{r.ingredient_name}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: C.mutedOnTint }}>
                      {luongGon(r.qty_base, r.unit)}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700 }}>{vnd(r.amount)}đ</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </ChartCard>
    </div>
  );
}

function So({ nhan, giatri, mau }: { nhan: string; giatri: string; mau?: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: C.mutedOnTint }}>{nhan}</div>
      <strong style={{ fontSize: 20, color: mau }}>{giatri}</strong>
    </div>
  );
}
