import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { useApi } from '../lib/use-api.ts';

/**
 * Trang cập nhật ảnh món qua LINK BÍ MẬT — `/anh-mon/:token` (2026-08-16).
 *
 * Người dùng đích: NGƯỜI NHÀ CHỦ QUÁN, biết rất ít về công nghệ, cầm điện thoại. Chủ quán gửi
 * cho họ đúng một đường link; bấm vào là thấy danh sách món và bấm món nào thì chụp/chọn ảnh
 * cho món đó. Không đăng nhập, không mật khẩu — token trong URL là chìa khoá, BE kiểm ở
 * `public-menu-photos.controller.ts` (link sai = 404, trang này hiện lời nhắn thân thiện).
 *
 * Vì đối tượng đó, MỌI quyết định UI ở đây nghiêng về to-rõ-ít-chữ:
 *  - ĐỨNG NGOÀI AppShell: không header, không giỏ hàng, không footer — màn hình chỉ có đúng
 *    một việc. Người không quen công nghệ lạc vào menu khách là không tìm được đường về.
 *  - MỘT danh sách theo thứ tự menu + 3 chip lọc (Tất cả / Chưa có ảnh / Đã có ảnh). Bản đầu
 *    chia 2 mục cứng "chưa có ảnh" trên, "đã có ảnh" dưới — chủ dự án bắt ngay lỗi tư duy
 *    (2026-08-16): vừa thêm ảnh xong thì món BIẾN MẤT khỏi chỗ đang đứng (nhảy xuống mục
 *    dưới), người dùng tưởng hỏng. Nay món đứng YÊN tại chỗ sau khi thêm ảnh — thumbnail đổi
 *    + dòng "✓ Đã xong" ngay dưới hàng; muốn dồn việc thì bấm chip "Chưa có ảnh".
 *  - Cả HÀNG là một nút (cao ≥76px), không có nút con nhỏ xíu phải nhắm trúng.
 *  - `<input type="file" accept="image/*">`: điện thoại tự mở đúng hộp "Chụp ảnh / Thư viện"
 *    quen thuộc của máy — không tự chế trình chụp ảnh nào cả.
 *  - Ô tìm kiếm font 16px: dưới 16px là iOS tự phóng to trang khi chạm vào ô, người không
 *    quen sẽ tưởng màn hình bị hỏng.
 *  - Upload là MỘT bước (BE gán ảnh vào món luôn), có chữ trạng thái to ngay trên hàng:
 *    "Đang tải ảnh..." → "✓ Đã xong".
 */

const PhotoItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  group_label: z.string(),
  group_sort: z.number(),
  image_url: z.string().nullable(),
});
type PhotoItem = z.infer<typeof PhotoItem>;
const PhotoList = z.object({ items: PhotoItem.array() });

