// Sub-tab "Máy in" của khối Cài đặt (2026-09-19).
//
// Vì sao màn này phải có ngay từ vòng đầu chứ không phải làm sau: cầu in sống trên một chiếc
// máy tính bảng đặt ở quầy, không ai mở terminal ra đọc log của nó. Nếu không có chỗ nào nhìn
// thấy "tablet cuối cùng gọi về lúc nào" thì cái ngày nó ngủ quên, hàng đợi chỉ lặng lẽ dài ra
// và người ta phát hiện bằng cách khách hỏi hoá đơn.
//
// Ba khối, xếp theo đúng thứ tự người ta cần khi đi lắp máy: cấu hình máy in → khai thiết bị
// (lấy token dán vào Termux) → nhìn hàng đợi để biết nó có chạy không.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

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

const JOB_STATUS: Record<string, { label: string; bg: string; border: string; text: string }> = {
  PENDING: { label: 'Đang chờ', bg: C.warnBg, border: C.warnBorder, text: C.warnText },
  CLAIMED: { label: 'Đang in', bg: C.deliveryBg, border: C.deliveryBorder, text: C.deliveryText },
  DONE: { label: 'Đã in', bg: C.okBg, border: C.okBorder, text: C.okText },
  FAILED: { label: 'Hỏng', bg: C.alertBg, border: C.alertBorder, text: C.alertText },
  EXPIRED: { label: 'Quá hạn', bg: C.panelBg, border: C.borderSoft, text: C.muted },
};

/** Đơn ship/mang về ngồi ở một bàn ảo, nên `table_code` của chúng là mã kỹ thuật. Hiện thẳng
 *  ra thì dòng nhật ký đọc là "Bàn delivery" — đúng dữ liệu nhưng vô nghĩa với người đứng quầy. */
function describeJobTarget(j: JobRow): string {
  if (j.fulfillment_type === 'DELIVERY') return 'Giao tận nơi';
  if (j.fulfillment_type === 'PICKUP') return 'Khách tự lấy';
  return `Bàn ${j.table_code ?? '?'}`;
}

const card: React.CSSProperties = {
  background: C.cardBg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, color: C.muted, marginBottom: 4 };
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontSize: 15,
  boxSizing: 'border-box',
};

