// Bulk order modal — shopping cart UX.
// Panel trái: grid menu (tap để thêm vào giỏ, tap lại tăng qty).
// Panel phải: giỏ hàng (− qty + xoá + note inline).
// Mobile <768px: stack vertical (menu trên, giỏ dưới).
// Submit 1 lần → BE create N items + auto báo bếp.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { dayMonHetXuongCuoi, filterMenuBySearch } from '../lib/menu-search.ts';
import { menuThumbUrl } from '../lib/menu-thumb.ts';
import { pickAutoItem } from '../lib/auto-items.ts';
import { useToast } from './Toast.tsx';
import { useConfirm } from './ConfirmDialog.tsx';
import { Icon } from './ui/Icon.tsx';
import { QtyStepper } from './ui/QtyStepper.tsx';
import { useIsPhone } from './ui/use-is-phone.ts';

type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_out_of_stock: boolean;
  /** Bếp bật ở màn Quản lý menu khi món ế — món lên dải "NÊN MỜI KHÁCH" đầu lưới. */
  is_push_sale?: boolean;
};

type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort_order: number;
};

/** Mã tab giả cho "Nên mời" — không phải mã nhóm món thật nên lấy một chuỗi không thể trùng
 *  mã nhóm do chủ quán đặt. Nó sống chung ô state với mã nhóm để tab này loại trừ các tab kia:
 *  đang xem "Nên mời" rồi bấm "Món nướng" là chuyển hẳn, không phải lọc chồng. */
const PUSH_TAB = '__push_sale__';

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

type CartLine = {
  menu_item: MenuItem;
  qty: number;
  note: string;
};

/** MỘT thẻ món trong lưới, tách riêng và bọc `memo` — KHÔNG phải để cho gọn file.
 *
 * Menu thật của quán là ~283 món và tab mặc định là "Tất cả", nên lưới này là ~2.000 phần tử
 * DOM. Cái hộp Gọi món lại nằm TRONG `OrderDrawer`, mà cả drawer lẫn `OrdersPage` phía sau đều
 * có nhịp poll 2 giây riêng — mỗi nhịp là một lượt re-render dội thẳng xuống đây. Không memo
 * thì cứ ~2 giây cả 283 thẻ dựng lại một lần, ngay giữa lúc ngón tay đang vuốt: đo trên máy
 * giả lập chậm 6× là 17,3ms mỗi lượt, quá ngân sách một khung hình 60fps (16,7ms) → rớt frame
 * đều đặn, đúng cái người dùng thấy là "vuốt bị giật". Có memo: 0,9ms.
 *
 * Vì vậy MỌI prop ở đây phải giữ nguyên identity giữa các lần render cha, nếu không memo thành
 * vô nghĩa: `line` là object trong `cart` (các hàm sửa giỏ chỉ thay đúng dòng bị đụng, dòng
 * khác giữ nguyên tham chiếu), `groupLabel` là chuỗi, còn `onAdd`/`onNote` phải là `useCallback`
 * deps rỗng. Thêm prop mới thì kiểm lại điều này trước.
 */
