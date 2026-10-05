// Màn "Combo gợi ý" (chủ quán chốt 2026-10-03) — chủ quán chọn các món để nhân vật ở thực đơn
// tại bàn mời khách, tạo thành một vòng lặp quanh những món quán muốn khách trải nghiệm:
//   - khách thêm món nằm trong combo → chỉ mời các món khác của combo đó;
//   - món ngoài combo, hoặc combo đã hết món → mời ngẫu nhiên từ "Món đề xuất";
//   - hết cả hai → không mời gì.
//
// KHÔNG phải nhóm món "Combo" trong menu (món có giá, vào bếp). Combo ở đây không có giá, không
// vào đơn — chỉ là bảng ghép để mời. Câu thoại của nhân vật nằm trong code, ở đây chỉ chọn MÓN.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

type MenuRow = { id: string; name: string; price: number; is_active: boolean; is_out_of_stock: boolean };
type Combo = { id: string; name: string; emoji: string | null; item_ids: string[]; is_active: boolean; sort_order: number };
type Draft = { id: string | null; name: string; emoji: string; item_ids: string[] };

const fmtK = (v: number) => `${Math.round(v / 1000)}k`;
/** Bỏ dấu để gõ "ga rang" ra "Gà Rang Muối" — chủ quán gõ vội trên điện thoại. */
const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/**
 * Combo mẫu — dựng từ thực đơn thật ngày 2026-10-03, chủ quán đã duyệt danh sách này trong buổi
 * bàn. Khớp theo TÊN món (không theo id) nên quán đổi giá, xoá món vẫn tạo được; món nào không còn
 * thì bỏ, combo dưới 2 món thì không tạo.
 */
const SAMPLES: { name: string; emoji: string; items: string[] }[] = [
  { name: 'Hải sản lai rai', emoji: '🦪', items: ['Ốc Mít/ To Xào Sả', 'Hàu Nướng 10 Con', 'Ngao Hấp Thái', 'Dưa Chuột', 'Bia Tiger', 'Mỳ/ Mì Xào Hải Sản'] },
  { name: 'Rượu quê', emoji: '🍶', items: ['Lòng Trần Thập Cẩm', 'Nộm Tai Lợn', 'Dưa Chuột - Xoài', 'Rượu Men Lá', 'Cơm Rang Dưa Bò'] },
  { name: 'Bữa cơm nhóm', emoji: '🍗', items: ['Gà Rang Muối', 'Rau Muống Xào', 'Canh Nga0', 'Ca Trà Đá', 'Cơm Trắng 30k'] },
  { name: 'Bia giòn rụm', emoji: '🍺', items: ['Cánh Gà Chiên Mắm', 'Nem Chua Rán', 'Khoai Tây Lắc Phô Mai', 'Xoài Lắc', 'Bia Hơi Ca', 'Mỳ/ Mì Xào Bò 100k'] },
  { name: 'Ếch đồng', emoji: '🐸', items: ['Ếch Xào Lá Lốt', 'Trạch Chiên Lá Lốt', 'Rau Bí Xào', 'Rượu Nếp', 'Cơm Trắng 30k'] },
  { name: 'Ngồi chơi không nhậu', emoji: '🧋', items: ['Ca Trà Chanh', 'Nem Chua Thanh Hóa', 'Hoa Quả Thập Cẩm', 'Hướng Dương Có Vị'] },
];

