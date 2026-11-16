// Sub-tab "Máy in" của khối Cài đặt (2026-09-19).
//
// Vì sao màn này phải có ngay từ vòng đầu chứ không phải làm sau: cầu in sống trên một chiếc
// máy tính bảng đặt ở quầy, không ai mở terminal ra đọc log của nó. Nếu không có chỗ nào nhìn
// thấy "tablet cuối cùng gọi về lúc nào" thì cái ngày nó ngủ quên, hàng đợi chỉ lặng lẽ dài ra
// và người ta phát hiện bằng cách khách hỏi hoá đơn.
//
// Ba khối, xếp theo đúng thứ tự người ta cần khi đi lắp máy: cấu hình máy in → khai thiết bị
// (lấy token dán vào Termux) → nhìn hàng đợi để biết nó có chạy không.
//
// LÀM LẠI GIAO DIỆN 2026-11-13 (Cài đặt đợt 1, chủ quán duyệt bản xem thử): dải tình trạng cầu in
// lên đầu (thay hộp đỏ to), ô tick → công tắc gạt `Switch`, cấu hình thành dòng "tên … ô chọn",
// hàng đợi = tóm tắt + 10 lệnh mới nhất + "Xem thêm" (trước 30 dòng đẩy trang điện thoại dài
// 5.200px). Không đổi logic, không đổi API.
//
// ĐỢT 2 (2026-11-16, bản xem thử "Cài đặt làm lại"): công tắc + ô chọn ĐỔI LÀ LƯU NGAY (bỏ nút Lưu
// chung); chỉ ô IP/cổng/tên quán dùng thanh Lưu dính đáy. "In thử" lên đầu thẻ. Điện thoại: thẻ
// thiết bị cầu in thu thành một hàng (chạm mới mở), hàng đợi chỉ 3 lệnh mới nhất.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import { CdRow, CdSection, SaveBar, useSaveSetting, useServerDraft } from './cai-dat/parts.tsx';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { Link } from 'react-router-dom';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Switch } from '../components/ui/Switch.tsx';
import './cai-dat.css';

type DeviceRow = {
  id: string;
  name: string;
  token: string;
  last_seen_at: number | null;
  last_status: string | null;
  revoked_at: number | null;
  created_at: number;
  created_by_full_name: string | null;
};

type JobRow = {
  id: string;
  order_id: string;
  table_code: string | null;
  fulfillment_type: string | null;
  kind: string;
  reason: string;
  status: string;
  attempts: number;
  last_error: string | null;
  printed_at: number | null;
  created_at: number;
  requested_by_full_name: string | null;
};

type Overview = {
  devices: DeviceRow[];
  counts: { pending: number; failed: number };
  jobs: JobRow[];
};

type PrintSettings = {
  printing_enabled: boolean;
  printer_connection: string;
  printer_host: string;
  printer_port: number;
  printer_paper_width_mm: number;
  printer_darkness: number;
  printer_heat: number;
  printer_auto_cut: boolean;
  store_name: string;
};

/** Tablet im lặng quá lâu = cầu in đã chết. 90 giây là hơn 45 nhịp hỏi (2s/nhịp) — đủ rộng để
 *  một lần rớt Wi-Fi thoáng qua không bị báo động, đủ hẹp để biết trước khi khách phải chờ. */
const DEVICE_STALE_MS = 90_000;

