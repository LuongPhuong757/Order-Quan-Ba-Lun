// Quản lý bàn: CRUD bàn với 3 loại (dine-in / takeaway / delivery).
// Admin & chủ quán sửa được (BE có AdminGuard trên POST/PATCH/DELETE); vai trò khác chỉ xem.
//
// Làm lại 2026-11-12 theo bản xem thử chủ quán duyệt: lưới ô số chia nhóm theo loại (thay thẻ có
// nút Sửa + Xoá ĐỎ trên từng bàn), chạm ô → tấm sửa (Xoá nằm cuối tấm), "Thêm nhiều bàn" vào ⋯,
// X/Y thu vào "Thứ tự hiển thị". CSS ở ./ban-an.css.
import { useEffect, useState, type FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import './ban-an.css';

type RestaurantTable = {
  id: string;
  code: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  is_active: boolean;
};

type Kind = 'dine-in' | 'takeaway' | 'delivery';

// Thứ tự nhóm trên màn: bàn ăn tại quán (nhiều nhất, dùng nhiều nhất) lên ĐẦU. Trước đây theo
// thứ tự BE trả (`kind ASC` → "delivery" < "dine-in") nên Ship đứng đầu, bàn tại quán bị đẩy
// xuống dưới.
const KINDS: Kind[] = ['dine-in', 'takeaway', 'delivery'];

const KIND_LABEL: Record<string, string> = {
  'dine-in': 'Ăn tại quán',
  takeaway: 'Mang về',
  delivery: 'Giao hàng',
};

// Icon tách khỏi nhãn: nhãn còn đi vào chuỗi thuần (thông báo) nên không chứa được icon.
const KIND_ICON: Record<string, IconName> = {
  'dine-in': 'ban',
  takeaway: 'mang-ve',
  delivery: 'giao-hang',
};

// Mapping kind → format code/name ở FE (sync với BE KIND_FORMAT trong table-kind.ts)
const KIND_FORMAT_FE: Record<Kind, { codePrefix: string; namePrefix: string; label: string }> = {
  'dine-in':  { codePrefix: 'ban',     namePrefix: 'Bàn',     label: 'Tại quán' },
  'takeaway': { codePrefix: 'mang-ve', namePrefix: 'Mang về', label: 'Mang về' },
  'delivery': { codePrefix: 'ship',    namePrefix: 'Ship',    label: 'Giao hàng' },
};

/** Số bàn rút từ mã (`ban-05` → 5) — cùng luật `tableNumberOf` ở BE. Không có số → vô cực
 *  để bàn tên lạ ("VIP") xếp cuối nhóm. */
function numberOf(code: string): number {
  const d = code.replace(/\D/g, '');
  return d === '' ? Number.POSITIVE_INFINITY : Number(d);
}

/** Màn này sắp theo SỐ bàn, không theo `y`/`x` như BE: bàn tạo hàng loạt trước 2026-11-12 có `y`
 *  đếm lại từ 0 mỗi lần tạo, sắp theo `y` sẽ ra "Bàn 01, Bàn 11, Bàn 02…". */
function sortTables(a: RestaurantTable, b: RestaurantTable): number {
  return numberOf(a.code) - numberOf(b.code) || a.name.localeCompare(b.name, 'vi');
}

/** Ô bàn: tên đúng khuôn "<Tiền tố> <số>" → hiện SỐ to (+ tiền tố nhỏ cho Mang về/Ship để không
 *  nhầm với bàn tại quán); tên khác ("Bàn test 70", "VIP") → hiện nguyên tên. */
function TileLabel({ t }: { t: RestaurantTable }) {
  const fmt = KIND_FORMAT_FE[t.kind as Kind];
  const m = fmt ? new RegExp(`^${fmt.namePrefix}\\s+(\\d+)$`, 'i').exec(t.name.trim()) : null;
  if (!fmt || !m) return <span className="ba-tile__name">{t.name}</span>;
  return (
    <>
      <span className="ba-tile__num">{m[1]}</span>
      {t.kind !== 'dine-in' && <span className="ba-tile__pre">{fmt.namePrefix}</span>}
    </>
  );
}

function KindSeg({ value, onChange }: { value: string; onChange: (k: Kind) => void }) {
  return (
    <div className="ba-seg" role="radiogroup" aria-label="Loại bàn">
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          className={`ba-seg__opt${value === k ? ' is-on' : ''}`}
          onClick={() => onChange(k)}
        >
          <Icon name={KIND_ICON[k]} size={16} />
          {KIND_FORMAT_FE[k].label}
        </button>
      ))}
    </div>
  );
}

