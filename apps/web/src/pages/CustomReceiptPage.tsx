// Màn "Hoá đơn tự do" (M6.D-05) — soạn một tờ hoá đơn rồi in, KHÔNG tạo đơn nào trong hệ thống.
//
// Ranh giới của màn này, và là lý do nó đứng riêng chứ không nằm trong màn Gọi món: ở đây không
// có bàn, không có bếp, không có kho, không có doanh thu. Người dùng gõ ra một tờ giấy và bấm in.
// Làm nó trông giống màn order là cái bẫy — sớm muộn sẽ có người tưởng mình vừa bán được hàng.
import { useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { CustomReceiptsLog } from './CustomReceiptsLog.tsx';
import { BulkOrderModal } from '../components/BulkOrderModal.tsx';
import { blankLine, receiptTotals, toCreatePayload, type DraftLine } from '../lib/custom-receipt.ts';

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

const card: React.CSSProperties = {
  background: C.cardBg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, color: C.muted, marginBottom: 4 };
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontSize: 15,
  boxSizing: 'border-box',
};

/** Ô nhập tiền: rỗng là 0, và PHẢI để rỗng được.
 *
 *  Một ô tiền giữ sẵn số 0 thì gõ "15000" vào sẽ ra "015000", hoặc phải xoá số 0 trước — chuyện
 *  nhỏ nhưng lặp lại mỗi lần dùng. Nên state giữ chuỗi, chỉ quy ra số khi tính tiền. */