const MenuCard = memo(function MenuCard({
  it,
  line,
  onAdd,
  onGiam,
  onNote,
}: {
  it: MenuItem;
  line: CartLine | undefined;
  onAdd: (item: MenuItem) => void;
  /** Bớt 1 phần — về 0 thì hỏi "Bỏ món này?" (logic ở cha). */
  onGiam: (id: string) => void;
  onNote: (id: string) => void;
}) {
  /* MỘT khung, HAI dáng (chủ quán chốt 2026-11-09) — đổi bằng @media trong CSS, không đo bề
     rộng bằng JS (600 thẻ, re-render theo nhịp poll 2s):
     - iPad/máy tính (≥ 768px): THẺ LƯỚI. Tên + giá kèm đơn vị; món đã chọn chỉ có CON SỐ ở góc —
       giỏ bên phải đã có − số + và ghi chú, lặp lại trên thẻ là thừa.
     - Điện thoại (< 768px): HÀNG DANH SÁCH theo mẫu app chủ quán đưa: ảnh 56px trái · tên + giá
       giữa · nút + phải; đã chọn thì + thành − số + (kèm "Ghi chú" dưới) và ảnh có dấu ✓.
     Thân (ảnh + chữ) là MỘT nút +1 phần; nút +, bộ − số +, Ghi chú là nút riêng — nút không
     lồng được vào trong nút. Bỏ mã SP (vẫn tìm được theo mã). */
  const anh = it.image_url;
  return (
    <div className={`bulk-menu-card-wrap ${it.is_out_of_stock ? 'out' : ''} ${line ? 'noted' : ''}`}>
      <button
        className="bulk-menu-card"
        onClick={() => onAdd(it)}
        disabled={it.is_out_of_stock}
        aria-label={it.is_out_of_stock ? `${it.name} — hết món` : `Thêm 1 ${it.name}`}
      >
        {/* Ảnh — chỉ hiện ở điện thoại. Ảnh nhỏ (thumb) trước, lỗi thì lùi về ảnh gốc một lần. */}
        <span className="thumb" aria-hidden="true">
          {anh ? (
            <img
              src={menuThumbUrl(anh)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.dataset.goc !== '1') {
                  img.dataset.goc = '1';
                  img.src = anh;
                }
              }}
            />
          ) : (
            <Icon name="order" size={28} />
          )}
          {line && (
            <span className="thumb-ok">
              <Icon name="xong" size={26} />
            </span>
          )}
        </span>
        <span className="info">
          <span className="name">{it.name}</span>
          <span className="price">
            {it.is_out_of_stock ? (
              'Hết món'
            ) : (
              <>
                {fmt(it.price)}
                {it.unit && <span className="unit"> / {it.unit}</span>}
              </>
            )}
          </span>
          {/* Có ghi chú thì đọc được ngay trên hàng (điện thoại), một dòng. */}
          {line?.note && <span className="note-line">“{line.note}”</span>}
        </span>
      </button>
      {line && <span className="bulk-qty-badge" aria-hidden="true">{line.qty}</span>}
      {/* Cột phải — chỉ hiện ở điện thoại. */}
      {!it.is_out_of_stock && (
        <div className="bulk-row-right">
          {line ? (
            <>
              <QtyStepper
                value={line.qty}
                tenMon={it.name}
                onGiam={() => onGiam(it.id)}
                onTang={() => onAdd(it)}
              />
              <button
                type="button"
                className={`bulk-note-btn ${line.note ? 'has' : ''}`}
                onClick={() => onNote(it.id)}
                aria-label={line.note ? `Sửa ghi chú ${it.name}: ${line.note}` : `Thêm ghi chú cho ${it.name}`}
              >
                {line.note ? 'Sửa ghi chú' : '＋ Ghi chú'}
              </button>
            </>
          ) : (
            <button type="button" className="bulk-add" onClick={() => onAdd(it)} aria-label={`Thêm 1 ${it.name}`}>
              {/* Icon chứ KHÔNG phải ký tự "+": ký tự nằm theo đường chân chữ của font nên lệch
                  xuống (chủ quán 2026-11-10); icon là khối vuông, flex căn giữa tuyệt đối. */}
              <Icon name="them" size={22} />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Món đã chọn, trả ra ngoài ở chế độ `onCollect`. Cố ý KHÔNG trả nguyên `MenuItem`: nơi nhận là
 *  hoá đơn tự do, nơi tên và giá được CHỤP LẠI và sửa được — trả cả object món sống là mời gọi
 *  chỗ đó bám ngược vào menu, đúng thứ tính năng này không được phép làm. */
export type PickedLine = { name: string; qty: number; unit_price: number; note: string };

type Props = {
  /** Đơn để báo bếp. Bỏ trống khi dùng `onCollect` — lúc đó không có đơn nào cả. */
  orderId: string;
  tableLabel: string;
  /** `dine-in` | `takeaway` | `delivery` — quyết định có gợi khăn lạnh vào giỏ hay không. */
  tableKind: string;
  /** Bàn CHƯA gọi món nào. Chỉ bàn mới tinh mới được gợi sẵn khăn lạnh. */
  isNewTable: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  /**
   * Chế độ GOM GIỎ: thay vì gọi API báo bếp, trả danh sách món đã chọn ra ngoài.
   *
   * Có để màn Hoá đơn tự do (M6) dùng đúng cái lưới chọn món mà nhân viên đã quen — chọn nhiều
   * món một lượt, tap tăng số phần, ghi chú ngay trên thẻ. Viết một lưới thứ hai cho giống thì
   * hai lưới sẽ khác nhau dần, và "giống màn order" là cả yêu cầu của chủ quán.
   *
   * Không truyền: mọi thứ chạy y như cũ.
   */
  onCollect?: (lines: PickedLine[]) => void;
};

export function BulkOrderModal({
  orderId,
  tableLabel,
  tableKind,
  isNewTable,
  onClose,
  onSubmitted,
  onCollect,
}: Props) {
  const toast = useToast();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [groupList, setGroupList] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<string>('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  /** < 768px — quyết định CHỖ đặt ô tìm (đầu màn hay thanh công cụ), không chỉ dáng. */
  const isPhone = useIsPhone();
  /** Menu ⋯ ở đầu giỏ (chứa "Xoá hết giỏ…"). */
  const [cartMenuOpen, setCartMenuOpen] = useState(false);
  /** Món đang mở ô ghi chú NGAY TRÊN LƯỚI (id món). Tách khỏi `editingNote` của giỏ
      để hai đường sửa ghi chú không giành nhau ô nhập. */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  /* Con trỏ phải quay lại đúng ô này sau mỗi lần tap món — nếu không, bàn phím điện thoại
     tụt xuống và nhân viên phải bấm vào ô mới gõ được món kế. */
  const searchRef = useRef<HTMLInputElement>(null);
  /* Chữ đang gõ, đọc qua ref chứ không đọc thẳng biến `search` trong `addToCart`. Đọc thẳng
     thì `search` phải nằm trong deps của `useCallback`, gõ một chữ là callback đổi identity
     và toàn bộ `MenuCard` memo hoá re-render — đúng thứ vừa bỏ công tránh. */
  const searchValRef = useRef(search);
  searchValRef.current = search;

  useEffect(() => {
    Promise.all([
      // page_size=2000 → lấy hết menu 1 lần (default BE chỉ 200, không đủ với quán
      // có nhiều món). Order picker không phân trang trong UI.
      api.get<{ data: { items: MenuItem[] } }>('/menu?page_size=2000'),
      api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
    ])
      .then(([menuRes, groupRes]) => {
        const items = menuRes.data.data.items;
        setMenu(items);
        setGroupList(groupRes.data.data.items);
        /* Bàn tại chỗ MỚI TINH → bỏ sẵn khăn lạnh vào giỏ (chủ quán 2026-09-08). Ở GIỎ chứ
           không thêm thẳng vào đơn: nhân viên còn sửa số lượng hoặc bấm 🗑 bỏ đi trước khi
           Báo bếp — vào đơn rồi thì muốn bỏ phải đi huỷ món, đụng cả bếp lẫn tiền.
           Đặt trong `.then` của lần nạp menu, không phải effect riêng: phải có menu mới dò được
           tên món, và làm đúng một lần lúc mở màn. */
        const auto = pickAutoItem(tableKind, isNewTable, items);
        if (auto) {
          setCart((prev) => {
            if (prev.has(auto.item.id)) return prev; // không đè lên thứ người ta đã tự chọn
            const next = new Map(prev);
            next.set(auto.item.id, { menu_item: auto.item, qty: auto.qty, note: '' });
            return next;
          });
        }
      })
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setLoading(false));
  }, [toast]);

  // Lookup helpers — dynamic groups (sau khi import file user có tới 30+ nhóm tự tạo)
  const groupMap = useMemo(() => new Map(groupList.map((g) => [g.code, g])), [groupList]);
  const labelOf = useCallback(
    (code: string): string => {
      const g = groupMap.get(code);
      if (!g) return code;
      return g.icon ? `${g.icon} ${g.name}` : g.name;
    },
    [groupMap],
  );

  // Tìm kiếm: không dấu + viết tắt ('ktl' → 'Khoai tây lắc'), xếp theo độ khớp.
  // Logic ở lib/menu-search.ts để MenuPickerModal dùng chung.
  //
  // `useMemo` chứ không tính trần: đây là lọc + xếp hạng trên CẢ menu (~283 món của quán), mà
  // hộp này re-render theo nhịp poll 2 giây của `OrderDrawer` bọc ngoài — tính lại mỗi nhịp là
  // tính lại một thứ không hề đổi. Deps đúng bằng 3 thứ thực sự quyết định kết quả.
  const filtered = useMemo(
    () => dayMonHetXuongCuoi(
      filterMenuBySearch(
        menu.filter((it) => {
          if (group === PUSH_TAB) return !!it.is_push_sale && !it.is_out_of_stock;
          return !group || it.group === group;
        }),
        search,
      ),
      !!search.trim(),
    ),
    [menu, group, search],
  );

  /* Đếm món bếp đang đẩy bán — quyết định tab "Nên mời" có hiện hay không, và hiện số mấy.
     Món vừa bị báo hết thì BE đã tự tắt cờ, nhưng lọc thêm `is_out_of_stock` ở đây để một
     nhịp poll chậm không khiến ai mời hụt một món bếp vừa báo không làm được. */
  const pushCount = useMemo(
    () => menu.filter((it) => it.is_push_sale && !it.is_out_of_stock).length,
    [menu],
  );

  /* 'Tất cả' + tab "Nên mời" (chỉ khi bếp đang đẩy món nào) + tất cả nhóm động
     (sort_order ASC, đã sort ở BE).
     Tab "Nên mời" đứng NGAY SAU 'Tất cả' chứ không xếp cuối: quán có ~25 nhóm, hàng tab cuộn
     ngang, nhét cuối là nó nằm ngoài màn hình và không ai biết nó tồn tại. */
  const groupCodes = [
    '',
    ...(pushCount > 0 ? [PUSH_TAB] : []),
    ...groupList.map((g) => g.code),
  ];

  /* Mọi hàm sửa giỏ đều `useCallback` deps RỖNG — chúng là prop của `MenuCard` (memo) và của
     `CartLineList`. Chỉ cần một hàm đổi identity mỗi render là memo mất tác dụng hoàn toàn.
     Làm được deps rỗng vì bên trong chỉ đụng `setCart` dạng hàm (React đảm bảo ổn định) và
     hai cái ref — không hàm nào đọc state trực tiếp. Giữ nguyên tính chất đó khi sửa sau này. */
  const addToCart = useCallback((item: MenuItem) => {
    if (item.is_out_of_stock) return;
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, qty: Math.min(99, existing.qty + 1) });
      } else {
        next.set(item.id, { menu_item: item, qty: 1, note: '' });
      }
      return next;
    });
    /* Chọn xong thì GIỮ NGUYÊN chữ đang gõ, nhưng BÔI ĐEN sẵn (chủ quán 2026-09-19, sửa lại
       lần đầu làm xoá trắng). Xoá trắng nghe thì tiện nhưng nó cuốn luôn danh sách đang lọc:
       gọi 2 phần chân gà chiên mắm là phải gõ lại y hệt từ đầu. Giữ chữ thì thẻ món vẫn nằm
       đó, tap phát nữa là badge lên 2 — mà vẫn không phải xoá tay, vì chữ đã bôi đen: gõ chữ
       đầu tiên của món kế là chữ cũ tự bị thay. Muốn xoá hẳn thì có nút ✕ trong ô tìm.
       focus() giữ bàn phím khỏi tụt sau khi tay chạm vào thẻ món.
       Chỉ đụng khi đang có chữ: đang chọn theo danh mục thì không có gì để bôi đen, và bật
       bàn phím lúc đó chỉ tổ che mất danh sách món. */
    if (searchValRef.current) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, []);

  const updateQty = useCallback((id: string, delta: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(id);
      if (!line) return prev;
      const newQty = line.qty + delta;
      if (newQty <= 0) {
        next.delete(id);
      } else if (newQty <= 99) {
        next.set(id, { ...line, qty: newQty });
      }
      return next;
    });
  }, []);

  /* Bớt 1 phần. Về 0 thì HỎI trước (chủ quán chốt 2026-11-09, thay nút "🗑 Xoá" từng món nằm
     sát nút − — bấm trượt là mất cả dòng kèm ghi chú). Đọc giỏ qua ref để hàm giữ identity ổn
     định: nó là prop của `MenuCard` (memo), xem chú thích đầu file. */
  const confirm = useConfirm();
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const giamMot = useCallback(
    async (id: string) => {
      const line = cartRef.current.get(id);
      if (!line) return;
      if (line.qty <= 1) {
        const ok = await confirm({
          title: 'Bỏ món này?',
          message: `Bỏ "${line.menu_item.name}" khỏi giỏ${line.note ? ` (kèm ghi chú: ${line.note})` : ''}?`,
          confirmLabel: 'Bỏ món',
          cancelLabel: 'Giữ lại',
          variant: 'danger',
        });
        if (!ok) return;
      }
      updateQty(id, -1);
    },
    [confirm, updateQty],
  );

  /** "Xoá hết" nay nằm trong menu ⋯ và luôn hỏi lại — trước là nút đỏ sát nút ✕ đóng giỏ. */
  const xoaHetGio = async () => {
    setCartMenuOpen(false);
    const ok = await confirm({
      title: 'Xoá hết giỏ?',
      message: `Bỏ cả ${cart.size} món (${Array.from(cart.values()).reduce((s, l) => s + l.qty, 0)} phần) đang chọn. Chưa gửi bếp nên bếp không bị ảnh hưởng.`,
      confirmLabel: 'Xoá hết',
      cancelLabel: 'Giữ lại',
      variant: 'danger',
    });
    if (ok) setCart(new Map());
  };

  const setNote = useCallback((id: string, note: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(id);
      if (!line) return prev;
      next.set(id, { ...line, note });
      return next;
    });
  }, []);

  /** Mở ô ghi chú từ lưới. Tách ra thành callback ổn định vì là prop của `MenuCard` (memo). */
  const openNoteFor = useCallback((id: string) => setNoteFor(id), []);

  const noteLine = noteFor ? cart.get(noteFor) ?? null : null;
  const cartLines = Array.from(cart.values());
  const total = cartLines.reduce((s, l) => s + l.menu_item.price * l.qty, 0);
  const totalQty = cartLines.reduce((s, l) => s + l.qty, 0);

  const submit = async () => {
    if (cartLines.length === 0) {
      toast.push('error', 'Giỏ hàng trống');
      return;
    }
    // Chế độ gom giỏ: không có đơn nào để báo bếp, chỉ đưa món ra ngoài rồi đóng.
    if (onCollect) {
      onCollect(
        cartLines.map((l) => ({
          name: l.menu_item.name,
          qty: l.qty,
          unit_price: l.menu_item.price,
          note: l.note.trim(),
        })),
      );
      setMobileCartOpen(false);
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ data: { count: number; state: string } }>(
        `/orders/${orderId}/items-bulk`,
        {
          items: cartLines.map((l) => ({
            menu_item_id: l.menu_item.id,
            qty: l.qty,
            note: l.note.trim() || null,
          })),
          send_to_kitchen: true, // báo bếp luôn — bếp xử lý ngay
        },
      );
      toast.push('success', `Đã báo bếp ${cartLines.length} món (${totalQty} phần) — ${fmt(total)}`);
      // KHÔNG push notificationStore — readyNotifier (polling) sẽ tự emit NewOrder cho bếp.
      // Order staff vừa gọi món rồi không cần notification cho chính mình.
      setMobileCartOpen(false);
      onSubmitted();
    } catch (e) {
      toast.push('error', extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  /* Ô tìm dựng MỘT lần, đặt chỗ theo bề rộng: điện thoại ở đầu màn (giữa tên bàn và ✕), máy
     tính trong thanh công cụ trên lưới như cũ. Chỉ một ô tồn tại tại một thời điểm nên
     searchRef (giữ chữ + bôi đen sau khi chọn món) luôn trỏ đúng ô đang thấy. */
  const oTim = (
      <div className="bulk-search-wrap">
        <input
          ref={searchRef}
          // type=search + enterKeyHint: bàn phím điện thoại hiện nút "Tìm" thay "Xuống
          // dòng"; bấm nó thì cất bàn phím để thấy hết lưới món. Chữ gợi ý rút ngắn
          // (2026-11-09) — bản dài bị cắt cụt thành "…khoai tây" trên máy 390px.
          type="search"
          enterKeyHint="search"
          aria-label="Tìm món theo tên, mã hoặc viết tắt"
          // Điện thoại: ô nằm giữa tên bàn và ✕ nên hẹp — chữ gợi ý ngắn cho khỏi bị cắt.
          placeholder={isPhone ? 'Tìm món, mã, ktl' : 'Tìm món, mã, viết tắt (ktl)'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          // 16px: dưới 16 iPhone tự phóng to trang khi chạm vào ô; 44px: cỡ chạm tối thiểu.
          style={{ minHeight: 44, fontSize: 16 }}
        />
        {/* Chữ không tự xoá sau khi chọn món nữa, nên phải có đường xoá bằng MỘT chạm.
            Ẩn khi ô trống: nút ✕ trên ô rỗng chỉ làm người ta phân vân nó xoá cái gì. */}
        {search && (
          <button
            type="button"
            className="bulk-search-clear"
            aria-label="Xoá chữ đang tìm"
            onClick={() => {
              setSearch('');
              searchRef.current?.focus();
            }}
          >
            <Icon name="dong" size={20} label="Xoá chữ đang tìm" />
          </button>
        )}
      </div>
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{`
        /* Điện thoại: hộp cao CỐ ĐỊNH (2026-09-19). Trước đây chỉ có max-height nên hộp co
           theo số món còn lại — lọc còn 2 món là header với thanh đáy nhảy vào giữa màn, gõ
           thêm một chữ là chúng nhảy tiếp, tap trượt sang món khác.
           dvh chứ không phải vh: trên Safari iOS, vh tính theo màn hình lúc thanh địa chỉ đã
           thu lại, nên đáy hộp (thanh đáy) bị thanh địa chỉ che. Dòng vh ngay trên giữ làm dự
           phòng cho máy cũ chưa hiểu dvh — trình duyệt không hiểu sẽ bỏ qua dòng sau.
           Máy tính vẫn co theo nội dung như cũ (override ở khối desktop cuối file). */
        .bulk-container {
          background: white;
          width: 100%;
          max-width: 1100px;
          height: 95vh;
          height: 95dvh;
          max-height: 95vh;
          max-height: 95dvh;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          /* Mốc neo cho .bulk-mobile-bar (position: absolute). Thiếu dòng này thì thanh đáy
             neo vào VIEWPORT — hộp thấp hơn màn là thanh đáy rơi ra ngoài đáy hộp. */
          position: relative;
        }
        .bulk-header {
          padding: 14px 18px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .bulk-header h1 { margin: 0; font-size: 18px; }
        .bulk-header button.bulk-close { padding: 6px 12px; }
        .bulk-body {
          display: grid;
          grid-template-columns: 1fr;
          flex: 1;
          overflow: hidden;
          /* Mặc định flex/grid item không co nhỏ hơn nội dung: thiếu min-height:0 thì cả cột
             món đẩy hộp dài ra, vùng cuộn nằm ở đâu không ai biết. */
          min-height: 0;
        }
        @media (min-width: 768px) {
          .bulk-body { grid-template-columns: 1.4fr 1fr; }
        }
        .bulk-menu-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;  /* như .bulk-body — để .bulk-menu-grid mới thực sự là chỗ cuộn */
        }
        @media (min-width: 768px) {
          .bulk-menu-panel { border-right: 1px solid #e5e7eb; }
        }
        /* Mobile sticky bar — base mobile-first: visible mặc định. Desktop override bên dưới. */
        /* Điện thoại: ô tìm nằm GIỮA đầu màn, giữa tên bàn và nút ✕ (2026-11-09). */
        .bulk-header .bulk-search-wrap { flex: 1 1 auto; min-width: 0; margin: 0 8px; }
        .bulk-header h1 { white-space: nowrap; flex: none; }
        /* Nút "Chọn lại" ở thanh đáy điện thoại — nền xám nhạt, nhường nút chính. */
        .bulk-mobile-bar button.bulk-reset {
          flex: 1 1 0;
          min-height: 52px;
          border: 0;
          border-radius: 14px;
          background: #f3f4f6;
          color: #1f2937;
          font-size: 17px;
          font-weight: 700;
        }
        .bulk-mobile-bar button.bulk-reset:disabled { opacity: 0.5; }
        .bulk-mobile-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: white;
          border-top: 1px solid #e5e7eb;
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: stretch;
          z-index: 5;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.08);
        }
        .bulk-mobile-bar .submit {
          flex: 1.5 1 0;  /* rộng hơn nút "Chọn lại" bên cạnh */
          background: var(--brand, #0f766e);
          color: white;
          font-weight: 700;
          padding: 10px 14px;
          font-size: 14px;
          min-height: 52px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          display: flex;
          /* NGANG chứ không phải dọc: badge đếm đứng cạnh chữ chứ không đè lên trên đầu chữ.
             Trước đây là column vì nút từng có hai dòng chữ, giờ chỉ còn một nhãn. */
          flex-direction: row;
          gap: 10px;
          align-items: center;
          justify-content: center;
          line-height: 1.1;
        }
        /* Badge đếm số phần đang chọn — trắng trên nền xanh ngọc để đọc được mà không cần nhìn kỹ. */
        .bulk-mobile-bar .submit .bar-count {
          background: white;
          color: var(--brand, #0f766e);
          font-size: 15px;
          font-weight: 800;
          min-width: 28px;
          height: 28px;
          padding: 0 8px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          animation: bulk-count-pop 0.22s ease-out;
        }
        @keyframes bulk-count-pop {
          0% { transform: scale(0.6); }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        .bulk-mobile-bar .submit:disabled {
          background: #d1d5db;
          color: #9ca3af;
          cursor: not-allowed;
        }
        /* Mobile cart sheet — slide từ dưới lên */
        .bulk-mobile-sheet-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 10000;
          display: flex;
          align-items: flex-end;
          animation: bulk-fadein 0.15s ease-out;
        }
        @keyframes bulk-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        /* Cao BẰNG hộp Gọi món (95dvh) — trước đây 85vh, tấm giỏ thấp hơn nền phía sau nên
           mỗi lần mở/đóng cả màn nhảy một nấc. dvh vì Safari iOS, vh giữ cho máy cũ. */
        .bulk-mobile-sheet {
          background: white;
          width: 100%;
          height: 95vh;
          height: 95dvh;
          max-height: 95vh;
          max-height: 95dvh;
          border-radius: 16px 16px 0 0;
          display: flex;
          flex-direction: column;
          animation: bulk-slideup 0.2s ease-out;
        }
        @keyframes bulk-slideup {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        /* Đầu tấm giỏ ĐỨNG YÊN: tên bàn, số món và TỔNG TIỀN. Tiền dọn lên đây vì trước
           nó nằm ở chân tấm, giỏ dài là phải cuộn hết mới thấy tổng. Hàng nút [+][Báo bếp]
           thì GIỮ NGUYÊN ở chân tấm (chỉ đạo chủ quán 2026-09-21) — đã thử đưa lên trên
           cùng tổng tiền và phải trả về. flex:0 0 auto để header không bị danh sách ép co. */
        .bulk-mobile-sheet-header {
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 0 0 auto;
          background: white;
        }
        .bulk-sheet-head-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .bulk-mobile-sheet-header .bulk-total-row { margin-bottom: 0; }
        /* Tên bàn cùng màu xanh với đầu hộp Gọi món để đọc lướt là khớp được hai màn. */
        .bulk-sheet-table { color: #0f766e; font-weight: 700; }
        .bulk-mobile-sheet-header h2 {
          margin: 0;
          font-size: 17px;
          min-width: 0;      /* cho nhãn co lại thay vì đẩy 'Xoá hết' và ✕ xuống dòng */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bulk-mobile-sheet-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          background: #f9fafb;
        }
        /* Chân tấm ĐỨNG YÊN ở đáy: [+ gọi thêm] và [Báo bếp] ở nguyên chỗ cũ — ngón cái
           cầm điện thoại với tới đáy, còn đầu tấm thì để soát bàn và tổng tiền. */
        .bulk-mobile-sheet-footer {
          padding: 12px 14px;
          background: white;
          border-top: 1px solid #e5e7eb;
          flex: 0 0 auto;
        }
        .bulk-sheet-handle {
          width: 40px;
          height: 4px;
          background: #d1d5db;
          border-radius: 2px;
          margin: 6px auto 0;
        }
        .bulk-menu-toolbar {
          flex: 0 0 auto;  /* dính trên: không co lại khi danh sách món dài */
          padding: 10px 12px;
          background: white;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid #f3f4f6;
        }
        .bulk-search-wrap {
          position: relative;
          display: flex;
        }
        .bulk-search-wrap input {
          width: 100%;
          padding-right: 44px;  /* chừa chỗ cho nút ✕, chữ dài không chui xuống dưới nút */
        }
        /* Ô TRỐNG thì nút ✕ không hiện → không chừa chỗ cho nó (2026-11-09: chữ gợi ý bị cắt
           cụt "…viết tắt (" trong khi bên phải còn một khoảng trắng 44px). */
        .bulk-search-wrap input:placeholder-shown { padding-right: 12px; }
        /* Viết button.bulk-search-clear chứ không phải class trần .bulk-search-clear: rule
           'button' trần trong styles.css có màu nền riêng, class trần thua nó độ ưu tiên.
           (Không dùng dấu backtick trong khối này — cả khối CSS nằm trong một template
           literal, một dấu backtick lạc vào là cắt đứt chuỗi, cả file hỏng cú pháp.) */
        button.bulk-search-clear {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 36px;
          min-height: 36px;
          padding: 0;
          border: none;
          background: transparent;
          color: #6b7280;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
        }
        .bulk-menu-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .bulk-menu-tabs button {
          padding: 6px 12px;
          font-size: 13px;
          white-space: nowrap;
          min-height: 36px;
          flex: 0 0 auto;
        }
        /* ─── Tab "Nên mời" ──────────────────────────────────────────────────
           Tab của món bếp đang đẩy bán. Tô CAM ở cả hai trạng thái chọn/không chọn —
           các tab nhóm khác đều xanh-xám như nhau, nên màu khác là thứ duy nhất kéo
           được mắt nhân viên sang nó giữa một hàng 25 tab cuộn ngang.
           Viết button.bulk-tab-push chứ không viết trần: .secondary trong styles.css có
           cùng độ ưu tiên và sẽ đè mất màu nền của tab chưa chọn. */
        button.bulk-tab-push {
          background: var(--brand, #0f766e);
          border-color: var(--brand, #0f766e);
          color: #fff;
          font-weight: 700;
        }
        button.bulk-tab-push.secondary {
          background: var(--teal-50, #f0fdfa);
          border-color: var(--teal-200, #99f6e4);
          color: var(--teal-800, #115e59);
        }
        .bulk-menu-grid {
          flex: 1;
          overflow-y: auto;
          padding: 10px 12px 96px;  /* mobile-first: chừa space cho sticky bar; desktop reset */
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          /* Hàng grid tự co theo nội dung, KHÔNG chia nhau chỗ trống. Mặc định của grid là
             stretch: từ lúc hộp cao cố định (2026-09-19), lọc còn 2 món là hai thẻ đó kéo dài
             hết màn, giá nằm tít dưới đáy. */
          align-content: start;
          /* Mỗi thẻ cao theo nội dung CỦA NÓ (2026-11-09): thẻ đã chọn cao hơn vì có thanh
             − số +, mặc định stretch kéo thẻ hết món cùng hàng cao theo, để lại khoảng trống. */
          align-items: start;
        }
        /* Khung bọc thẻ món — chỗ neo cho nút ghi chú (thẻ là <button>, không lồng nút vào được). */
        /* content-visibility KHÔNG phải tinh chỉnh vặt — nó là thứ chữa cú "tap món xong đơ
           một nhịp" (2026-09-21).
           Tap một món làm thẻ đó mọc thêm badge số lượng + nút Ghi chú và đổi class 'noted'.
           Chỉ MỘT thẻ đổi, và React cũng chỉ render đúng một thẻ (đã memo) — nhưng trình duyệt
           thì tính lại layout cho CẢ lưới 283 thẻ, vì mọi thẻ đều là grid item có kích thước
           theo nội dung. Đo được (Chrome headless, CPU giả lập chậm 6×): React 4,3ms nhưng
           layout 48,1ms. Người dùng thấy là "bấm xong khựng một lúc".
           content-visibility:auto cho trình duyệt BỎ QUA hẳn layout của thẻ đang nằm ngoài tầm
           nhìn → 48,1ms còn 13,1ms. contain-intrinsic-size giữ chỗ chiều cao thay cho thẻ chưa
           vẽ (102px là chiều cao thật, đo tại chỗ); có từ khoá 'auto' thì sau lần vẽ đầu trình
           duyệt nhớ kích thước thật nên thanh cuộn không nhảy.
           Đã thử và LOẠI: 'contain: layout style' một mình (49→43,6ms, gần như vô ích) và
           'grid-auto-rows: 102px' (49→42,7ms) — chi phí nằm ở layout TỪNG THẺ chứ không ở việc
           chia hàng của grid.
           LƯU Ý: Safari chỉ hiểu từ bản 18. iPhone cũ hơn bỏ qua dòng này — không vỡ gì, nhưng
           cũng không nhanh lên. Máy cũ mà vẫn khựng thì phải cắt số thẻ render (phân trang /
           virtualize), CSS không làm được nữa.
           KHÔNG dùng dấu backtick trong khối chú thích này: cả khối style nằm trong một template
           literal, một dấu backtick là đóng chuỗi sớm và vỡ build. */
        /* Khung bọc MANG viền + nền của thẻ (2026-11-09): bên trong là thân thẻ (nút +1) và,
           khi món đã vào giỏ, hàng [− số +][Ghi chú] — hai nút riêng không lồng vào thân thẻ
           được, nên viền phải ôm cả hai. 72px = chiều cao thật của thẻ chưa chọn (đo tại chỗ). */
        .bulk-menu-card-wrap {
          position: relative;
          display: flex;
          flex-direction: column;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          /* CLIP chứ KHÔNG hidden (2026-11-09, đo bằng Chrome headless trên 600 thẻ): hidden biến
             khung thành vùng cuộn → "kích thước tối thiểu tự động" của grid item về 0, cộng với
             content-visibility bên dưới là cả lưới sụp còn 2px/thẻ, chồng lên nhau, không đọc
             được món nào. clip vẫn cắt góc bo cho thanh − số + nhưng không đụng tới chuyện đó. */
          overflow: clip;
          contain: layout style;
          content-visibility: auto;
          contain-intrinsic-size: auto 72px;
        }
        .bulk-menu-card-wrap > .bulk-menu-card { flex: 1 1 auto; min-width: 0; }
        /* ══ DÁNG CHUNG / MÁY TÍNH (thẻ lưới) ══
           Món đã chọn: viền xanh ngọc + con số góc phải (cam đổi sang màu hệ thống 2026-11-09). Chừa mép phải thân thẻ cho con số. */
        .bulk-menu-card-wrap.noted { border: 2px solid var(--brand, #0f766e); }
        .bulk-menu-card-wrap.noted > button.bulk-menu-card { padding-right: 46px; }
        /* Món hết: viền ĐỨT + tên gạch ngang + chữ xám, không chạm được (nút disabled). Bản
           trước chỉ làm mờ 45% nên trông như thẻ bị lỗi; bản cũ hơn nữa là khối đỏ chói. */
        .bulk-menu-card-wrap.out { background: #f3f4f6; border-style: dashed; border-color: #d1d5db; }
        .bulk-menu-card-wrap.out .name { color: #9ca3af; text-decoration: line-through; }
        .bulk-menu-card-wrap.out .price { color: #9ca3af; font-weight: 600; }
        /* Ở thẻ lưới, khối chữ "tan" vào thân thẻ (tên trên, giá dưới như cũ); ảnh, cột phải và
           dòng ghi chú chỉ dành cho hàng danh sách trên điện thoại. */
        .bulk-menu-card .info { display: contents; }
        .bulk-menu-card .thumb,
        .bulk-row-right,
        .bulk-menu-card .note-line { display: none; }
        .bulk-qty-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          min-width: 30px;
          height: 30px;
          padding: 0 8px;
          border-radius: 999px;
          background: var(--brand, #0f766e);
          color: white;
          font-size: 16px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-variant-numeric: tabular-nums;
          pointer-events: none;
        }
        @media (min-width: 768px) {
          /* Thẻ rộng hơn trên iPad/máy tính (chủ quán 2026-11-09: 4 thẻ/hàng "quá chật", tên dài
             bị cắt). 170px → khung món ~560px còn 3 thẻ/hàng; màn rộng hơn tự thêm cột.
             Tên dài thì thẻ DÀI XUỐNG cho đủ chữ (tối đa 3 dòng, giá được xuống dòng), các thẻ
             cùng hàng CAO BẰNG NHAU (stretch). Stretch an toàn nhờ khung thẻ dùng overflow: clip
             (xem .bulk-menu-card-wrap); với hidden là lưới sụp. */
          .bulk-menu-grid {
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
            gap: 10px;
            align-items: stretch;
          }
          .bulk-menu-card .name { -webkit-line-clamp: 3; line-clamp: 3; max-height: 3.75em; }
          .bulk-menu-card .price { white-space: normal; }
        }

        /* ══ ĐIỆN THOẠI: hộp CAO HẾT MÀN (chủ quán 2026-11-09). Trước cao 95dvh và lớp phủ đẩy
           hộp xuống đáy (flex-end) → 5% trên cùng bỏ trống, lộ header app phía sau. Lấy lại
           chỗ đó cho danh sách món thay vì ép bớt khoảng đệm (đã thử ép: chật, bị trả lại).
           Đệm đỉnh bằng safe-area để tai thỏ/giờ của iPhone không đè lên tên bàn. Bo góc bỏ
           vì hộp đã chạm mép màn. Thanh cuộn xám của hàng tab ẩn đi — vuốt ngang vẫn được. */
        @media (max-width: 767px) {
          .bulk-container {
            height: 100vh;
            height: 100dvh;
            max-height: 100vh;
            max-height: 100dvh;
            border-radius: 0;
            padding-top: env(safe-area-inset-top, 0px);
          }
          /* Tấm giỏ luôn cao BẰNG hộp Gọi món (xem .bulk-mobile-sheet) → cũng hết màn. */
          .bulk-mobile-sheet {
            height: 100vh;
            height: 100dvh;
            max-height: 100vh;
            max-height: 100dvh;
            padding-top: env(safe-area-inset-top, 0px);
          }
          .bulk-header button.bulk-close { width: 44px; padding: 0; flex: none; }
          .bulk-menu-tabs { scrollbar-width: none; }
          .bulk-menu-tabs::-webkit-scrollbar { display: none; }
        }
        /* ══ ĐIỆN THOẠI (< 768px): HÀNG DANH SÁCH theo mẫu chủ quán đưa (2026-11-09) ══
           [ảnh 56] [tên / giá / ghi chú] [+  hoặc  − số + và Ghi chú]. Mỗi món một hàng, kẻ
           ngang mảnh giữa các hàng, không viền thẻ. */
        @media (max-width: 767px) {
          .bulk-menu-grid { grid-template-columns: 1fr; gap: 0; padding-left: 12px; padding-right: 12px; }
          .bulk-menu-card-wrap,
          .bulk-menu-card-wrap.noted,
          .bulk-menu-card-wrap.out {
            flex-direction: row;
            align-items: center;
            gap: 8px;
            border: 0;
            border-bottom: 1px solid #f1f5f9;
            border-radius: 0;
            background: transparent;
            contain-intrinsic-size: auto 78px;
          }
          .bulk-menu-card-wrap.noted { background: linear-gradient(90deg, #f0fdfa, #fff 75%); }
          .bulk-menu-card-wrap > button.bulk-menu-card,
          .bulk-menu-card-wrap.noted > button.bulk-menu-card {
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 12px;
            padding: 10px 0;
            min-height: 78px;
          }
          .bulk-qty-badge { display: none; }
          .bulk-menu-card .thumb {
            position: relative;
            flex: none;
            width: 56px;
            height: 56px;
            border-radius: 12px;
            background: #e6f4f1;
            color: #5eaaa0;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .bulk-menu-card .thumb img { width: 100%; height: 100%; object-fit: cover; }
          .bulk-menu-card .thumb-ok {
            position: absolute;
            inset: 0;
            background: rgba(15, 118, 110, 0.6);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .bulk-menu-card-wrap.out .thumb { opacity: 0.5; }
          .bulk-menu-card .info { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
          .bulk-menu-card .name { font-weight: 700; color: #111827; }
          .bulk-menu-card .price { font-weight: 600; color: #374151; }
          .bulk-menu-card .price .unit { color: #0f766e; font-weight: 500; }
          .bulk-menu-card .note-line { display: block; }
          .bulk-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: none; }
          /* Nhìn 38px (44px bị chê to, 2026-11-09), vùng chạm vẫn ~44px nhờ ::after. */
          button.bulk-add {
            position: relative;
            width: 38px;
            height: 38px;
            min-height: 38px;
            padding: 0;
            border-radius: 12px;
            border: 1px solid #d1d5db;
            background: white;
            color: #0f766e;
            font-size: 22px;
            font-weight: 400;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          button.bulk-add::after { content: ""; position: absolute; inset: -3px; }
          button.bulk-add:active { background: #f0fdfa; }
          button.bulk-note-btn {
            min-height: 32px;
            padding: 0 2px;
            border: 0;
            background: transparent;
            color: var(--brand, #0f766e);
            font-size: 14px;
            font-weight: 600;
            white-space: nowrap;
          }
          button.bulk-note-btn.has { color: #0f766e; }
        }
        .bulk-menu-card .note-line {
          font-size: 14px;
          color: #0f766e;
          font-style: italic;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Ô ghi chú mở từ lưới. z-index trên cả tấm giỏ (10000) vì mở được từ trong tấm đó. */
        .bulk-note-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .bulk-note-box {
          background: white;
          border-radius: 14px;
          padding: 16px;
          width: 100%;
          max-width: 380px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
        }
        .bulk-note-box h3 { margin: 0 0 10px; font-size: 16px; }
        .bulk-note-box input {
          width: 100%;
          box-sizing: border-box;
          /* 16px là mức tối thiểu để Safari iOS không tự phóng to trang khi focus. */
          font-size: 16px;
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          min-height: 44px;
        }
        .bulk-note-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
        .bulk-note-done {
          background: #0f766e;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 10px 22px;
          min-height: 44px;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
        }
        /* Thân thẻ = MỘT nút +1 phần. Nền/viền nằm ở khung bọc, nút này trong suốt. Viết
           button.bulk-menu-card vì luật nút chung của app tô nền teal + chữ trắng cho mọi nút. */
        button.bulk-menu-card {
          background: transparent;
          border: 0;
          border-radius: 0;
          padding: 10px 10px 8px;
          cursor: pointer;
          text-align: left;
          min-height: 72px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 4px;
          color: #1f2937;
          font-weight: 400;
          overflow: hidden;  /* safety — không cho con vượt khung card */
        }
        .bulk-menu-card-wrap:not(.out):active { transform: scale(0.98); }
        .bulk-menu-card-wrap { transition: transform 0.08s, border-color 0.15s; }
        @media (hover: hover) {
          .bulk-menu-card-wrap:not(.out):not(.noted):hover { border-color: #0f766e; }
        }
        button.bulk-menu-card:disabled { cursor: not-allowed; background: transparent; color: #1f2937; }
        .bulk-menu-card .name {
          font-size: 16px;
          font-weight: 600;
          line-height: 1.25;
          /* Clamp tối đa 2 dòng — tránh tên dài đẩy giá ra khỏi card */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
          overflow-wrap: anywhere;
          /* Fallback nếu browser không hỗ trợ line-clamp: 2 × line-height */
          max-height: 2.5em;
        }
        .bulk-menu-card .price {
          font-size: 15px;
          font-weight: 700;
          color: #0f766e;
          /* Giá luôn ở đáy thân thẻ, không bị tên dài đẩy ra ngoài khung */
          flex: 0 0 auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Đơn vị đi kèm giá ("/ ca"): nhạt hơn để mắt bắt con số trước. */
        .bulk-menu-card .price .unit { font-weight: 500; color: #6b7280; }
        /* Ô tìm type=search: Safari/Chrome tự vẽ thêm một nút xoá nhỏ — app đã có nút ✕ to
           riêng (.bulk-search-clear), để cả hai là hai dấu ✕ chồng nhau. */
        .bulk-search-wrap input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
        /* Menu ⋯ ở đầu giỏ — thả xuống dưới nút, neo mép phải. */
        .bulk-cart-menu { position: relative; }
        button.bulk-cart-menu-btn { padding: 6px 10px; min-height: 44px; }
        .bulk-cart-menu-shade { position: fixed; inset: 0; z-index: 40; }
        .bulk-cart-menu-list {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 41;
          min-width: 200px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
          padding: 6px;
        }
        button.bulk-cart-menu-danger {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 48px;
          padding: 0 12px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #b91c1c;
          font-size: 16px;
          font-weight: 600;
          text-align: left;
        }
        button.bulk-cart-menu-danger:active { background: #fef2f2; }
        .bulk-cart-panel {
          /* Mobile-first: ẨN cart panel — chỉ hiện trên desktop (≥768px override bên dưới).
             Lý do: mobile dùng sticky bar dưới + slide-up sheet (tap để xem giỏ đầy đủ). */
          display: none;
          flex-direction: column;
          background: #f9fafb;
          overflow: hidden;
        }
        .bulk-cart-header {
          padding: 10px 14px;
          font-weight: 600;
          color: #6b7280;
          font-size: 13px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .bulk-cart-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
        }
        .bulk-cart-empty {
          color: #9ca3af;
          text-align: center;
          padding: 32px 16px;
          font-size: 13px;
        }
        .bulk-cart-line {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 8px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .bulk-cart-line .col-trai { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .bulk-cart-line .col-phai { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
        /* Tên món + tiền là thứ chủ quán soát lại trước khi Báo bếp, nên to hơn hẳn phần
           điều khiển. Trước đây tên 14px / giá 13px, còn nút −/+ 32px nhìn lấn át cả dòng. */
        .bulk-cart-line .name {
          font-size: 17px;
          font-weight: 700;
          flex: 1;
          min-width: 0;            /* cho phép flex item co lại + word-break ngắt */
          line-height: 1.3;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .bulk-cart-line .price {
          font-size: 16px;
          font-weight: 700;
          color: #0f766e;
          white-space: nowrap;
          flex-shrink: 0;          /* price không co khi name dài */
        }
        .bulk-cart-line .row { display: flex; gap: 6px; align-items: center; }
        .qty-stepper { display: flex; align-items: center; gap: 4px; }
        .qty-stepper button {
          background: #e5e7eb;
          color: #1f2937;
          border: none;
          width: 30px;
          height: 30px;
          min-height: 30px;
          min-width: 30px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
        }
        .qty-stepper button:hover { background: #d1d5db; }
        .qty-stepper .qty { font-weight: 700; min-width: 24px; text-align: center; font-size: 16px; }
        /* Ghi chú đứng cùng hàng với nút Xoá (giữa thanh +/− và Xoá), không xuống dòng riêng:
           dòng món gọn lại một nấc, danh sách dài bớt phải cuộn. */
        .bulk-cart-note {
          font-size: 12px;
          color: #6b7280;
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
        }
        .bulk-cart-note input {
          font-size: 12px;
          padding: 4px 8px;
          min-height: 30px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }
        .bulk-cart-note-btn {
          background: transparent;
          color: #0f766e;
          border: 1px solid #0f766e;
          padding: 3px 8px;
          font-size: 11px;
          border-radius: 6px;
          cursor: pointer;
          min-height: 28px;
        }
        .bulk-cart-note-existing {
          background: #f0fdfa;
          color: #0f766e;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bulk-cart-note-btn { flex: 0 0 auto; }
        .bulk-cart-footer {
          padding: 12px 14px;
          background: white;
          border-top: 1px solid #e5e7eb;
        }
        .bulk-total-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 10px;
        }
        .bulk-total-label { color: #6b7280; font-size: 13px; }
        .bulk-total-value { font-size: 22px; font-weight: 700; color: #0f766e; }
        /* Hàng nút đáy tấm giỏ trên điện thoại: [+ gọi thêm] [Báo bếp].
           Trước đây chỉ có "Báo bếp", muốn chọn thêm món phải bấm ✕ đóng giỏ đi đã —
           mà ✕ đọc ra là "bỏ", không ai đoán nó đưa mình về danh sách món. */
        .bulk-footer-actions { display: flex; gap: 10px; align-items: stretch; }
        .bulk-footer-actions .bulk-submit { flex: 1; width: auto; }
        .bulk-add-more {
          flex: 0 0 auto;
          width: 60px;
          min-height: 52px;
          padding: 0;
          border-radius: 10px;
          border: 2px solid #0f766e;
          background: white;
          color: #0f766e;
          font-size: 30px;
          font-weight: 400;
          line-height: 1;
          cursor: pointer;
        }
        .bulk-submit {
          width: 100%;
          background: var(--brand, #0f766e);
          color: white;
          font-size: 16px;
          font-weight: 700;
          padding: 14px;
          min-height: 52px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
        }
        .bulk-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .bulk-clear {
          background: transparent;
          color: #dc2626;
          font-size: 12px;
          padding: 2px 6px;
          border: none;
          cursor: pointer;
          min-height: 28px;
          white-space: nowrap;   /* 'Xoá hết' gãy thành hai dòng thì cả hàng cao gấp đôi */
          flex: 0 0 auto;
        }

        /* Desktop overrides (≥768px) — đặt CUỐI để đảm bảo source-order win.
           Đây là điểm bị bug trước: media @media trước base rule sẽ bị base ghi đè. */
        @media (min-width: 768px) {
          .bulk-cart-panel { display: flex; }
          .bulk-mobile-bar { display: none; }
          .bulk-menu-grid  { padding-bottom: 10px; }
          /* Máy tính giữ nguyên như trước: hộp co theo nội dung, ít món thì hộp thấp.
             Chỉ đạo 2026-09-19 là sửa cho điện thoại. */
          .bulk-container  { height: auto; }
        }
      `}</style>

      <div className="bulk-container">
        <div className="bulk-header">
          {/* Điện thoại: MỘT hàng [Bàn 05] [ô tìm] [✕] — bỏ chữ "Gọi món" (chủ quán 2026-11-09),
              ô tìm lên đầu màn cho gần ngón cái và nhường chỗ cho danh sách món. */}
          <h1>
            {!isPhone && <>{onCollect ? 'Chọn món' : 'Gọi món'} ·{' '}</>}
            <span style={{ color: '#0f766e' }}>{tableLabel}</span>
          </h1>
          {isPhone && oTim}
          <button className="secondary bulk-close" onClick={onClose} aria-label="Đóng">
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>

        <div className="bulk-body">
          {/* PANEL TRÁI — MENU */}
          <div className="bulk-menu-panel">
            <div className="bulk-menu-toolbar">
              {!isPhone && oTim}
              <div className="bulk-menu-tabs">
                {groupCodes.map((g) => (
                  <button
                    key={g || 'all'}
                    onClick={() => setGroup(g)}
                    className={`${group === g ? '' : 'secondary'} ${g === PUSH_TAB ? 'bulk-tab-push' : ''}`}
                  >
                    {g === '' && `Tất cả (${menu.length})`}
                    {g === PUSH_TAB && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="de-xuat" size={16} />Nên mời ({pushCount})</span>}
                    {g !== '' && g !== PUSH_TAB && labelOf(g)}
                  </button>
                ))}
              </div>
            </div>
            <div className="bulk-menu-grid">
              {loading && <p style={{ color: '#6b7280', gridColumn: '1/-1' }}>Đang tải menu...</p>}
              {!loading && filtered.length === 0 && (
                <p style={{ color: '#9ca3af', gridColumn: '1/-1', textAlign: 'center', padding: 24 }}>
                  Không tìm thấy món
                </p>
              )}
              {filtered.map((it) => (
                <MenuCard
                  key={it.id}
                  it={it}
                  line={cart.get(it.id)}
                  onAdd={addToCart}
                  onGiam={giamMot}
                  onNote={openNoteFor}
                />
              ))}
            </div>
          </div>

          {/* PANEL PHẢI — GIỎ HÀNG (desktop only, mobile dùng sticky bar + sheet) */}
          <div className="bulk-cart-panel">
            <div className="bulk-cart-header">
              <span>{demMon(cartLines.length, totalQty)}</span>
              {cartLines.length > 0 && (
                <CartMenu open={cartMenuOpen} onToggle={setCartMenuOpen} onXoaHet={xoaHetGio} />
              )}
            </div>
            <div className="bulk-cart-body">
              <CartLineList
                lines={cartLines}
                editingNote={editingNote}
                onUpdateQty={updateQty}
                onGiam={giamMot}
                onSetNote={setNote}
                onStartEditNote={(id) => setEditingNote(id)}
                onStopEditNote={() => setEditingNote(null)}
              />
            </div>
            <div className="bulk-cart-footer">
              <div className="bulk-total-row">
                <span className="bulk-total-label">Tổng tạm tính:</span>
                <span className="bulk-total-value">{fmt(total)}</span>
              </div>
              <button
                className="bulk-submit"
                onClick={submit}
                disabled={submitting || cartLines.length === 0}
              >
                {submitting && <span className="spinner" />}
                {onCollect ? 'Thêm vào hoá đơn' : 'Báo bếp'}
              </button>
            </div>
          </div>
        </div>

        {/* MOBILE — thanh dưới, ĐÚNG MỘT NÚT (chỉ đạo chủ quán 2026-09-08).
            Trước đây là hai nút: một ô tóm tắt giỏ và một nút hành động. Hai ô cạnh nhau cùng
            dẫn tới đúng một chỗ thì ô bên trái chỉ tổ chiếm nửa bề ngang mà không thêm việc gì.
            Và nút này KHÔNG báo bếp: gửi thẳng từ đây là gửi mà chưa từng nhìn lại giỏ — tap
            trúng một món hai lần là thành 2 phần mà không hề biết, gửi xong mới phát hiện thì
            món đã nằm ở bếp. Báo bếp CHỈ còn bên trong giỏ. */}
        <div className="bulk-mobile-bar">
          {/* [Chọn lại] [Xem đơn · tổng tiền (số phần)] — theo mẫu app chủ quán đưa (2026-11-09),
              thay cho thanh "đúng một nút" (2026-09-08). "Chọn lại" = xoá cả giỏ, LUÔN hỏi lại
              (xoaHetGio). "Xem đơn" vẫn chỉ MỞ giỏ, không báo bếp: gửi thẳng từ đây là gửi mà chưa
              từng nhìn lại giỏ. Số phần trong vòng tròn nhảy một nhịp mỗi lần tap (key) — báo
              "tap của bạn đã được nhận". */}
          <button
            type="button"
            className="bulk-reset"
            onClick={xoaHetGio}
            disabled={cartLines.length === 0}
          >
            Chọn lại
          </button>
          <button
            className="submit"
            onClick={() => setMobileCartOpen(true)}
            disabled={cartLines.length === 0}
          >
            <span>
              Xem đơn{totalQty > 0 && ` · ${fmt(total)}`}
            </span>
            {totalQty > 0 && (
              <span className="bar-count" key={totalQty}>
                {totalQty}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* MOBILE — full cart sheet (slide-up modal-trong-modal) */}
      {mobileCartOpen && (
        <div
          className="bulk-mobile-sheet-overlay"
          onClick={(e) => e.target === e.currentTarget && setMobileCartOpen(false)}
        >
          <div className="bulk-mobile-sheet">
            <div className="bulk-sheet-handle" />
            <div className="bulk-mobile-sheet-header">
              <div className="bulk-sheet-head-top">
                {/* KHÔNG icon và KHÔNG chữ 'Giỏ hàng' (chỉ đạo chủ quán 2026-09-08) — đang
                    đứng trong chính cái giỏ thì không cần ai nhắc lại. Tên bàn thì có: tấm
                    giỏ che kín màn, không còn thấy đầu hộp Gọi món để biết đang gọi cho bàn
                    nào. */}
                <h2>
                  <span className="bulk-sheet-table">{tableLabel}</span> · {demMon(cartLines.length, totalQty)}
                </h2>
                <div className="flex" style={{ gap: 8 }}>
                  {cartLines.length > 0 && (
                    <CartMenu open={cartMenuOpen} onToggle={setCartMenuOpen} onXoaHet={xoaHetGio} />
                  )}
                  <button
                    className="secondary"
                    onClick={() => setMobileCartOpen(false)}
                    style={{ padding: '6px 10px' }}
                    aria-label="Đóng giỏ"
                  >
                    <Icon name="dong" size={22} label="Đóng giỏ" />
                  </button>
                </div>
              </div>
              <div className="bulk-total-row">
                <span className="bulk-total-label">Tổng tạm tính:</span>
                <span className="bulk-total-value">{fmt(total)}</span>
              </div>
            </div>
            <div className="bulk-mobile-sheet-body">
              <CartLineList
                lines={cartLines}
                editingNote={editingNote}
                onUpdateQty={updateQty}
                onGiam={giamMot}
                onSetNote={setNote}
                onStartEditNote={(id) => setEditingNote(id)}
                onStopEditNote={() => setEditingNote(null)}
              />
            </div>
            <div className="bulk-mobile-sheet-footer">
              <div className="bulk-footer-actions">
                {/* Gọi thêm: đóng tấm giỏ để về danh sách món, GIỎ GIỮ NGUYÊN. Cùng việc với
                    nút ✕ trên đầu tấm, nhưng ✕ đọc ra là "thôi bỏ" nên không ai dám bấm khi
                    đang muốn gọi tiếp. */}
                <button
                  type="button"
                  className="bulk-add-more"
                  onClick={() => setMobileCartOpen(false)}
                  title="Gọi thêm món"
                  aria-label="Gọi thêm món"
                >
                  +
                </button>
                <button
                  className="bulk-submit"
                  onClick={async () => {
                    await submit();
                  }}
                  disabled={submitting || cartLines.length === 0}
                >
                  {submitting && <span className="spinner" />}
                  {onCollect ? 'Thêm vào hoá đơn' : 'Báo bếp'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ô GHI CHÚ mở thẳng từ lưới món — khỏi phải vào giỏ mới ghi được (2026-09-21).
          Gõ tới đâu ăn vào giỏ tới đó, nên đóng kiểu nào (Xong, Enter, bấm ra ngoài) cũng
          không mất chữ. */}
      {noteFor && noteLine && (
        <div
          className="bulk-note-overlay"
          onClick={(e) => e.target === e.currentTarget && setNoteFor(null)}
        >
          <div className="bulk-note-box">
            <h3>{noteLine.menu_item.name}</h3>
            <input
              autoFocus
              value={noteLine.note}
              onChange={(e) => setNote(noteFor, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setNoteFor(null); }}
              placeholder="vd: ít cay, không hành..."
            />
            <div className="bulk-note-actions">
              {noteLine.note && (
                <button type="button" className="secondary" onClick={() => setNote(noteFor, '')}>
                  Xoá chữ
                </button>
              )}
              <button type="button" className="bulk-note-done" onClick={() => setNoteFor(null)}>
                Xong
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tái dùng cho desktop cart panel + mobile sheet body
/** Cách đếm THỐNG NHẤT mọi chỗ (chủ quán chốt 2026-11-09): "2 món (6 phần)". Trước giỏ ghi
 *  "2 món · 6 phần" còn hộp thanh toán ghi "6 món" — cùng một đơn mà hai con số "món". */
function demMon(soMon: number, soPhan: number) {
  return soMon === soPhan ? `${soMon} món` : `${soMon} món (${soPhan} phần)`;
}

/** Nút ⋯ ở đầu giỏ + menu thả xuống. "Xoá hết" chuyển vào đây (2026-11-09): trước là nút đỏ
 *  đứng sát nút ✕ đóng giỏ — định đóng giỏ mà bấm trượt là mất cả giỏ. */
function CartMenu({
  open,
  onToggle,
  onXoaHet,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  onXoaHet: () => void;
}) {
  return (
    <div className="bulk-cart-menu">
      <button
        type="button"
        className="secondary bulk-cart-menu-btn"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label="Thêm thao tác với giỏ"
      >
        <Icon name="them-thao-tac" size={22} label="Thêm thao tác với giỏ" />
      </button>
      {open && (
        <>
          {/* Lớp trong suốt bắt chạm ra ngoài để đóng menu. */}
          <div className="bulk-cart-menu-shade" onClick={() => onToggle(false)} />
          <div className="bulk-cart-menu-list" role="menu">
            <button type="button" role="menuitem" className="bulk-cart-menu-danger" onClick={onXoaHet}>
              <Icon name="xoa" size={18} />Xoá hết giỏ…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CartLineList({
  lines,
  editingNote,
  onUpdateQty,
  onGiam,
  onSetNote,
  onStartEditNote,
  onStopEditNote,
}: {
  lines: CartLine[];
  editingNote: string | null;
  onUpdateQty: (id: string, delta: number) => void;
  /** Bớt 1; về 0 thì hỏi "Bỏ món này?" — thay nút "🗑 Xoá" từng món (2026-11-09). */
  onGiam: (id: string) => void;
  onSetNote: (id: string, note: string) => void;
  onStartEditNote: (id: string) => void;
  onStopEditNote: () => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="bulk-cart-empty">
        Tap món bên trái để thêm vào giỏ.
        <br />
        Tap lại để tăng số lượng.
      </div>
    );
  }
  return (
    <>
      {lines.map((line) => (
        <div key={line.menu_item.id} className="bulk-cart-line">
          {/* HAI CỘT (chủ quán 2026-11-09): trái = tên + ghi chú, phải = giá + bộ − số + NGAY DƯỚI
              giá — số phần và tiền của nó đọc cùng một chỗ, liếc dọc cột phải là soát được cả giỏ. */}
          <div className="col-trai">
            <div className="name">{line.menu_item.name}</div>
            <div className="bulk-cart-note">
              {editingNote === line.menu_item.id ? (
                <input
                  value={line.note}
                  onChange={(e) => onSetNote(line.menu_item.id, e.target.value)}
                  onBlur={onStopEditNote}
                  autoFocus
                  placeholder="vd: ít cay, không hành..."
                />
              ) : line.note ? (
                <span
                  className="bulk-cart-note-existing"
                  onClick={() => onStartEditNote(line.menu_item.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <Icon name="ghi-chu" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{line.note}
                </span>
              ) : (
                <button
                  className="bulk-cart-note-btn"
                  onClick={() => onStartEditNote(line.menu_item.id)}
                >
                  + Ghi chú
                </button>
              )}
            </div>
          </div>
          <div className="col-phai">
            <div className="price">{fmt(line.menu_item.price * line.qty)}</div>
            <QtyStepper
              value={line.qty}
              tenMon={line.menu_item.name}
              onGiam={() => onGiam(line.menu_item.id)}
              onTang={() => onUpdateQty(line.menu_item.id, +1)}
            />
          </div>
        </div>
      ))}
    </>
  );
}
