// Trang con "Top món bán chạy" (đợt 2, 2026-11-16) — tách từ tab con cũ.
// Bảng xếp hạng ở trang khách `/top`: số suất LUÔN là số bán thật (cả tại quán lẫn online) — trang
// này KHÔNG có và KHÔNG ĐƯỢC thêm ô "cộng thêm số ảo" (DESIGN.md apps/shop cấm số liệu bịa). Admin chỉ
// chỉnh cách trình bày. Công tắc + ô chọn lưu ngay; số món và danh sách món ẩn dùng thanh Lưu.
import { useEffect, useState } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { filterMenuBySearch } from '../../lib/menu-search.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { Switch } from '../../components/ui/Switch.tsx';
import { CdRow, CdSection, SaveBar, useSaveSetting, useServerDraft } from './parts.tsx';
import type { SettingsResponse, StoreSettingsMap } from './settings-data.ts';

type PickableMenuItem = { id: string; code: string; name: string; is_active: boolean };

const TOP_WINDOW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Từ trước tới nay' },
  { value: '30d', label: '30 ngày gần nhất' },
  { value: '7d', label: '7 ngày gần nhất' },
  { value: 'today', label: 'Chỉ hôm nay' },
];

export function TopDishesPage({
  data,
  patch,
  onSaved,
}: {
  data: SettingsResponse;
  patch: (p: Partial<StoreSettingsMap>) => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const saveNow = useSaveSetting();
  const s = data.settings;
  const { draft, setDraft, dirty, reset } = useServerDraft({
    limit: s.top_dishes_limit,
    hiddenIds: [...s.top_dishes_hidden_ids].sort(),
  });
  const [saving, setSaving] = useState(false);
  const [menuItems, setMenuItems] = useState<PickableMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .get<{ data: { items: PickableMenuItem[] } }>('/menu?page_size=2000')
      .then((res) => setMenuItems(res.data.data.items.filter((it) => it.is_active)))
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setMenuLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setNow = async (p: Partial<StoreSettingsMap>, undo: Partial<StoreSettingsMap>, okMsg: string) => {
    patch(p);
    if (!(await saveNow(p, okMsg))) patch(undo);
  };

  const toggleHidden = (id: string) =>
    setDraft((d) => ({
      ...d,
      hiddenIds: (d.hiddenIds.includes(id) ? d.hiddenIds.filter((h) => h !== id) : [...d.hiddenIds, id]).sort(),
    }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', { top_dishes_limit: draft.limit, top_dishes_hidden_ids: draft.hiddenIds });
      toast.push('success', 'Đã lưu Top món');
      await onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const on = s.top_dishes_enabled;
  const filtered = filterMenuBySearch(menuItems, search);

  return (
    <div className="cd-stack">
      <CdSection label="Bảng xếp hạng trên trang khách">
        <CdRow
          title="Hiện bảng Món bán chạy"
          info="Trang khách có màn Món bán chạy — số suất đã phục vụ là số bán THẬT (cả tại quán lẫn online), khách mở trang sẽ thấy số đếm chạy lên."
        >
          <Switch label="Hiện bảng Món bán chạy" on={on}
                  onChange={(v) => void setNow({ top_dishes_enabled: v }, { top_dishes_enabled: !v }, v ? 'Đã bật Top món' : 'Đã tắt Top món')} />
        </CdRow>
        <CdRow title="Số món hiển thị" sub="Từ 3 đến 10 món" dim={!on}>
          <input className="cd-input cd-num" type="number" min={3} max={10} aria-label="Số món hiển thị" value={draft.limit}
                 onChange={(e) => setDraft((d) => ({ ...d, limit: Math.min(10, Math.max(3, Number(e.target.value) || 3)) }))} />
        </CdRow>
        <CdRow title="Đếm số suất" dim={!on}>
          <div className="cd-row__c--dd">
            <Dropdown
              ariaLabel="Đếm số suất"
              sheetTitle="Đếm số suất"
              value={s.top_dishes_window}
              neutralValue={s.top_dishes_window}
              options={TOP_WINDOW_OPTIONS}
              onChange={(v) => void setNow({ top_dishes_window: v }, { top_dishes_window: s.top_dishes_window }, 'Đã đổi cách đếm số suất')}
              full
            />
          </div>
        </CdRow>
      </CdSection>

      <CdSection label={`Món giấu khỏi bảng${draft.hiddenIds.length > 0 ? ` (đang giấu ${draft.hiddenIds.length})` : ''}`}>
        <CdRow title="Tìm món" sub="Món tick vẫn bán bình thường, chỉ không lên bảng xếp hạng" stack dim={!on}>
          {/* 16px để iPhone không tự phóng to; 44px cho ngón tay. */}
          <input id="td-search" className="cd-input" value={search} placeholder="Gõ tên món (không dấu cũng được)"
                 aria-label="Tìm món để giấu" onChange={(e) => setSearch(e.target.value)} />
        </CdRow>
        <div className={`cd-picklist${on ? '' : ' is-dim'}`}>
          {menuLoading && <div className="cd-row"><span className="cd-row__s">Đang tải thực đơn…</span></div>}
          {!menuLoading && filtered.length === 0 && <div className="cd-row"><span className="cd-row__s">Không có món nào khớp.</span></div>}
          {filtered.map((it) => {
            const an = draft.hiddenIds.includes(it.id);
            return (
              <label key={it.id} className="cd-row cd-pick">
                <input type="checkbox" checked={an} onChange={() => toggleHidden(it.id)} />
                <span className="cd-row__t">{it.name}</span>
                {an && <span className="cd-pill cd-pill--muted">đang giấu</span>}
              </label>
            );
          })}
        </div>
      </CdSection>

      <SaveBar dirty={dirty} saving={saving} what="Top món" onSave={() => void save()} onCancel={reset} />
    </div>
  );
}
