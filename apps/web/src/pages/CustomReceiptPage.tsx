// Màn "Hoá đơn tự do" (M6.D-05) — soạn một tờ hoá đơn rồi in, KHÔNG tạo đơn nào trong hệ thống.
//
// Ranh giới của màn này, và là lý do nó đứng riêng chứ không nằm trong màn Gọi món: ở đây không
// có bàn, không có bếp, không có kho, không có doanh thu. Người dùng gõ ra một tờ giấy và bấm in.
// Làm nó trông giống màn order là cái bẫy — sớm muộn sẽ có người tưởng mình vừa bán được hàng.
//
// Làm lại giao diện 2026-11-10 (chủ quán, đủ 11 điểm): MỘT lớp nền trắng, món là hàng ~56px kẻ
// mảnh 1px (bỏ thẻ viền + vạch xanh), 4 cỡ chữ 22/16/14/12, chỉ tên món + tổng tiền in đậm,
// thanh dính đáy [Tổng · In phiếu] nằm sát trên nav, bấm In → XEM TRƯỚC đúng tấm ảnh máy in sẽ
// in, in xong KHÔNG xoá form mà hiện "Đã in #MÃ · In lại · Soạn phiếu mới". Kiểu dáng ở `.crp-*`
// trong styles.css (cần media query — style nội tuyến không viết được).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { QtyStepper } from '../components/ui/QtyStepper.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import type { ReceiptCopy } from './CustomReceiptHistoryPage.tsx';
import { BulkOrderModal } from '../components/BulkOrderModal.tsx';
import { blankLine, receiptTotals, toCreatePayload, type DraftLine } from '../lib/custom-receipt.ts';

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

/** Ô nhập tiền: rỗng là 0, và PHẢI để rỗng được.
 *
 *  Một ô tiền giữ sẵn số 0 thì gõ "15000" vào sẽ ra "015000", hoặc phải xoá số 0 trước — chuyện
 *  nhỏ nhưng lặp lại mỗi lần dùng. Nên state giữ chuỗi, chỉ quy ra số khi tính tiền. */
