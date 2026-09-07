// Popup xác nhận đổi giá (M3.D-21) — thứ quan trọng nhất của cả Milestone 3.
//
// Nguyên tắc: MẶC ĐỊNH TIN TƯỞNG, CHỈ SOI NGOẠI LỆ. Phiếu 50 dòng mà bắt người nhập đọc cả 50
// để tìm 3 dòng đổi giá thì tuần thứ hai là bấm bừa, và cảnh báo mất sạch tác dụng. Nên popup
// này chỉ liệt kê đúng những dòng lệch — các dòng bình thường không xuất hiện ở đây.
//
// Hai mức (M3.D-22):
// - `warn` (>10%): duyệt được cả cụm bằng một nút.
// - `strict` (>30%): KHÔNG có đường duyệt hàng loạt, phải bấm từng dòng. 30% không còn là biến
//   động mùa vụ; buộc dừng lại nhìn từng cái là có chủ đích.
import { useMemo, useState } from 'react';
import { C } from '../lib/online-ui.ts';

import { upperUnit } from '../lib/text-case.ts';

export type PriceChange = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  prev_unit_price: number;
  unit_price: number;
  prev_unit_price_base: string;
  unit_price_base: string;
  price_change_pct: string;
  level: 'none' | 'warn' | 'strict';
  pack_size_changed: boolean;
  prev_qty_base_per_unit: string | null;
  qty_base_per_unit: string;
};

export type DuplicateHint = {
  id: string;
  delivery_date: string;
  total_amount: number;
  created_by_name: string;
};

const vnd = (n: number) => n.toLocaleString('vi-VN');

/** Giá quy đổi hay là số lẻ (7,5 đ/g) — cắt bớt số 0 thừa để bảng đọc được, nhưng KHÔNG làm
 * tròn về số nguyên: 7,5 → 8 là sai 6% ngay trên màn hình đang nói về chuyện sai vài %. */
const baseprice = (v: string) => {
  const n = Number(v);
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
};

export function PriceChangeDialog({
  changes,
  duplicate,
  onCancel,
  onConfirm,
}: {
  changes: PriceChange[];
  duplicate: DuplicateHint | null;
  onCancel: () => void;
  onConfirm: (approvedIngredientIds: string[], allowDuplicate: boolean) => void;
}) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const strict = useMemo(() => changes.filter((c) => c.level === 'strict'), [changes]);
  const warn = useMemo(() => changes.filter((c) => c.level === 'warn'), [changes]);

  // Nút "Duyệt tất cả" CHỈ xuất hiện khi không có dòng nào ở mức strict. Vừa cho duyệt hàng loạt
  // vừa bảo "phải xem từng cái" là tự mâu thuẫn, và người dùng sẽ luôn chọn cái nút to hơn.
  const canBulk = strict.length === 0 && warn.length > 0;
  const allApproved = changes.every((c) => approved.has(c.ingredient_id));

  const toggle = (id: string) =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xác nhận thay đổi giá"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 9030,
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {duplicate && (
          // M3.D-11. Gợi ý chứ không chặn: NCC giao hai chuyến trong ngày là chuyện có thật, nên
          // quyết định cuối thuộc về người đang cầm hàng.
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <strong style={{ color: '#b91c1c' }}>Nhà cung cấp này đã có phiếu hôm nay</strong>
            <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 4 }}>
              Phiếu {vnd(duplicate.total_amount)}đ, {duplicate.created_by_name} nhập. Kiểm tra kẻo
              nhập trùng.
            </div>
          </div>
        )}

        {changes.length > 0 && (
          <>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>
              ⚠ {changes.length} mặt hàng đổi giá
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: C.muted }}>
              Những dòng còn lại giữ nguyên giá, không cần xem.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              {changes.map((c) => {
                const pct = Number(c.price_change_pct);
                const up = pct > 0;
                const ok = approved.has(c.ingredient_id);
                return (
                  <div
                    key={c.ingredient_id}
                    style={{
                      border: `1px solid ${ok ? C.accent : c.level === 'strict' ? '#fca5a5' : '#e5e7eb'}`,
                      borderRadius: 8,
                      padding: 12,
                      background: ok ? C.accentSoft : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{c.ingredient_name}</div>
                        <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 2 }}>
                          {vnd(c.prev_unit_price)} → <strong>{vnd(c.unit_price)}</strong> đ/
                          {upperUnit(c.purchase_unit)}
                        </div>
                        {/* Giá quy đổi luôn hiện kèm: đây mới là con số so sánh được, và khi NCC
                            đổi đơn vị báo giá thì hai dòng trên nhìn như không liên quan gì. */}
                        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                          {baseprice(c.prev_unit_price_base)} → {baseprice(c.unit_price_base)} đ/
                          {upperUnit(c.base_unit)}
                        </div>
                        {c.pack_size_changed && (
                          // M3.D-37 — không nói rõ chỗ này thì người xem tưởng hệ thống tính sai:
                          // giá mỗi thùng y hệt tháng trước mà lại báo tăng.
                          <div
                            style={{
                              fontSize: 13,
                              color: '#b45309',
                              marginTop: 6,
                              background: '#fffbeb',
                              borderRadius: 6,
                              padding: '4px 8px',
                            }}
                          >
                            Cỡ đóng gói đổi: 1 {upperUnit(c.purchase_unit)} từ{' '}
                            {baseprice(c.prev_qty_base_per_unit ?? '0')} xuống{' '}
                            {baseprice(c.qty_base_per_unit)} {upperUnit(c.base_unit)} — giá mỗi{' '}
                            {upperUnit(c.purchase_unit)} không đổi nhưng hàng ít đi.
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            color: up ? '#b91c1c' : '#15803d',
                          }}
                        >
                          {up ? '▲' : '▼'} {Math.abs(pct).toLocaleString('vi-VN', {
                            maximumFractionDigits: 1,
                          })}
                          %
                        </div>
                        <button
                          type="button"
                          className={ok ? '' : 'secondary'}
                          onClick={() => toggle(c.ingredient_id)}
                          style={{ marginTop: 8, minHeight: 40, padding: '0 18px' }}
                        >
                          {ok ? '✓ Đã duyệt' : 'Duyệt'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" className="secondary" onClick={onCancel} style={{ minHeight: 48 }}>
            Quay lại sửa
          </button>
          {canBulk && !allApproved && (
            <button
              type="button"
              className="secondary"
              onClick={() => setApproved(new Set(changes.map((c) => c.ingredient_id)))}
              style={{ minHeight: 48 }}
            >
              Duyệt tất cả
            </button>
          )}
          <button
            type="button"
            disabled={!allApproved}
            onClick={() => onConfirm([...approved], true)}
            style={{ minHeight: 48, marginLeft: 'auto', padding: '0 24px' }}
          >
            {changes.length === 0 ? 'Vẫn tạo phiếu' : 'Xác nhận & lưu phiếu'}
          </button>
        </div>

        {strict.length > 0 && !allApproved && (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: '#b91c1c' }}>
            Có {strict.length} mặt hàng lệch trên 30% — phải duyệt từng dòng, không duyệt gộp được.
          </p>
        )}
      </div>
    </div>
  );
}
