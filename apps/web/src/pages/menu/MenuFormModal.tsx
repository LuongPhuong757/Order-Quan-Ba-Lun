// Form Thêm/Sửa món — tách khỏi `MenuManagementPage.tsx` 2026-11-11.
//
// Bản 2 (góp ý màn Thực đơn 2026-11-11, mục B):
// - MỘT cách lưu: mọi thứ trong form chỉ lưu khi bấm Lưu. Trước có 2 nút ⭐ Đề xuất / 📣 Đẩy bán
//   "lưu ngay khi bấm" nằm giữa các ô chờ Lưu — bấm Huỷ vẫn tưởng hoàn lại hết mà không phải.
//   Hai việc đó nay ở thẻ chi tiết món / menu ⋯ (thao tác nhanh, lưu ngay).
// - Thông tin chính lên đầu: [ảnh 96] cạnh Tên · Giá/ĐVT · Nhóm. Ảnh dùng cho CẢ màn Gọi món nên
//   không còn nằm trong khối "Trên web khách". Ô ảnh hỏng hiện "⚠ Ảnh lỗi · Chọn lại" thay vì icon
//   ảnh vỡ + chữ "preview" + nút ✕ đen đè góc (trông như lỗi giao diện).
// - Giá tự định dạng "40.000", bàn phím số. Mã món chỉ nhập khi TẠO, khi sửa là chữ chỉ đọc.
// - Tóm tắt giá vốn ngay trong form + lối sang Công thức.
// - "Trên web khách": công tắc Bán online ở tiêu đề; KHÔNG nền màu (khung trong khung) — phân vùng
//   bằng tiêu đề nhỏ in hoa và đường kẻ.
// - Nút Huỷ/Lưu dính đáy; Esc đóng. Điện thoại: form phủ kín màn.
// Không đổi API: vẫn PATCH /menu/:id (kèm `is_online_hidden`) và POST /menu/upload-image.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { formatVND, pctText, pctTone, type FoodCostEntry, type MenuGroup, type MenuItem } from './menu-types.ts';

/** "40000" → "40.000"; ô trống giữ trống (không hiện "0" — trông như giá đã nhập). */
function giaHienThi(v: number | null): string {
  return v === null ? '' : v.toLocaleString('vi-VN');
}

