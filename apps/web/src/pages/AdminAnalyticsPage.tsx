// Màn "Truy cập & khách hàng" (2026-08-05, Task.md: "Màn quản lý traffic vào trang web, user,
// số điện thoại các thứ").
//
// ĐƯỜNG VÀO CHÍNH là tab "📈 Thống kê" của màn Đơn hàng online (`?view=stats`) — vì "Online" là
// mục CÓ trong nav dưới, còn `/dashboard` thì KHÔNG: nav admin có 7 mục và không mục nào trỏ về
// dashboard, link duy nhất tới nó nằm trong trang 404. Bản đầu của màn này chỉ có thẻ ở Dashboard
// làm đường vào, nghĩa là không bấm tới được — chỉ gõ tay URL mới vào. Đừng bỏ tab đó đi.
//
// Vì vậy file này export 2 thứ:
//   - `AdminAnalyticsPanel` — nội dung, không bọc container/h1, để nhúng vào tab.
//   - `AdminAnalyticsPage`  — bọc container + h1 cho route `/admin/analytics`, giữ vì thẻ ở
//     Dashboard và bookmark đang trỏ vào URL đó.
//
// KHÔNG polling: dữ liệu tải khi mở trang / đổi khoảng ngày / bấm "Tải lại". Hai endpoint phía
// sau chạy ~10 câu gộp mỗi lần gọi — biến màn này thành polling 2s như màn bếp là tự tạo tải
// nền vô ích trên chính con VPS đang phục vụ khách.
//
// Biểu đồ vẽ bằng div + CSS, KHÔNG thêm thư viện chart: app quản lý hiện không có dependency
// biểu đồ nào (package.json), thêm một cái vào chỉ để vẽ 4 dãy cột là đổi ~50-150KB bundle lấy
// thứ 60 dòng CSS làm được.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

type TrafficData = {
  range: { days: number; from_day: string; to_day: string };
  totals: {
    sessions: number;
    page_views: number;
    visitors: number;
    avg_duration_sec: number;
    bounce_rate: number;
    bot_sessions: number;
    phones_seen: number;
  };
  by_day: Array<{
    day: string;
    sessions: number;
    page_views: number;
    visitors: number;
    avg_duration_sec: number;
    orders: number;
  }>;
  by_hour: Array<{ hour: number; sessions: number }>;
  by_device: Array<{ device: string; sessions: number }>;
  duration_buckets: Array<{ label: string; sessions: number }>;
  top_paths: Array<{ path: string; views: number }>;
  top_referrers: Array<{ host: string; sessions: number }>;
  active_now: number;
  collecting: boolean;
};

type CustomerData = {
  range: { days: number; from_day: string; to_day: string };
  phones_total_ever: number;
  phones_in_range: number;
  phones_new_in_range: number;
  phones_repeat_ever: number;
  phones_from_staff_orders: number;
  orders_in_range: number;
  orders_by_status: Array<{ status: string; count: number }>;
  top_phones: Array<{
    phone: string;
    name: string;
    orders: number;
    subtotal_sum: number;
    last_order_ms: number;
  }>;
};

// 2 màu cho 2 chuỗi số của biểu đồ theo ngày (lượt vào / đơn hàng). Cặp này đã qua validator
// palette (tách được với cả 3 dạng mù màu ở nền sáng) — đổi màu thì phải chạy lại, đừng chọn
// bằng mắt. Mọi biểu đồ 1 chuỗi khác trong file dùng CHUNG một màu xanh: một chuỗi thì màu
// không mang thông tin gì, đổi hue chỉ làm người đọc tưởng là ý nghĩa khác.
const C_SESSION = '#2563eb';
const C_ORDER = '#d97706';
const INK = '#374151';
const INK_MUTED = '#6b7280';
const GRID = '#e5e7eb';

const RANGES = [
  { days: 1, label: 'Hôm nay' },
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
];

const DEVICE_LABEL: Record<string, string> = {
  mobile: '📱 Điện thoại',
  tablet: '📟 Tablet',
  desktop: '💻 Máy tính',
  bot: '🤖 Bot / máy quét',
};

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Đang chờ duyệt',
  CONFIRMED: 'Đã xác nhận',
  REJECTED: 'Bị từ chối',
  CANCELLED_BY_CUSTOMER: 'Khách tự huỷ',
  CANCELLED_BY_STAFF: 'Quán huỷ',
};

