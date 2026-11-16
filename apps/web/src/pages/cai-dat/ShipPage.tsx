// Trang con "Nhận hàng & phí ship" (đợt 2, 2026-11-16) — tách từ khối "Hình thức nhận hàng".
// Mỗi hình thức vẫn đi kèm ETA và phí CỦA CHÍNH NÓ (sửa lỗi cấu trúc 2026-08-04). Đổi:
// - công tắc Khách đến lấy / Giao tận nơi LƯU NGAY (bản cũ phải bấm "Lưu hình thức nhận hàng");
// - ô số + bảng phí gom vào thanh Lưu dính đáy; giải thích dài vào ⓘ.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_SHIP_FEE_TIERS, type ShipFeeTier } from '@order/schemas';
import { api, extractError } from '../../lib/api.ts';
import { digitsOnly, formatMoneyInput } from '../../lib/money-input.ts';
import { settingsHref } from '../../lib/settings-groups.ts';
import { useToast } from '../../components/Toast.tsx';
import { Switch } from '../../components/ui/Switch.tsx';
import { CdRow, CdSection, SaveBar, useSaveSetting, useServerDraft } from './parts.tsx';
import type { SettingsResponse, StoreSettingsMap } from './settings-data.ts';

// Form giữ CHUỖI (có dấu chấm nghìn), chỉ bóc về số lúc gửi — cùng quy ước `money-input.ts`. Giữ
// số thô rồi format lúc vẽ làm con trỏ nhảy về cuối ô mỗi lần sửa giữa chuỗi.
type TierDraft = { min_subtotal: string; free_km: string; per_km: string };

/** Bảng mẫu = đúng bảng chủ quán mô tả 2026-08-07. Chỉ là điểm khởi đầu, sửa được hết. */
const SAMPLE_TIERS: TierDraft[] = [
  { min_subtotal: '0', free_km: '3', per_km: '5.000' },
  { min_subtotal: '100.000', free_km: '5', per_km: '5.000' },
  { min_subtotal: '300.000', free_km: '7', per_km: '5.000' },
  { min_subtotal: '500.000', free_km: '10', per_km: '5.000' },
];

function toDrafts(tiers: ShipFeeTier[]): TierDraft[] {
  return [...tiers]
    .sort((a, b) => a.min_subtotal - b.min_subtotal)
    .map((t) => ({
      min_subtotal: formatMoneyInput(String(t.min_subtotal)),
      free_km: String(t.free_km),
      per_km: formatMoneyInput(String(t.per_km)),
    }));
}

/** Ô trống đọc thành 0; dòng ĐẦU luôn ép về mốc 0 (BE cũng chặn, chặn sớm để không gặp câu lỗi). */
function draftsToTiers(drafts: TierDraft[]): ShipFeeTier[] {
  return drafts.map((d, i) => ({
    min_subtotal: i === 0 ? 0 : Number(digitsOnly(d.min_subtotal) || '0'),
    free_km: Number(d.free_km || '0'),
    per_km: Number(digitsOnly(d.per_km) || '0'),
  }));
}

/** Ô bán kính → km gửi BE. Ô TRỐNG / gõ dở / âm = 0 = không giới hạn. Trần 100 khớp `@Max(100)`. */
function parseMaxDeliveryKm(raw: string): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

type ShipDraft = {
  etaPickupMin: number;
  etaPickupMax: number;
  etaDeliveryMin: number;
  etaDeliveryMax: number;
  distanceFactor: number;
  maxDeliveryKm: string;
  tiers: TierDraft[];
};

function NumInput({ value, onChange, label, step, min = 0, max }: {
  value: number | string; onChange: (v: string) => void; label: string; step?: number; min?: number; max?: number;
}) {
  return (
    <input className="cd-input cd-num" type="number" inputMode="decimal" aria-label={label}
           value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value)} />
  );
}