export function MenuFormModal({
  existing,
  groups,
  cost,
  recipeCount,
  onOpenRecipe,
  onDelete,
  onClose,
  onSaved,
}: {
  existing?: MenuItem;
  groups: MenuGroup[];
  /** Giá vốn đã nạp sẵn của màn (chỉ khi sửa). `undefined` = chưa khai / chưa có giá. */
  cost?: FoodCostEntry;
  recipeCount?: number;
  /** Mở hộp Công thức (form đóng lại). */
  onOpenRecipe?: () => void;
  onDelete?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [group, setGroup] = useState(existing?.group || groups[0]?.code || 'food');
  /* `null` = ô trống. Món mới mở ra không hiện sẵn "0". */
  const [price, setPrice] = useState<number | null>(existing ? existing.price : null);
  const [unit, setUnit] = useState(existing?.unit || 'phần');
  const [description, setDescription] = useState(existing?.description ?? '');
  /* Giữ ở dạng CHUỖI chứ không number: ô để trống là "chưa khai" (NULL), mà `useState(0)` thì
     không phân biệt được "chưa khai" với "0 người ăn". */
  const [serves, setServes] = useState(existing?.serves != null ? String(existing.serves) : '');
  const [imageUrl, setImageUrl] = useState(existing?.image_url || '');
  const [imgBroken, setImgBroken] = useState(false);
  const [onlineOn, setOnlineOn] = useState(!(existing?.is_online_hidden ?? false));
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const groupHidden = !!groups.find((g) => g.code === group)?.is_online_hidden;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickFile = () => fileInputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErr('Ảnh vượt quá 10MB, vui lòng chọn ảnh nhỏ hơn');
      e.target.value = '';
      return;
    }
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ data: { url: string } }>('/menu/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.data.url);
      setImgBroken(false);
      toast.push('success', 'Đã tải ảnh — bấm Lưu để giữ ảnh này');
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || price === null || price < 0) {
      setErr(existing ? 'Tên và giá là bắt buộc' : 'Mã món, tên, giá là bắt buộc');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name,
        group,
        price,
        unit,
        image_url: imageUrl.trim() ? imageUrl : null,
        // Ô trống → NULL, không phải chuỗi rỗng / số 0: trang khách dựa vào NULL để ẩn hẳn dòng.
        description: description.trim() || null,
        serves: serves.trim() ? Number(serves) : null,
      };
      if (existing) {
        if (onlineOn === existing.is_online_hidden) body.is_online_hidden = !onlineOn;
        await api.patch(`/menu/${existing.id}`, body);
        toast.push('success', `Cập nhật ${name} thành công`);
      } else {
        body.code = code;
        const res = await api.post<{ data: { id: string } }>('/menu', body);
        // `POST /menu` không nhận `is_online_hidden` (DTO tạo món chặn trường lạ —
        // forbidNonWhitelisted), nên món mới muốn ẩn online thì PATCH thêm một nhịp.
        if (!onlineOn) await api.patch(`/menu/${res.data.data.id}`, { is_online_hidden: true });
        toast.push('success', `Tạo món ${name} thành công`);
      }
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  let oAnh;
  if (uploading) oAnh = <span className="spinner" />;
  else if (imageUrl && !imgBroken) oAnh = <img src={imageUrl} alt="" onError={() => setImgBroken(true)} />;
  else if (imageUrl) {
    oAnh = (
      <span className="tdf-anh__chu tdf-anh__chu--loi">
        <Icon name="canh-bao" size={20} />
        Ảnh lỗi
        <b>Chọn lại</b>
      </span>
    );
  } else {
    oAnh = (
      <span className="tdf-anh__chu">
        <Icon name="anh" size={22} />
        Thêm ảnh
      </span>
    );
  }

  return (
    <div className="modal-overlay tdf-bg" role="dialog" aria-modal="true" aria-label={existing ? 'Sửa món' : 'Thêm món mới'}>
      <form className="tdf" onSubmit={submit}>
        <div className="tdf-hd">
          <button type="button" className="tdf-hd__x" onClick={onClose} aria-label="Đóng">
            <Icon name="dong" size={22} />
          </button>
          <h1>{existing ? 'Sửa món' : 'Thêm món mới'}</h1>
        </div>

        <div className="tdf-body">
          {/* ── Thông tin chính ── */}
          <div className="tdf-top">
            <div className="tdf-anh-wrap">
              <button
                type="button"
                className={`tdf-anh${imageUrl && imgBroken ? ' tdf-anh--loi' : ''}`}
                onClick={pickFile}
                disabled={uploading}
                aria-label={imageUrl ? 'Đổi ảnh món' : 'Thêm ảnh món'}
              >
                {oAnh}
              </button>
              {imageUrl ? (
                <button type="button" className="tdf-nho" onClick={() => { setImageUrl(''); setImgBroken(false); setShowUrlInput(false); }}>
                  Bỏ ảnh
                </button>
              ) : (
                <button type="button" className="tdf-nho" onClick={() => setShowUrlInput((v) => !v)}>
                  Dán link
                </button>
              )}
            </div>
            <div className="tdf-chinh">
              {!existing && (
                <div className="row">
                  <label htmlFor="m-code">Mã món (vd F001)</label>
                  <input
                    id="m-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                    autoFocus
                  />
                </div>
              )}
              <div className="row">
                <label htmlFor="m-name">Tên món</label>
                <input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!existing} />
              </div>
              <div className="tdf-gia">
                <div className="row">
                  <label htmlFor="m-price">Giá</label>
                  <div className="tdf-gia__o">
                    <input
                      id="m-price"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={giaHienThi(price)}
                      onChange={(e) => {
                        const so = e.target.value.replace(/\D/g, '');
                        setPrice(so ? Number(so) : null);
                      }}
                      placeholder="0"
                    />
                    <span>đ</span>
                  </div>
                </div>
                <div className="row">
                  <label htmlFor="m-unit">Đơn vị</label>
                  <input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="phần, đĩa…" />
                </div>
              </div>
            </div>
          </div>
          {showUrlInput && !imageUrl && (
            <div className="row">
              <label htmlFor="m-url">Link ảnh</label>
              <input id="m-url" type="url" placeholder="https://..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            </div>
          )}
          {/* Một input file dùng chung cho mọi lần chạm ô ảnh. */}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />

          <div className="row">
            <label>Nhóm</label>
            {/* ~30 nhóm → Dropdown chung tự có ô tìm (gõ không dấu). */}
            <Dropdown
              ariaLabel="Nhóm"
              value={group}
              onChange={setGroup}
              options={groups.map((g) => ({ value: g.code, label: g.icon ? `${g.icon} ${g.name}` : g.name }))}
              full
            />
          </div>

          {/* ── Giá vốn (chỉ khi sửa) ── */}
          {existing && (
            <div className="tdf-sec tdf-von">
              <div>
                <div className="tdf-sec__tieude">Giá vốn</div>
                {cost ? (
                  <div className="tdf-von__so">
                    {formatVND(cost.cost)} · <span className={pctTone(cost.pct)}>{pctText(cost)}</span>
                    <small> giá bán</small>
                  </div>
                ) : (
                  <div className="tdf-von__trong">{recipeCount ? `${recipeCount} nguyên liệu, chưa có giá nhập` : 'Chưa khai nguyên liệu'}</div>
                )}
              </div>
              {onOpenRecipe && (
                <button type="button" className="tdf-link" onClick={onOpenRecipe} disabled={existing.is_out_of_stock}>
                  {recipeCount ? 'Sửa công thức' : 'Khai nguyên liệu'}
                  <Icon name="mui-ten-phai" size={18} />
                </button>
              )}
            </div>
          )}

          {/* ── Trên web khách ── */}
          <div className="tdf-sec">
            <div className="tdf-web-hd">
              <div>
                <div className="tdf-sec__tieude">Trên web khách</div>
                <div className="tdf-phu">
                  {onlineOn ? 'Khách đặt được món này trên web.' : 'Món ẩn khỏi web khách (POS trong quán không ảnh hưởng).'}
                  {groupHidden && ' Cả nhóm đang ẩn online nên khách vẫn không thấy.'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={onlineOn}
                aria-label="Bán online"
                className={`td-sw${onlineOn ? ' td-sw--on' : ' td-sw--an'}`}
                onClick={() => setOnlineOn((v) => !v)}
              >
                <span className="td-sw__ray" aria-hidden="true" />
              </button>
            </div>
            {/* Mô tả + mấy người ăn (2026-10-05) — KHÔNG bắt buộc: viết được 30 món chủ lực đã ăn thua. */}
            <div className="row">
              <label htmlFor="m-desc">Mô tả cho khách</label>
              <input
                id="m-desc"
                value={description}
                maxLength={160}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Cay vừa, ăn kèm bánh mì…"
              />
              <small className="tdf-phu">{description.length}/160</small>
            </div>
            <div className="row tdf-serves">
              <label htmlFor="m-serves">Mấy người ăn</label>
              <input
                id="m-serves"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={serves}
                onChange={(e) => setServes(e.target.value)}
                placeholder="vd 3"
              />
            </div>
          </div>

          {existing && (
            <div className="tdf-sec tdf-cuoi">
              <span className="tdf-phu">
                Mã món <b>{existing.code}</b>
              </span>
              {onDelete && existing.is_active && (
                <button type="button" className="secondary tdf-xoa" onClick={onDelete} disabled={existing.is_out_of_stock}>
                  Xoá món
                </button>
              )}
            </div>
          )}
          {err && <div className="field-error">{err}</div>}
        </div>

        <div className="tdf-foot">
          <button type="button" className="secondary" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting || uploading}>
            {submitting && <span className="spinner" />}
            {existing ? 'Lưu' : 'Tạo món'}
          </button>
        </div>
      </form>
    </div>
  );
}
