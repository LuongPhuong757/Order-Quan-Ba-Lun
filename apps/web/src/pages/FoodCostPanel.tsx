// Giá vốn món ăn (bước 5) — câu trả lời cuối cùng cho "NCC tăng giá thì sao".
//
// Bảng này không phải báo cáo để ngắm: nó nói món nào đang mỏng lãi, và nguyên liệu nào trong
// món đó ngốn tiền nhất — tức là nên gọi điện mặc cả cái gì trước.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { useAuth } from '../lib/auth-context.tsx';

type Component = {
  ingredient_id: string;
  ingredient_name: string;
  supplier_id: string | null;
  base_unit: string;
  qty_per_serving: number;
  unit_price_base: number | null;
  cost: number | null;
  share_pct: number | null;
  /** Nguyên liệu phụ (2026-10-22) — không cộng vào giá vốn trực tiếp, đi qua % phụ. */
  is_secondary: boolean;
};

type FoodCostRow = {
  menu_item_id: string;
  menu_item_name: string;
  sell_price: number;
  /** Giá vốn ĐẦY ĐỦ = `cost_main` + `overhead_amount`. */
  cost: number;
  cost_main: number;
  overhead_amount: number;
  missing: string[];
  complete: boolean;
  margin_amount: number | null;
  margin_pct: number | null;
  components: Component[];
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });

/** Màu theo biên lợi nhuận. Ngưỡng 25% / 50% là mức thường thấy ở quán ăn — dưới 25% là mỏng tới
 * mức một lần NCC tăng giá là lỗ. */
function marginColor(pct: number | null): string {
  if (pct === null) return C.muted;
  if (pct < 25) return '#b91c1c';
  if (pct < 50) return '#b45309';
  return '#15803d';
}