/** Trùng trần BE (menu-image.ts) — chặn sớm cho câu lỗi tử tế thay vì lỗi mạng khó hiểu. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Bỏ dấu + hạ thường — cùng cách tìm của trang menu khách. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

type RowStatus = { kind: 'uploading' | 'done' | 'error'; message: string };
type PhotoFilter = 'all' | 'missing' | 'having';

export function PhotoUploadPage(): JSX.Element {
  const { token = '' } = useParams();
  const list = useApi(`/api/public/menu-photos/${token}`, PhotoList);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PhotoFilter>('all');
  // Ảnh vừa upload xong — đè lên dữ liệu gốc để thumbnail đổi ngay không cần tải lại trang.
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<PhotoItem | null>(null);

  const items = useMemo(() => {
    const base = list.data?.items ?? [];
    const q = normalize(search);
    const filtered = q === '' ? base : base.filter((it) => normalize(it.name).includes(q) || normalize(it.code).includes(q));
    return [...filtered].sort(
      (a, b) => a.group_sort - b.group_sort || a.name.localeCompare(b.name, 'vi'),
    );
  }, [list.data, search]);

  const urlOf = (it: PhotoItem): string | null => uploadedUrls[it.id] ?? it.image_url;
  // Đếm trên danh sách ĐÃ QUA TÌM KIẾM: đang tìm "cháo" thì con số trên chip trả lời đúng câu
  // đang hỏi ("mấy món cháo chưa có ảnh"), không phải con số của cả menu.
  const missingCount = items.filter((it) => urlOf(it) === null).length;
  const shown =
    filter === 'all'
      ? items
      : items.filter((it) => (filter === 'missing' ? urlOf(it) === null : urlOf(it) !== null));

  const pick = (it: PhotoItem): void => {
    targetRef.current = it;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    const target = targetRef.current;
    e.target.value = ''; // chọn lại đúng file cũ vẫn phải bắn onChange
    if (!file || !target) return;

    if (file.size > MAX_FILE_BYTES) {
      setStatus((s) => ({
        ...s,
        [target.id]: { kind: 'error', message: 'Ảnh này nặng quá (trên 10MB). Bạn chụp lại hoặc chọn ảnh khác nhé.' },
      }));
      return;
    }

    setStatus((s) => ({ ...s, [target.id]: { kind: 'uploading', message: 'Đang tải ảnh lên...' } }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      // KHÔNG tự đặt Content-Type: trình duyệt phải tự gắn boundary của multipart.
      // credentials same-origin để có header Origin — CsrfOriginGuard đòi ở mọi POST public.
      const res = await fetch(`/api/public/menu-photos/${token}/${target.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: { url?: string } };
      const url = json.data?.url;
      if (!url) throw new Error('no-url');
      setUploadedUrls((m) => ({ ...m, [target.id]: url }));
      setStatus((s) => ({ ...s, [target.id]: { kind: 'done', message: '✓ Đã xong — ảnh đã lên web' } }));
    } catch {
      setStatus((s) => ({
        ...s,
        [target.id]: { kind: 'error', message: 'Chưa tải được ảnh. Bạn kiểm tra mạng rồi bấm thử lại nhé.' },
      }));
    }
  };

  // Link sai/đã đổi → BE trả 404. Nói việc cần làm, không nói mã lỗi.
  if (list.error) {
    return (
      <div style={page}>
        <div style={{ ...card, textAlign: 'center', marginTop: '20vh' }}>
          <p style={{ fontSize: 44, margin: 0 }}>🔒</p>
          <h1 style={{ margin: '8px 0', fontSize: 20 }}>Link này không mở được</h1>
          <p style={{ margin: 0, fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {list.error.kind === 'http'
              ? 'Link không đúng hoặc đã bị đổi. Bạn nhắn lại người gửi link để lấy link mới nhé.'
              : 'Không kết nối được mạng. Bạn kiểm tra mạng rồi mở lại link nhé.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <header style={head}>
        <h1 style={{ margin: 0, fontSize: 20 }}>📷 Ảnh món ăn — Quán Bà Lùn</h1>
        <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Bấm vào món bất kỳ rồi <strong>chụp ảnh</strong> hoặc <strong>chọn ảnh có sẵn</strong> trong máy.
          Ảnh sẽ hiện trên web của quán ngay.
        </p>
      </header>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Tìm tên món..."
        style={searchInput}
      />

      {/* 3 chip lọc — món ĐỨNG YÊN theo thứ tự menu, chip chỉ thu hẹp danh sách. Con số trên
          chip "Chưa có ảnh" chính là "còn bao nhiêu việc". */}
      <div style={chipRow}>
        {(
          [
            { v: 'all', label: `Tất cả (${items.length})` },
            { v: 'missing', label: `Chưa có ảnh (${missingCount})` },
            { v: 'having', label: `Đã có ảnh (${items.length - missingCount})` },
          ] as { v: PhotoFilter; label: string }[]
        ).map((c) => (
          <button
            key={c.v}
            type="button"
            onClick={() => setFilter(c.v)}
            style={filter === c.v ? chipActive : chip}
          >
            {c.label}
          </button>
        ))}
      </div>

      {list.loading && <p style={{ fontSize: 16, color: 'var(--text-muted)' }}>Đang tải danh sách món...</p>}

      {!list.loading && missingCount === 0 && items.length > 0 && filter !== 'having' && (
        <p style={allDone}>🎉 Tất cả món đều đã có ảnh! Bấm vào món nào đó nếu muốn thay ảnh đẹp hơn.</p>
      )}

      {!list.loading &&
        shown.map((it) => <Row key={it.id} item={it} url={urlOf(it)} status={status[it.id]} onPick={pick} />)}

      {!list.loading && shown.length === 0 && items.length > 0 && (
        <p style={{ fontSize: 16, color: 'var(--text-muted)' }}>
          {filter === 'missing' ? 'Không còn món nào thiếu ảnh trong danh sách này.' : 'Không có món nào trong mục này.'}
        </p>
      )}

      {!list.loading && items.length === 0 && (
        <p style={{ fontSize: 16, color: 'var(--text-muted)' }}>Không tìm thấy món nào khớp «{search}».</p>
      )}

      {/* Một input file ẩn dùng chung — accept image để điện thoại mở hộp Chụp/Thư viện. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void onFileChosen(e)}
        style={{ display: 'none' }}
      />
    </div>
  );
}

function Row({
  item,
  url,
  status,
  onPick,
}: {
  item: PhotoItem;
  url: string | null;
  status: RowStatus | undefined;
  onPick: (item: PhotoItem) => void;
}): JSX.Element {
  const uploading = status?.kind === 'uploading';
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => onPick(item)}
        disabled={uploading}
        style={{ ...row, opacity: uploading ? 0.6 : 1 }}
      >
        {url ? (
          <img src={url} alt="" style={thumb} />
        ) : (
          <span style={thumbEmpty} aria-hidden="true">
            📷
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={rowName}>{item.name}</span>
          <span style={rowGroup}>{item.group_label}</span>
        </span>
        <span style={rowAction}>{url ? 'Đổi ảnh' : 'Thêm ảnh'}</span>
      </button>
      {status && (
        <p
          style={{
            ...statusLine,
            color:
              status.kind === 'error'
                ? 'var(--danger-600, #dc2626)'
                : status.kind === 'done'
                  ? 'var(--herb-600, #16a34a)'
                  : 'var(--text-muted)',
          }}
          role="status"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

// ─── Styles — trang đứng ngoài AppShell nên tự lo nền + khung ────────────────────────────────
const page: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-page)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  maxWidth: 560,
  margin: '0 auto',
  padding: '16px 16px 48px',
  boxSizing: 'border-box',
};

const head: CSSProperties = { marginBottom: 14 };

const card: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  padding: 20,
};

const searchInput: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 48,
  padding: '0 14px',
  // 16px là SÀN: nhỏ hơn thì iOS tự zoom vào trang khi chạm ô — người không quen tưởng máy hỏng.
  fontSize: 16,
  fontFamily: 'var(--font-body)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  marginBottom: 16,
};

const chipRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 14,
};

/** Chip lọc — cao ≥44px cho ngón tay, chữ 15px đủ đọc với người lớn tuổi. */
const chip: CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  fontSize: 15,
  fontWeight: 600,
  fontFamily: 'var(--font-body)',
  border: '1px solid var(--border-default)',
  borderRadius: 999,
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  cursor: 'pointer',
};