export function TablesManagementPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Admin & chủ quán đều được quản lý bàn (thêm/sửa/xoá).
  const canManage = !!user?.is_owner || user?.role === 'admin';
  const [items, setItems] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: { items: RestaurantTable[] } }>('/tables');
      setItems(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = KINDS.map((k) => ({
    kind: k,
    tables: items.filter((t) => t.kind === k).sort(sortTables),
  })).filter((g) => g.tables.length > 0);

  return (
    <div className="container wide with-bottom-nav">
      {/* Không lặp tiêu đề "Bàn ăn": thanh đầu trang đã có tên màn. Hàng này chỉ còn tổng số bàn
          + đúng MỘT nút chính; việc hiếm (thêm nhiều bàn) nằm trong ⋯. */}
      <div className="ba-head">
        <div className="ba-head__sum">{loading && items.length === 0 ? 'Đang tải…' : `${items.length} bàn`}</div>
        {canManage && (
          <>
            <button type="button" className="ba-more" onClick={() => setShowMore(true)} aria-label="Thêm tuỳ chọn">
              <Icon name="them-thao-tac" size={22} />
            </button>
            <button type="button" className="ba-add" onClick={() => setShowCreate(true)}>
              <Icon name="them" size={18} />
              Thêm bàn
            </button>
          </>
        )}
      </div>

      {!loading && items.length === 0 && <div className="ba-empty">Chưa có bàn nào.</div>}

      {groups.map((g) => (
        <section key={g.kind} className="ba-grp" aria-label={KIND_LABEL[g.kind]}>
          <h2 className="ba-grp__h">
            <Icon name={KIND_ICON[g.kind]} size={18} />
            {KIND_LABEL[g.kind]}
            <span className="ba-grp__n">{g.tables.length}</span>
          </h2>
          <div className="ba-tiles">
            {g.tables.map((t) =>
              canManage ? (
                <button key={t.id} type="button" className="ba-tile" onClick={() => setEditing(t)} aria-label={`Sửa ${t.name}`}>
                  <TileLabel t={t} />
                </button>
              ) : (
                <div key={t.id} className="ba-tile">
                  <TileLabel t={t} />
                </div>
              ),
            )}
          </div>
        </section>
      ))}

      {showMore && (
        <Sheet title="Tuỳ chọn" onClose={() => setShowMore(false)} giuaKhiRong>
          <div className="ba-actions">
            <button type="button" className="ba-actions__opt" onClick={() => { setShowMore(false); setShowBulk(true); }}>
              <Icon name="combo" size={20} />
              Thêm nhiều bàn một lúc
            </button>
          </div>
        </Sheet>
      )}
      {showCreate && (
        <TableFormSheet
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <TableFormSheet
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {showBulk && (
        <BulkTablesSheet
          onClose={() => setShowBulk(false)}
          onCreated={() => { setShowBulk(false); refresh(); }}
        />
      )}
    </div>
  );
}

function BulkTablesSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('dine-in');
  // String state để input có thể trống — tránh bug "Number('') || 1 = 1" khi user xoá hết.
  const [fromStr, setFromStr] = useState('1');
  const [toStr, setToStr] = useState('10');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmt = KIND_FORMAT_FE[kind];
  const fromNum = parseInt(fromStr, 10);
  const toNum = parseInt(toStr, 10);

  const preview = (() => {
    if (!Number.isFinite(fromNum) || !Number.isFinite(toNum)) {
      return { ok: false, count: 0, msg: 'Nhập đủ số bắt đầu và kết thúc', samples: '' };
    }
    if (fromNum < 1) return { ok: false, count: 0, msg: 'Số bắt đầu phải từ 1 trở lên', samples: '' };
    if (toNum < fromNum) return { ok: false, count: 0, msg: 'Số kết thúc phải lớn hơn hoặc bằng số bắt đầu', samples: '' };
    const n = toNum - fromNum + 1;
    if (n > 100) return { ok: false, count: 0, msg: `Tối đa 100 bàn mỗi lần (đang chọn ${n})`, samples: '' };
    // Luôn pad tối thiểu 2 (01, 02… 100) — khớp `formatTableCode` ở BE. Cũ tính theo `toNum` nên
    // 1–120 ra "001" khác "01" của lần trước → tạo trùng bàn (sửa 2026-11-12).
    const nm = (i: number) => `${fmt.namePrefix} ${String(i).padStart(2, '0')}`;
    const samples = n <= 3
      ? Array.from({ length: n }, (_, i) => nm(fromNum + i)).join(', ')
      : `${nm(fromNum)}, ${nm(fromNum + 1)} … ${nm(toNum)}`;
    return { ok: true, count: n, msg: 'Số nào đã có bàn sẽ được bỏ qua', samples };
  })();

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!preview.ok) { setErr(preview.msg); return; }
    setSubmitting(true); setErr(null);
    try {
      const res = await api.post<{ data: { created: number; reopened: number; skipped: number; skipped_nums: number[] } }>(
        '/tables/bulk',
        { kind, from_num: fromNum, to_num: toNum },
      );
      // Chỉ tạo số còn thiếu: số đã có bàn thì bỏ qua, bàn đã xoá cùng số thì hiện lại (BE `planBulkTables`).
      const { created, reopened, skipped, skipped_nums } = res.data.data;
      let msg = `Đã tạo ${created} bàn`;
      if (reopened > 0) msg += ` · hiện lại ${reopened} bàn đã xoá`;
      if (skipped > 0) msg += ` · bỏ qua ${skipped} số đã có (${skipped_nums.slice(0, 5).join(', ')}${skipped_nums.length > 5 ? '…' : ''})`;
      toast.push('success', msg);
      onCreated();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      title="Thêm nhiều bàn một lúc"
      onClose={onClose}
      giuaKhiRong
      footer={
        <div className="ba-foot">
          <button type="button" className="ds-btn ds-btn--primary" disabled={submitting || !preview.ok} onClick={() => submit()}>
            {submitting && <span className="spinner" />}
            Tạo {preview.ok ? `tối đa ${preview.count}` : ''} bàn
          </button>
        </div>
      }
    >
      <form className="ba-form" onSubmit={submit}>
        <div>
          <label>Loại bàn</label>
          <KindSeg value={kind} onChange={setKind} />
        </div>
        <div className="ba-row2">
          <div>
            <label htmlFor="bt-from">Từ số</label>
            <input
              id="bt-from"
              type="number"
              inputMode="numeric"
              value={fromStr}
              onChange={(e) => { setFromStr(e.target.value.replace(/[^\d]/g, '')); setErr(null); }}
              min={1}
              max={999}
            />
          </div>
          <div>
            <label htmlFor="bt-to">Đến số</label>
            <input
              id="bt-to"
              type="number"
              inputMode="numeric"
              value={toStr}
              onChange={(e) => { setToStr(e.target.value.replace(/[^\d]/g, '')); setErr(null); }}
              min={1}
              max={999}
            />
          </div>
        </div>
        <div className={`ba-preview${preview.ok ? '' : ' is-err'}`}>
          <div className="ba-preview__msg">
            <Icon name={preview.ok ? 'xong' : 'canh-bao'} size={16} />
            {preview.msg}
          </div>
          {preview.ok && <div className="ba-preview__samples">{preview.samples}</div>}
        </div>
        {err && <div className="ba-err">{err}</div>}
      </form>
    </Sheet>
  );
}