function moneyValue(raw: string): number {
  const n = Number(raw.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Nút −/+ số phần. Vuông, cỡ ngón tay (36px) như hàng thao tác của thẻ món ở màn order, nhưng
 *  KHÔNG kéo dãn: hai cái nút này là thao tác nhỏ, trải ngang cả thẻ thì chúng át tên món. */
const QTY_BTN: React.CSSProperties = {
  padding: '6px 4px',
  fontSize: 15,
  minHeight: 36,
  width: 44,
  minWidth: 44,
};

/** Thành tiền của một dòng. */
function lineAmount(l: DraftLine): number {
  return l.unit_price * l.qty;
}

/**
 * MỘT dòng trên hoá đơn, dựng theo đúng dáng thẻ món của màn Gọi món (`.item-card` trong
 * `OrderDrawer`): viền trái dày, "2 × Bún bò" đậm bên trái, tiền bên phải, ghi chú xám phía dưới.
 *
 * Vì sao không để nguyên ba ô nhập như bản đầu: một tờ hoá đơn 8 món thành 24 ô nhập xếp chồng,
 * không liếc ra được món nào giá bao nhiêu — mà liếc-để-soát mới là việc người ta làm với màn
 * này. Ô nhập chỉ mở khi thực sự cần sửa.
 *
 * Hàng [− n +] luôn hiện: sửa số phần là việc làm nhiều nhất, giấu nó sau một nút nữa là thêm
 * một nhịp cho thao tác lặp lại suốt buổi — cùng lý do màn order để "Đã giao" nằm ngoài.
 */
function ReceiptLineCard({
  line,
  editing,
  onToggleEdit,
  onPatch,
  onRemove,
}: {
  line: DraftLine;
  editing: boolean;
  onToggleEdit: () => void;
  onPatch: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const unnamed = line.name.trim().length === 0;
  return (
    <div
      className="item-card"
      style={{
        background: 'white',
        border: `1px solid ${C.accent}33`,
        borderLeft: `4px solid ${C.accent}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 6,
      }}
    >
      <div className="flex between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: unnamed ? C.muted : undefined }}>
            {line.qty} × {unnamed ? 'Chưa đặt tên — bấm ⋯ để gõ' : line.name}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{fmt(line.unit_price)} / phần</div>
          {line.note && (
            <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>📝 {line.note}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <button
            type="button"
            className="item-more"
            onClick={onToggleEdit}
            aria-expanded={editing}
            aria-label={editing ? 'Đóng phần sửa' : 'Sửa tên, giá, ghi chú'}
            title={editing ? 'Đóng phần sửa' : 'Sửa tên, giá, ghi chú'}
          >
            ⋯
          </button>
          <div style={{ fontWeight: 600 }}>{fmt(lineAmount(line))}</div>
        </div>
      </div>

      {/* Hàng luôn hiện: CHỈ số phần. Xoá dòng nằm sau nút ⋯ — cùng lệ với màn order, nơi
          "Huỷ" không bao giờ nằm sẵn dưới ngón tay. Một nút đỏ trải ngang mỗi thẻ vừa chói vừa
          dễ bấm nhầm khi đang vuốt danh sách. */}
      <div className="flex" style={{ marginTop: 8, gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          className="secondary"
          style={QTY_BTN}
          aria-label="Bớt một phần"
          disabled={line.qty <= 1}
          onClick={() => onPatch({ qty: Math.max(1, line.qty - 1) })}
        >
          −
        </button>
        <span style={{ minWidth: 30, textAlign: 'center', fontWeight: 700 }}>{line.qty}</span>
        <button
          type="button"
          className="secondary"
          style={QTY_BTN}
          aria-label="Thêm một phần"
          disabled={line.qty >= 99}
          onClick={() => onPatch({ qty: Math.min(99, line.qty + 1) })}
        >
          +
        </button>
        <span style={{ color: C.muted, fontSize: 12, marginLeft: 2 }}>phần</span>
      </div>

      {editing && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          <div>
            <label style={label}>Tên món</label>
            <input
              style={input}
              value={line.name}
              maxLength={120}
              placeholder="Tên hiện trên hoá đơn"
              autoFocus
              onChange={(e) => onPatch({ name: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>Đơn giá</label>
            <input
              style={input}
              inputMode="numeric"
              value={line.unit_price === 0 ? '' : String(line.unit_price)}
              placeholder="0"
              onChange={(e) => onPatch({ unit_price: moneyValue(e.target.value) })}
            />
          </div>
          <div>
            <label style={label}>Ghi chú</label>
            <input
              style={input}
              value={line.note}
              maxLength={255}
              placeholder="In thụt vào dưới tên món, không có tiền"
              onChange={(e) => onPatch({ note: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="danger"
            style={{ padding: '8px 12px', fontSize: 13, justifySelf: 'start' }}
            onClick={onRemove}
            title={`Bỏ ${line.name || 'dòng này'} khỏi hoá đơn`}
          >
            ✕ Bỏ dòng này
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomReceiptPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Nhật ký chỉ admin đọc được (API có `AdminGuard`), nên nút mở nó cũng chỉ hiện với admin —
  // bày ra cho người khác chỉ để họ bấm rồi ăn 403.
  const canSeeLog = user?.role === 'admin' || user?.is_owner === true;
  const [showLog, setShowLog] = useState(false);
  const [headerNote, setHeaderNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [shipFeeRaw, setShipFeeRaw] = useState('');
  const [transferRaw, setTransferRaw] = useState('');
  const [picking, setPicking] = useState(false);
  /** Dòng đang mở phần sửa tên/giá. Một dòng tại một thời điểm, như nút ⋯ của thẻ món ở màn
   *  order: mở hết mọi dòng thì danh sách lại thành một rừng ô nhập, đúng thứ vừa bỏ đi. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const shipFee = moneyValue(shipFeeRaw);
  const transferAmount = moneyValue(transferRaw);
  const totals = receiptTotals(lines, shipFee);

  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    // Mảng mới + object mới thay vì sửa tại chỗ: state cũ phải giữ nguyên để React thấy có đổi.
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const print = async () => {
    const payload = toCreatePayload({ headerNote, lines, shipFee, transferAmount });
    if (payload.items.length === 0) {
      toast.push('error', 'Chưa có món nào để in.');
      return;
    }
    setPrinting(true);
    try {
      const res = await api.post<{ data: { code: string; queued: boolean } }>(
        '/custom-receipts',
        payload,
      );
      const { code, queued } = res.data.data;
      if (queued) {
        toast.push('success', `Đang in hoá đơn #${code}`);
      } else {
        // Bản ghi ĐÃ lưu — nói rõ để người ta biết không phải gõ lại, chỉ cần bật công tắc rồi
        // vào Cài đặt → Máy in bấm In lại.
        toast.push('error', `Chưa bật in hoá đơn — tờ #${code} đã lưu, bật xong vào Máy in để in lại`);
      }
      // Xoá trắng để làm tờ tiếp theo (chủ quán chốt 2026-09-30).
      setHeaderNote('');
      setLines([]);
      setEditingKey(null);
      setShipFeeRaw('');
      setTransferRaw('');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="container wide with-bottom-nav">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
          margin: '12px 0 4px',
        }}
      >
        <h1 style={{ margin: 0 }}>🧾 Hoá đơn tự do</h1>
        {canSeeLog && (
          <button
            type="button"
            className="secondary"
            style={{ padding: '8px 14px', fontSize: 13, flex: '0 0 auto' }}
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? '← Soạn hoá đơn' : '🕘 Đã in'}
          </button>
        )}
      </div>
      <p style={{ color: C.muted, margin: '0 0 16px', fontSize: 14 }}>
        In ra một tờ hoá đơn giống hệt hoá đơn thật. Tờ này <strong>không tính vào doanh thu</strong>,
        không trừ kho và không tạo đơn nào.
      </p>

      {/* Nhật ký ngay tại đây, không phải chỉ ở Cài đặt → Máy in: người vừa in xong và thấy giấy
          kẹt cần tìm lại tờ đó NGAY, không đi qua ba màn. Cùng một component, hai lối vào. */}
      {showLog && canSeeLog && <CustomReceiptsLog />}

      {!showLog && (
        <>
      <div style={card}>
        <label style={label} htmlFor="header-note">
          Ghi chú đầu tờ
        </label>
        <input
          id="header-note"
          style={input}
          value={headerNote}
          maxLength={64}
          placeholder="Bàn 5, Mang về, tên khách… — bỏ trống cũng được"
          onChange={(e) => setHeaderNote(e.target.value)}
        />
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Các món trên hoá đơn</h3>

        {lines.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14, margin: '0 0 12px' }}>
            Chưa có dòng nào. Bấm <strong>Chọn món từ menu</strong> để chọn nhiều món một lượt,
            hoặc{' '}
            <strong>Dòng tự gõ</strong> cho món không có trong menu.
          </p>
        )}

        {lines.map((l) => (
          <ReceiptLineCard
            key={l.key}
            line={l}
            editing={editingKey === l.key}
            onToggleEdit={() => setEditingKey((k) => (k === l.key ? null : l.key))}
            onPatch={(patch) => patchLine(l.key, patch)}
            onRemove={() => removeLine(l.key)}
          />
        ))}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setPicking(true)} style={{ padding: '9px 18px' }}>
            + Chọn món từ menu
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setLines((ls) => [...ls, blankLine()])}
            style={{ padding: '9px 18px' }}
          >
            + Dòng tự gõ
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={label} htmlFor="ship-fee">
              Phí giao hàng
            </label>
            <input
              id="ship-fee"
              style={input}
              inputMode="numeric"
              value={shipFeeRaw}
              placeholder="0"
              onChange={(e) => setShipFeeRaw(e.target.value)}
            />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={label} htmlFor="transfer">
              Khách chuyển khoản
            </label>
            <input
              id="transfer"
              style={input}
              inputMode="numeric"
              value={transferRaw}
              placeholder="0 — để trống là tiền mặt"
              onChange={(e) => setTransferRaw(e.target.value)}
            />
          </div>
        </div>

        {shipFee > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ color: C.muted }}>Tiền món</span>
            <span>{fmt(totals.items_total)}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${C.borderSoft}`,
            fontSize: 18,
          }}
        >
          <strong>TỔNG CỘNG</strong>
          <strong>{fmt(totals.total)}</strong>
        </div>

        <button
          type="button"
          onClick={print}
          disabled={printing || lines.length === 0}
          style={{ marginTop: 14, padding: '12px 20px', width: '100%', fontSize: 16 }}
        >
          {printing ? 'Đang gửi…' : '🖨 In hoá đơn'}
        </button>
      </div>

        </>
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