const chipActive: CSSProperties = {
  ...chip,
  border: '1px solid var(--brand-600)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
};

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 76,
  padding: 8,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  boxSizing: 'border-box',
};

const thumb: CSSProperties = {
  width: 60,
  height: 60,
  objectFit: 'cover',
  borderRadius: 10,
  flexShrink: 0,
  background: 'var(--bg-sunken)',
};

const thumbEmpty: CSSProperties = {
  width: 60,
  height: 60,
  flexShrink: 0,
  borderRadius: 10,
  border: '2px dashed var(--border-default)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 24,
  background: 'var(--bg-sunken)',
};

/** Tên món hiển thị ĐỦ, xuống dòng thoải mái — KHÔNG ellipsis (chỉ đạo 2026-08-16: người dùng
 *  lớn tuổi, tên bị cắt "Cháo Tim C..." là không biết mình đang thêm ảnh cho món nào). Hàng đã
 *  có minHeight, tên dài thì hàng tự cao lên. */
const rowName: CSSProperties = {
  display: 'block',
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1.35,
  overflowWrap: 'break-word',
  color: 'var(--text-strong)',
};

const rowGroup: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--text-muted)',
  marginTop: 2,
};

const rowAction: CSSProperties = {
  flexShrink: 0,
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--brand-600)',
  padding: '0 4px',
};

const statusLine: CSSProperties = {
  margin: '4px 4px 0',
  fontSize: 15,
  fontWeight: 600,
};

const allDone: CSSProperties = {
  fontSize: 16,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  padding: 14,
  lineHeight: 1.5,
};