export function PrintersPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [addingDevice, setAddingDevice] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // Giữ bản mới nhất trong ref để vòng tự làm mới không phụ thuộc vào state trong closure.
  const mounted = useRef(true);

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

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      await api.put('/admin/settings', settings);
      toast.push('success', 'Đã lưu cấu hình máy in ✓');
      await loadOverview();
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
        toast.push('error', 'Chưa bật in hoá đơn — bật công tắc rồi Lưu trước đã');
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
      toast.push('success', 'Đã tạo thiết bị — chép token sang Termux trên máy tính bảng');
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
      message: 'Máy tính bảng đó sẽ ngừng in ngay lập tức. Muốn dùng lại phải tạo thiết bị mới và dán token mới vào Termux.',
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
      toast.push('success', 'Đã chép token');
    } catch {
      // clipboard API chỉ chạy trên HTTPS/localhost. Trên máy dev qua IP LAN thì hỏng —
      // nói thật thay vì im lặng để người dùng tưởng đã chép được.
      toast.push('error', 'Trình duyệt không cho chép tự động — bôi đen token rồi chép tay');
    }
  };

  if (loading) return <div style={{ padding: 16, color: C.muted }}>Đang tải…</div>;
  if (!settings) return null;

  const activeDevices = (overview?.devices ?? []).filter((d) => !d.revoked_at);
  const liveDevice = activeDevices.find(
    (d) => d.last_seen_at && Date.now() - d.last_seen_at < DEVICE_STALE_MS,
  );

  return (
    <div style={{ maxWidth: 820 }}>
      {/* ── Tình trạng chung: câu trả lời cho "in được không" phải ở ngay đầu trang ── */}
      {settings.printing_enabled && activeDevices.length > 0 && !liveDevice && (
        <div
          style={{
            ...card,
            background: C.alertBg,
            border: `1px solid ${C.alertBorder}`,
            color: C.alertText,
          }}
        >
          <strong>Không có cầu in nào đang chạy.</strong> Máy tính bảng ở quầy không gọi về trong
          hơn {Math.round(DEVICE_STALE_MS / 1000)} giây. Kiểm Termux còn mở không, Wi-Fi còn không,
          và đã tắt tối ưu pin cho Termux chưa.
        </div>
      )}

      {/* ── 1. Cấu hình máy in ── */}
      <form style={card} onSubmit={saveSettings}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Cấu hình máy in</h3>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={settings.printing_enabled}
            onChange={(e) => setSettings({ ...settings, printing_enabled: e.target.checked })}
          />
          <span style={{ fontWeight: 600 }}>Bật in hoá đơn</span>
          <span style={{ color: C.muted, fontSize: 13 }}>
            — tắt thì thanh toán vẫn chạy bình thường, chỉ không ra giấy
          </span>
        </label>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Máy in nối vào đâu</label>
          <select
            style={{ ...input, maxWidth: 300 }}
            value={settings.printer_connection}
            onChange={(e) => setSettings({ ...settings, printer_connection: e.target.value })}
          >
            <option value="LAN">Dây mạng (LAN)</option>
            <option value="USB">Dây USB vào máy POS Android</option>
          </select>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {settings.printer_connection === 'USB'
              ? 'Cầu in là một trang web mở sẵn trong Chrome trên máy POS.'
              : 'Cầu in là script chạy trong Termux trên máy tính bảng.'}
          </div>
        </div>

        {/* Ô địa chỉ IP chỉ có nghĩa với máy in nối mạng. Ở chế độ USB, máy in nối bằng dây vào
            máy POS và KHÔNG có địa chỉ nào — để ô này lại là mời người lắp máy điền bừa một con
            số rồi ngồi đoán vì sao không in được. */}
        {settings.printer_connection === 'USB' ? (
          <div
            style={{
              background: C.okBg,
              border: `1px solid ${C.okBorder}`,
              color: C.okText,
              borderRadius: 8,
              padding: 12,
              marginBottom: 14,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Mở <b>Chrome trên máy POS</b> rồi vào địa chỉ:
            <div style={{ margin: '6px 0' }}>
              <code style={{ background: '#fff', padding: '4px 8px', borderRadius: 6 }}>
                {window.location.origin}/print-bridge
              </code>
            </div>
            Dán token thiết bị ở khối bên dưới, bấm <b>Kết nối máy in</b> rồi <b>Bắt đầu</b>. Để
            trang đó mở và màn hình sáng — đóng trang là hoá đơn ngừng ra.
          </div>
        ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={label}>Địa chỉ IP máy in trong mạng quán</label>
            <input
              style={input}
              value={settings.printer_host}
              placeholder="192.168.1.50"
              onChange={(e) => setSettings({ ...settings, printer_host: e.target.value.trim() })}
            />
          </div>
          <div style={{ flex: '0 0 110px' }}>
            <label style={label}>Cổng</label>
            <input
              style={input}
              type="number"
              value={settings.printer_port}
              onChange={(e) => setSettings({ ...settings, printer_port: Number(e.target.value) })}
            />
          </div>
        </div>
        )}

        <div style={{ marginBottom: 14 }}>
          {/* Khổ giấy là thứ SAI MÀ KHÔNG BÁO LỖI: đặt 58 trên máy 80mm thì hoá đơn vẫn ra,
              chữ vẫn sắc, chỉ chiếm nửa trái tờ giấy. Nên để nó thành ô chọn nằm ngay cạnh IP
              chứ không giấu dưới mục nâng cao. */}
          <label style={label}>Khổ giấy</label>
          <select
            style={{ ...input, maxWidth: 260 }}
            value={settings.printer_paper_width_mm}
            onChange={(e) =>
              setSettings({ ...settings, printer_paper_width_mm: Number(e.target.value) })
            }
          >
            <option value={80}>80mm — máy để bàn (vd XP-D600)</option>
            <option value={58}>58mm — máy nhỏ / cầm tay</option>
          </select>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            Xem đáy máy in, dòng <em>热敏纸宽 / Paper width</em>. Chọn sai thì hoá đơn vẫn in
            nhưng chỉ chiếm nửa tờ giấy.
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Tên quán in trên đầu hoá đơn</label>
          <input
            style={input}
            value={settings.store_name}
            onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
          />
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={settings.printer_auto_cut}
            onChange={(e) => setSettings({ ...settings, printer_auto_cut: e.target.checked })}
          />
          <span>Máy in có dao cắt giấy</span>
          <span style={{ color: C.muted, fontSize: 13 }}>
            — máy để bàn thường có, máy cầm tay thì không
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" disabled={saving} style={{ padding: '9px 18px' }}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={testPrint}
            disabled={testing}
            style={{ padding: '9px 18px' }}
          >
            {testing ? 'Đang xếp…' : 'In thử'}
          </button>
        </div>
      </form>

      {/* ── 2. Cầu in ── */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Thiết bị làm cầu in</h3>
        <p style={{ margin: '0 0 14px', color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
          Mỗi thiết bị cần một token riêng — dán vào Termux (chế độ LAN) hoặc vào trang
          /print-bridge trên máy POS (chế độ USB). Chạy nhiều thiết bị cùng lúc là an toàn:
          server không bao giờ giao cùng một hoá đơn cho hai máy.
        </p>

        {activeDevices.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14 }}>Chưa có thiết bị nào.</p>
        )}

        {activeDevices.map((d) => {
          const live = d.last_seen_at && Date.now() - d.last_seen_at < DEVICE_STALE_MS;
          const statusBad = d.last_status && d.last_status !== 'OK';
          return (
            <div
              key={d.id}
              style={{
                border: `1px solid ${C.borderSoft}`,
                borderLeft: `4px solid ${live ? C.connected : C.danger}`,
                borderRadius: 8,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{d.name}</strong>
                  <span style={{ marginLeft: 10, color: live ? C.connected : C.danger, fontSize: 13 }}>
                    {live ? '● đang chạy' : '● không phản hồi'}
                  </span>
                  <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
                    Gọi về lần cuối: {relativeTime(d.last_seen_at)}
                    {statusBad && (
                      <span style={{ color: C.alertText }}> · {d.last_status}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => revokeDevice(d)}
                  style={{ padding: '6px 12px', fontSize: 13, alignSelf: 'flex-start' }}
                >
                  Thu hồi
                </button>
              </div>

              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code
                  style={{
                    background: C.panelBg,
                    padding: '6px 8px',
                    borderRadius: 6,
                    fontSize: 13,
                    wordBreak: 'break-all',
                    flex: '1 1 260px',
                  }}
                >
                  {revealed[d.id] ? d.token : '•'.repeat(24)}
                </code>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => setRevealed((r) => ({ ...r, [d.id]: !r[d.id] }))}
                >
                  {revealed[d.id] ? 'Ẩn' : 'Hiện'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => copyToken(d.token)}
                >
                  Chép
                </button>
              </div>
            </div>
          );
        })}

        <form onSubmit={addDevice} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            style={{ ...input, flex: '1 1 220px', width: 'auto' }}
            value={newDeviceName}
            placeholder="Tên thiết bị, vd: Tablet quầy"
            maxLength={64}
            onChange={(e) => setNewDeviceName(e.target.value)}
          />
          <button type="submit" disabled={addingDevice || !newDeviceName.trim()} style={{ padding: '9px 18px' }}>
            Thêm thiết bị
          </button>
        </form>
      </div>

      {/* ── 3. Hàng đợi ── */}
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>
          Hàng đợi in
          {overview && (
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: C.muted }}>
              {overview.counts.pending} đang chờ · {overview.counts.failed} hỏng
            </span>
          )}
        </h3>

        {(overview?.jobs.length ?? 0) === 0 && (
          <p style={{ color: C.muted, fontSize: 14 }}>Chưa có lần in nào.</p>
        )}

        <div style={{ overflowX: 'auto' }}>
          {overview && overview.jobs.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.muted, fontSize: 13 }}>
                  <th style={{ padding: '6px 8px' }}>Lúc</th>
                  <th style={{ padding: '6px 8px' }}>Nội dung</th>
                  <th style={{ padding: '6px 8px' }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {overview.jobs.map((j) => {
                  const s = JOB_STATUS[j.status] ?? JOB_STATUS.PENDING;
                  return (
                    <tr key={j.id} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap', color: C.muted }}>
                        {clockTime(j.created_at)}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {j.kind === 'TEST' ? 'In thử' : describeJobTarget(j)}
                        {j.reason === 'REPRINT' && j.kind !== 'TEST' && (
                          <span style={{ color: C.muted }}> · in lại</span>
                        )}
                        {j.requested_by_full_name && (
                          <span style={{ color: C.muted }}> · {j.requested_by_full_name}</span>
                        )}
                        {j.last_error && j.status !== 'DONE' && (
                          <div style={{ color: C.alertText, fontSize: 13 }}>{j.last_error}</div>
                        )}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: s.bg,
                            border: `1px solid ${s.border}`,
                            color: s.text,
                            borderRadius: 999,
                            padding: '2px 10px',
                            fontSize: 13,
                          }}
                        >
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