function fmtInt(n: number): string {
  return n.toLocaleString('vi-VN');
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} giây`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} phút` : `${m} phút ${s} giây`;
}

function fmtMoney(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

function fmtDayShort(day: string): string {
  // '2026-08-05' → '5/8'
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** Route `/admin/analytics` — chỉ bọc khung; nội dung ở `AdminAnalyticsPanel`. */
export function AdminAnalyticsPage() {
  return (
    <div className="container wide with-bottom-nav">
      <h1 style={{ margin: '0 0 12px' }}>Truy cập &amp; khách hàng</h1>
      <AdminAnalyticsPanel />
    </div>
  );
}

export function AdminAnalyticsPanel() {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [customers, setCustomers] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (d: number) => {
      setLoading(true);
      try {
        // 2 endpoint độc lập → gọi song song, đừng để người dùng chờ cộng dồn.
        const [t, c] = await Promise.all([
          api.get<{ data: TrafficData }>(`/admin/analytics/traffic?days=${d}`),
          api.get<{ data: CustomerData }>(`/admin/analytics/customers?days=${d}`),
        ]);
        setTraffic(t.data.data);
        setCustomers(c.data.data);
      } catch (err) {
        toast.push('error', extractError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <>
      {/* Hàng chọn khoảng ngày. KHÔNG có <h1> ở đây: khi nhúng vào tab, tiêu đề đã là "Đơn hàng
          online" + nhãn tab — thêm một h1 nữa là 2 tiêu đề chồng nhau trên cùng màn hình. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {RANGES.map((r) => (
          <button
            key={r.days}
            className={r.days === days ? '' : 'secondary'}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </button>
        ))}
        <button className="secondary" onClick={() => load(days)} title="Tải lại số liệu">
          ↻
        </button>
      </div>

      {traffic && (
        <p style={{ color: INK_MUTED, fontSize: 13, margin: '0 0 12px' }}>
          {traffic.range.from_day === traffic.range.to_day
            ? `Ngày ${traffic.range.from_day}`
            : `Từ ${traffic.range.from_day} đến ${traffic.range.to_day}`}
          {' · '}
          <strong style={{ color: traffic.active_now > 0 ? '#059669' : INK_MUTED }}>
            {traffic.active_now > 0
              ? `🟢 ${traffic.active_now} khách đang xem web`
              : 'Chưa có ai đang xem web'}
          </strong>
          {!traffic.collecting && ' · ⚠ Đang TẮT thu thập (ANALYTICS_ENABLED=false)'}
        </p>
      )}

      {loading && !traffic && (
        <p style={{ textAlign: 'center', color: INK_MUTED }}>
          <span className="spinner" /> Đang tải số liệu...
        </p>
      )}

      {traffic && (
        <>
          <div style={tileGrid}>
            <Tile
              label="Lượt vào web"
              value={fmtInt(traffic.totals.sessions)}
              hint="Mỗi lần khách mở web là 1 lượt (đóng tab là hết lượt)"
            />
            <Tile
              label="Thiết bị khác nhau"
              value={fmtInt(traffic.totals.visitors)}
              hint="Đếm theo IP đã mã hoá — cùng wifi có thể tính là 1"
            />
            <Tile label="Lượt xem trang" value={fmtInt(traffic.totals.page_views)} />
            <Tile
              label="Ở lại trung bình"
              value={fmtDuration(traffic.totals.avg_duration_sec)}
              hint="Từ lúc mở web đến lần cuối còn thấy hoạt động"
            />
            <Tile
              label="Vào rồi đi ngay"
              value={`${traffic.totals.bounce_rate}%`}
              hint="Chỉ xem 1 trang và dưới 10 giây"
            />
            <Tile
              label="Đơn online"
              value={fmtInt(customers?.orders_in_range ?? 0)}
              hint={
                traffic.totals.sessions > 0
                  ? `Tỉ lệ đặt đơn ${Math.round(((customers?.orders_in_range ?? 0) / traffic.totals.sessions) * 100)}% số lượt vào`
                  : undefined
              }
            />
            <Tile
              label="Bot / máy quét"
              value={fmtInt(traffic.totals.bot_sessions)}
              hint="Đã tách khỏi mọi con số khách ở trên"
            />
          </div>

          <Panel title="Lượt vào web theo ngày">
            <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 13, color: INK }}>
              <Legend color={C_SESSION} label="Lượt vào" />
              <Legend color={C_ORDER} label="Đơn online" />
            </div>
            <DayChart rows={traffic.by_day} />
          </Panel>

          <div style={twoCol}>
            <Panel title="Giờ nào đông khách">
              <HourChart rows={traffic.by_hour} />
            </Panel>
            <Panel title="Khách ở lại bao lâu">
              <RowBars
                rows={traffic.duration_buckets.map((b) => ({
                  key: b.label,
                  label: b.label,
                  value: b.sessions,
                }))}
                unit="lượt"
              />
            </Panel>
          </div>

          <div style={twoCol}>
            <Panel title="Khách vào bằng thiết bị gì">
              <RowBars
                rows={traffic.by_device.map((d) => ({
                  key: d.device,
                  label: DEVICE_LABEL[d.device] ?? d.device,
                  value: d.sessions,
                }))}
                unit="lượt"
              />
            </Panel>
            <Panel title="Trang khách xem nhiều nhất">
              <RowBars
                rows={traffic.top_paths.map((p) => ({
                  key: p.path,
                  label: p.path,
                  value: p.views,
                }))}
                unit="lượt xem"
                empty="Chưa có dữ liệu."
              />
            </Panel>
          </div>

          <Panel title="Khách đến từ đâu">
            {traffic.top_referrers.length === 0 ? (
              <p style={empty}>
                Chưa ghi nhận nguồn nào — nghĩa là khách gõ địa chỉ / quét QR / bấm link trong
                app nhắn tin (những nguồn đó không để lại dấu).
              </p>
            ) : (
              <RowBars
                rows={traffic.top_referrers.map((r) => ({
                  key: r.host,
                  label: r.host,
                  value: r.sessions,
                }))}
                unit="lượt"
              />
            )}
          </Panel>
        </>
      )}

      {customers && (
        <>
          <h2 style={{ marginTop: 28 }}>Số điện thoại khách</h2>
          <div style={tileGrid}>
            <Tile
              label="SĐT từng đặt đơn online"
              value={fmtInt(customers.phones_total_ever)}
              hint="Tính từ khi mở web đến nay, mọi trạng thái đơn"
            />
            <Tile
              label="SĐT đặt trong kỳ"
              value={fmtInt(customers.phones_in_range)}
              hint={`Trong ${customers.range.days} ngày đang xem`}
            />
            <Tile
              label="Khách mới"
              value={fmtInt(customers.phones_new_in_range)}
              hint="SĐT có đơn ĐẦU TIÊN trong kỳ"
            />
            <Tile
              label="Khách quay lại"
              value={fmtInt(customers.phones_repeat_ever)}
              hint="SĐT đã đặt từ 2 đơn trở lên"
            />
            <Tile
              label="SĐT nhân viên nhập tay"
              value={fmtInt(customers.phones_from_staff_orders)}
              hint="Đơn tại quán/ship do nhân viên tạo — số riêng, không cộng vào số online"
            />
          </div>

          <Panel title={`Đơn online trong ${customers.range.days} ngày, theo trạng thái`}>
            <RowBars
              rows={customers.orders_by_status.map((s) => ({
                key: s.status,
                label: STATUS_LABEL[s.status] ?? s.status,
                value: s.count,
              }))}
              unit="đơn"
              empty="Chưa có đơn nào trong kỳ."
            />
          </Panel>

          <Panel title="Khách đặt nhiều nhất (mọi thời điểm)">
            {customers.top_phones.length === 0 ? (
              <p style={empty}>Chưa có khách nào đặt đơn online.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: INK_MUTED }}>
                      <th style={th}>SĐT</th>
                      <th style={th}>Tên</th>
                      <th style={{ ...th, textAlign: 'right' }}>Số đơn</th>
                      <th style={{ ...th, textAlign: 'right' }}>Tổng tiền đã đặt</th>
                      <th style={th}>Đơn gần nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.top_phones.map((p) => (
                      <tr key={p.phone} style={{ borderTop: `1px solid ${GRID}` }}>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                          <a href={`tel:${p.phone}`} style={{ color: C_SESSION }}>
                            {p.phone}
                          </a>
                        </td>
                        <td style={td}>{p.name || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtInt(p.orders)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(p.subtotal_sum)}</td>
                        <td style={{ ...td, color: INK_MUTED }}>
                          {new Date(p.last_order_ms).toLocaleString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <p style={{ ...empty, marginTop: 20 }}>
            Ghi chú: số liệu truy cập gửi về theo lô 10 giây và giữ 90 ngày, nên con số vài giây
            gần nhất có thể chưa hiện. Web KHÔNG dùng Google Analytics hay script theo dõi bên
            ngoài — chỉ đếm trên máy chủ của quán, không lưu IP thật (chỉ lưu bản mã hoá) và
            không lưu địa chỉ trang khách đến từ đâu ngoài tên miền.
          </p>
        </>
      )}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: INK_MUTED, fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: INK, lineHeight: 1.2, marginTop: 2 }}>
        {value}
      </div>
      {hint && <div style={{ color: INK_MUTED, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: INK }}>{title}</h3>
      {children}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

/** 2 cột cạnh nhau mỗi ngày (lượt vào / đơn). `title` trên từng cột là tooltip — đủ cho nhu
 *  cầu "liếc xem ngày đó bao nhiêu" mà không cần dựng lớp hover riêng. */
function DayChart({ rows }: { rows: TrafficData['by_day'] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.sessions, r.orders)));
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, minWidth: 320 }}>
        {rows.map((r) => (
          <div key={r.day} style={{ flex: '1 1 0', minWidth: 26, textAlign: 'center' }}>
            <div
              style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 130 }}
              title={`${r.day}\n${r.sessions} lượt vào · ${r.visitors} thiết bị · ${r.page_views} lượt xem trang\nở lại TB ${fmtDuration(r.avg_duration_sec)} · ${r.orders} đơn`}
            >
              <Bar value={r.sessions} max={max} color={C_SESSION} />
              <Bar value={r.orders} max={max} color={C_ORDER} />
            </div>
            <div style={{ fontSize: 10, color: INK_MUTED, marginTop: 4 }}>{fmtDayShort(r.day)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const h = value === 0 ? 2 : Math.max(3, Math.round((value / max) * 130));
  return (
    <div
      style={{
        flex: 1,
        height: h,
        background: value === 0 ? GRID : color,
        // Bo 4px đầu trên, chân cột dính đáy — không bo cả 4 góc (cột không "bay").
        borderRadius: '4px 4px 0 0',
      }}
    />
  );
}

function HourChart({ rows }: { rows: TrafficData['by_hour'] }) {
  const max = Math.max(1, ...rows.map((r) => r.sessions));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110 }}>
      {rows.map((r) => (
        <div key={r.hour} style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{ height: 84, display: 'flex', alignItems: 'flex-end' }}
            title={`${r.hour}h – ${r.hour + 1}h: ${r.sessions} lượt`}
          >
            <Bar value={r.sessions} max={max} color={C_SESSION} />
          </div>
          {/* Chỉ ghi nhãn 4 tiếng một lần — 24 nhãn cạnh nhau trên điện thoại là chồng chữ. */}
          <div style={{ fontSize: 9, color: INK_MUTED, marginTop: 3, height: 12 }}>
            {r.hour % 4 === 0 ? `${r.hour}h` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cột ngang + số ở cuối — dạng đọc nhanh nhất cho danh sách nhãn dài (đường dẫn, tên miền). */
function RowBars({
  rows,
  unit,
  empty: emptyText,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  unit: string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 1 && rows.every((r) => r.value === 0)) {
    return <p style={empty}>{emptyText ?? 'Chưa có dữ liệu.'}</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: INK,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={r.label}
            >
              {r.label}
            </div>
            <div style={{ background: GRID, borderRadius: 4, height: 8, marginTop: 3 }}>
              <div
                style={{
                  width: `${Math.max(2, Math.round((r.value / max) * 100))}%`,
                  height: 8,
                  background: C_SESSION,
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
          <div style={{ fontSize: 13, color: INK, whiteSpace: 'nowrap', alignSelf: 'center' }}>
            {fmtInt(r.value)} <span style={{ color: INK_MUTED, fontSize: 11 }}>{unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const tileGrid: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
};

const twoCol: CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  alignItems: 'start',
};

const th: CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '8px', color: INK };
const empty: CSSProperties = { color: INK_MUTED, fontSize: 13, margin: 0 };
