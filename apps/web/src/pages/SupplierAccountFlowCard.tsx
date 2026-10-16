// Biểu đồ "Tiền vào / tiền ra của một tài khoản" ở tab Thống kê NCC (2026-10-15, chủ quán yêu cầu).
//
// Chủ quán chốt:
//  - VÀO = tiền khách chuyển khoản vào mã QR đó (cùng số màn Lịch sử); đơn nợ trả sau tính ngày
//    trả nợ. RA = các lần trả NCC bằng CK đã chọn tài khoản đó. KHÔNG phải sao kê ngân hàng —
//    xem đầu `apps/api/src/modules/suppliers/account-flow.ts`.
//  - Xem MỘT tài khoản một lúc, chọn bằng nút to. Chỉ mã QR đang bật và có số tài khoản.
//  - Cột vào/ra theo NGÀY LỊCH + ba ô tổng. Dùng CHUNG kỳ với cả tab.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { ChartCard, GroupedBarChart, type LineSeries } from '../components/Charts.tsx';
import { tienGon } from '../lib/supplier-stats.ts';
import { buildAccountFlowChart, type AccountFlowRow } from '../lib/ck-ncc.ts';
import type { DayRange } from '../lib/date-range.ts';

const vnd = (n: number) => n.toLocaleString('vi-VN');
const XANH = '#059669';
const DO = '#dc2626';

type TaiKhoan = { id: string; label: string; bank_name: string | null; account_no: string | null; is_hkd: boolean };

type Data = { accounts: TaiKhoan[]; account_id: string | null; items: AccountFlowRow[] };

export function SupplierAccountFlowCard({ range }: { range: DayRange }) {
  // `null` = để server chọn tài khoản đầu tiên; sau lần tải đầu thì giữ tài khoản người dùng bấm.
  const [chon, setChon] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    let huy = false;
    setData(null);
    setLoi(null);
    api
      .get<{ data: Data }>('/supplier-reports/account-flow', {
        params: { account_id: chon ?? undefined, from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => {
        if (!huy) setData(r.data.data);
      })
      // Lỗi chỉ hiện TRONG thẻ này, không bật toast: đây là một khối phụ của tab, hỏng nó thì các
      // biểu đồ khác vẫn phải dùng được — cùng lệ với doanh thu ở biểu đồ nợ.
      .catch((err) => {
        if (!huy) setLoi(extractError(err).message);
      });
    return () => {
      huy = true;
    };
  }, [chon, range.from, range.to]);

  const chart = useMemo(() => buildAccountFlowChart(data?.items ?? [], range), [data, range]);
  const series = useMemo<LineSeries[]>(
    () => [
      { id: 'vao', name: 'Tiền vào (khách CK)', color: XANH, values: chart.vao },
      { id: 'ra', name: 'Tiền ra (trả NCC)', color: DO, values: chart.ra },
    ],
    [chart],
  );
  const dangXem = data?.accounts.find((a) => a.id === data.account_id);
  const chenh = chart.tongVao - chart.tongRa;

  return (
    <ChartCard
      title="🏧 Tiền vào / tiền ra theo tài khoản"
      hint={
        'Xanh: tiền khách chuyển khoản vào mã QR này (cùng số màn Lịch sử). Đỏ: tiền trả nhà cung cấp ' +
        'bằng chuyển khoản từ tài khoản này. KHÔNG gồm các khoản chi khác (lương, điện…).' +
        (chart.bucket === 'week' ? ' Kỳ dài nên mỗi cột là một TUẦN.' : chart.bucket === 'month' ? ' Kỳ rất dài nên mỗi cột là một THÁNG.' : '')
      }
    >
      {loi ? (
        <p style={{ color: C.danger, margin: 0 }}>{loi}</p>
      ) : data === null ? (
        <p style={{ color: C.muted, margin: 0 }}>Đang tải…</p>
      ) : data.accounts.length === 0 ? (
        <p style={{ color: C.muted, margin: 0 }}>
          Chưa có mã QR nào đang bật mà có số tài khoản. Thêm ở Cài đặt → QR thanh toán.
        </p>
      ) : (
        <>
          <div role="group" aria-label="Chọn tài khoản" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.accounts.map((a) => {
              const bat = a.id === data.account_id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={bat}
                  onClick={() => setChon(a.id)}
                  style={{
                    minHeight: 52,
                    padding: '6px 14px',
                    borderRadius: 10,
                    border: `2px solid ${bat ? C.accent : C.border}`,
                    background: bat ? C.accentSoft : '#fff',
                    color: C.text,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>
                    {bat && '✓ '}
                    {a.label}
                    {a.is_hkd && <span style={{ marginLeft: 6, fontSize: 12, color: C.muted }}>(HKD)</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: 13, color: C.muted }}>
                    {[a.bank_name, a.account_no].filter(Boolean).join(' · ')}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <O nhan="Tổng vào" giatri={`${vnd(chart.tongVao)}đ`} mau={XANH} />
            <O nhan="Tổng ra (trả NCC)" giatri={`${vnd(chart.tongRa)}đ`} mau={DO} />
            <O nhan="Chênh lệch" giatri={`${chenh >= 0 ? '+' : '−'}${vnd(Math.abs(chenh))}đ`} mau={chenh >= 0 ? XANH : DO} />
          </div>

          {chart.labels.length === 0 ? (
            <p style={{ color: C.muted, margin: 0 }}>
              {dangXem?.label ?? 'Tài khoản này'} không có tiền vào hay ra trong kỳ này.
            </p>
          ) : (
            <GroupedBarChart
              labels={chart.labels}
              series={series}
              formatValue={(v) => `${tienGon(v)}đ`}
              ariaLabel={`Tiền vào và tiền ra của tài khoản ${dangXem?.label ?? ''} qua ${chart.labels.length} mốc thời gian`}
            />
          )}
        </>
      )}
    </ChartCard>
  );
}

function O({ nhan, giatri, mau }: { nhan: string; giatri: string; mau: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: C.mutedOnTint }}>{nhan}</div>
      <strong style={{ fontSize: 22, color: mau }}>{giatri}</strong>
    </div>
  );
}
