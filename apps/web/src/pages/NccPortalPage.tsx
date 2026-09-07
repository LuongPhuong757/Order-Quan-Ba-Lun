// Cổng nhà cung cấp — màn NCC tự dùng (bước 4 của Milestone 3).
//
// Người dùng ở đây phần lớn KHÔNG RÀNH CÔNG NGHỆ. Vài luật cứng cho cả file:
// - Chữ to (16px trở lên), nút cao ≥52px, mỗi màn một việc.
// - Không gõ bàn phím chữ ở đường chính: số lượng bằng nút −/+, PIN bằng bàn phím số.
// - Không thuật ngữ. Không "phiếu nhập kho", không "đồng bộ", không mã SKU.
// - Lỗi thì hiện SỐ ĐIỆN THOẠI QUÁN để gọi, không hiện mã lỗi.
//
// Đây là màn CÔNG KHAI, ngoài `ProtectedShell`: NCC không phải nhân viên, không có role, không
// bao giờ được đi qua guard của app nội bộ.
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { api, extractError } from '../lib/api.ts';
import { upperUnit } from '../lib/text-case.ts';

const TOKEN_KEY = 'ncc_token';

type SupplierItemRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  last_unit_price: number;
  last_delivery_date: string;
};

type PortalDelivery = {
  id: string;
  delivery_date: string;
  status: 'PENDING_REVIEW' | 'PENDING_PRICE' | 'CONFIRMED' | 'CANCELLED';
  source: 'STAFF' | 'SUPPLIER';
  total_amount: number;
  note: string | null;
};

const vnd = (n: number) => n.toLocaleString('vi-VN');

/** Trạng thái phiếu, nói bằng lời NCC hiểu — không phải tên trạng thái trong máy. */
const STATUS_TEXT: Record<PortalDelivery['status'], { label: string; color: string }> = {
  PENDING_REVIEW: { label: 'Quán đang kiểm hàng', color: '#b45309' },
  PENDING_PRICE: { label: 'Quán đang xem lại giá', color: '#b45309' },
  CONFIRMED: { label: 'Quán đã nhận đủ', color: '#15803d' },
  CANCELLED: { label: 'Đã huỷ', color: '#b91c1c' },
};

/** Gọi API kèm token phiên. Header riêng `x-supplier-token` — không dùng cookie đăng nhập của
 * nhân viên, hai loại chủ thể không được dùng chung một đường xác thực. */
function nccApi(token: string) {
  return {
    get: <T,>(url: string) => api.get<T>(url, { headers: { 'x-supplier-token': token } }),
    post: <T,>(url: string, body?: unknown) =>
      api.post<T>(url, body, { headers: { 'x-supplier-token': token } }),
  };
}

