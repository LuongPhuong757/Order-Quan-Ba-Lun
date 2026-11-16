// Trang con "Số điện thoại bị chặn" (đợt 2, 2026-11-16) — tách từ tab con cũ. M2.D-59: thêm/xoá TAY,
// bản ghi KHÔNG tự hết hạn. Bảng 5 cột → danh sách hàng (số + lý do · người thêm · ngày) cho vừa
// điện thoại; lọc và trang vẫn ở URL (`q`, `page`) như cũ.
import { useEffect, useState, type FormEvent } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { useConfirm } from '../../components/ConfirmDialog.tsx';
import { CdSection } from './parts.tsx';

type BlacklistRow = {
  phone: string;
  reason: string;
  created_at: number;
  expires_at: number | null;
  created_by_full_name: string | null;
};

const PAGE_SIZE = 50;

export function BlacklistPage({ q, page, onUpdateParam }: { q: string; page: number; onUpdateParam: (k: string, v: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<BlacklistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (q) qs.set('q', q);
      const res = await api.get<{ data: { items: BlacklistRow[]; total: number } }>(`/admin/phone-blacklist?${qs.toString()}`);
      setItems(res.data.data.items);
      setTotal(res.data.data.total);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q]);

  const addPhone = async (e: FormEvent) => {
    e.preventDefault();
    if (!phoneInput.trim()) return toast.push('error', 'Vui lòng nhập số điện thoại');
    if (!reasonInput.trim()) return toast.push('error', 'Vui lòng nhập lý do');
    setSubmitting(true);
    try {
      await api.post('/admin/phone-blacklist', { phone: phoneInput.trim(), reason: reasonInput.trim() });
      toast.push('success', `Đã chặn ${phoneInput.trim()}`);
      setPhoneInput('');
      setReasonInput('');
      void refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const removePhone = async (row: BlacklistRow) => {
    const ok = await confirm({
      title: `Bỏ chặn ${row.phone}?`,
      message: `Số ${row.phone} sẽ đặt hàng lại được ngay. Thao tác này không hoàn tác được.`,
      variant: 'danger',
      confirmLabel: 'Bỏ chặn',
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/phone-blacklist/${encodeURIComponent(row.phone)}`);
      toast.push('success', `Đã bỏ chặn ${row.phone}`);
      void refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="cd-stack">
      <p className="cd-lead">Số bị chặn không đặt được đơn online. Không tự hết hạn — muốn bỏ chặn thì xoá tay.</p>

      <CdSection label="Chặn số mới">
        <form className="cd-form cd-form--card" onSubmit={addPhone}>
          <div>
            <label htmlFor="bl-phone">Số điện thoại</label>
            <input id="bl-phone" type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}
                   placeholder="0912 345 678 — gõ kiểu nào cũng được" />
          </div>
          <div>
            <label htmlFor="bl-reason">Lý do</label>
            <input id="bl-reason" value={reasonInput} maxLength={255} onChange={(e) => setReasonInput(e.target.value)}
                   placeholder="vd: Bom đơn 3 lần liên tiếp" />
          </div>
          <button type="submit" disabled={submitting}>{submitting ? 'Đang thêm…' : '+ Chặn số này'}</button>
        </form>
      </CdSection>

      <CdSection label={`Đang chặn${total > 0 ? ` (${total})` : ''}`}>
        <div className="cd-row">
          <input id="bl-q" className="cd-input" value={q} placeholder="Tìm theo số, vd: 0912" aria-label="Tìm theo số điện thoại"
                 onChange={(e) => onUpdateParam('q', e.target.value)} />
        </div>
        {loading && <div className="cd-row"><span className="cd-row__s">Đang tải…</span></div>}
        {!loading && items.length === 0 && (
          <div className="cd-row"><span className="cd-row__s">Chưa có số nào bị chặn. Dùng khi khách bom đơn liên tục hoặc dùng số ảo.</span></div>
        )}
        {items.map((r) => (
          <div className="cd-row" key={r.phone}>
            <div className="cd-row__m">
              <span className="cd-row__t cd-tnum">{r.phone}</span>
              <span className="cd-row__s">
                {r.reason} · {r.created_by_full_name || '—'} · {new Date(r.created_at).toLocaleDateString('vi-VN')}
              </span>
            </div>
            <button type="button" className="secondary cd-sm" onClick={() => void removePhone(r)}>Bỏ chặn</button>
          </div>
        ))}
        {maxPage > 1 && (
          <div className="cd-row cd-pager">
            <button type="button" className="secondary cd-sm" disabled={page <= 1} onClick={() => onUpdateParam('page', String(page - 1))}>← Trước</button>
            <span className="cd-row__s">{page}/{maxPage}</span>
            <button type="button" className="secondary cd-sm" disabled={page >= maxPage} onClick={() => onUpdateParam('page', String(page + 1))}>Sau →</button>
          </div>
        )}
      </CdSection>
    </div>
  );
}
