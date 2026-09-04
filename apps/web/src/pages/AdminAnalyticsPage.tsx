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
  };
  by_day: Array<{
    day: string;
    sessions: number;
    page_views: number;
    visitors: number;
    orders: number;
  }>;
  by_hour: Array<{ hour: number; sessions: number }>;
  top_paths: Array<{ path: string; views: number }>;
  active_now: number;
  /** Từng lần chia sẻ vị trí HỎNG, mới nhất trước (2026-09-04). Tối đa 30 dòng, xem
   *  `GEO_FAILURES_LIMIT` phía BE. */
  geo_failures: Array<{
    at_ms: number;
    outcome: string;
    code: number | null;
    message: string | null;
    elapsed_ms: number;
    device: string;
    browser: string;
    page: string;
    secure: boolean;
  }>;
  /** Bộ đếm nút "Chia sẻ vị trí" ở trang khách (2026-08-30) — xem `geo_share_daily` phía BE. */
  geo_share: {
    ok: number;
    failed: number;
    total: number;
    /** `null` = chưa có lượt bấm nào. KHÁC 0% (có bấm, không lượt nào hỏng). */
    failed_pct: number | null;
    by_outcome: Array<{ outcome: string; hits: number }>;
  };
  collecting: boolean;
};

/**
 * Nhãn tiếng Việt cho từng kiểu hỏng. Mỗi kiểu dẫn tới một việc PHẢI LÀM khác hẳn nhau, nên
 * không gộp: 'denied' là khách phải mở quyền trong Cài đặt máy, 'timeout' là sóng/GPS yếu (chờ
 * thêm là xong), còn 'unsupported' là khách đang mở link trong WebView Zalo/Facebook — ba việc
 * không liên quan gì tới nhau.
 */