export function NccPortalPage() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [name, setName] = useState('');

  // `index.html` đặt tiêu đề "Admin · Quán Bà Lùn" cho app nội bộ. NCC mở link trên điện thoại mà
  // thấy chữ "Admin" thì vừa khó hiểu vừa sai — đây là màn của họ, không phải màn quản trị.
  useEffect(() => {
    const prev = document.title;
    document.title = 'Giao hàng · Quán Bà Lùn';
    return () => {
      document.title = prev;
    };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  useEffect(() => {
    if (!token) return;
    nccApi(token)
      .get<{ data: { supplier_name: string } }>('/supplier-portal/me')
      .then((r) => setName(r.data.data.supplier_name))
      // Phiên chết (hết hạn, hoặc chủ quán vừa đặt lại PIN) → về màn đăng nhập, không kẹt ở
      // trang trắng.
      .catch(() => logout());
  }, [token, logout]);

  if (!token) {
    return (
      <LoginScreen
        onLoggedIn={(t, n) => {
          localStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          setName(n);
        }}
      />
    );
  }
  return <PortalHome token={token} name={name} onLogout={logout} />;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (token: string, name: string) => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await api.post<{ data: { token: string; supplier_name: string } }>(
        '/supplier-portal/login',
        { phone: phone.trim(), pin },
      );
      onLoggedIn(res.data.data.token, res.data.data.supplier_name);
    } catch (e2) {
      // Thông báo của BE đã viết bằng lời thường ("Số điện thoại hoặc mã PIN không đúng", "thử
      // lại sau N phút") — hiện nguyên văn, không dịch lại thành mã lỗi.
      setErr(
        axios.isAxiosError(e2) && e2.response
          ? extractError(e2).message
          : 'Không kết nối được. Kiểm tra mạng rồi thử lại nhé.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Giao hàng</h1>
      <p style={{ fontSize: 16, color: '#4b5563', marginTop: 0 }}>Đăng nhập để gửi phiếu giao hàng</p>

      <form onSubmit={submit}>
        <label style={{ display: 'block', marginTop: 20 }}>
          <span style={{ fontSize: 16 }}>Số điện thoại</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            // `inputMode="tel"` để điện thoại bật bàn phím số — nhóm này gõ chữ rất chậm.
            inputMode="tel"
            autoComplete="username"
            required
            style={{ width: '100%', minHeight: 56, fontSize: 22, marginTop: 6 }}
          />
        </label>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 16 }}>Mã PIN (6 số)</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="current-password"
            required
            style={{ width: '100%', minHeight: 56, fontSize: 28, letterSpacing: 8, marginTop: 6 }}
          />
        </label>

        {err && (
          <div
            style={{
              marginTop: 16,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: 12,
              fontSize: 16,
              color: '#b91c1c',
            }}
          >
            {err}
          </div>
        )}

        <button type="submit" disabled={busy} style={{ width: '100%', minHeight: 56, fontSize: 20, marginTop: 20 }}>
          {busy ? 'Đang vào…' : 'Vào'}
        </button>
      </form>

      {/* M3.D-03 — quên mã thì GỌI QUÁN, không có luồng đặt lại qua email. Chủ quán đặt lại trong
          màn quản lý rồi đọc mã mới qua điện thoại. */}
      <p style={{ marginTop: 24, fontSize: 16, color: '#4b5563' }}>
        Quên mã PIN? Gọi cho quán để lấy mã mới.
      </p>
    </div>
  );
}