export function MenuComboPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<MenuRow[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const load = async () => {
    try {
      const [menuRes, comboRes] = await Promise.all([
        api.get<{ data: { items: MenuRow[] } }>('/menu?page_size=2000'),
        api.get<{ data: { items: Combo[] } }>('/menu-combos'),
      ]);
      setItems(menuRes.data.data.items.filter((it) => it.is_active));
      setCombos(comboRes.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (c: Combo) => {
    setBusy(true);
    try {
      await api.patch(`/menu-combos/${c.id}`, { is_active: !c.is_active });
      setCombos((list) => list.map((x) => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)));
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Combo) => {
    const ok = await confirm({
      title: `Xoá combo "${c.name}"?`,
      message: 'Nhân vật sẽ không mời món theo combo này nữa. Muốn tạm dừng thì bấm "Đang bật" để tắt thay vì xoá.',
      variant: 'danger',
      confirmLabel: 'Xoá combo',
    });
    if (!ok) return;
    try {
      await api.delete(`/menu-combos/${c.id}`);
      setCombos((list) => list.filter((x) => x.id !== c.id));
      toast.push('success', `Đã xoá combo ${c.name}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const createSamples = async () => {
    const idByName = new Map(items.map((i) => [fold(i.name), i.id]));
    let made = 0;
    setBusy(true);
    try {
      for (const s of SAMPLES) {
        const ids = s.items.map((n) => idByName.get(fold(n))).filter((id): id is string => !!id);
        if (ids.length < 2) continue;
        await api.post('/menu-combos', { name: s.name, emoji: s.emoji, item_ids: ids });
        made += 1;
      }
      toast.push('success', `Đã tạo ${made} combo mẫu — sửa lại tuỳ ý`);
      await load();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.push('error', 'Đặt tên cho combo đã');
      return;
    }
    if (draft.item_ids.length < 2) {
      toast.push('error', 'Combo cần ít nhất 2 món');
      return;
    }
    setBusy(true);
    try {
      const body = { name: draft.name, emoji: draft.emoji, item_ids: draft.item_ids };
      if (draft.id) await api.patch(`/menu-combos/${draft.id}`, body);
      else await api.post('/menu-combos', body);
      toast.push('success', `Đã lưu combo ${draft.name}`);
      setDraft(null);
      await load();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 720, width: '100%', minWidth: 0 }}>
        <div className="flex between" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>🎯 {draft ? (draft.id ? 'Sửa combo' : 'Combo mới') : 'Combo gợi ý'}</h2>
          <button
            className="secondary"
            onClick={() => {
              if (draft && !window.confirm('Có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
              onClose();
            }}
            style={{ padding: '6px 10px' }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p style={{ color: C.muted, fontSize: 15 }}>Đang tải…</p>
        ) : draft ? (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={draft.emoji}
                onChange={(e) => setDraft({ ...draft, emoji: e.target.value.slice(0, 4) })}
                placeholder="🍺"
                aria-label="Biểu tượng"
                style={{ width: 64, fontSize: 20, textAlign: 'center', padding: 8 }}
              />
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Tên combo, vd: Bia giòn rụm"
                maxLength={64}
                style={{ flex: 1, minWidth: 0, fontSize: 16, padding: 10 }}
              />
            </div>
            <ItemPicker
              ids={draft.item_ids}
              onChange={(item_ids) => setDraft({ ...draft, item_ids })}
              items={items}
              byId={byId}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="secondary" onClick={() => setDraft(null)} style={{ padding: '10px 14px', fontSize: 15 }}>
                Huỷ
              </button>
              <button onClick={() => void save()} disabled={busy} style={{ padding: '10px 18px', fontSize: 15 }}>
                {busy ? 'Đang lưu…' : 'Lưu combo'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: '75dvh', overflowY: 'auto' }}>
            <p style={{ margin: '4px 0 12px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
              Khách thêm một món nằm trong combo → bạn nhỏ đồng hành <strong>chỉ mời các món khác của
              combo đó</strong>. Món ngoài combo, hoặc combo đã gọi hết → mời ngẫu nhiên từ{' '}
              <strong>Món đề xuất</strong>. Hết cả hai thì thôi không mời.
            </p>
            {/* Mục "Món đề xuất" đã CHUYỂN khỏi đây (chủ quán chốt 2026-10-05) sang nút ⭐ trên
                từng thẻ món ở màn Thực đơn. Lý do: chọn ở đây phải gõ TÌM LẠI TÊN món vừa nhìn
                thấy trên lưới thực đơn, trong khi lưới đó đã có sẵn ô tìm, bộ lọc nhóm và ảnh.
                Để lại một dòng chỉ đường, vì câu giải thích ngay trên vẫn nhắc tới nó. */}
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
              ⭐ Chọn <strong>Món đề xuất</strong> ngay trên màn <strong>Thực đơn</strong> — mỗi thẻ
              món có nút “⭐ Đề xuất”, bấm phát là xong.
            </p>

            {/* ── Combo ──────────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                onClick={() => setDraft({ id: null, name: '', emoji: '', item_ids: [] })}
                style={{ padding: '10px 14px', fontSize: 15 }}
              >
                + Combo mới
              </button>
              {combos.length === 0 && (
                <button className="secondary" disabled={busy} onClick={() => void createSamples()} style={{ padding: '10px 14px', fontSize: 15 }}>
                  ✨ Tạo 6 combo mẫu
                </button>
              )}
            </div>

            {combos.length === 0 && <p style={{ color: C.muted, fontSize: 15 }}>Chưa có combo nào.</p>}

            <div style={{ display: 'grid', gap: 10 }}>
              {combos.map((c) => (
                <div key={c.id} className="card" style={{ padding: 12, opacity: c.is_active ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 17, flex: 1, minWidth: 140 }}>
                      {c.emoji ? `${c.emoji} ` : ''}
                      {c.name}
                    </strong>
                    <button
                      className={c.is_active ? '' : 'secondary'}
                      disabled={busy}
                      onClick={() => void toggle(c)}
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    >
                      {c.is_active ? '● Đang bật' : '○ Đang tắt'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setDraft({ id: c.id, name: c.name, emoji: c.emoji ?? '', item_ids: [...c.item_ids] })}
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    >
                      Sửa
                    </button>
                    <button className="secondary" onClick={() => void remove(c)} style={{ padding: '8px 12px', fontSize: 14, color: C.danger }}>
                      Xoá
                    </button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>
                    {c.item_ids.map((id) => byId.get(id)?.name ?? '(món đã xoá)').join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Danh sách món có nút ✕ bỏ món + ô gõ tìm món để thêm. Chỉ còn combo dùng — món đề xuất đã
 *  chuyển sang nút ⭐ trên từng thẻ ở màn Thực đơn (2026-10-05). */
function ItemPicker({
  ids,
  onChange,
  items,
  byId,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  items: MenuRow[];
  byId: Map<string, MenuRow>;
}) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const needle = fold(q);
    if (!needle) return [];
    const used = new Set(ids);
    return items.filter((it) => !used.has(it.id) && fold(it.name).includes(needle)).slice(0, 8);
  }, [q, items, ids]);

  return (
    <div>
      {/* Ô gõ + gợi ý đứng TRÊN danh sách đã chọn: combo nhiều món thì danh sách đẩy ô gõ xuống
          đáy hộp, gợi ý hiện ra khuất dưới mép màn — chủ quán tưởng gõ không ra gì (2026-10-03). */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="+ Gõ tên món để thêm"
        style={{ width: '100%', fontSize: 16, padding: 8, boxSizing: 'border-box' }}
      />
      {hits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {hits.map((it) => (
            <button
              key={it.id}
              className="secondary"
              onClick={() => {
                onChange([...ids, it.id]);
                setQ('');
              }}
              style={{ padding: '6px 10px', fontSize: 14 }}
            >
              + {it.name} · {fmtK(it.price)}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {ids.length === 0 && <span style={{ color: C.muted, fontSize: 14 }}>Chưa có món nào.</span>}
        {ids.map((id) => {
          const it = byId.get(id);
          return (
            <span
              key={id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 15,
                padding: '4px 4px 4px 10px', background: C.panelBg, borderRadius: 999, maxWidth: '100%',
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it ? it.name : '(món đã xoá)'}
                {it ? <span style={{ color: C.muted }}> · {fmtK(it.price)}</span> : null}
                {it?.is_out_of_stock ? <span style={{ color: C.warnText }}> · tạm hết</span> : null}
              </span>
              <button
                className="secondary"
                onClick={() => onChange(ids.filter((x) => x !== id))}
                aria-label={`Bỏ ${it?.name ?? 'món'}`}
                style={{ padding: '2px 8px', borderRadius: 999, flex: 'none' }}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