const GEO_OUTCOME_LABEL: Record<string, string> = {
  ok: 'Chia sẻ được',
  denied: 'Máy chặn quyền vị trí',
  timeout: 'Lấy quá lâu (sóng/GPS yếu)',
  unavailable: 'Máy không bắt được tín hiệu',
  unsupported: 'Trình duyệt trong app chặn (Zalo/Facebook)',
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

/** `GET /admin/analytics/carts` — ẢNH CHỤP "ngay lúc này", KHÔNG theo khoảng ngày như 2 type
 *  trên (giỏ hàng chỉ có trạng thái hiện tại, bảng ghi đè mỗi ping). Vì thế nó không dùng
 *  `days` và không tải lại khi người dùng đổi khoảng ngày. */
type CartData = {
  fresh_hours: number;
  carts_with_items: number;
  items_total: number;
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

/**
 * Nhãn trình duyệt cho bảng "Lần hỏng gần đây". 3 nhãn đầu là WEBVIEW TRONG APP — tách riêng
 * khỏi trình duyệt thật vì đó là nghi phạm số một của "chia sẻ vị trí cái được cái không":
 * WebView có tầng quyền riêng của app, khách cho quyền Safari không có nghĩa là Zalo được phép.
 */
const BROWSER_LABEL: Record<string, string> = {
  zalo: 'Zalo (app)',
  facebook: 'Facebook (app)',
  instagram: 'Instagram (app)',
  safari: 'Safari',
  chrome: 'Chrome',
  firefox: 'Firefox',
  edge: 'Edge',
  samsung: 'Samsung Internet',
  other: 'Khác',
};

function fmtInt(n: number): string {
  return n.toLocaleString('vi-VN');
}

/**
 * Thời gian chờ của một lần bấm chia sẻ vị trí. Giữ đơn vị ms khi dưới 1 giây thay vì làm tròn
 * thành "0s": chênh lệch giữa 80ms và 900ms chính là thứ phân biệt "quyền đã bị nhớ Deny, máy
 * từ chối tức thì" với "máy có hỏi rồi mới hỏng".
 */
function fmtElapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
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
  const [carts, setCarts] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (d: number) => {
      setLoading(true);
      try {
        // 3 endpoint độc lập → gọi song song, đừng để người dùng chờ cộng dồn.
        // `carts` KHÔNG nhận `days` (ảnh chụp hiện tại) nhưng vẫn tải lại cùng nhịp: người
        // bấm "↻" muốn mọi con số trên màn tươi lại, không phải hai phần lệch tuổi nhau.
        const [t, c, k] = await Promise.all([
          api.get<{ data: TrafficData }>(`/admin/analytics/traffic?days=${d}`),
          api.get<{ data: CustomerData }>(`/admin/analytics/customers?days=${d}`),
          api.get<{ data: CartData }>('/admin/analytics/carts'),
        ]);
        setTraffic(t.data.data);
        setCustomers(c.data.data);
        setCarts(k.data.data);
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
              label="Đơn online"
              value={fmtInt(customers?.orders_in_range ?? 0)}
              hint={
                traffic.totals.sessions > 0
                  ? `Tỉ lệ đặt đơn ${Math.round(((customers?.orders_in_range ?? 0) / traffic.totals.sessions) * 100)}% số lượt vào`
                  : undefined
              }
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

          <Panel title="Khách chia sẻ vị trí">
            {traffic.geo_share.total === 0 ? (
              <p style={empty}>Chưa có lượt bấm "Chia sẻ vị trí" nào trong khoảng này.</p>
            ) : (
              <>
                <p style={{ margin: '0 0 4px', fontSize: 14 }}>
                  {fmtInt(traffic.geo_share.total)} lượt bấm ·{' '}
                  <strong
                    style={{
                      // Ngưỡng 20%: dưới mức đó là nền nhiễu bình thường (khách bấm nhầm, đi
                      // thang máy, để máy trong túi). Trên mức đó là có thứ hỏng có hệ thống và
                      // đáng đi tìm — tô đỏ để mắt dừng lại đúng lúc cần.
                      color: (traffic.geo_share.failed_pct ?? 0) > 20 ? '#dc2626' : INK_MUTED,
                    }}
                  >
                    {fmtInt(traffic.geo_share.failed)} lượt hỏng ({traffic.geo_share.failed_pct}%)
                  </strong>
                </p>

                {/* Đếm gộp theo kiểu hỏng — cần bên cạnh bảng bên dưới vì bảng chỉ giữ 30 lần
                    gần nhất, còn dòng này tính trên TOÀN khoảng đang xem. */}
                <p style={{ ...empty, marginBottom: 14 }}>
                  {traffic.geo_share.by_outcome
                    .filter((o) => o.outcome !== 'ok')
                    .map((o) => `${GEO_OUTCOME_LABEL[o.outcome] ?? o.outcome}: ${o.hits}`)
                    .join(' · ') || 'Không có lượt nào hỏng.'}
                </p>

                {traffic.geo_failures.length === 0 ? (
                  <p style={empty}>
                    Không có lần hỏng nào được ghi chi tiết trong khoảng này.
                  </p>
                ) : (
                  <>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: INK }}>
                      {traffic.geo_failures.length} lần hỏng gần đây nhất
                    </h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: INK_MUTED }}>
                            <th style={th}>Lúc</th>
                            <th style={th}>Khách vào bằng gì</th>
                            <th style={th}>Lỗi</th>
                            <th style={{ ...th, textAlign: 'right' }}>Chờ</th>
                            <th style={th}>Trang</th>
                          </tr>
                        </thead>
                        <tbody>
                          {traffic.geo_failures.map((f) => (
                            <tr
                              key={`${f.at_ms}-${f.page}-${f.outcome}`}
                              style={{ borderTop: `1px solid ${GRID}` }}
                            >
                              <td style={{ ...td, color: INK_MUTED, whiteSpace: 'nowrap' }}>
                                {new Date(f.at_ms).toLocaleString('vi-VN', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                {DEVICE_LABEL[f.device] ?? f.device}
                                <span style={{ color: INK_MUTED }}>
                                  {' · '}
                                  {BROWSER_LABEL[f.browser] ?? f.browser}
                                </span>
                              </td>
                              <td style={td}>
                                {GEO_OUTCOME_LABEL[f.outcome] ?? f.outcome}
                                {/* Chuỗi lỗi THÔ của trình duyệt — không diễn dịch. Trên iOS đây
                                    là thứ phân biệt được hai ca cùng `outcome` nhưng khác hẳn
                                    nguyên nhân (vd "kCLErrorDomain error 0"). */}
                                {f.message && (
                                  <div
                                    style={{
                                      color: INK_MUTED,
                                      fontSize: 11,
                                      fontFamily: 'ui-monospace, monospace',
                                      marginTop: 2,
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {f.code !== null && `[${f.code}] `}
                                    {f.message}
                                  </div>
                                )}
                                {!f.secure && (
                                  <div style={{ color: '#dc2626', fontSize: 11, marginTop: 2 }}>
                                    ⚠ Trang mở KHÔNG qua HTTPS — trình duyệt chặn định vị
                                  </div>
                                )}
                              </td>
                              <td
                                style={{
                                  ...td,
                                  textAlign: 'right',
                                  whiteSpace: 'nowrap',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {fmtElapsed(f.elapsed_ms)}
                              </td>
                              <td style={{ ...td, color: INK_MUTED }}>{f.page}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ ...empty, marginTop: 10 }}>
                      Chỉ ghi lần HỎNG, giữ 14 ngày. Không lưu IP, toạ độ hay danh tính khách —
                      "Khách vào bằng gì" suy ra từ User-Agent.
                    </p>
                  </>
                )}
              </>
            )}
          </Panel>
        </>
      )}

      {carts && (
        <>
          <h2 style={{ marginTop: 28 }}>Giỏ hàng đang treo</h2>
          <p style={{ color: INK_MUTED, fontSize: 13, margin: '0 0 12px' }}>
            Khách đã chọn món nhưng CHƯA bấm đặt. Tính các giỏ còn hoạt động trong{' '}
            {carts.fresh_hours} giờ gần nhất — giỏ trên máy khách tự hết hạn sau 24 giờ.
          </p>
          <div style={tileGrid}>
            <Tile
              label="Giỏ đang có món"
              value={fmtInt(carts.carts_with_items)}
              hint="Đếm theo máy khách (mỗi máy 1 giỏ)"
            />
            <Tile
              label="Tổng số món trong các giỏ đó"
              value={fmtInt(carts.items_total)}
            />
          </div>

          <p style={{ ...empty, marginTop: 12 }}>
            Số món do máy khách tự báo kèm lượt truy cập, KHÔNG phải đơn hàng — chỉ dùng để
            biết còn bao nhiêu khách đang lửng lơ. Mọi con số về đơn và doanh thu vẫn lấy từ
            đơn thật.
          </p>
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
            Ghi chú: số liệu truy cập gửi về theo lô 10 giây và giữ 90 ngày (riêng chi tiết lần
            chia sẻ vị trí hỏng giữ 14 ngày), nên con số vài giây gần nhất có thể chưa hiện. Web KHÔNG dùng Google Analytics hay script theo dõi bên
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
              title={`${r.day}\n${r.sessions} lượt vào · ${r.visitors} thiết bị · ${r.page_views} lượt xem trang\n${r.orders} đơn online`}
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
