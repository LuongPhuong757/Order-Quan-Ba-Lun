// Thanh dính đáy khi "Chọn nhiều" + thanh Hoàn tác 5 giây của màn Thực đơn.
//
// Vì sao có chọn nhiều (2026-11-11): tắt online cả chục món một lúc (vd mùa mưa không ship đồ
// nướng) trước đây là chục lần bấm lẻ ở tab "Món online". Một lệnh `POST /menu/bulk` thay cho chục
// cú PATCH và cho MỘT đường lùi Hoàn tác cho cả lô.
//
// Thanh Hoàn tác dùng lại `.oo-undo` / `.oo-undo-ring` của màn duyệt đơn (styles.css) để mọi thanh
// "vừa làm xong · Hoàn tác" trong app trông như một.

export type UndoState = { text: string; revert: () => void; deadlineMs: number };

export type BulkAction = 'an' | 'hien' | 'het' | 'con';

export function MenuBulkBar({
  count,
  busy,
  onAction,
  onClear,
  onExit,
}: {
  count: number;
  busy: boolean;
  onAction: (a: BulkAction) => void;
  onClear: () => void;
  onExit: () => void;
}) {
  const off = busy || count === 0;
  return (
    <div className="td-bulk" role="region" aria-label="Thao tác hàng loạt">
      <strong className="td-bulk__dem">{count === 0 ? 'Chưa chọn món nào' : `${count} món đã chọn`}</strong>
      <div className="td-bulk__nut">
        {/* Bản 3 (2026-11-11): thanh này THAY thanh công cụ đầu màn khi đã chọn ≥1 món. */}
        <button type="button" className="secondary" disabled={off} onClick={() => onAction('het')}>Báo hết</button>
        <button type="button" className="secondary" disabled={off} onClick={() => onAction('con')}>Còn hàng</button>
        <button type="button" className="secondary" disabled={off} onClick={() => onAction('an')}>Ẩn online</button>
        <button type="button" className="secondary" disabled={off} onClick={() => onAction('hien')}>Bán online lại</button>
        {count > 0 ? (
          <button type="button" className="secondary" disabled={busy} onClick={onClear}>Bỏ chọn</button>
        ) : (
          <button type="button" className="secondary" onClick={onExit}>Xong</button>
        )}
      </div>
    </div>
  );
}

export function MenuUndoBar({ undo, nowMs, raised, onUndo }: { undo: UndoState; nowMs: number; raised: boolean; onUndo: () => void }) {
  return (
    <div className={`oo-undo${raised ? ' td-undo--tren' : ''}`} role="status" aria-live="polite">
      <span className="oo-undo-ring" aria-hidden="true">
        {Math.max(1, Math.ceil((undo.deadlineMs - nowMs) / 1000))}
      </span>
      <span style={{ flex: 1, minWidth: 140 }}>{undo.text}</span>
      <button type="button" className="secondary" onClick={onUndo}>
        Hoàn tác
      </button>
    </div>
  );
}