export function ShipPage({
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
  const { draft, setDraft, dirty, reset } = useServerDraft<ShipDraft>({
    etaPickupMin: s.eta_pickup_min,
    etaPickupMax: s.eta_pickup_max,
    etaDeliveryMin: s.eta_delivery_min,
    etaDeliveryMax: s.eta_delivery_max,
    distanceFactor: s.distance_factor,
    maxDeliveryKm: String(s.max_delivery_km),
    tiers: toDrafts(s.ship_fee_tiers),
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<ShipDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setTier = (i: number, p: Partial<TierDraft>) =>
    setDraft((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) }));

  const toggle = async (key: 'pickup_enabled' | 'delivery_enabled', next: boolean, okMsg: string) => {
    patch({ [key]: next });
    if (!(await saveNow({ [key]: next }, okMsg))) patch({ [key]: !next });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        eta_pickup_min: draft.etaPickupMin,
        eta_pickup_max: draft.etaPickupMax,
        eta_delivery_min: draft.etaDeliveryMin,
        eta_delivery_max: draft.etaDeliveryMax,
        ship_fee_tiers: draftsToTiers(draft.tiers),
        distance_factor: draft.distanceFactor,
        max_delivery_km: parseMaxDeliveryKm(draft.maxDeliveryKm),
      });
      toast.push('success', 'Đã lưu nhận hàng & phí ship');
      await onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const giao = s.delivery_enabled;
  const km = parseMaxDeliveryKm(draft.maxDeliveryKm);
  const thieuToaDo = s.store_lat === null || s.store_lng === null;
  const { tiers } = draft;

  return (
    <div className="cd-stack">
      <CdSection label="Khách đến lấy">
        <CdRow title="Khách đến lấy" sub="Tắt thì khách không chọn được hình thức này">
          <Switch label="Khách đến lấy" on={s.pickup_enabled}
                  onChange={(v) => void toggle('pickup_enabled', v, v ? 'Đã bật Khách đến lấy' : 'Đã tắt Khách đến lấy')} />
        </CdRow>
        <CdRow title="Bao lâu có hàng" dim={!s.pickup_enabled}>
          <div className="cd-two cd-two--range">
            <NumInput label="Ít nhất (phút)" value={draft.etaPickupMin} max={240} onChange={(v) => set({ etaPickupMin: Number(v) })} />
            <span>–</span>
            <NumInput label="Nhiều nhất (phút)" value={draft.etaPickupMax} max={240} onChange={(v) => set({ etaPickupMax: Number(v) })} />
            <span className="cd-unit">phút</span>
          </div>
        </CdRow>
      </CdSection>

      <CdSection label="Giao tận nơi">
        <CdRow title="Giao tận nơi" sub="Tắt thì giá trị bên dưới vẫn giữ, không mất">
          <Switch label="Giao tận nơi" on={giao}
                  onChange={(v) => void toggle('delivery_enabled', v, v ? 'Đã bật Giao tận nơi' : 'Đã tắt Giao tận nơi')} />
        </CdRow>
        <CdRow title="Bao lâu thì tới" dim={!giao}>
          <div className="cd-two cd-two--range">
            <NumInput label="Ít nhất (phút)" value={draft.etaDeliveryMin} max={240} onChange={(v) => set({ etaDeliveryMin: Number(v) })} />
            <span>–</span>
            <NumInput label="Nhiều nhất (phút)" value={draft.etaDeliveryMax} max={240} onChange={(v) => set({ etaDeliveryMax: Number(v) })} />
            <span className="cd-unit">phút</span>
          </div>
        </CdRow>
        {/* Khác mọi ô còn lại: các ô kia đổi CON SỐ khách thấy, ô này TỪ CHỐI đơn — nên nói rõ trong ⓘ,
            và cảnh báo cam khi thiếu toạ độ (không đo được thì không chặn được đơn nào). */}
        <CdRow
          title="Bán kính giao tối đa"
          dim={!giao}
          sub={km === 0 ? 'Đang để 0 = không giới hạn' : undefined}
          warn={km > 0 && thieuToaDo ? (
            <>Quán chưa có toạ độ ở <Link to={settingsHref('store')} className="cd-inlink">Thông tin quán</Link> — chưa chặn được đơn nào</>
          ) : undefined}
          info="Khách chia sẻ vị trí mà xa hơn mức này thì hệ thống tự từ chối đơn giao ngay lúc khách đặt — không vào hàng chờ, không phải gọi lại để huỷ. Để trống hoặc 0 là không giới hạn."
        >
          <div className="cd-two">
            <NumInput label="Bán kính giao tối đa (km)" value={draft.maxDeliveryKm} max={100} step={0.5} onChange={(v) => set({ maxDeliveryKm: v })} />
            <span className="cd-unit">km</span>
          </div>
        </CdRow>
        <CdRow title="Hệ số đường thực tế" dim={!giao} info="Đường đi thực tế dài hơn đường chim bay bao nhiêu lần. Dùng để ước km khi tính phí ship.">
          <NumInput label="Hệ số đường thực tế" value={draft.distanceFactor} min={1} max={3} step={0.1}
                    onChange={(v) => set({ distanceFactor: Number(v) })} />
        </CdRow>
      </CdSection>

      {/* Bảng phí theo GIÁ TRỊ ĐƠN (2026-08-07). Rỗng = không tự tính phí ship (đúng hành vi cũ).
          Bậc đầu LUÔN là "Mọi đơn" (mốc 0đ), không xoá được — thiếu nó thì đơn nhỏ không luật nào phủ. */}
      <CdSection label="Bảng phí ship theo giá trị đơn">
        <CdRow
          title={tiers.length === 0 ? 'Chưa có bảng phí' : 'Đơn càng lớn, miễn phí càng xa'}
          sub={tiers.length === 0 ? 'Hệ thống chưa tự tính tiền ship' : 'Phí khách thấy là tạm tính — nhân viên sửa được lúc duyệt đơn'}
          dim={!giao}
          info="Khách đọc được đúng bảng này ở trang đặt hàng và trang Hướng dẫn. Km vượt làm tròn lên km chẵn, tiền làm tròn lên 1.000đ. Phí cuối vẫn do quán chốt khi gọi lại."
        />
        {tiers.length === 0 ? (
          <div className="cd-row">
            <div className="cd-btns">
              <button type="button" className="secondary" disabled={!giao} onClick={() => set({ tiers: SAMPLE_TIERS.map((t) => ({ ...t })) })}>
                Dùng bảng mẫu
              </button>
              <button type="button" className="secondary" disabled={!giao}
                      onClick={() => set({ tiers: [{ min_subtotal: '0', free_km: '3', per_km: '5.000' }] })}>
                + Tự tạo
              </button>
            </div>
          </div>
        ) : (
          <>
            {tiers.map((t, i) => (
              <div className={`cd-row cd-tier${giao ? '' : ' is-dim'}`} key={i}>
                <label className="cd-tier__f">
                  <span>{i === 0 ? 'Áp dụng cho' : 'Đơn từ (đ)'}</span>
                  {i === 0 ? (
                    // Bậc gốc: mốc phải là 0 — hiện chữ thay vì ô khoá mờ để không ai tìm cách gõ vào.
                    <b>Mọi đơn</b>
                  ) : (
                    <input className="cd-input cd-num" inputMode="numeric" value={t.min_subtotal}
                           onChange={(e) => setTier(i, { min_subtotal: formatMoneyInput(e.target.value) })} />
                  )}
                </label>
                <label className="cd-tier__f">
                  <span>Miễn phí (km)</span>
                  <input className="cd-input cd-num" type="number" min={0} max={100} value={t.free_km}
                         onChange={(e) => setTier(i, { free_km: e.target.value })} />
                </label>
                <label className="cd-tier__f">
                  <span>Vượt (đ/km)</span>
                  <input className="cd-input cd-num" inputMode="numeric" value={t.per_km}
                         onChange={(e) => setTier(i, { per_km: formatMoneyInput(e.target.value) })} />
                </label>
                {i > 0 && (
                  <button type="button" className="secondary cd-sm cd-tier__x" aria-label="Xoá bậc này"
                          onClick={() => set({ tiers: tiers.filter((_, j) => j !== i) })}>
                    Xoá
                  </button>
                )}
              </div>
            ))}
            <div className="cd-row">
              <div className="cd-btns">
                <button type="button" className="secondary" disabled={!giao || tiers.length >= MAX_SHIP_FEE_TIERS}
                        onClick={() => {
                          // Mốc gợi ý = mốc cuối + 100k, giá mỗi km chép từ bậc cuối — gần như luôn đúng ý.
                          const last = tiers[tiers.length - 1];
                          set({
                            tiers: [...tiers, {
                              min_subtotal: formatMoneyInput(String(Number(digitsOnly(last.min_subtotal) || '0') + 100_000)),
                              free_km: last.free_km,
                              per_km: last.per_km,
                            }],
                          });
                        }}>
                  + Thêm bậc
                </button>
                <button type="button" className="secondary" disabled={!giao} onClick={() => set({ tiers: [] })}>
                  Bỏ bảng phí
                </button>
              </div>
              {tiers.length >= MAX_SHIP_FEE_TIERS && <span className="cd-row__s">Tối đa {MAX_SHIP_FEE_TIERS} bậc.</span>}
            </div>
          </>
        )}
      </CdSection>

      <SaveBar dirty={dirty} saving={saving} what="Nhận hàng & phí ship" onSave={() => void save()} onCancel={reset} />
    </div>
  );
}
