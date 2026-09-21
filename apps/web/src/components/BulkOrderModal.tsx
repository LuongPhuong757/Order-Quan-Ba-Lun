// Bulk order modal — shopping cart UX.
// Panel trái: grid menu (tap để thêm vào giỏ, tap lại tăng qty).
// Panel phải: giỏ hàng (− qty + xoá + note inline).
// Mobile <768px: stack vertical (menu trên, giỏ dưới).
// Submit 1 lần → BE create N items + auto báo bếp.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { filterMenuBySearch } from '../lib/menu-search.ts';
import { pickAutoItem } from '../lib/auto-items.ts';
import { useToast } from './Toast.tsx';

type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_out_of_stock: boolean;
};

type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort_order: number;
};

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
  groupLabel,
  onAdd,
  onNote,
}: {
  it: MenuItem;
  line: CartLine | undefined;
  groupLabel: string;
  onAdd: (item: MenuItem) => void;
  onNote: (id: string) => void;
}) {
  return (
    /* Thẻ món phải nằm trong một khung bọc: cả thẻ là MỘT cái nút (chạm đâu
       cũng +1 phần), mà nút ghi chú thì không lồng vào trong nút được — nó là
       nút thứ hai, đứng cạnh, chỉ neo lên góc thẻ bằng position. */
    <div className="bulk-menu-card-wrap">
      <button
        className={`bulk-menu-card ${it.is_out_of_stock ? 'out' : ''} ${line ? 'noted' : ''} ${line?.note ? 'has-note' : ''}`}
        onClick={() => onAdd(it)}
        disabled={it.is_out_of_stock}
      >
        {line && <span className="cart-badge">{line.qty}</span>}
        <div className="body">
          <div className="code">{it.code}</div>
          <div className="name">{it.name}</div>
          <div className="meta">{groupLabel} · {it.unit}</div>
        </div>
        <div className="price">
          {it.is_out_of_stock ? '🚫 HẾT' : fmt(it.price)}
        </div>
      </button>
      {/* Chỉ hiện khi món ĐÃ vào giỏ: ghi chú treo vào dòng giỏ, chưa chọn thì
          chưa có chỗ mà ghi. Có chữ rồi thì nút đổi màu để nhìn lướt là thấy
          món nào đã dặn gì. */}
      {line && (
        <button
          type="button"
          className={`bulk-note-btn ${line.note ? 'has' : ''}`}
          onClick={() => onNote(it.id)}
          title={line.note ? `Ghi chú: ${line.note}` : 'Thêm ghi chú'}
          aria-label={`Ghi chú cho ${it.name}`}
        >
          {line.note ? `📝 ${line.note}` : 'Ghi chú'}
        </button>
      )}
    </div>
  );
});

type Props = {
  orderId: string;
  tableLabel: string;
  /** `dine-in` | `takeaway` | `delivery` — quyết định có gợi khăn lạnh vào giỏ hay không. */
  tableKind: string;
  /** Bàn CHƯA gọi món nào. Chỉ bàn mới tinh mới được gợi sẵn khăn lạnh. */
  isNewTable: boolean;
  onClose: () => void;
  onSubmitted: () => void;
};