function TableFormSheet({
  existing,
  onClose,
  onSaved,
}: {
  existing?: RestaurantTable;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [kind, setKind] = useState(existing?.kind || 'dine-in');
  const [x, setX] = useState(existing?.x ?? 0);
  const [y, setY] = useState(existing?.y ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr('Cần nhập mã bàn và tên bàn');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name, kind, x, y };
      if (existing) {
        await api.patch(`/tables/${existing.id}`, body);
        toast.push('success', `Đã lưu ${name}`);
      } else {
        body.code = code;
        await api.post('/tables', body);
        toast.push('success', `Đã thêm ${name}`);
      }
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const softDelete = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Xoá ${existing.name}?`,
      message: 'Bàn sẽ ẩn khỏi sơ đồ. Đơn cũ của bàn vẫn được giữ.',
      variant: 'danger',
      confirmLabel: 'Xoá bàn',
    });
    if (!ok) return;
    try {
      await api.delete(`/tables/${existing.id}`);
      toast.push('success', `Đã xoá ${existing.name}`);
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    }
  };

  return (
    <Sheet
      title={existing ? existing.name : 'Thêm bàn'}
      onClose={onClose}
      giuaKhiRong
      footer={
        <div className="ba-foot">
          <button type="button" className="ds-btn ds-btn--primary" disabled={submitting} onClick={() => submit()}>
            {submitting && <span className="spinner" />}
            {existing ? 'Lưu' : 'Thêm bàn'}
          </button>
          {existing && (
            <button type="button" className="ba-del" onClick={softDelete}>
              <Icon name="xoa" size={18} />
              Xoá bàn này
            </button>
          )}
        </div>
      }
    >
      <form className="ba-form" onSubmit={submit}>
        {/* Mã chỉ hỏi khi THÊM: BE không cho đổi mã (đơn cũ, QR bàn bám vào nó). */}
        {!existing && (
          <div>
            <label htmlFor="t-code">Mã bàn (vd ban-61, ship-10)</label>
            <input
              id="t-code"
              value={code}
              onChange={(e) => { setCode(e.target.value.toLowerCase()); setErr(null); }}
              placeholder="ban-61"
              autoFocus
              autoCapitalize="none"
            />
          </div>
        )}
        <div>
          <label htmlFor="t-name">Tên bàn</label>
          <input
            id="t-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setErr(null); }}
            placeholder="vd: Bàn 61, Mang về 4, Ship 10"
          />
        </div>
        <div>
          <label>Loại bàn</label>
          <KindSeg value={kind} onChange={setKind} />
        </div>
        {/* Hàng/cột (y/x): server trả danh sách bàn sắp theo y rồi x — màn Order dùng thứ tự đó.
            Gần như không ai sửa nên thu gọn, khỏi làm rối form. */}
        <details className="ba-adv">
          <summary>
            Thứ tự hiển thị
            <Icon name="mui-ten-xuong" size={18} />
          </summary>
          <div className="ba-row2">
            <div>
              <label htmlFor="t-y">Hàng</label>
              <input id="t-y" type="number" inputMode="numeric" value={y} onChange={(e) => setY(Number(e.target.value) || 0)} min={0} />
            </div>
            <div>
              <label htmlFor="t-x">Cột</label>
              <input id="t-x" type="number" inputMode="numeric" value={x} onChange={(e) => setX(Number(e.target.value) || 0)} min={0} />
            </div>
          </div>
          <p className="ba-adv__hint">Thường không cần sửa. Số nhỏ đứng trước ở màn Order (0, 0 = đầu tiên).</p>
        </details>
        {err && <div className="ba-err">{err}</div>}
      </form>
    </Sheet>
  );
}