export function FoodCostPanel() {
  const toast = useToast();
  const { user } = useAuth();
  // Owner cũng mang role admin. Role `report` chỉ xem: thấy % đang áp nhưng không có ô sửa.
  const canEdit = user?.role === 'admin';
  const [rows, setRows] = useState<FoodCostRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [overheadPct, setOverheadPct] = useState(0);
  const [referencePct, setReferencePct] = useState<number | null>(null);

  const load = useCallback(() => {
    setRows(null);
    api
      .get<{
        data: { from: string; items: FoodCostRow[]; overhead_pct: number; overhead_reference_pct: number | null };
      }>('/supplier-reports/food-cost')
      .then((r) => {
        setRows(r.data.data.items);
        setFrom(r.data.data.from);
        setOverheadPct(r.data.data.overhead_pct ?? 0);
        setReferencePct(r.data.data.overhead_reference_pct ?? null);
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [toast]);

  useEffect(load, [load]);

  // Món mỏng lãi nhất nằm trên. Món chưa đủ giá nguyên liệu xuống cuối — con số của chúng chưa
  // dùng để ra quyết định được, để lẫn lên đầu chỉ gây hiểu nhầm.
  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) => {
        if (a.complete !== b.complete) return a.complete ? -1 : 1;
        return (a.margin_pct ?? 999) - (b.margin_pct ?? 999);
      }),
    [rows],
  );

  const incomplete = sorted.filter((r) => !r.complete);
  // % = 0 nghĩa là "chưa đặt": bảng giữ đúng hình dạng cũ, không thêm cột (chủ quán chốt 2026-10-22).
  const showMain = overheadPct > 0;

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (rows.length === 0) {
    return (
      <div className="empty-state card">
        Chưa món nào có công thức. Khai công thức ở màn Menu rồi quay lại đây.
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 14, color: C.mutedOnTint, margin: '0 0 12px' }}>
        Giá vốn tính theo <strong>giá mua bình quân</strong> từ {from} tới nay — không phải giá lần
        nhập cuối, để một đợt mua lẻ đắt đỏ không kéo lệch cả bảng.
      </p>

      <OverheadPctBox
        pct={overheadPct}
        referencePct={referencePct}
        canEdit={canEdit}
        onSaved={load}
      />

      {incomplete.length > 0 && (
        // Nói thẳng ra, không giấu: giá vốn thiếu nguyên liệu luôn THẤP hơn thật, tức biên lợi
        // nhuận đẹp hơn thật.
        <div className="card" style={{ marginBottom: 12, background: '#fffbeb' }}>
          <strong>{incomplete.length} món chưa đủ giá nguyên liệu</strong>
          <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 4 }}>
            Những món đó chưa tính được biên lợi nhuận. Nhập một phiếu có nguyên liệu còn thiếu là
            bảng tự đủ.
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 8 }}>Món</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Giá bán</th>
              {showMain && <th style={{ padding: 8, textAlign: 'right' }}>NL chính</th>}
              <th style={{ padding: 8, textAlign: 'right' }}>{showMain ? 'Giá vốn đủ' : 'Giá vốn'}</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Lãi/phần</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Biên LN</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <>
                <tr
                  key={r.menu_item_id}
                  onClick={() => setOpen(open === r.menu_item_id ? null : r.menu_item_id)}
                  style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                >
                  <td style={{ padding: 8 }}>
                    {open === r.menu_item_id ? '▾ ' : '▸ '}
                    {r.menu_item_name}
                    {!r.complete && (
                      <div style={{ fontSize: 12, color: '#b45309' }}>
                        thiếu giá: {r.missing.join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{vnd(r.sell_price)}đ</td>
                  {showMain && (
                    <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}>{vnd(r.cost_main)}đ</td>
                  )}
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                    {vnd(r.cost)}đ{!r.complete && <span style={{ color: '#b45309' }}> +?</span>}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {r.margin_amount === null ? '—' : `${vnd(r.margin_amount)}đ`}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      fontWeight: 800,
                      color: marginColor(r.margin_pct),
                    }}
                  >
                    {r.margin_pct === null ? '—' : `${r.margin_pct.toLocaleString('vi-VN')}%`}
                  </td>
                </tr>
                {open === r.menu_item_id && (
                  <tr key={`${r.menu_item_id}-d`}>
                    <td colSpan={showMain ? 6 : 5} style={{ padding: '0 8px 12px', background: '#f9fafb' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {/* Sắp theo phần đóng góp giảm dần — nguyên liệu đáng đàm phán nằm trên. */}
                          {/* Nguyên liệu phụ xuống cuối: nó không nằm trong tổng ở trên. */}
                          {[...r.components]
                            .sort((a, b) =>
                              a.is_secondary !== b.is_secondary
                                ? a.is_secondary ? 1 : -1
                                : (b.cost ?? -1) - (a.cost ?? -1),
                            )
                            .map((c) => (
                              /* Khoá gồm NCC: từ 2026-10-19 một món có thể có hai dòng cùng nguyên liệu
                                 khác NCC ("Thịt bò · NCC A", "· NCC B"). Tên hiển thị BE đã ghép sẵn NCC. */
                              <tr key={`${c.ingredient_id}|${c.supplier_id ?? ''}`}>
                                <td style={{ padding: '4px 8px' }}>
                                  {c.ingredient_name}
                                  {c.is_secondary && (
                                    <span style={{ marginLeft: 6, fontSize: 12, color: C.muted }}>
                                      (phụ — tính qua %)
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: C.mutedOnTint }}>
                                  {num(c.qty_per_serving)} {c.base_unit}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: C.mutedOnTint }}>
                                  {c.unit_price_base === null ? (
                                    <span style={{ color: '#b45309' }}>chưa có giá</span>
                                  ) : (
                                    `${num(c.unit_price_base)} đ/${c.base_unit}`
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: '4px 8px',
                                    textAlign: 'right',
                                    fontWeight: c.is_secondary ? 400 : 600,
                                    color: c.is_secondary ? C.muted : undefined,
                                  }}
                                >
                                  {c.cost === null ? '—' : `${vnd(c.cost)}đ`}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', width: 56, color: C.muted }}>
                                  {c.share_pct === null ? '' : `${c.share_pct}%`}
                                </td>
                              </tr>
                            ))}
                          {r.overhead_amount > 0 && (
                            <tr style={{ borderTop: '1px dashed #d1d5db' }}>
                              <td style={{ padding: '4px 8px' }} colSpan={3}>
                                Nguyên liệu phụ ({overheadPct.toLocaleString('vi-VN')}% của {vnd(r.cost_main)}đ)
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
                                +{vnd(r.overhead_amount)}đ
                              </td>
                              <td />
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Ô % chi phí nguyên liệu phụ (2026-10-22).
 *
 * Số thực tế (tiền mua đồ phụ ÷ tiền mua nguyên liệu chính, cùng cửa sổ 90 ngày) chỉ hiện để
 * THAM KHẢO — chủ quán chốt không tự điền: tháng nào mua dồn bình gas thì số thực tế vọt lên,
 * tự điền theo là giá vốn cả bảng nhảy theo từng lần đổi bình.
 */
function OverheadPctBox({
  pct,
  referencePct,
  canEdit,
  onSaved,
}: {
  pct: number;
  referencePct: number | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(String(pct));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(String(pct)), [pct]);

  const parsed = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const changed = valid && Math.round(parsed * 10) / 10 !== pct;

  const save = async () => {
    if (!changed) return;
    setSaving(true);
    try {
      await api.put('/supplier-reports/overhead-pct', { pct: Math.round(parsed * 10) / 10 });
      toast.push('success', 'Đã lưu % chi phí phụ');
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>Chi phí nguyên liệu phụ</div>
      <div style={{ fontSize: 14, color: C.mutedOnTint, margin: '4px 0 10px' }}>
        Gas, hành lá, đá… không cân vào từng món. Cộng thêm bấy nhiêu % trên tiền nguyên liệu chính
        của mọi món.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {canEdit ? (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="% chi phí nguyên liệu phụ"
              style={{ width: 90, fontSize: 20, fontWeight: 700, padding: '8px 10px', textAlign: 'right' }}
            />
            <span style={{ fontSize: 20, fontWeight: 700 }}>%</span>
            <button type="button" onClick={save} disabled={!changed || saving} style={{ minHeight: 44 }}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 20, fontWeight: 700 }}>{pct.toLocaleString('vi-VN')}%</span>
        )}
        {referencePct !== null && (
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>
            Thực tế 90 ngày qua: <strong>{referencePct.toLocaleString('vi-VN')}%</strong>
          </span>
        )}
      </div>
      {canEdit && draft.trim() !== '' && !valid && (
        <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 6 }}>Nhập số từ 0 đến 100.</div>
      )}
      {pct === 0 && (
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
          Đang là 0% — giá vốn chưa tính phần nguyên liệu phụ.
        </div>
      )}
    </div>
  );
}