export function BulkOrderModal({
  orderId,
  tableLabel,
  tableKind,
  isNewTable,
  onClose,
  onSubmitted,
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
    () => filterMenuBySearch(menu.filter((it) => !group || it.group === group), search),
    [menu, group, search],
  );

  // 'Tất cả' + tất cả nhóm động (sort_order ASC, đã sort ở BE)
  const groupCodes = ['', ...groupList.map((g) => g.code)];

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

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

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
      toast.push('success', `📢 Đã báo bếp ${cartLines.length} món (${totalQty} phần) — ${fmt(total)}`);
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

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{`
        /* Điện thoại: hộp cao CỐ ĐỊNH (2026-09-19). Trước đây chỉ có max-height nên hộp co
           theo số món còn lại — lọc còn 2 món là header với thanh cam nhảy vào giữa màn, gõ
           thêm một chữ là chúng nhảy tiếp, tap trượt sang món khác.
           dvh chứ không phải vh: trên Safari iOS, vh tính theo màn hình lúc thanh địa chỉ đã
           thu lại, nên đáy hộp (thanh cam) bị thanh địa chỉ che. Dòng vh ngay trên giữ làm dự
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
          /* Mốc neo cho .bulk-mobile-bar (position: absolute). Thiếu dòng này thì thanh cam
             neo vào VIEWPORT — hộp thấp hơn màn là thanh cam rơi ra ngoài đáy hộp. */
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
          flex: 1;
          background: #f59e0b;
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
        /* Badge đếm số phần đang chọn — trắng trên nền cam để đọc được mà không cần nhìn kỹ. */
        .bulk-mobile-bar .submit .bar-count {
          background: white;
          color: #b45309;
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
        }
        /* Khung bọc thẻ món — chỗ neo cho nút ghi chú (thẻ là <button>, không lồng nút vào được). */
        .bulk-menu-card-wrap { position: relative; display: flex; flex-direction: column; }
        .bulk-menu-card-wrap > .bulk-menu-card { flex: 1 1 auto; min-width: 0; }
        /* Góc PHẢI DƯỚI thẻ, cùng cạnh phải với badge số lượng ở trên. Chữ thay cho icon để
           người lớn tuổi đọc được ngay là nút làm gì. */
        .bulk-note-btn {
          position: absolute;
          bottom: 6px;
          right: 6px;
          padding: 3px 8px;
          min-height: 24px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: white;
          color: #475569;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
          cursor: pointer;
          z-index: 2;
        }
        /* Có ghi chú thì CHÍNH nút này hiện nội dung — ấn vào là sửa, không đẻ thêm nút
           'Sửa'. Chữ ghi chú không in vào trong thân thẻ được: thân thẻ là nút +1 phần, ấn
           vào để sửa sẽ thành gọi thêm một phần.
           Lúc này nút BỎ neo góc, xuống hẳn một dòng riêng chiếm cả bề ngang dưới thẻ —
           đứng cạnh giá thì thẻ hẹp 140px chỉ còn ~48px, ghi chú nào cũng cụt thành '…'. */
        .bulk-note-btn.has {
          position: static;
          width: 100%;
          margin-top: 4px;
          border-color: #0f766e;
          background: #ccfbf1;
          color: #0f766e;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Nút nằm đè lên hàng giá — chừa chỗ để giá dài (100.000đ) không chui xuống dưới nút. */
        .bulk-menu-card.noted .price { padding-right: 62px; }
        /* Có ghi chú: nút đã tự giới hạn bề ngang nên giá không cần chừa chỗ nữa. */
        .bulk-menu-card.noted.has-note .price { padding-right: 0; }
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
        .bulk-menu-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px;
          cursor: pointer;
          text-align: left;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          transition: transform 0.08s, border-color 0.15s;
          color: #1f2937;
          font-weight: 400;
          position: relative;
          overflow: hidden;  /* safety — không cho con vượt khung card */
        }
        .bulk-menu-card > .body {
          flex: 1 1 auto;
          min-width: 0;
          min-height: 0;
          overflow: hidden;   /* clamp con bên trong */
          display: flex;
          flex-direction: column;
        }
        .bulk-menu-card:hover:not(:disabled) {
          border-color: #0f766e;
          transform: translateY(-1px);
        }
        .bulk-menu-card:active:not(:disabled) {
          transform: scale(0.98);
        }
        .bulk-menu-card.out {
          background: #fef2f2;
          border-color: #dc2626;
          color: #dc2626;
          cursor: not-allowed;
        }
        .bulk-menu-card .code {
          font-size: 10px;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bulk-menu-card .name {
          font-size: 14px;
          font-weight: 600;
          margin: 2px 0;
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
        .bulk-menu-card .meta {
          font-size: 11px;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bulk-menu-card .price {
          font-size: 14px;
          font-weight: 700;
          color: #0f766e;
          margin-top: 6px;
          /* Price luôn ở đáy card, không bị name dài đẩy ra ngoài khung */
          flex: 0 0 auto;
          align-self: stretch;
          white-space: nowrap;
        }
        .bulk-menu-card .cart-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          background: #0f766e;
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 999px;
          min-width: 22px;
          text-align: center;
        }
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
        }
        .bulk-cart-line .top {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: flex-start;
          margin-bottom: 6px;
        }
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
          padding-left: 8px;
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
          background: #f59e0b;
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
          <h1>
            Gọi món · <span style={{ color: '#0f766e' }}>{tableLabel}</span>
          </h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 12px' }}>
            ✕
          </button>
        </div>

        <div className="bulk-body">
          {/* PANEL TRÁI — MENU */}
          <div className="bulk-menu-panel">
            <div className="bulk-menu-toolbar">
              <div className="bulk-search-wrap">
                <input
                  ref={searchRef}
                  placeholder="🔍 Tên, mã hoặc viết tắt (vd: ktl = khoai tây lắc)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ minHeight: 40 }}
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
                    ✕
                  </button>
                )}
              </div>
              <div className="bulk-menu-tabs">
                {groupCodes.map((g) => (
                  <button
                    key={g || 'all'}
                    onClick={() => setGroup(g)}
                    className={group === g ? '' : 'secondary'}
                  >
                    {g === '' ? `Tất cả (${menu.length})` : labelOf(g)}
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
                  groupLabel={labelOf(it.group)}
                  onAdd={addToCart}
                  onNote={openNoteFor}
                />
              ))}
            </div>
          </div>

          {/* PANEL PHẢI — GIỎ HÀNG (desktop only, mobile dùng sticky bar + sheet) */}
          <div className="bulk-cart-panel">
            <div className="bulk-cart-header">
              <span>{cartLines.length} món · {totalQty} phần</span>
              {cartLines.length > 0 && (
                <button className="bulk-clear" onClick={() => setCart(new Map())}>
                  Xoá hết
                </button>
              )}
            </div>
            <div className="bulk-cart-body">
              <CartLineList
                lines={cartLines}
                editingNote={editingNote}
                onUpdateQty={updateQty}
                onRemove={removeFromCart}
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
                Báo bếp
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
          <button
            className="submit"
            onClick={() => setMobileCartOpen(true)}
            disabled={cartLines.length === 0}
          >
            {/* Badge đếm nằm TRONG nút, không phải một ô riêng cạnh nút: thanh dưới vẫn đúng
                MỘT nút (chỉ đạo chủ quán 2026-09-08), nhưng tap món là thấy số nhảy ngay —
                trước đây thêm xong không biết đã thêm bao nhiêu, phải mở giỏ ra mới biết.
                Đếm số PHẦN (totalQty) vì đó là con số tăng theo từng cái tap; số món/phần
                đầy đủ vẫn có ở tiêu đề giỏ. key={totalQty} để mỗi lần số đổi là badge nhảy
                một nhịp — chính cái nhịp đó nói "tap của bạn đã được nhận". */}
            {totalQty > 0 && (
              <span className="bar-count" key={totalQty}>
                {totalQty}
              </span>
            )}
            <span>Xem đơn và xác nhận lại</span>
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
                  <span className="bulk-sheet-table">{tableLabel}</span> · {cartLines.length} món · {totalQty} phần
                </h2>
                <div className="flex" style={{ gap: 8 }}>
                  {cartLines.length > 0 && (
                    <button className="bulk-clear" onClick={() => setCart(new Map())}>
                      Xoá hết
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={() => setMobileCartOpen(false)}
                    style={{ padding: '6px 10px' }}
                  >
                    ✕
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
                onRemove={removeFromCart}
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
                  Báo bếp
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
            <h3>📝 {noteLine.menu_item.name}</h3>
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
function CartLineList({
  lines,
  editingNote,
  onUpdateQty,
  onRemove,
  onSetNote,
  onStartEditNote,
  onStopEditNote,
}: {
  lines: CartLine[];
  editingNote: string | null;
  onUpdateQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
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
          <div className="top">
            <div className="name">{line.menu_item.name}</div>
            <div className="price">{fmt(line.menu_item.price * line.qty)}</div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="qty-stepper">
              <button onClick={() => onUpdateQty(line.menu_item.id, -1)}>−</button>
              <span className="qty">{line.qty}</span>
              <button onClick={() => onUpdateQty(line.menu_item.id, +1)}>+</button>
            </div>
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
                  📝 {line.note}
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
            <button
              className="bulk-clear"
              onClick={() => onRemove(line.menu_item.id)}
              title="Xoá khỏi giỏ"
            >
              🗑 Xoá
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