function relativeTime(ms: number | null): string {
  if (!ms) return 'chưa bao giờ';
  const diff = Date.now() - ms;
  if (diff < 10_000) return 'vừa xong';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} giây trước`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return `${Math.floor(diff / 86_400_000)} ngày trước`;
}

function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Màu trạng thái lệnh in (2026-11-13): xanh ngọc = đã in, xám = đang chờ/đang in, cam = hỏng/quá
 *  hạn. Bỏ đỏ — đỏ chỉ dành cho lỗi nhập liệu (bộ quy tắc màu admin). */
const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Đang chờ', cls: 'cd-pill--muted' },
  CLAIMED: { label: 'Đang in', cls: 'cd-pill--muted' },
  DONE: { label: 'Đã in', cls: 'cd-pill--ok' },
  FAILED: { label: 'Hỏng', cls: 'cd-pill--bad' },
  EXPIRED: { label: 'Quá hạn', cls: 'cd-pill--warn' },
};

/** Hàng đợi chỉ hiện chừng này lệnh mới nhất cho tới khi bấm "Xem thêm" — trước đó 30 dòng "Quá
 *  hạn" đẩy trang điện thoại dài 5.200px, phần cấu hình trôi mất. */
const JOB_GON = 10;
/** Điện thoại: chỉ 3 lệnh (chủ quán chọn 2026-11-16) — phần cấu hình mới là thứ người ta mở màn này để sửa. */
const JOB_GON_DT = 3;

/** Đơn ship/mang về ngồi ở một bàn ảo, nên `table_code` của chúng là mã kỹ thuật. Hiện thẳng
 *  ra thì dòng nhật ký đọc là "Bàn delivery" — đúng dữ liệu nhưng vô nghĩa với người đứng quầy. */
function describeJobTarget(j: JobRow): string {
  if (j.fulfillment_type === 'DELIVERY') return 'Giao tận nơi';
  if (j.fulfillment_type === 'PICKUP') return 'Khách tự lấy';
  return `Bàn ${j.table_code ?? '?'}`;
}

export function PrintersPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const isPhone = useIsPhone();
  const saveNow = useSaveSetting();
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [addingDevice, setAddingDevice] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [xemHet, setXemHet] = useState(false);
  const [moThietBi, setMoThietBi] = useState(false);
  // Giữ bản mới nhất trong ref để vòng tự làm mới không phụ thuộc vào state trong closure.
  const mounted = useRef(true);

  // Bản nháp các ô GÕ (IP, cổng, tên quán) — đi qua thanh Lưu. Gọi hook trước mọi `return` sớm.
  const { draft, setDraft, dirty, reset } = useServerDraft({
    printer_host: settings?.printer_host ?? '',
    printer_port: settings?.printer_port ?? 9100,
    store_name: settings?.store_name ?? '',
  });

  const loadOverview = useCallback(async () => {
    const res = await api.get<{ data: Overview }>('/admin/print/overview');
    if (mounted.current) setOverview(res.data.data);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [s] = await Promise.all([
        api.get<{ data: { settings: PrintSettings } }>('/admin/settings'),
        loadOverview(),
      ]);
      if (!mounted.current) return;
      const v = s.data.data.settings;
      setSettings({
        printing_enabled: v.printing_enabled,
        printer_connection: v.printer_connection === 'USB' ? 'USB' : 'LAN',
        printer_host: v.printer_host ?? '',
        printer_port: v.printer_port ?? 9100,
        printer_paper_width_mm: v.printer_paper_width_mm ?? 80,
        printer_darkness: v.printer_darkness ?? 2,
        printer_heat: v.printer_heat ?? 0,
        printer_auto_cut: v.printer_auto_cut,
        store_name: v.store_name ?? '',
      });
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [loadOverview, toast]);

  useEffect(() => {
    mounted.current = true;
    void loadAll();
    // Tự làm mới 5 giây/lần: lúc đang lắp máy, người ta bấm "In thử" rồi nhìn màn hình chờ
    // trạng thái đổi. Bắt họ bấm F5 để biết tờ giấy đã ra chưa là hỏng mất vòng thử-sai.
    const timer = setInterval(() => {
      void loadOverview().catch(() => {});
    }, 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [loadAll, loadOverview]);

  /** Công tắc / ô chọn: đổi trên màn trước, gửi ĐÚNG field đó, hỏng thì trả về. */
  const setNow = async <K extends keyof PrintSettings>(key: K, value: PrintSettings[K], okMsg: string) => {
    if (!settings) return;
    const prev = settings[key];
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    if (!(await saveNow({ [key]: value }, okMsg))) setSettings((s) => (s ? { ...s, [key]: prev } : s));
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', draft);
      setSettings((s) => (s ? { ...s, ...draft } : s));
      toast.push('success', 'Đã lưu cấu hình máy in');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ data: { queued: boolean } }>('/admin/print/test', {});
      if (res.data.data.queued) {
        toast.push('success', 'Đã xếp tờ in thử — giấy sẽ ra trong vài giây');
      } else {
        toast.push('error', 'Chưa bật in hoá đơn — gạt công tắc In hoá đơn trước đã');
      }
      await loadOverview();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setTesting(false);
    }
  };

  const addDevice = async (e: FormEvent) => {
    e.preventDefault();
    const name = newDeviceName.trim();
    if (!name) return;
    setAddingDevice(true);
    try {
      const res = await api.post<{ data: DeviceRow }>('/admin/print/devices', { name });
      setNewDeviceName('');
      // Hiện token NGAY của thiết bị vừa tạo: người đang đứng cạnh tablet cần chép nó sang
      // Termux, và bắt họ bấm thêm một nút "Hiện" nữa là thêm một bước vô nghĩa.
      setRevealed((r) => ({ ...r, [res.data.data.id]: true }));
      toast.push('success', 'Đã tạo thiết bị — chép mã sang máy làm cầu in');
      await loadOverview();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setAddingDevice(false);
    }
  };

  const revokeDevice = async (d: DeviceRow) => {
    const ok = await confirm({
      title: `Thu hồi "${d.name}"?`,
      message: 'Máy đó sẽ ngừng in ngay lập tức. Muốn dùng lại phải tạo thiết bị mới và dán mã mới.',
      variant: 'danger',
      confirmLabel: 'Thu hồi',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/print/devices/${d.id}/revoke`, {});
      toast.push('success', 'Đã thu hồi thiết bị');
      await loadOverview();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast.push('success', 'Đã chép mã');
    } catch {
      // clipboard API chỉ chạy trên HTTPS/localhost — nói thật thay vì im lặng.
      toast.push('error', 'Trình duyệt không cho chép tự động — bôi đen mã rồi chép tay');
    }
  };

  if (loading) return <div className="cd-row__s" style={{ padding: 16 }}>Đang tải…</div>;
  if (!settings) return null;

  const activeDevices = (overview?.devices ?? []).filter((d) => !d.revoked_at);
  const liveDevice = activeDevices.find(
    (d) => d.last_seen_at && Date.now() - d.last_seen_at < DEVICE_STALE_MS,
  );
  // Thiết bị gọi về gần nhất — để dải tình trạng nói được "máy A gọi về lần cuối … trước".
  const ganNhat = [...activeDevices].sort((a, b) => (b.last_seen_at ?? 0) - (a.last_seen_at ?? 0))[0];
  const jobs = overview?.jobs ?? [];
  const soQuaHan = jobs.filter((j) => j.status === 'EXPIRED').length;
  const gon = isPhone ? JOB_GON_DT : JOB_GON;
  const jobsHien = xemHet ? jobs : jobs.slice(0, gon);
  const laUsb = settings.printer_connection === 'USB';
  const noiCau = laUsb ? 'trang /print-bridge trên máy POS' : 'Termux trên máy tính bảng';

  /* Dải tình trạng ĐẦU trang: câu trả lời cho "in được không". Gọn 2 dòng (đợt 2). */
  const tinhTrang = !settings.printing_enabled ? (
    <div className="cd-status cd-status--off">
      <span><b>Đang tắt in hoá đơn</b>Thanh toán vẫn chạy bình thường, chỉ không ra giấy.</span>
    </div>
  ) : activeDevices.length === 0 ? (
    <div className="cd-status cd-status--warn">
      <span><b>Chưa có thiết bị làm cầu in</b>Thêm một thiết bị ở mục Cầu in, rồi dán mã vào {noiCau}.</span>
    </div>
  ) : !liveDevice ? (
    <div className="cd-status cd-status--warn">
      <span>
        <b>Cầu in không chạy</b>
        {ganNhat ? `Máy "${ganNhat.name}" gọi về lần cuối ${relativeTime(ganNhat.last_seen_at)}. ` : ''}
        {laUsb ? 'Mở /print-bridge trên máy POS.' : 'Kiểm Termux, Wi-Fi và tối ưu pin trên máy tính bảng.'}
      </span>
    </div>
  ) : (
    <div className="cd-status cd-status--ok">
      <span><b>Cầu in đang chạy</b>Máy "{liveDevice.name}" gọi về {relativeTime(liveDevice.last_seen_at)}.</span>
    </div>
  );

  /** Một hàng có ô chọn bên phải — chọn là LƯU NGAY. `neutralValue` = giá trị đang chọn để ô không
   *  bị tô viền xanh "đang lọc" (đây là cài đặt, không phải bộ lọc). */
  const dongChon = <K extends keyof PrintSettings>(
    key: K,
    t: string,
    info: string | null,
    options: Array<{ value: string; label: string }>,
    parse: (v: string) => PrintSettings[K],
  ) => {
    const value = String(settings[key]);
    return (
      <div className="cd-row cd-row--dd">
        <CdRowTitle title={t} info={info} />
        <div className="cd-row__c cd-row__c--dd">
          <Dropdown ariaLabel={t} sheetTitle={t} value={value} neutralValue={value} options={options} full
                    onChange={(v) => void setNow(key, parse(v), `Đã đổi ${t.toLowerCase()}`)} />
        </div>
      </div>
    );
  };

  const hienThietBi = !isPhone || moThietBi;

  return (
    <div className="cd-stack">
      {tinhTrang}

      {/* ── 1. Cấu hình máy in ── */}
      <CdSection
        label="Máy in hoá đơn"
        action={
          <button type="button" className="secondary cd-sm" onClick={() => void testPrint()} disabled={testing}>
            {testing ? 'Đang xếp…' : 'In thử'}
          </button>
        }
      >
        <CdRow title="In hoá đơn" sub="Tắt thì thanh toán vẫn chạy, chỉ không ra giấy">
          <Switch label="In hoá đơn" on={settings.printing_enabled}
                  onChange={(v) => void setNow('printing_enabled', v, v ? 'Đã bật in hoá đơn' : 'Đã tắt in hoá đơn')} />
        </CdRow>

        {dongChon(
          'printer_connection',
          'Máy in nối vào',
          laUsb ? 'Cầu in là trang web mở trong Chrome máy POS.' : 'Cầu in là script chạy trong Termux trên máy tính bảng.',
          [
            { value: 'LAN', label: 'Dây mạng (LAN)' },
            { value: 'USB', label: 'Dây USB vào máy POS' },
          ],
          (v) => v,
        )}

        {/* Ô địa chỉ IP chỉ có nghĩa với máy in nối mạng. Ở chế độ USB máy in KHÔNG có địa chỉ nào —
            để ô này lại là mời người lắp máy điền bừa rồi ngồi đoán vì sao không in được. */}
        {laUsb ? (
          <div className="cd-row">
            <p className="cd-note" style={{ flex: 1 }}>
              Mở <b>Chrome trên máy POS</b> rồi vào <code>{window.location.origin}/print-bridge</code>. Dán
              mã thiết bị ở mục Cầu in, bấm <b>Kết nối máy in</b> rồi <b>Bắt đầu</b>. Để trang đó mở và
              màn hình sáng — đóng trang là hoá đơn ngừng ra.
            </p>
          </div>
        ) : (
          <CdRow title="Địa chỉ máy in trong mạng quán" sub="IP và cổng (thường là 9100)" stack>
            <div className="cd-two">
              <input className="cd-input" style={{ flex: 1 }} value={draft.printer_host} placeholder="192.168.1.50"
                     aria-label="Địa chỉ IP máy in"
                     onChange={(e) => setDraft((d) => ({ ...d, printer_host: e.target.value.trim() }))} />
              <input className="cd-input cd-num" type="number" value={draft.printer_port} aria-label="Cổng máy in"
                     onChange={(e) => setDraft((d) => ({ ...d, printer_port: Number(e.target.value) }))} />
            </div>
          </CdRow>
        )}

        {/* Khổ giấy là thứ SAI MÀ KHÔNG BÁO LỖI: đặt 58 trên máy 80mm thì hoá đơn vẫn ra, chỉ chiếm
            nửa trái tờ giấy — nên nó đứng ngay đây chứ không giấu dưới mục nâng cao. */}
        {dongChon(
          'printer_paper_width_mm',
          'Khổ giấy',
          'Xem đáy máy in (Paper width). Chọn sai thì hoá đơn chỉ chiếm nửa tờ.',
          [
            { value: '80', label: '80mm — máy để bàn' },
            { value: '58', label: '58mm — máy nhỏ' },
          ],
          Number,
        )}

        {/* Ảnh gửi xuống máy in là 1-bit, không có "đen hơn" — đậm lên nghĩa là nét dày ra. */}
        {dongChon(
          'printer_darkness',
          'Độ đậm chữ',
          'Rất đậm thì dấu tiếng Việt có thể hơi bí — in thử để chọn.',
          [
            { value: '1', label: 'Thường' },
            { value: '2', label: 'Đậm' },
            { value: '3', label: 'Rất đậm' },
          ],
          Number,
        )}

        {/* Lever DUY NHẤT làm từng chấm đen hơn thật. Đầu giấy hiện ký tự lạ = máy in không hiểu
            lệnh → chọn lại "Giữ nguyên". */}
        {dongChon(
          'printer_heat',
          'Nhiệt đầu in',
          'Tăng khi chữ vẫn nhạt sau khi đã tăng độ đậm. Ra ký tự lạ thì chọn lại Giữ nguyên.',
          [
            { value: '0', label: 'Giữ nguyên' },
            { value: '1', label: 'Cao' },
            { value: '2', label: 'Rất cao' },
          ],
          Number,
        )}

        <CdRow title="Có dao cắt giấy" sub="Máy để bàn thường có, máy cầm tay thì không">
          <Switch label="Máy in có dao cắt giấy" on={settings.printer_auto_cut}
                  onChange={(v) => void setNow('printer_auto_cut', v, v ? 'Đã bật cắt giấy' : 'Đã tắt cắt giấy')} />
        </CdRow>

        <CdRow title="Tên quán in trên đầu hoá đơn" stack>
          <input className="cd-input" value={draft.store_name} aria-label="Tên quán in trên đầu hoá đơn"
                 onChange={(e) => setDraft((d) => ({ ...d, store_name: e.target.value }))} />
        </CdRow>
      </CdSection>

      {/* ── 2. Cầu in ── Điện thoại: một hàng tóm tắt, chạm mới mở (lắp máy làm một lần). */}
      <CdSection label="Cầu in">
        {!hienThietBi ? (
          <button type="button" className="cd-row cd-row--btn" onClick={() => setMoThietBi(true)}>
            <span className="cd-row__m">
              <span className="cd-row__t">Thiết bị làm cầu in</span>
              <span className={liveDevice || activeDevices.length === 0 ? 'cd-row__s' : 'cd-row__warn'}>
                {activeDevices.length === 0
                  ? 'Chưa có thiết bị nào'
                  : `${activeDevices.length} thiết bị · ${liveDevice ? 'đang chạy' : 'không phản hồi'}`}
              </span>
            </span>
            <span className="cd-row__v">Mở</span>
          </button>
        ) : (
          <>
            <CdRow
              title="Thiết bị làm cầu in"
              info={`Mỗi thiết bị một mã riêng — dán vào ${noiCau}. Chạy nhiều thiết bị cùng lúc vẫn an toàn: một hoá đơn không bao giờ in hai lần.`}
            />
            {activeDevices.length === 0 && (
              <div className="cd-row"><span className="cd-row__s">Chưa có thiết bị nào.</span></div>
            )}
            {activeDevices.map((d) => {
              const live = d.last_seen_at && Date.now() - d.last_seen_at < DEVICE_STALE_MS;
              const statusBad = d.last_status && d.last_status !== 'OK';
              return (
                <div key={d.id} className="cd-row cd-dev">
                  <div className="cd-row__m">
                    <span className="cd-row__t">
                      {d.name}{' '}
                      <span className={`cd-pill ${live ? 'cd-pill--ok' : 'cd-pill--warn'}`}>{live ? 'Đang chạy' : 'Không phản hồi'}</span>
                    </span>
                    <span className="cd-row__s">
                      Gọi về lần cuối: {relativeTime(d.last_seen_at)}
                      {statusBad && <span className="cd-row__warn"> · {d.last_status}</span>}
                    </span>
                  </div>
                  <button type="button" className="secondary cd-sm" onClick={() => void revokeDevice(d)}>Thu hồi</button>
                  <div className="cd-dev__tok">
                    <code>{revealed[d.id] ? d.token : '•'.repeat(24)}</code>
                    <button type="button" className="secondary cd-sm"
                            onClick={() => setRevealed((r) => ({ ...r, [d.id]: !r[d.id] }))}>
                      {revealed[d.id] ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button type="button" className="secondary cd-sm" onClick={() => void copyToken(d.token)}>Chép</button>
                  </div>
                </div>
              );
            })}
            <form onSubmit={addDevice} className="cd-row">
              <input className="cd-input" style={{ flex: 1, minWidth: 0 }} value={newDeviceName}
                     placeholder="Tên thiết bị mới, vd: Tablet quầy" maxLength={64} aria-label="Tên thiết bị mới"
                     onChange={(e) => setNewDeviceName(e.target.value)} />
              <button type="submit" className="secondary cd-sm" disabled={addingDevice || !newDeviceName.trim()}>
                Thêm
              </button>
            </form>
          </>
        )}
      </CdSection>

      {/* ── 3. Hàng đợi ── tóm tắt + lệnh mới nhất. Câu "quá hạn = 10 phút" nói MỘT lần dưới tóm tắt. */}
      <CdSection label="Hàng đợi in">
        {overview && (
          <div className="cd-row cd-sum">
            <span>{overview.counts.pending} đang chờ</span>
            <span className={overview.counts.failed > 0 ? 'is-warn' : undefined}>{overview.counts.failed} hỏng</span>
            {soQuaHan > 0 && <span className="is-warn">{soQuaHan} quá hạn</span>}
          </div>
        )}
        {soQuaHan > 0 && (
          <p className="cd-card__ds">Quá hạn = 10 phút không cầu in nào nhận lệnh — tờ đó sẽ không in nữa.</p>
        )}

        {jobs.length === 0 && <div className="cd-row"><span className="cd-row__s">Chưa có lần in nào.</span></div>}

        {jobsHien.map((j) => {
          const s = JOB_STATUS[j.status] ?? JOB_STATUS.PENDING;
          const noiDung = j.kind === 'TEST'
            ? 'In thử'
            : j.kind === 'CUSTOM'
              ? 'Hoá đơn tự do'
              : j.kind === 'TAM_TINH'
                ? `Tạm tính · ${describeJobTarget(j)}`
                : describeJobTarget(j);
          return (
            <div key={j.id} className="cd-job">
              <div className="cd-job__m">
                <span className="cd-job__t">
                  {noiDung}
                  {j.reason === 'REPRINT' && j.kind !== 'TEST' && j.kind !== 'TAM_TINH' && ' · in lại'}
                </span>
                <span className="cd-job__s">
                  {clockTime(j.created_at)}
                  {j.requested_by_full_name && ` · ${j.requested_by_full_name}`}
                </span>
                {/* Lỗi quá hạn đã nói dưới tóm tắt; chỉ hiện lỗi KHÁC (hết giấy, mất kết nối…). */}
                {j.last_error && j.status !== 'DONE' && j.status !== 'EXPIRED' && (
                  <span className="cd-job__err">{j.last_error}</span>
                )}
              </div>
              <span className={`cd-pill ${s.cls}`}>{s.label}</span>
            </div>
          );
        })}
        {jobs.length > gon && (
          <button type="button" className="cd-morebtn" onClick={() => setXemHet((v) => !v)}>
            {xemHet ? 'Thu gọn' : `Xem tất cả ${jobs.length} lệnh`}
          </button>
        )}
      </CdSection>

      {/* ── 4. Hoá đơn tự do đã in (M6.D-06) — màn riêng "Phiếu đã in"; ở đây chỉ còn đường vào. */}
      <Link to="/custom-receipt/history" className="cd-link">
        Phiếu đã in (hoá đơn tự do) →
      </Link>

      <SaveBar dirty={dirty} saving={saving} what="Cấu hình máy in" onSave={() => void saveDraft()} onCancel={reset} />
    </div>
  );
}

/** Tên hàng + ⓘ cho hàng ô chọn (hàng ô chọn tự dựng `cd-row--dd` để ô xuống dòng trên điện thoại). */
function CdRowTitle({ title, info }: { title: string; info: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cd-row__m">
      <span className="cd-row__t">
        {title}
        {info && (
          <button type="button" className="cd-i" aria-expanded={open} aria-label={`Giải thích: ${title}`}
                  onClick={() => setOpen((v) => !v)}>
            i
          </button>
        )}
      </span>
      {open && info && <span className="cd-why cd-why--inline">{info}</span>}
    </div>
  );
}
