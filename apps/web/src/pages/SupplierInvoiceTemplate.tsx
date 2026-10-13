// Màn "Mẫu hoá đơn" của một NCC (2026-10-13).
//
// Chủ quán tick bỏ những món không muốn in, rồi tải Excel/CSV đem đi in đưa NCC. Thứ tự KHÔNG
// chỉnh tay được — luôn theo số lần nhập 90 ngày, server xếp sẵn (chủ quán chốt). Màn chỉ lưu
// danh sách món BỎ.
//
// Bấm tải file khi còn thay đổi chưa lưu thì LƯU LUÔN rồi mới tải: tờ mẫu đang cầm trên tay và
// cấu hình lần sau mở ra phải là một, không thì lần in sau lại ra một bộ món khác.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import {
  downloadTemplateCsv, downloadTemplateXlsx, type TemplateItem,
} from '../lib/invoice-template.ts';
import { upperUnit } from '../lib/text-case.ts';
import { Ico } from './supplier-ui.tsx';

type TemplateData = { window_days: number; saved_at: number | null; items: TemplateItem[] };

export function SupplierInvoiceTemplate({
  supplierId, supplierName, onClose,
}: {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<TemplateData | null>(null);
  /** Bộ món đang tick BỎ trên màn — có thể khác bản đã lưu cho tới khi bấm Lưu. */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const nap = useCallback((d: TemplateData) => {
    setData(d);
    setHidden(new Set(d.items.filter((i) => i.hidden).map((i) => i.ingredient_id)));
  }, []);

  useEffect(() => {
    api.get<{ data: TemplateData }>(`/suppliers/${supplierId}/invoice-template`)
      .then((r) => nap(r.data.data))
      .catch((err) => toast.push('error', extractError(err).message));
  }, [supplierId, nap, toast]);

  const dirty = useMemo(() => {
    if (!data) return false;
    return data.items.some((i) => i.hidden !== hidden.has(i.ingredient_id));
  }, [data, hidden]);

  const items = useMemo(
    () => (data?.items ?? []).map((i) => ({ ...i, hidden: hidden.has(i.ingredient_id) })),
    [data, hidden],
  );
  const soLay = items.filter((i) => !i.hidden).length;

  const doi = (id: string) => setHidden((cu) => {
    const moi = new Set(cu);
    if (moi.has(id)) moi.delete(id); else moi.add(id);
    return moi;
  });

  /** Lưu lên server; trả về danh sách sau khi lưu (null nếu lỗi). */
  const luu = async (): Promise<TemplateItem[] | null> => {
    try {
      const r = await api.put<{ data: TemplateData }>(`/suppliers/${supplierId}/invoice-template`, {
        hidden_ingredient_ids: [...hidden],
      });
      nap(r.data.data);
      return r.data.data.items;
    } catch (err) {
      toast.push('error', extractError(err).message);
      return null;
    }
  };

  const bamLuu = async () => {
    setBusy(true);
    if (await luu()) toast.push('success', 'Đã lưu mẫu hoá đơn');
    setBusy(false);
  };

  const tai = async (loai: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      const ds = dirty ? await luu() : items;
      if (!ds) return;
      if (loai === 'xlsx') await downloadTemplateXlsx(supplierName, ds);
      else downloadTemplateCsv(supplierName, ds);
    } catch (err) {
      toast.push('error', `Không tạo được file: ${extractError(err).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Mẫu hoá đơn ${supplierName}`}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
                  flexDirection: 'row', justifyContent: 'center', padding: 16, overflowY: 'auto',
                  zIndex: 9100 }}>
      <div className="ncc-ui ncc-ui--dialog" style={{ maxWidth: 720, width: '100%', margin: 'auto' }}>
        <button className="back" type="button" onClick={onClose}>
          <Ico d="m15 6-6 6 6 6" />{supplierName}
        </button>

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Mẫu hoá đơn — {supplierName}</h2>
          </div>
          <p className="mhd-note">
            Bỏ dấu tick những món không muốn in. Món giao nhiều lần nhất trong
            {' '}{data?.window_days ?? 90} ngày qua tự xếp lên đầu. Cuối phiếu có sẵn 10 dòng trống.
          </p>

          {!data ? (
            <p className="mhd-note">Đang tải…</p>
          ) : items.length === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">Chưa có mặt hàng nào</p>
              <p className="emptyfilter__s">Nhập hàng từ NCC này ít nhất một lần thì món mới hiện ở đây.</p>
            </div>
          ) : (
            <>
              <div className="mhd-tools">
                <span className="mhd-count">Lấy {soLay}/{items.length} món</span>
                <button className="chip" type="button" onClick={() => setHidden(new Set())}>Lấy hết</button>
                <button className="chip" type="button"
                        onClick={() => setHidden(new Set(items.map((i) => i.ingredient_id)))}>Bỏ hết</button>
              </div>
              <ul className="mhd-list">
                {items.map((i, k) => (
                  <li key={i.ingredient_id}>
                    <label className={`mhd-row${i.hidden ? ' mhd-row--off' : ''}`}>
                      <input type="checkbox" checked={!i.hidden} onChange={() => doi(i.ingredient_id)} />
                      <span className="mhd-stt">{k + 1}</span>
                      <span className="mhd-name">
                        {i.ingredient_name}
                        {i.is_new && <span className="badge badge--pending mhd-new">MỚI</span>}
                        <span className="mhd-sub">
                          {upperUnit(i.purchase_unit)} · {i.times > 0 ? `giao ${i.times} lần` : 'chưa giao trong kỳ'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {data && items.length > 0 && (
          <section className="actions" aria-label="Lưu và tải mẫu">
            <button className="btn btn--primary act-wide" type="button" disabled={busy}
                    onClick={() => void tai('xlsx')}>
              <Ico d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />Tải Excel
            </button>
            <button className="btn btn--accent-ghost act-wide" type="button" disabled={busy}
                    onClick={() => void tai('csv')}>
              <Ico d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />Tải CSV
            </button>
            <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void bamLuu()}>
              {dirty ? 'Lưu thay đổi' : 'Đã lưu'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
