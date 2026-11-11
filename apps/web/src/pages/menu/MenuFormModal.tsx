// Form Thêm/Sửa món — tách khỏi `MenuManagementPage.tsx` 2026-11-11.
//
// Từ ngày đó form có khối "Trên web khách" (nền xanh ngọc nhạt): gom MỌI thứ khách thấy — bán
// online hay không, mô tả, ảnh, mấy người ăn, đề xuất, đẩy bán — vào một chỗ. Trước đây nửa số đó
// nằm ở tab "Món online" của màn Đơn online, chủ quán phải nhớ "ảnh sửa ở đâu, ẩn online ở đâu".
// Không đổi API: vẫn PATCH /menu/:id (thêm `is_online_hidden`) và POST /menu/upload-image.
import { useRef, useState, type FormEvent } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { Icon, type IconName } from '../../components/ui/Icon.tsx';
import type { MenuGroup, MenuItem } from './menu-types.ts';

function IconText({ name, size = 16, children }: { name: IconName; size?: number; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon name={name} size={size} />
      {children}
    </span>
  );
}

export function MenuFormModal({
  existing,
  groups,
  featured = false,
  onToggleFeatured,
  onTogglePushSale,
  onClose,
  onSaved,
}: {
  existing?: MenuItem;
  groups: MenuGroup[];
  /** Món đang trong danh sách đề xuất không (lấy từ `featuredIds` của màn, luôn mới). */
  featured?: boolean;
  /** ⭐ và 📣 LƯU NGAY khi bấm (đúng hàm của bảng món), không chờ nút Lưu của form: chúng là
   *  bảng/cờ RỜI (`/menu-combos/featured`, `toggle-push-sale`), gom vào PATCH là phải đổi API. */
  onToggleFeatured?: () => void;
  onTogglePushSale?: () => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [group, setGroup] = useState(existing?.group || groups[0]?.code || 'food');
  const [price, setPrice] = useState(existing?.price || 0);
  const [unit, setUnit] = useState(existing?.unit || 'phần');
  const [description, setDescription] = useState(existing?.description ?? '');
  /* Giữ ở dạng CHUỖI chứ không number: ô để trống là "chưa khai" (NULL), mà `useState(0)` thì
     không phân biệt được "chưa khai" với "0 người ăn". */
  const [serves, setServes] = useState(existing?.serves != null ? String(existing.serves) : '');
  const [imageUrl, setImageUrl] = useState(existing?.image_url || '');
  const [onlineOn, setOnlineOn] = useState(!(existing?.is_online_hidden ?? false));
  // Bản sao cục bộ của cờ đẩy bán: `existing` là ảnh chụp lúc mở form, bấm 📣 xong nó không đổi.
  const [pushOn, setPushOn] = useState(existing?.is_push_sale ?? false);
  const [pushBusy, setPushBusy] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const groupHidden = !!groups.find((g) => g.code === group)?.is_online_hidden;

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
      toast.push('success', 'Tải ảnh lên thành công — bấm Lưu để giữ ảnh này');
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const clearImage = () => {
    setImageUrl('');
    setShowUrlInput(false);
  };

  const togglePush = async () => {
    if (!onTogglePushSale) return;
    setPushBusy(true);
    try {
      if (await onTogglePushSale()) setPushOn((v) => !v);
    } finally {
      setPushBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || price < 0) {
      setErr('Mã món, tên, giá là bắt buộc');
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

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={submit}>
        <h1>{existing ? 'Sửa món' : 'Thêm món mới'}</h1>
        <div className="row">
          <label htmlFor="m-code">Mã món (vd F001)</label>
          <input
            id="m-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!existing}
            style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
            autoFocus={!existing}
          />
        </div>
        <div className="row">
          <label htmlFor="m-name">Tên món</label>
          <input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!existing} />
        </div>
        <div className="row">
          <label>Nhóm</label>
          {/* ~30 nhóm → Dropdown chung tự có ô tìm (gõ không dấu). Thay `<select>` gốc: danh sách
              bung ra của hệ điều hành không tìm được, phải cuộn cả 30 dòng. Emoji nhóm là dữ liệu
              chủ quán tự đặt nên giữ trong nhãn. */}
          <Dropdown
            ariaLabel="Nhóm"
            value={group}
            onChange={setGroup}
            options={groups.map((g) => ({ value: g.code, label: g.icon ? `${g.icon} ${g.name}` : g.name }))}
            full
          />
        </div>
        <div className="flex">
          <div className="row" style={{ flex: 2 }}>
            <label htmlFor="m-price">Giá (VND)</label>
            <input
              id="m-price"
              type="number"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              min={0}
              step={1000}
            />
          </div>
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="m-unit">ĐVT</label>
            <input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="phần / cốc..." />
          </div>
        </div>

        {/* ── Khối "Trên web khách" (2026-11-11) ── */}
        <section className="td-web" aria-labelledby="m-web-title">
          <h2 id="m-web-title" className="td-web__tieude">
            <Icon name="web" size={20} /> Trên web khách
          </h2>

          <div className="td-web__hang">
            <div>
              <div className="td-web__nhan">Bán online</div>
              <div className="td-web__phu">
                {onlineOn ? 'Khách đặt được món này trên web.' : 'Món biến hẳn khỏi web khách (POS trong quán không ảnh hưởng).'}
                {groupHidden && ' Lưu ý: cả nhóm của món đang ẩn online, nên khách vẫn không thấy.'}
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
              {/* Cùng công tắc nhỏ với hàng món ở bảng — một màn chỉ một kiểu công tắc. */}
              <span className="td-sw__ray" aria-hidden="true" />
              <span className="td-sw__chu">{onlineOn ? 'Online' : 'Ẩn'}</span>
            </button>
          </div>

          {/* ── Mô tả + mấy người ăn (2026-10-05) ──
              Thực đơn tại bàn trước giờ chỉ có tên + giá + ảnh, nên khách không dám gọi món lạ và
              cứ gọi lại món đã quen. Hai ô này KHÔNG bắt buộc: 598 món thì còn lâu mới viết hết,
              viết được 30 món chủ lực đã ăn thua rồi. */}
          <div className="row">
            <label htmlFor="m-desc">Mô tả cho khách (không bắt buộc)</label>
            <input
              id="m-desc"
              value={description}
              maxLength={160}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cay vừa, ăn kèm bánh mì…"
            />
            <small style={{ color: '#6b7280' }}>
              Khách đọc câu này trong thực đơn tại bàn. {description.length}/160
            </small>
          </div>

          <div className="row">
            <label>Ảnh món (không bắt buộc)</label>
            {imageUrl ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={imageUrl}
                    alt="preview"
                    style={{
                      // Rộng CỐ ĐỊNH 240: ảnh tải hỏng thì <img> co về 0 và nút ✕ trôi lệch.
                      width: 240,
                      maxWidth: '100%',
                      height: 160,
                      background: '#f3f4f6',
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      display: 'block',
                    }}
                  />
                  <button
                    type="button"
                    onClick={clearImage}
                    aria-label="Xoá ảnh"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      padding: 0,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      border: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="dong" size={18} label="Xoá ảnh" />
                  </button>
                </div>
                {/* Đổi ảnh ngay tại chỗ — trước phải xoá ảnh cũ rồi mới hiện nút tải lên. */}
                <button type="button" className="secondary" onClick={pickFile} disabled={uploading}>
                  {uploading ? <span className="spinner" /> : <IconText name="anh">Đổi ảnh</IconText>}
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={uploading}
                    style={{ flex: 1, minWidth: 140, padding: '12px 14px' }}
                  >
                    {uploading ? <span className="spinner" /> : <IconText name="anh" size={20}>Tải ảnh lên</IconText>}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowUrlInput((v) => !v)}
                    style={{ padding: '12px 14px' }}
                  >
                    {showUrlInput ? 'Đóng URL' : 'Hoặc dán URL'}
                  </button>
                </div>
                {showUrlInput && (
                  <input
                    type="url"
                    placeholder="https://..."
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                )}
                <p style={{ fontSize: 'var(--ds-fs-label)', color: 'var(--ds-ink-2)', marginTop: 6 }}>
                  JPG/PNG/WEBP/GIF, tối đa 10MB. Trên điện thoại có thể chụp trực tiếp từ camera.
                </p>
              </>
            )}
            {/* Một input file dùng chung cho "Tải ảnh lên" và "Đổi ảnh". */}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          </div>

          <div className="row">
            <label htmlFor="m-serves">Mấy người ăn (không bắt buộc)</label>
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

          {/* ⭐ / 📣 chỉ có khi SỬA: chúng gắn với id món, món chưa tạo thì chưa có gì để gắn. */}
          {existing && (
            <div className="td-web__co">
              <button
                type="button"
                className={`td-chip${featured ? ' td-chip--on' : ''}`}
                aria-pressed={featured}
                onClick={onToggleFeatured}
              >
                <IconText name="de-xuat">{featured ? 'Đang đề xuất' : 'Đề xuất'}</IconText>
              </button>
              <button
                type="button"
                className={`td-chip${pushOn ? ' td-chip--on' : ''}`}
                aria-pressed={pushOn}
                disabled={pushBusy || existing.is_out_of_stock}
                onClick={() => void togglePush()}
              >
                <IconText name="day-ban">{pushOn ? 'Đang đẩy bán' : 'Đẩy bán'}</IconText>
              </button>
              <small className="td-web__phu" style={{ flexBasis: '100%' }}>
                Hai nút này lưu ngay khi bấm.
                {existing.is_out_of_stock && ' Món đang hết nên không đẩy bán được.'}
              </small>
            </div>
          )}
        </section>

        {err && <div className="field-error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="flex">
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            {existing ? 'Lưu' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}