function moneyValue(raw: string): number {
  const n = Number(raw.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Ngưỡng vuốt — cùng số với thẻ món ở tấm bàn (OrderDrawer): dưới 40px là chạm run tay, dọc
 *  nhiều hơn ngang là đang CUỘN danh sách chứ không vuốt một dòng. */
const SWIPE_MIN_PX = 40;

/**
 * MỘT dòng trên hoá đơn — một HÀNG ~56px (chủ quán 2026-11-10; bản thẻ 3 hàng ~95px chỉ thấy
 * được 3 món trên điện thoại): [tên đậm / đơn giá nhỏ] [− n +] [thành tiền].
 *
 * Không còn nút ⋯: chạm TÊN mở tấm sửa tên/giá/ghi chú (máy tính không vuốt được, nên đây là lối
 * chính), VUỐT TRÁI hiện ô [Ghi chú][Xoá] như thẻ món ở tấm bàn. Xoá màu xám đậm, không đỏ: đỏ
 * chỉ dành cho lỗi — và xoá một dòng giấy chưa in thì gõ lại được, không phải việc nguy hiểm.
 */
function ReceiptRow({
  line,
  revealed,
  onReveal,
  onEdit,
  onPatch,
  onRemove,
}: {
  line: DraftLine;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  onEdit: () => void;
  onPatch: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const unnamed = line.name.trim().length === 0;
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  return (
    <li
      className="crp-row"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchRef.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
        // Vuốt TRÁI mở, vuốt PHẢI cất — đúng chiều ô trượt ra từ mép phải.
        onReveal(dx < 0);
      }}
    >
      <button type="button" className="crp-row__name" onClick={onEdit} aria-label={`Sửa ${line.name || 'dòng chưa đặt tên'}`}>
        <span className={unnamed ? 'crp-row__title crp-row__title--trong' : 'crp-row__title'}>
          {unnamed ? 'Chưa đặt tên — chạm để gõ' : line.name}
        </span>
        <span className="crp-row__sub">
          {fmt(line.unit_price)}
          {line.note ? ` · ${line.note}` : ''}
        </span>
      </button>
      <QtyStepper
        value={line.qty}
        tenMon={line.name || 'dòng này'}
        // Về 0 = bỏ dòng: cùng luật với giỏ màn Gọi món, khỏi phải tìm nút xoá riêng.
        onGiam={() => (line.qty <= 1 ? onRemove() : onPatch({ qty: line.qty - 1 }))}
        onTang={() => onPatch({ qty: Math.min(99, line.qty + 1) })}
      />
      <span className="crp-row__amount">{fmt(line.unit_price * line.qty)}</span>
      {revealed && (
        <span className="item-swipe" role="group" aria-label={`Thao tác ${line.name || 'dòng này'}`}>
          <button type="button" style={{ background: 'var(--brand)' }} onClick={() => { onReveal(false); onEdit(); }}>
            <Icon name="ghi-chu" size={22} />
            Ghi chú
          </button>
          <button type="button" style={{ background: 'var(--gray-700)' }} onClick={() => { onReveal(false); onRemove(); }}>
            <Icon name="xoa" size={22} />
            Xoá
          </button>
        </span>
      )}
    </li>
  );
}

/** Tấm sửa MỘT dòng: tên, đơn giá, ghi chú. Sửa thẳng vào state (không có nút Lưu) — đóng tấm
 *  là xong, giống ô nhập ngay trên thẻ của bản cũ. */
function EditLineSheet({
  line,
  onPatch,
  onClose,
}: {
  line: DraftLine;
  onPatch: (patch: Partial<DraftLine>) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={line.name.trim() ? `Sửa ${line.name}` : 'Dòng tự gõ'}
      giuaKhiRong
      onClose={onClose}
      footer={
        <div className="crp-sheet-foot">
          <button type="button" className="crp-btn crp-btn--chinh" onClick={onClose}>
            Xong
          </button>
        </div>
      }
    >
      <div className="crp-sheet-body">
        <label className="crp-field">
          <span className="crp-label">Tên món</span>
          <input
            className="crp-input"
            value={line.name}
            maxLength={120}
            placeholder="Tên hiện trên hoá đơn"
            autoFocus={!line.name}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        <label className="crp-field">
          <span className="crp-label">Đơn giá</span>
          <input
            className="crp-input"
            inputMode="numeric"
            value={line.unit_price === 0 ? '' : String(line.unit_price)}
            placeholder="0"
            onChange={(e) => onPatch({ unit_price: moneyValue(e.target.value) })}
          />
        </label>
        <label className="crp-field">
          <span className="crp-label">Ghi chú</span>
          <input
            className="crp-input"
            value={line.note}
            maxLength={255}
            placeholder="In thụt vào dưới tên món, không có tiền"
            autoFocus={!!line.name}
            onChange={(e) => onPatch({ note: e.target.value })}
          />
        </label>
      </div>
    </Sheet>
  );
}

/** Tờ vừa in: id để In lại đúng tờ đó, `sig` để biết form đã bị sửa sau khi in hay chưa. */
type Printed = { id: string; code: string; queued: boolean; sig: string };

/** Phiếu giống hệt vừa in (≤ 1 phút, máy chủ phát hiện) — hỏi "In thêm bản sao?". */
type DuplicateOf = { id: string; code: string; created_at: number };

/** Dữ liệu ban đầu: trống, hoặc chép từ một phiếu cũ ("Tạo phiếu mới" ở màn Phiếu đã in). */
function initialFrom(copy: ReceiptCopy | undefined) {
  if (!copy) return { headerNote: '', lines: [] as DraftLine[], ship: '', transfer: '' };
  return {
    headerNote: copy.header_note,
    lines: copy.items.map((it) => ({ ...blankLine(), name: it.name, qty: it.qty, unit_price: it.unit_price, note: it.note ?? '' })),
    ship: copy.ship_fee ? String(copy.ship_fee) : '',
    transfer: copy.transfer_amount ? String(copy.transfer_amount) : '',
  };
}

export function CustomReceiptPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Nhật ký chỉ admin đọc được (API có `AdminGuard`), nên icon mở nó cũng chỉ hiện với admin —
  // bày ra cho người khác chỉ để họ bấm rồi ăn 403 (chủ quán giữ nguyên quyền 2026-11-10).
  const canSeeLog = user?.role === 'admin' || user?.is_owner === true;
  const navigate = useNavigate();
  const loc = useLocation();
  // Chỉ đọc MỘT lần lúc mở màn: tải lại trang thì state của history vẫn còn, nhưng đó đúng là thứ
  // người dùng muốn (đang sửa bản chép dở thì không mất).
  const [init] = useState(() => initialFrom((loc.state as { copyFrom?: ReceiptCopy } | null)?.copyFrom));
  const [showWhy, setShowWhy] = useState(false);
  const [headerNote, setHeaderNote] = useState(init.headerNote);
  const [lines, setLines] = useState<DraftLine[]>(init.lines);
  const [shipFeeRaw, setShipFeeRaw] = useState(init.ship);
  const [transferRaw, setTransferRaw] = useState(init.transfer);
  const [dupOf, setDupOf] = useState<DuplicateOf | null>(null);
  /** Khoá NGAY lần bấm đầu (ref chứ không chỉ state: hai cú chạm sát nhau cùng thấy
   *  `printing === false` vì state chưa kịp vẽ lại) — chống tạo 2 mã cho 1 tờ. */
  const printLock = useRef(false);
  const [picking, setPicking] = useState(false);
  /** Dòng đang mở tấm sửa / đang lộ ô vuốt. Một dòng tại một thời điểm. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  /** Ảnh xem trước (data URL) — có giá trị = tấm xem trước đang mở. */
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [printed, setPrinted] = useState<Printed | null>(null);

  const shipFee = moneyValue(shipFeeRaw);
  const transferAmount = moneyValue(transferRaw);
  const totals = receiptTotals(lines, shipFee);
  const payload = useMemo(
    () => toCreatePayload({ headerNote, lines, shipFee, transferAmount }),
    [headerNote, lines, shipFee, transferAmount],
  );
  const sig = useMemo(() => JSON.stringify(payload), [payload]);
  /** Đã in VÀ chưa sửa gì sau đó. Sửa một chữ là thanh đáy quay về "In phiếu" — in tiếp sẽ ra
   *  tờ MỚI (mã mới); "In lại" chỉ dành cho đúng tờ đã in (chủ quán chốt 2026-11-10). */
  const daIn = printed !== null && printed.sig === sig;

  /* Thanh dính đáy phải nằm SÁT TRÊN nav dưới — nav cao khác nhau theo bề rộng màn và vùng an
     toàn iPhone, nên đo chứ không ghi cứng. */
  const [navH, setNavH] = useState(0);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.nav-bottom');
    if (!nav) return;
    const ro = new ResizeObserver(() => setNavH(nav.offsetHeight));
    ro.observe(nav);
    setNavH(nav.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    // Mảng mới + object mới thay vì sửa tại chỗ: state cũ phải giữ nguyên để React thấy có đổi.
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const addTyped = () => {
    const l = blankLine();
    setLines((ls) => [...ls, l]);
    // Dòng tự gõ chưa có tên lẫn giá — mở ngay tấm sửa, khỏi bắt người ta tìm rồi chạm thêm lần nữa.
    setEditingKey(l.key);
  };

  const openPreview = async () => {
    if (payload.items.length === 0) {
      toast.push('error', 'Chưa có món nào có tên để in.');
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await api.post<{ data: { image: string } }>('/custom-receipts/preview', payload);
      setPreview(res.data.data.image);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const print = async (allowDuplicate = false) => {
    if (printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    try {
      const res = await api.post<{
        data: { id: string; code: string; queued: boolean } | { duplicate_of: DuplicateOf };
      }>('/custom-receipts', { ...payload, allow_duplicate: allowDuplicate || undefined });
      const d = res.data.data;
      if ('duplicate_of' in d) {
        // Máy chủ thấy phiếu giống hệt vừa in (≤ 1 phút) — KHÔNG tạo mã mới, hỏi người dùng.
        setPreview(null);
        setDupOf(d.duplicate_of);
        return;
      }
      const { id, code, queued } = d;
      setPrinted({ id, code, queued, sig });
      setPreview(null);
      setDupOf(null);
      if (queued) toast.push('success', `Đã gửi lệnh in #${code}`);
      else {
        // Bản ghi ĐÃ lưu — nói rõ để người ta biết không phải gõ lại, chỉ cần bật công tắc rồi
        // bấm In lại ngay trên thanh đáy.
        toast.push('error', `Chưa bật in hoá đơn — tờ #${code} đã lưu, bật xong bấm In lại`);
      }
      // KHÔNG xoá form ở đây nữa (đảo quyết định 2026-09-30, chủ quán 2026-11-10): xoá ngay sau
      // in thì giấy kẹt là phải gõ lại cả tờ. Form chỉ xoá khi bấm "Soạn phiếu mới".
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  };

  /** "In thêm bản sao" của phiếu trùng: in lại ĐÚNG mã cũ (giấy mang dấu BẢN IN LẠI), không tạo mã. */
  const printCopyOf = async (dup: DuplicateOf) => {
    if (printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/custom-receipts/${dup.id}/print`, {});
      setPrinted({ id: dup.id, code: dup.code, queued: res.data.data.queued, sig });
      setDupOf(null);
      if (res.data.data.queued) toast.push('success', `Đã gửi lệnh in bản sao #${dup.code}`);
      else toast.push('error', 'Chưa bật in hoá đơn — vào Cài đặt → Máy in để bật');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  };

  const reprint = async () => {
    if (!printed || reprinting) return;
    setReprinting(true);
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/custom-receipts/${printed.id}/print`, {});
      if (res.data.data.queued) toast.push('success', `Đã gửi lệnh in #${printed.code}`);
      else toast.push('error', 'Chưa bật in hoá đơn — vào Cài đặt → Máy in để bật');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setReprinting(false);
    }
  };

  const newReceipt = () => {
    setHeaderNote('');
    setLines([]);
    setEditingKey(null);
    setRevealedKey(null);
    setShipFeeRaw('');
    setTransferRaw('');
    setPrinted(null);
  };

  const editingLine = lines.find((l) => l.key === editingKey) ?? null;

  return (
    <div className="crp" style={{ paddingBottom: navH + 96 }}>
      {/* Tên màn + nút ← nằm ở HEADER CHUNG (AppNav, 2026-11-10). Ở đây chỉ còn hàng chip:
          "Không tính doanh thu" (bấm mới hiện giải thích) và — chỉ admin — "Phiếu đã in" (màn riêng
          /custom-receipt/history). */}
      <div className="crp-chip-row">
        <button type="button" className="crp-chip" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>
          <Icon name="thong-tin" size={16} />
          Không tính doanh thu
        </button>
        {canSeeLog && (
          <button type="button" className="crp-chip" onClick={() => navigate('/custom-receipt/history')}>
            <Icon name="lich-su" size={16} />
            Phiếu đã in
          </button>
        )}
      </div>

      {(
        <>
          {/* Câu giải thích 3 dòng cũ thành MỘT chip (ở hàng chip trên): đọc một lần là đủ. */}
          {showWhy && (
            <p className="crp-why">
              Tờ này in giống hệt hoá đơn thật nhưng không tính vào doanh thu, không trừ kho và
              không tạo đơn nào.
            </p>
          )}

          <section className="crp-group">
            <label className="crp-field">
              <span className="crp-label">Ghi chú đầu tờ</span>
              <input
                className="crp-input"
                value={headerNote}
                maxLength={64}
                placeholder="Bàn 5, Mang về, tên khách…"
                onChange={(e) => setHeaderNote(e.target.value)}
              />
            </label>
          </section>

          <section className="crp-group">
            {lines.length === 0 ? (
              <div className="crp-empty">
                <Icon name="hoa-don" size={32} />
                <span>Chưa có món nào</span>
              </div>
            ) : (
              <ul className="crp-list">
                {lines.map((l) => (
                  <ReceiptRow
                    key={l.key}
                    line={l}
                    revealed={revealedKey === l.key}
                    onReveal={(open) => setRevealedKey(open ? l.key : null)}
                    onEdit={() => setEditingKey(l.key)}
                    onPatch={(patch) => patchLine(l.key, patch)}
                    onRemove={() => removeLine(l.key)}
                  />
                ))}
              </ul>
            )}
            <div className="crp-add">
              <button type="button" className="crp-btn crp-btn--chinh" onClick={() => setPicking(true)}>
                <Icon name="them" size={20} />
                Thêm món
              </button>
              <button type="button" className="crp-btn crp-btn--vien" onClick={addTyped}>
                <Icon name="sua" size={20} />
                Tự gõ
              </button>
            </div>
          </section>

          <section className="crp-group crp-costs">
            <label className="crp-field">
              <span className="crp-label">Phí giao hàng</span>
              <input
                className="crp-input"
                inputMode="numeric"
                value={shipFeeRaw}
                placeholder="0"
                onChange={(e) => setShipFeeRaw(e.target.value)}
              />
            </label>
            <label className="crp-field">
              <span className="crp-label">Khách chuyển khoản</span>
              <input
                className="crp-input"
                inputMode="numeric"
                value={transferRaw}
                placeholder="Để trống là tiền mặt"
                onChange={(e) => setTransferRaw(e.target.value)}
              />
            </label>
          </section>
        </>
      )}

      {/* THANH DÍNH ĐÁY, sát trên nav (chủ quán 2026-11-10): tổng tiền là thứ nổi bật nhất màn,
          và nút In luôn trong tầm ngón cái — bản cũ để chúng cuối trang, 2 món là đã chui dưới nav. */}
      {(
        <div className="crp-bar" style={{ bottom: navH }}>
          <div className="crp-bar__in">
            {daIn ? (
              <>
                <div className="crp-bar__done">
                  <Icon name="xong" size={20} />
                  {printed.queued ? `Đã in #${printed.code}` : `Đã lưu #${printed.code}`}
                </div>
                <button type="button" className="crp-btn crp-btn--vien" onClick={reprint} disabled={reprinting}>
                  {reprinting ? 'Đang gửi…' : 'In lại'}
                </button>
                <button type="button" className="crp-btn crp-btn--chinh" onClick={newReceipt}>
                  Soạn phiếu mới
                </button>
              </>
            ) : (
              <>
                <div className="crp-bar__total">
                  <span className="crp-bar__label">Tổng</span>
                  <span className="crp-bar__amount">{fmt(totals.total)}</span>
                  {shipFee > 0 && <span className="crp-bar__label">gồm {fmt(shipFee)} phí giao</span>}
                </div>
                <button
                  type="button"
                  className="crp-btn crp-btn--chinh crp-btn--in"
                  onClick={openPreview}
                  disabled={loadingPreview || lines.length === 0}
                >
                  <Icon name="in" size={22} />
                  {loadingPreview ? 'Đang dựng…' : 'In phiếu'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {preview && (
        <Sheet
          title="Xem trước tờ phiếu"
          giuaKhiRong
          onClose={() => !printing && setPreview(null)}
          footer={
            <div className="crp-sheet-foot">
              <button type="button" className="crp-btn crp-btn--vien" onClick={() => setPreview(null)} disabled={printing}>
                Sửa lại
              </button>
              <button type="button" className="crp-btn crp-btn--chinh crp-btn--in" onClick={() => void print()} disabled={printing}>
                <Icon name="in" size={22} />
                {printing ? 'Đang gửi…' : 'In'}
              </button>
            </div>
          }
        >
          <div className="crp-paper-wrap">
            {/* Ảnh này là ĐÚNG tấm bitmap máy in sẽ in (máy chủ dựng bằng code in thật), chỉ
                khác mã phiếu: mã thật có sau khi bấm In. */}
            <img className="crp-paper" src={preview} alt="Tờ phiếu khổ 80mm sẽ in" />
            <span className="crp-label">Khổ 80mm · mã phiếu có sau khi in</span>
          </div>
        </Sheet>
      )}

      {dupOf && (
        <Sheet
          title="Phiếu này vừa in rồi"
          giuaKhiRong
          onClose={() => !printing && setDupOf(null)}
          footer={
            <div className="crp-sheet-foot crp-sheet-foot--doc">
              <button type="button" className="crp-btn crp-btn--chinh" onClick={() => void printCopyOf(dupOf)} disabled={printing}>
                <Icon name="in" size={20} />
                In thêm bản sao #{dupOf.code}
              </button>
              <button type="button" className="crp-btn crp-btn--vien" onClick={() => void print(true)} disabled={printing}>
                Vẫn tạo phiếu mới
              </button>
              <button type="button" className="crp-btn crp-btn--phang" onClick={() => setDupOf(null)} disabled={printing}>
                Huỷ
              </button>
            </div>
          }
        >
          <p className="crp-dup-text">
            Phiếu #{dupOf.code} giống hệt vừa in lúc{' '}
            {new Date(dupOf.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}. In thêm
            bản sao giữ nguyên mã (giấy ghi BẢN IN LẠI), không tạo phiếu thứ hai.
          </p>
        </Sheet>
      )}

      {editingLine && (
        <EditLineSheet
          line={editingLine}
          onPatch={(patch) => patchLine(editingLine.key, patch)}
          onClose={() => setEditingKey(null)}
        />
      )}

      {picking && (
        /* Đúng cái lưới chọn món của màn Gọi món, chạy ở chế độ gom giỏ — chọn nhiều món một
           lượt, tap tăng phần. `orderId` rỗng và `isNewTable` false: ở đây không có đơn nào để
           báo bếp, và cũng không gợi khăn lạnh vào một tờ giấy. */
        <BulkOrderModal
          orderId=""
          tableLabel="Hoá đơn tự do"
          tableKind="takeaway"
          isNewTable={false}
          onClose={() => setPicking(false)}
          onSubmitted={() => setPicking(false)}
          onCollect={(picked) => {
            // Giá menu là ĐIỂM BẮT ĐẦU, sửa lại ngay trên dòng vừa thêm — đó là cả lý do tính
            // năng này tồn tại thay vì bắt người ta mở một đơn thật rồi huỷ.
            setLines((ls) => [...ls, ...picked.map((p) => ({ ...blankLine(), ...p }))]);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
