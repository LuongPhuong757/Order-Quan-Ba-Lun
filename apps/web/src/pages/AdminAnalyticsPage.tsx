// Màn "Truy cập & khách hàng" (2026-08-05, Task.md: "Màn quản lý traffic vào trang web, user,
// số điện thoại các thứ").
//
// ĐƯỜNG VÀO CHÍNH là tab "Thống kê" của màn Đơn hàng online (`?view=stats`) — vì "Online" là
// mục CÓ trong nav dưới, còn `/dashboard` thì KHÔNG: nav admin có 7 mục và không mục nào trỏ về
// dashboard, link duy nhất tới nó nằm trong trang 404. Bản đầu của màn này chỉ có thẻ ở Dashboard
// làm đường vào, nghĩa là không bấm tới được — chỉ gõ tay URL mới vào. Đừng bỏ tab đó đi.
//
// Vì vậy file này export 2 thứ:
//   - `AdminAnalyticsPanel` — nội dung, không bọc container/h1, để nhúng vào tab.
//   - `AdminAnalyticsPage`  — bọc container + h1 cho route `/admin/analytics`, giữ vì thẻ ở
//     Dashboard và bookmark đang trỏ vào URL đó.
//
// LÀM LẠI 2026-11-11 theo chủ quán: ĐẦU trang là ĐƠN và TIỀN (doanh thu online đã thu, đơn thành
// công, TB/đơn, tỉ lệ từ chối, thời gian duyệt, biểu đồ đơn thành công theo ngày, giờ đông đơn,
// món bán chạy, bảng khách); số liệu TRUY CẬP web (lượt vào, phễu trang, giỏ treo, vị trí) dồn
// hết xuống dưới. Lý do: bản cũ mở đầu bằng "Lượt vào web" và đếm "Đơn online" gồm cả đơn bị từ
// chối — chủ quán đọc ra số đơn đẹp hơn thực tế và không thấy tiền đâu.
//
// KHÔNG polling: dữ liệu tải khi mở trang / đổi khoảng ngày / bấm "Làm mới". Các endpoint phía
// sau chạy ~10 câu gộp mỗi lần gọi — biến màn này thành polling 2s như màn bếp là tự tạo tải
// nền vô ích trên chính con VPS đang phục vụ khách.
//
// ÁP BỘ QUY TẮC `--ds-*` (2026-11-11, chủ quán chốt): 5 cỡ chữ (số lớn 28, tiêu đề vùng 20, tiêu
// đề khối 16, nội dung 15–16, nhãn 13 — không chữ nào <13px), biểu đồ chỉ 3 màu --ds-chart-*,
// trang chia 3 VÙNG có tiêu đề "Kinh doanh" → "Khách hàng" → "Lưu lượng web", thẻ chỉ số có so
// sánh kỳ trước, biểu đồ ít số liệu thì thành một câu tóm tắt.
//
// Biểu đồ vẽ bằng div + CSS grid, KHÔNG thêm thư viện chart: app quản lý hiện không có dependency
// biểu đồ nào (package.json), thêm một cái vào chỉ để vẽ vài dãy cột là đổi ~50-150KB bundle lấy
// thứ vài chục dòng CSS làm được.
import { useCallback, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { PRESET_LABEL, countDays, presetToRange, type TimePreset } from '../lib/time-presets.ts';
import { fmtInt, khoangNgay, ngayGio, nhanKhoang } from '../lib/thong-ke-online.ts';
import { KhachHang, KinhDoanh, LuuLuongWeb, VungTk } from './ThongKeOnlineParts.tsx';
import './thong-ke.css';

type RangeInfo = { days: number; from_day: string; to_day: string };

export type TrafficData = {
  range: RangeInfo;
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

/** `GET /admin/analytics/orders` (2026-11-11) — định nghĩa từng số xem đầu
 *  `apps/api/src/modules/analytics/online-sales-queries.ts`. */
export type Kpis = {
  revenue: number;
  success_count: number;
  placed_count: number;
  rejected_count: number;
  customer_cancelled_count: number;
  rejected_pct: number | null;
  avg_order_value: number;
  avg_review_seconds: number | null;
};

export type OrdersData = {
  range: RangeInfo;
  kpis: Kpis;
  /** Cùng hình dạng `kpis`, cho khoảng cùng độ dài NGAY TRƯỚC khoảng đang xem — để ghi ▲/▼ %. */
  prev_kpis: Kpis;
  by_day: Array<{ day: string; success: number; revenue: number }>;
  by_hour: Array<{ hour: number; success: number }>;
  top_items: Array<{ name: string; qty: number; revenue: number }>;
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

export type CustomerData = {
  range: RangeInfo;
  phones_total_ever: number;
  phones_in_range: number;
  phones_new_in_range: number;
  phones_repeat_ever: number;
  phones_from_staff_orders: number;
  orders_in_range: number;
  orders_by_status: Array<{ status: string; count: number }>;
  /** Trong KHOẢNG đang xem (2026-11-11), không còn "mọi thời điểm". */
  top_phones: Array<{
    phone: string;
    name: string;
    orders: number;
    success: number;
    rejected: number;
    success_money: number;
    last_order_ms: number;
  }>;
};

/** `GET /admin/analytics/carts` — ẢNH CHỤP "ngay lúc này", KHÔNG theo khoảng ngày như các type
 *  trên (giỏ hàng chỉ có trạng thái hiện tại, bảng ghi đè mỗi ping). Vì thế nó không dùng
 *  `days` và không tải lại khi người dùng đổi khoảng ngày. */
export type CartData = {
  fresh_hours: number;
  carts_with_items: number;
  items_total: number;
};

// Màu chữ chỉ 3 sắc của bộ quy tắc chung — đừng thêm xám thứ tư.
const INK = 'var(--ds-ink)';
const INK_MUTED = 'var(--ds-ink-2)';

/**
 * Bộ nút chung (Đợt 0 đồng bộ giao diện, 2026-11-09): thay "Hôm nay / 7 / 30 / 90 ngày" riêng
 * của màn này. API chỉ nhận `?days=N` (N ngày tính lùi, gồm hôm nay) nên chỉ giữ các nút có
 * ĐẦU CUỐI là hôm nay — "Hôm qua"/"Tháng trước" kết thúc trước hôm nay, quy ra `days` sẽ sai.
 * Bỏ "90 ngày" theo bộ chung đã chốt.
 */
const RANGE_PRESETS: readonly TimePreset[] = ['today', '7d', '30d', 'month'];

/** Nút → số ngày gửi API. Tính LÚC tải (không chốt lúc bấm) để "Tháng này" qua nửa đêm vẫn đúng. */
function presetDays(p: TimePreset): number {
  const r = presetToRange(p, Date.now());
  return countDays(r.from, r.to);
}

// Bỏ emoji 📱 📟 💻 🤖 (Đợt 0): chữ đã đủ nghĩa, bộ Icon chung chưa có hình máy tính / bot.
const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Điện thoại',
  tablet: 'Tablet',
  desktop: 'Máy tính',
  bot: 'Bot / máy quét',
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


/**
 * Thời gian chờ của một lần bấm chia sẻ vị trí. Giữ đơn vị ms khi dưới 1 giây thay vì làm tròn
 * thành "0s": chênh lệch giữa 80ms và 900ms chính là thứ phân biệt "quyền đã bị nhớ Deny, máy
 * từ chối tức thì" với "máy có hỏi rồi mới hỏng".
 */
function fmtElapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}



/** Route `/admin/analytics` — chỉ bọc khung; nội dung ở `AdminAnalyticsPanel`. */
export function AdminAnalyticsPage() {
  return (
    <div className="container wide with-bottom-nav ds">
      <h1 style={{ margin: '0 0 12px' }}>Truy cập &amp; khách hàng</h1>
      <AdminAnalyticsPanel />
    </div>
  );
}

export function AdminAnalyticsPanel() {
  const toast = useToast();
  // Mặc định 30 ngày (Đợt 0 chốt cho mọi màn không ca; trước là 7 ngày).
  const [preset, setPreset] = useState<TimePreset>('30d');
  const [orders, setOrders] = useState<OrdersData | null>(null);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [customers, setCustomers] = useState<CustomerData | null>(null);
  const [carts, setCarts] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  // Giờ tải xong lần gần nhất — "cập nhật 14:52" cạnh nút ↻ (không polling, xem đầu file).
  const [capNhat, setCapNhat] = useState<string | null>(null);

  const load = useCallback(
    async (p: TimePreset) => {
      const d = presetDays(p);
      setLoading(true);
      try {
        // 4 endpoint độc lập → gọi song song, đừng để người dùng chờ cộng dồn.
        // `carts` KHÔNG nhận `days` (ảnh chụp hiện tại) nhưng vẫn tải lại cùng nhịp: người
        // bấm "Làm mới" muốn mọi con số trên màn tươi lại, không phải hai phần lệch tuổi nhau.
        const [o, t, c, k] = await Promise.all([
          api.get<{ data: OrdersData }>(`/admin/analytics/orders?days=${d}`),
          api.get<{ data: TrafficData }>(`/admin/analytics/traffic?days=${d}`),
          api.get<{ data: CustomerData }>(`/admin/analytics/customers?days=${d}`),
          api.get<{ data: CartData }>('/admin/analytics/carts'),
        ]);
        setOrders(o.data.data);
        setTraffic(t.data.data);
        setCustomers(c.data.data);
        setCarts(k.data.data);
        setCapNhat(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        toast.push('error', extractError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(preset);
  }, [preset, load]);

  const range = orders?.range ?? traffic?.range ?? null;
  const soNgay = range?.days ?? presetDays(preset);

  return (
    <div className="tk2">
      {/* Đầu tab (bản 2, 2026-11-11): segmented control chọn khoảng + dòng "13/10 – 11/11 · cập
          nhật 14:52 ↻". Chủ quán chọn ↻ NHỎ cạnh dòng ngày thay nút "Làm mới" to đứng riêng góc.
          KHÔNG <h1>: tiêu đề màn đã là "Đơn online" + tab. */}
      <div className="tk2-loc">
        <div className="tk2-seg" role="tablist" aria-label="Chọn khoảng thời gian xem thống kê">
          {RANGE_PRESETS.map((pr) => (
            <button
              key={pr}
              type="button"
              role="tab"
              aria-selected={preset === pr}
              className={preset === pr ? 'is-on' : undefined}
              onClick={() => setPreset(pr)}
            >
              {PRESET_LABEL[pr]}
            </button>
          ))}
        </div>
        {range && (
          <span className="tk2-khoang">
            {khoangNgay(range.from_day, range.to_day)}
            {capNhat && ` · cập nhật ${capNhat}`}
            {traffic && traffic.active_now > 0 && (
              <span className="tk2-dangxem"> · {traffic.active_now} khách đang xem web</span>
            )}
            <button
              type="button"
              className="tk2-lammoi"
              aria-label="Làm mới số liệu"
              onClick={() => load(preset)}
              disabled={loading}
            >
              <Icon name="lam-moi" size={18} />
            </button>
          </span>
        )}
      </div>

      {traffic && !traffic.collecting && (
        <p className="tk2-mo">
          <Icon name="canh-bao" size={16} style={{ verticalAlign: '-3px' }} /> Đang TẮT thu thập lượt vào web
          (ANALYTICS_ENABLED=false)
        </p>
      )}

      {loading && !orders && (
        <p className="tk2-mo" style={{ textAlign: 'center' }}>
          <span className="spinner" /> Đang tải số liệu...
        </p>
      )}

      {/* 3 VÙNG theo thứ tự chủ quán hỏi: tiền & đơn → khách là ai → web có ai vào. */}
      {orders && (
        <VungTk tieuDe="Kinh doanh">
          <KinhDoanh data={orders} traffic={traffic} moDau={nhanKhoang(soNgay)} />
        </VungTk>
      )}
      {customers && (
        <VungTk tieuDe="Khách hàng">
          <KhachHang data={customers} />
        </VungTk>
      )}
      {/* Số liệu truy cập: gửi về theo lô 10 giây, giữ 90 ngày (chi tiết chia sẻ vị trí hỏng giữ
          14 ngày). Không dùng Google Analytics; không lưu IP thật (chỉ bản mã hoá). */}
      {traffic && (
        <VungTk tieuDe="Lưu lượng web">
          <LuuLuongWeb
            traffic={traffic}
            successCount={orders?.kpis.success_count ?? null}
            carts={carts}
            geo={<GeoShareKhoi traffic={traffic} />}
          />
        </VungTk>
      )}
    </div>
  );
}

/** Khối "Khách chia sẻ vị trí" — tách khỏi thân panel cho gọn, nội dung giữ như cũ. */
function GeoShareKhoi({ traffic }: { traffic: TrafficData }) {
  return (
    <Khoi tieuDe="Khách chia sẻ vị trí">
      {traffic.geo_share.total === 0 ? (
        <p style={empty}>Chưa có lượt bấm "Chia sẻ vị trí" nào trong khoảng này.</p>
      ) : (
        <>
          <p style={{ margin: '0 0 4px', fontSize: 'var(--ds-fs-body2)' }}>
            {fmtInt(traffic.geo_share.total)} lượt bấm ·{' '}
            <strong
              style={{
                // Ngưỡng 20%: dưới mức đó là nền nhiễu bình thường (khách bấm nhầm, đi
                // thang máy, để máy trong túi). Trên mức đó là có thứ hỏng có hệ thống và
                // đáng đi tìm — tô đỏ để mắt dừng lại đúng lúc cần.
                color: (traffic.geo_share.failed_pct ?? 0) > 20 ? 'var(--ds-danger)' : INK_MUTED,
              }}
            >
              {fmtInt(traffic.geo_share.failed)} lượt hỏng ({traffic.geo_share.failed_pct}%)
            </strong>
          </p>

          {/* Đếm gộp theo kiểu hỏng — cần bên cạnh bảng bên dưới vì bảng chỉ giữ 30 lần
              gần nhất, còn dòng này tính trên TOÀN khoảng đang xem. */}
          <p style={{ ...empty, marginBottom: 16 }}>
            {traffic.geo_share.by_outcome
              .filter((o) => o.outcome !== 'ok')
              .map((o) => `${GEO_OUTCOME_LABEL[o.outcome] ?? o.outcome}: ${o.hits}`)
              .join(' · ') || 'Không có lượt nào hỏng.'}
          </p>

          {traffic.geo_failures.length === 0 ? (
            <p style={empty}>Không có lần hỏng nào được ghi chi tiết trong khoảng này.</p>
          ) : (
            <>
              <h4 style={{ margin: '0 0 8px', fontSize: 'var(--ds-fs-body2)', color: INK }}>
                {traffic.geo_failures.length} lần hỏng gần đây nhất
              </h4>
              <div className="tk-cuon">
                <table className="tk-bang tk-bang-rong">
                  <thead>
                    <tr>
                      <th>Lúc</th>
                      <th>Khách vào bằng gì</th>
                      <th>Lỗi</th>
                      <th className="so">Chờ</th>
                      <th>Trang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traffic.geo_failures.map((f) => (
                      <tr key={`${f.at_ms}-${f.page}-${f.outcome}`}>
                        <td style={{ color: INK_MUTED, whiteSpace: 'nowrap' }}>{ngayGio(f.at_ms)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {DEVICE_LABEL[f.device] ?? f.device}
                          <span style={{ color: INK_MUTED }}>
                            {' · '}
                            {BROWSER_LABEL[f.browser] ?? f.browser}
                          </span>
                        </td>
                        <td>
                          {GEO_OUTCOME_LABEL[f.outcome] ?? f.outcome}
                          {/* Chuỗi lỗi THÔ của trình duyệt — không diễn dịch. Trên iOS đây
                              là thứ phân biệt được hai ca cùng `outcome` nhưng khác hẳn
                              nguyên nhân (vd "kCLErrorDomain error 0"). */}
                          {f.message && (
                            <div
                              style={{
                                color: INK_MUTED,
                                fontSize: 'var(--ds-fs-label)',
                                fontFamily: 'ui-monospace, monospace',
                                marginTop: 4,
                                wordBreak: 'break-word',
                              }}
                            >
                              {f.code !== null && `[${f.code}] `}
                              {f.message}
                            </div>
                          )}
                          {!f.secure && (
                            <div
                              style={{
                                color: 'var(--ds-danger)',
                                fontSize: 'var(--ds-fs-label)',
                                marginTop: 4,
                              }}
                            >
                              <Icon name="canh-bao" size={14} style={{ verticalAlign: '-2px' }} /> Trang mở KHÔNG qua HTTPS — trình duyệt chặn định vị
                            </div>
                          )}
                        </td>
                        <td className="so">{fmtElapsed(f.elapsed_ms)}</td>
                        <td style={{ color: INK_MUTED }}>{f.page}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ ...empty, marginTop: 8, fontSize: 'var(--ds-fs-label)' }}>
                Chỉ ghi lần HỎNG, giữ 14 ngày. Không lưu IP, toạ độ hay danh tính khách —
                "Khách vào bằng gì" suy ra từ User-Agent.
              </p>
            </>
          )}
        </>
      )}
    </Khoi>
  );
}

// ── Khối dựng dùng chung ───────────────────────────────────────────────────

/** Nút "i" tròn — CHẠM để mở/đóng đoạn giải thích. Không hover, không tooltip. */
function NutI({ mo, onDoi, controls, ten }: { mo: boolean; onDoi: () => void; controls: string; ten: string }) {
  return (
    <button
      type="button"
      className="tk-i"
      aria-expanded={mo}
      aria-controls={controls}
      aria-label={mo ? `Đóng giải thích: ${ten}` : `Giải thích: ${ten}`}
      onClick={onDoi}
    >
      i
    </button>
  );
}

/** Khối nền trắng viền xám bo 12px, tiêu đề 16px + nút "i" (nếu có giải thích). */
function Khoi({
  tieuDe,
  giaiThich,
  children,
}: {
  tieuDe: string;
  giaiThich?: ReactNode;
  children: ReactNode;
}) {
  const [mo, setMo] = useState(false);
  const id = useId();
  return (
    <section className="tk-khoi">
      <div className="tk-tieude">
        <h3>{tieuDe}</h3>
        {giaiThich && <NutI mo={mo} onDoi={() => setMo((v) => !v)} controls={id} ten={tieuDe} />}
      </div>
      {giaiThich && mo && (
        <div id={id} className="tk-giaithich">
          {giaiThich}
        </div>
      )}
      {children}
    </section>
  );
}

const empty: CSSProperties = { color: INK_MUTED, fontSize: 'var(--ds-fs-body2)', margin: 0 };
