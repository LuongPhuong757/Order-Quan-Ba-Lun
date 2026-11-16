// Nhóm "Thông tin quán" (đợt 2, 2026-11-16). Bản cũ: MỘT khối gập lồng trong trang, tiêu đề
// "Thông tin quán" lặp hai lần, mỗi ô một câu giải thích dài.
//
// Nay: 2 thẻ "Liên hệ" / "Trên trang khách", giải thích vào ⓘ. Điện thoại: toạ độ và 3 link mạng xã
// hội thu thành hàng chạm-mới-mở (chủ quán chọn ẩn trên điện thoại — ít khi sửa). Cả trang một
// thanh Lưu dính đáy; chỉ gửi đúng 7 field store_* như cũ.
import { useState } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { useIsPhone } from '../../components/ui/use-is-phone.ts';
import { CdRow, CdSection, SaveBar, useServerDraft } from './parts.tsx';
import type { SettingsResponse } from './settings-data.ts';

type StoreDraft = {
  phone: string;
  address: string;
  facebookUrl: string;
  instagramUrl: string;
  zalo: string;
  lat: number | '';
  lng: number | '';
};

export function StoreInfoPage({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const isPhone = useIsPhone();
  const s = data.settings;
  // Chuẩn hoá `null → ''` cho toạ độ: server trả `null` còn ô rỗng là `''` — không chuẩn hoá là
  // trang luôn báo "Chưa lưu" ngay khi vừa tải.
  const { draft, setDraft, dirty, reset } = useServerDraft<StoreDraft>({
    phone: s.store_phone,
    address: s.store_address,
    facebookUrl: s.store_facebook_url,
    instagramUrl: s.store_instagram_url,
    zalo: s.store_zalo,
    lat: s.store_lat ?? '',
    lng: s.store_lng ?? '',
  });
  const [saving, setSaving] = useState(false);
  // Điện thoại: hàng toạ độ / mạng xã hội gập sẵn, chạm mới mở ô (chủ quán chọn — ít khi sửa).
  const [openGeo, setOpenGeo] = useState(false);
  const [openSocial, setOpenSocial] = useState(false);
  const set = (p: Partial<StoreDraft>) => setDraft((d) => ({ ...d, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        store_phone: draft.phone,
        store_address: draft.address,
        store_facebook_url: draft.facebookUrl,
        store_instagram_url: draft.instagramUrl,
        store_zalo: draft.zalo,
        ...(draft.lat !== '' ? { store_lat: draft.lat } : {}),
        ...(draft.lng !== '' ? { store_lng: draft.lng } : {}),
      });
      toast.push('success', 'Đã lưu thông tin quán');
      await onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const soMxh = [draft.facebookUrl, draft.instagramUrl, draft.zalo].filter((v) => v.trim()).length;
  const coToaDo = draft.lat !== '' && draft.lng !== '';
  const hienToaDo = !isPhone || openGeo;
  const hienMxh = !isPhone || openSocial;

  return (
    <div className="cd-stack">
      <CdSection label="Liên hệ">
        <CdRow title="Số điện thoại quán" info="Khách bấm gọi số này từ trang theo dõi đơn." stack>
          <input id="s-phone" className="cd-input" type="tel" value={draft.phone} maxLength={16}
                 aria-label="Số điện thoại quán" onChange={(e) => set({ phone: e.target.value })} />
        </CdRow>
        <CdRow
          title="Địa chỉ quán"
          info="Hiện ở chân trang khách — khách bấm là mở Google Maps. Gõ địa chỉ chữ, hoặc dán link chia sẻ Google Maps (maps.app.goo.gl/...) để ghim trỏ đúng quán."
          stack
        >
          <input id="s-address" className="cd-input" value={draft.address} maxLength={255}
                 aria-label="Địa chỉ quán" placeholder="Ví dụ: 123 Nguyễn Trãi, TP. Bắc Ninh"
                 onChange={(e) => set({ address: e.target.value })} />
        </CdRow>
        {hienToaDo ? (
          <CdRow
            title="Vị trí trên bản đồ (toạ độ)"
            info="Dùng để tính khoảng cách tới khách. Thiếu toạ độ thì trang khách không hiện được số km và bán kính giao chưa chặn được đơn nào."
            stack
          >
            <div className="cd-two">
              <input className="cd-input" type="number" placeholder="Vĩ độ" aria-label="Vĩ độ" value={draft.lat}
                     onChange={(e) => set({ lat: e.target.value === '' ? '' : Number(e.target.value) })} />
              <input className="cd-input" type="number" placeholder="Kinh độ" aria-label="Kinh độ" value={draft.lng}
                     onChange={(e) => set({ lng: e.target.value === '' ? '' : Number(e.target.value) })} />
            </div>
          </CdRow>
        ) : (
          <button type="button" className="cd-row cd-row--btn" onClick={() => setOpenGeo(true)}>
            <span className="cd-row__m">
              <span className="cd-row__t">Vị trí trên bản đồ</span>
              <span className="cd-row__s">Dùng để tính km tới khách</span>
            </span>
            <span className="cd-row__v">{coToaDo ? 'Đã ghim' : 'Chưa có'}</span>
          </button>
        )}
      </CdSection>

      <CdSection label="Trên trang khách">
        {hienMxh ? (
          <>
            <CdRow title="Facebook" sub={isPhone ? undefined : 'Hiện thành nút ở chân trang khách'} stack>
              <input id="s-facebook" className="cd-input" type="url" value={draft.facebookUrl} maxLength={255}
                     aria-label="Facebook" placeholder="https://facebook.com/quanbalun"
                     onChange={(e) => set({ facebookUrl: e.target.value })} />
            </CdRow>
            <CdRow title="Instagram" stack>
              <input id="s-instagram" className="cd-input" type="url" value={draft.instagramUrl} maxLength={255}
                     aria-label="Instagram" placeholder="https://instagram.com/quanbalun"
                     onChange={(e) => set({ instagramUrl: e.target.value })} />
            </CdRow>
            <CdRow title="Zalo" info="Số điện thoại Zalo hoặc link Zalo OA — khách bấm là mở cửa sổ chat." stack>
              <input id="s-zalo" className="cd-input" value={draft.zalo} maxLength={255}
                     aria-label="Zalo" placeholder="0912345678 hoặc https://zalo.me/..."
                     onChange={(e) => set({ zalo: e.target.value })} />
            </CdRow>
          </>
        ) : (
          <button type="button" className="cd-row cd-row--btn" onClick={() => setOpenSocial(true)}>
            <span className="cd-row__m">
              <span className="cd-row__t">Mạng xã hội</span>
              <span className="cd-row__s">Facebook, Instagram, Zalo — ô trống thì khách không thấy</span>
            </span>
            <span className="cd-row__v">{soMxh}/3</span>
          </button>
        )}
      </CdSection>

      <SaveBar dirty={dirty} saving={saving} what="Thông tin quán" onSave={() => void save()} onCancel={reset} />
    </div>
  );
}