function PortalHome({ token, name, onLogout }: { token: string; name: string; onLogout: () => void }) {
  const [items, setItems] = useState<SupplierItemRow[]>([]);
  const [deliveries, setDeliveries] = useState<PortalDelivery[]>([]);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    const a = nccApi(token);
    const [i, d] = await Promise.all([
      a.get<{ data: { items: SupplierItemRow[] } }>('/supplier-portal/items'),
      a.get<{ data: { items: PortalDelivery[] } }>('/supplier-portal/deliveries'),
    ]);
    setItems(i.data.data.items);
    setDeliveries(d.data.data.items);
  }, [token]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (composing) {
    return (
      <ComposeScreen
        token={token}
        items={items}
        onDone={() => {
          setComposing(false);
          load().catch(() => undefined);
        }}
        onCancel={() => setComposing(false)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{name}</h1>
        <button className="secondary" onClick={onLogout} style={{ marginLeft: 'auto', minHeight: 40 }}>
          Thoát
        </button>
      </div>

      <button
        onClick={() => setComposing(true)}
        style={{ width: '100%', minHeight: 64, fontSize: 22, marginTop: 20 }}
      >
        ＋ GIAO HÀNG HÔM NAY
      </button>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Phiếu đã gửi</h2>
      {deliveries.length === 0 && <p style={{ fontSize: 16, color: '#6b7280' }}>Chưa có phiếu nào.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {deliveries.map((d) => (
          <div key={d.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 17 }}>{d.delivery_date}</strong>
              <strong style={{ fontSize: 17 }}>{vnd(d.total_amount)}đ</strong>
            </div>
            <div style={{ fontSize: 15, color: STATUS_TEXT[d.status].color, marginTop: 4 }}>
              ● {STATUS_TEXT[d.status].label}
            </div>
            {/* M3.D-09 — phiếu quán nhập hộ vẫn hiện ở đây, gắn nhãn rõ. Minh bạch hai chiều, và
                đây là thứ khiến họ dần muốn tự nhập. */}
            {d.source === 'STAFF' && (
              <div style={{ fontSize: 14, color: '#6b7280', marginTop: 2 }}>Quán nhập giúp</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Draft = { key: string; item: SupplierItemRow; qty: number };

function ComposeScreen({
  token,
  items,
  onDone,
  onCancel,
}: {
  token: string;
  items: SupplierItemRow[];
  onDone: () => void;
  onCancel: () => void;
}) {
  // Bắt đầu bằng ĐÚNG những mặt hàng NCC này hay giao, số lượng 0 (M3.D-18). Họ chỉ việc bấm + ở
  // vài dòng — không phải tìm kiếm, không phải gõ tên.
  const [lines, setLines] = useState<Draft[]>(() =>
    items.map((it, i) => ({ key: `k${i}`, item: it, qty: 0 })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  const total = useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.qty * l.item.last_unit_price), 0),
    [lines],
  );
  const picked = lines.filter((l) => l.qty > 0);

  const setQty = (key: string, next: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(0, next) } : l)));

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      await nccApi(token).post('/supplier-portal/deliveries', {
        lines: picked.map((l) => ({
          ingredient_id: l.item.ingredient_id,
          purchase_unit: l.item.purchase_unit,
          qty_base_per_unit: Number(l.item.qty_base_per_unit),
          qty_purchase: l.qty,
          unit_price: l.item.last_unit_price,
        })),
      });
      setSent(true);
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // Màn sau khi gửi KHÔNG có hành động nào khác — một dấu tích, một câu, một nút về. Thêm nút ở
  // đây là mời người ta bấm nhầm ngay sau khi vừa gửi xong.
  if (sent) {
    return (
      <div style={{ maxWidth: 380, margin: '0 auto', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 64 }}>✅</div>
        <h1 style={{ fontSize: 24 }}>Đã gửi!</h1>
        <p style={{ fontSize: 17, color: '#4b5563' }}>Quán sẽ kiểm hàng và báo lại.</p>
        <button onClick={onDone} style={{ width: '100%', minHeight: 56, fontSize: 19, marginTop: 20 }}>
          Xong
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22 }}>Chưa có mặt hàng</h1>
        <p style={{ fontSize: 17, color: '#4b5563' }}>
          Lần giao đầu tiên quán sẽ nhập giúp. Từ lần sau bạn tự gửi được ở đây.
        </p>
        <button className="secondary" onClick={onCancel} style={{ width: '100%', minHeight: 56, fontSize: 18 }}>
          Quay lại
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20, paddingBottom: 120 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Hôm nay giao gì?</h1>
        <button className="secondary" onClick={onCancel} style={{ marginLeft: 'auto', minHeight: 40 }}>
          Huỷ
        </button>
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {lines.map((l) => (
          <div
            key={l.key}
            className="card"
            style={{ padding: 14, background: l.qty > 0 ? '#f0fdfa' : undefined }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 18 }}>{l.item.ingredient_name}</strong>
              <span style={{ fontSize: 16, color: '#4b5563' }}>
                {vnd(l.item.last_unit_price)}đ/{upperUnit(l.item.purchase_unit)}
              </span>
            </div>
            {/* Số lượng bằng NÚT, không bắt gõ. Ô số vẫn có để nhập nhanh khi cần nhiều. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button
                type="button"
                className="secondary"
                aria-label={`Bớt ${l.item.ingredient_name}`}
                onClick={() => setQty(l.key, l.qty - 1)}
                style={{ minWidth: 56, minHeight: 56, fontSize: 26 }}
              >
                −
              </button>
              <input
                value={l.qty || ''}
                onChange={(e) => setQty(l.key, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                inputMode="decimal"
                placeholder="0"
                style={{ flex: 1, minHeight: 56, fontSize: 24, textAlign: 'center' }}
              />
              <button
                type="button"
                className="secondary"
                aria-label={`Thêm ${l.item.ingredient_name}`}
                onClick={() => setQty(l.key, l.qty + 1)}
                style={{ minWidth: 56, minHeight: 56, fontSize: 26 }}
              >
                ＋
              </button>
              <span style={{ fontSize: 16, minWidth: 48, color: '#4b5563' }}>{upperUnit(l.item.purchase_unit)}</span>
            </div>
          </div>
        ))}
      </div>

      {err && (
        <div
          style={{
            marginTop: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: 12,
            fontSize: 16,
            color: '#b91c1c',
          }}
        >
          {err}
        </div>
      )}

      {/* Thanh tổng bám đáy: người dùng cuộn giữa danh sách vẫn luôn thấy tổng tiền và nút gửi. */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: '#fff',
          borderTop: '1px solid #e5e7eb',
          padding: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>{picked.length} mặt hàng</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{vnd(total)}đ</div>
        </div>
        <button
          onClick={send}
          disabled={busy || picked.length === 0}
          style={{ marginLeft: 'auto', minHeight: 56, fontSize: 20, padding: '0 28px' }}
        >
          {busy ? 'Đang gửi…' : 'GỬI'}
        </button>
      </div>
    </div>
  );
}
