import { useCallback, useEffect, useState } from 'react';
import {
  type TableCartLine,
  type TableSession,
  clearTableCart,
  newClientRequestId,
  readTableCart,
  setTableNote,
  setTableQty,
  subscribeTableCart,
  tableCartTotal,
  writeTableSession,
} from '../lib/table-cart-store.ts';

/**
 * M7 — toàn bộ giao diện gọi món tại bàn, dựng bằng LỚP PHỦ chứ không phải route.
 *
 * ⚠ Ràng buộc cứng: `MenuBookPage` được phục vụ ở HAI nơi — `/thuc-don` (có BrowserRouter) và
 * toàn bộ `menu.<domain>` (`main.tsx` CỐ Ý không dựng router). Dùng `useNavigate`/`<Link>`/route
 * mới thì luồng gọi món chỉ chạy được ở một trong hai địa chỉ mà QR có thể trỏ tới — và QR in
 * ra giấy rồi thì không sửa lại được.
 *
 * Mọi hộp dùng `dvh` chứ không `vh`: `vh` tính theo khung nhìn LỚN nên trên iPhone phần đỉnh
 * hộp trôi khỏi màn hình, nhìn ra tưởng hỏng sticky.
 */

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `same-origin` để trình duyệt gửi header Origin — thiếu nó là CsrfOriginGuard trả 403 và
    // triệu chứng trông y hệt lỗi code.
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || !json.ok) throw Object.assign(new Error(json.error?.message ?? 'Lỗi'), { code: json.error?.code });
  return json.data as T;
}

/* ── Hộp gõ số bàn ────────────────────────────────────────────────────────────────────── */

export function TableEntrySheet({
  onDone,
  onClose,
  /** `false` = CỔNG BẮT BUỘC: không có nút đóng, bấm ra ngoài không tắt. Dùng khi khách vừa
   *  mở thực đơn — chủ quán chốt 2026-10-01: phải khai bàn rồi mới thao tác tiếp được. */
  dismissible = true,
}: {
  onDone: (s: TableSession) => void;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  // M7.D-05 — bàn đang có người ăn thì phải nhập mã. Chuyển bước chứ không hiện cùng lúc:
  // người đầu tiên (đa số) không bao giờ phải nhìn thấy ô mã.
  const [needCode, setNeedCode] = useState<string | null>(null);
  /* M7.D-18 — lối vào CHỦ ĐỘNG cho người đã cầm sẵn mã bàn.
   *
   * Bản đầu chỉ có đúng một ô "Số bàn", và ô mã chỉ xuất hiện SAU khi server trả `NEED_CODE`.
   * Người đã được bạn cùng bàn đọc cho 4 số thì nhìn màn này không thấy chỗ nào nhập mã, nên
   * gõ thẳng mã vào ô số bàn — rồi nhận "Không thấy bàn 8386" và đứng lại ở đó. Đã xảy ra
   * thật khi chạy thử 2026-10-01.
   *
   * Spec D-18 nói rõ màn đầu phải kèm một dòng nhỏ "Đã có mã bàn? Nhập mã ở đây"; dòng đó bị
   * bỏ sót lúc dựng. `manualCode` chính là nó. */
  const [manualCode, setManualCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const prev = (() => { try { return localStorage.getItem('qbl.table_session.v1'); } catch { return null; } })();
      const token = prev ? (JSON.parse(prev) as TableSession).guest_token : undefined;
      const data = await postJson<
        | { state: 'OPENED'; guest_token: string; table_name: string; guest_code: string | null }
        | { state: 'NEED_CODE'; table_name: string }
      >('/api/public/table/open', {
        table_input: input,
        ...(code ? { code } : {}),
        ...(token ? { guest_token: token } : {}),
      });

      if (data.state === 'NEED_CODE') {
        setNeedCode(data.table_name);
        setBusy(false);
        return;
      }
      const session: TableSession = {
        guest_token: data.guest_token,
        table_name: data.table_name,
        savedAt: Date.now(),
      };
      writeTableSession(session);
      onDone(session);
    } catch (e) {
      const failed = e as Error & { code?: string };
      // Gõ đúng 4 chữ số mà không ra bàn nào thì gần như chắc chắn đó là MÃ BÀN bị gõ nhầm ô.
      // Tự dọn giúp: chuyển sang dạng có ô mã, bê nguyên con số vừa gõ sang đúng ô của nó, và
      // chỉ còn hỏi số bàn. Thà đoán ở đây còn hơn để khách đứng trước một câu từ chối cụt.
      if (failed.code === 'TABLE_NOT_FOUND' && /^\d{4}$/.test(input.trim())) {
        setCode(input.trim());
        setInput('');
        setManualCode(true);
        setErr('Số bạn vừa gõ trông giống MÃ BÀN 4 SỐ. Mình đã chuyển nó xuống ô mã — bạn gõ thêm SỐ BÀN đang ngồi nhé.');
      } else {
        setErr(failed.message);
      }
      setBusy(false);
    }
  }, [input, code, onDone]);

  return (
    <div className="dinein-scrim" onClick={dismissible ? onClose : undefined}>
      <div className="dinein-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dinein-head">
          <b>
            {needCode
              ? `${needCode} đã gọi đồ rồi`
              : manualCode
                ? 'Bàn bạn đã gọi đồ rồi'
                : 'Bạn ngồi bàn số mấy?'}
          </b>
          {dismissible ? (
            <button type="button" onClick={onClose} aria-label="Đóng">✕</button>
          ) : null}
        </div>

        <div className="dinein-body">
          {needCode ? (
            <>
              <p className="dinein-hint dinein-hint--lead">
                Bàn này đã có người gọi đồ. Để gọi thêm, bạn <b>nhập mã bàn 4 số</b> vào ô dưới đây.
              </p>
              <ul className="dinein-steps">
                <li>Mã đang hiện trên điện thoại của người đã gọi món ở bàn bạn.</li>
                <li>
                  <b>Không nhớ mã?</b> Bạn hỏi nhân viên nhé — nhân viên xem được mã của bàn và
                  đọc lại cho bạn.
                </li>
              </ul>
              <input
                className="dinein-code"
                inputMode="numeric"
                maxLength={4}
                placeholder="● ● ● ●"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                autoFocus
              />
            </>
          ) : manualCode ? (
            <>
              <p className="dinein-hint dinein-hint--lead">
                Điền <b>cả hai</b>: số bàn bạn đang ngồi và mã bàn 4 số người cùng bàn đưa cho bạn.
              </p>
              <label className="dinein-field">
                <span>Số bàn</span>
                <input
                  className="dinein-num"
                  inputMode="numeric"
                  placeholder="Số bàn"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="dinein-field">
                <span>Mã bàn 4 số</span>
                <input
                  className="dinein-code"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="● ● ● ●"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </label>
              <button
                type="button"
                className="dinein-link"
                onClick={() => {
                  setManualCode(false);
                  setCode('');
                  setErr(null);
                }}
              >
                ← Bàn tôi chưa gọi gì, quay lại
              </button>
            </>
          ) : (
            <>
              <input
                className="dinein-num"
                inputMode="numeric"
                placeholder="Số bàn"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
              />
              <p className="dinein-hint">
                Nhập số dán trên mặt bàn của bạn — số 1, 2, 3… dán trên mặt bàn, <b>không phải</b>
                {' '}mã bàn 4 số.
              </p>
              {/* M7.D-18 — dòng cho người thứ hai trở đi. Là NÚT thật chứ không phải câu nhắc:
                  câu nhắc "bước sau sẽ cần mã" không nói cho người đang cầm sẵn mã biết họ phải
                  bấm vào đâu. */}
              <button type="button" className="dinein-link" onClick={() => setManualCode(true)}>
                Đã có <b>mã bàn 4 số</b>? Nhập mã ở đây →
              </button>
            </>
          )}
          {err ? <p className="dinein-err">{err}</p> : null}
        </div>

        <div className="dinein-foot">
          <button
            type="button"
            className="dinein-primary"
            disabled={
              busy ||
              (needCode
                ? code.length !== 4
                : manualCode
                  ? input.trim() === '' || code.length !== 4
                  : input.trim() === '')
            }
            onClick={submit}
          >
            {busy
              ? 'Đang kiểm…'
              : needCode || manualCode
                ? 'Gọi thêm cho bàn này'
                : 'Tiếp tục'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Hộp xác nhận đúng bàn ────────────────────────────────────────────────────────────── */

/** M7.R1 — gõ nhầm số bàn là rủi ro CAO KHÔNG phát hiện tự động được: món sẽ vào một bàn có
 *  thật, chỉ là bàn người khác. Màn này là chốt chặn duy nhất, nên tên bàn phải TO. */
export function TableConfirmSheet({
  tableName,
  onYes,
  onNo,
}: {
  tableName: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="dinein-scrim">
      <div className="dinein-sheet dinein-sheet--center">
        <div className="dinein-body dinein-confirm">
          <p>Bạn đang ngồi</p>
          <strong>{tableName}</strong>
          <p className="dinein-hint">Món sẽ được mang ra đúng bàn này.</p>
        </div>
        <div className="dinein-foot dinein-foot--row">
          <button type="button" onClick={onNo}>Chọn lại</button>
          <button type="button" className="dinein-primary" onClick={onYes}>Đúng rồi</button>
        </div>
      </div>
    </div>
  );
}

/* ── Tấm giỏ ──────────────────────────────────────────────────────────────────────────── */

export function TableCartSheet({
  session,
  onClose,
  onSent,
}: {
  session: TableSession;
  onClose: () => void;
  onSent: (guestCode: string | null) => void;
}) {
  const [lines, setLines] = useState<TableCartLine[]>(() => readTableCart());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Sinh MỘT lần khi mở tấm giỏ: bấm lại vì mạng lỗi phải dùng đúng id cũ, nếu không BE sẽ
  // coi là lượt mới và bàn nhận món hai lần.
  const [requestId] = useState(() => newClientRequestId());

  useEffect(() => subscribeTableCart(() => setLines(readTableCart())), []);

  const send = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await postJson<{ guest_code: string | null }>('/api/public/table/cart', {
        guest_token: session.guest_token,
        client_request_id: requestId,
        items: lines.map((l) => ({
          menu_item_id: l.menu_item_id,
          qty: l.qty,
          ...(l.note ? { note: l.note } : {}),
        })),
      });
      clearTableCart();
      onSent(data.guest_code);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }, [lines, session, requestId, onSent]);

  const total = tableCartTotal(lines);

  return (
    <div className="dinein-scrim" onClick={onClose}>
      <div className="dinein-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dinein-head">
          <b>Món bạn chọn · {session.table_name}</b>
          <button type="button" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        {/* `min-height: 0` trên vùng cuộn là BẮT BUỘC — thiếu nó thì flex item không co được
            nhỏ hơn nội dung và cả tấm giỏ phình quá màn hình. */}
        <div className="dinein-body dinein-scroll">
          {lines.length === 0 ? (
            <p className="dinein-hint">Chưa chọn món nào. Chạm vào ảnh món để thêm nhé.</p>
          ) : (
            lines.map((l) => (
              <div key={l.menu_item_id} className="dinein-line">
                <div className="dinein-line-top">
                  <span className="dinein-line-name">{l.name}</span>
                  <span className="dinein-line-price">{vnd(l.unit_price * l.qty)}</span>
                </div>
                <div className="dinein-line-ctl">
                  <button type="button" onClick={() => setTableQty(l.menu_item_id, l.qty - 1)}>−</button>
                  <b>{l.qty}</b>
                  <button type="button" onClick={() => setTableQty(l.menu_item_id, l.qty + 1)}>+</button>
                  <input
                    placeholder="Ghi chú (ít cay…)"
                    value={l.note}
                    onChange={(e) => setTableNote(l.menu_item_id, e.target.value)}
                  />
                </div>
              </div>
            ))
          )}
          {err ? <p className="dinein-err">{err}</p> : null}
        </div>

        <div className="dinein-foot">
          <div className="dinein-total">
            <span>Tạm tính</span>
            <b>{vnd(total)}</b>
          </div>
          {/* D-11 — giá chốt lúc nhân viên xác nhận, nên con số trên kia là TẠM TÍNH. Nói ra
              để khách không thấy bill lệch rồi tranh cãi ở quầy. */}
          <p className="dinein-hint dinein-hint--sm">Giá tạm tính, quán xác nhận lại khi nhận món.</p>
          <button
            type="button"
            className="dinein-primary"
            disabled={busy || lines.length === 0}
            onClick={send}
          >
            {busy ? 'Đang gửi…' : 'Gửi cho quán'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Màn "Món của bàn" ────────────────────────────────────────────────────────────────── */

type StatePayload = {
  table_name: string;
  guest_code: string | null;
  waiting: Array<{ request_id: string; created_at: number; items: Array<{ name: string; qty: number; note: string | null }> }>;
  ordered: Array<{ name: string; qty: number; unit_price: number; line_total: number }>;
  subtotal: number;
  calls: Array<{ kind: 'STAFF' | 'BILL'; created_at: number; acked: boolean }>;
};

export function TableStateSheet({
  session,
  onClose,
  onEnded,
}: {
  session: TableSession;
  onClose: () => void;
  onEnded: () => void;
}) {
  const [data, setData] = useState<StatePayload | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/public/table/state', {
          headers: { 'X-Guest-Token': session.guest_token },
        });
        const json = (await res.json()) as { ok?: boolean; data?: StatePayload; error?: { code: string } };
        if (!alive) return;
        if (json.error?.code === 'SESSION_ENDED') {
          writeTableSession(null);
          onEnded();
          return;
        }
        if (json.data) setData(json.data);
      } catch {
        /* nhịp sau thử lại — không làm hỏng màn đang mở */
      }
    };
    void load();
    // 5 giây, không nhanh hơn: cả quán đi chung một IP, 20 khách poll nhanh là chạm trần.
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session, onEnded]);

  const call = useCallback(
    async (kind: 'STAFF' | 'BILL') => {
      setCalling(kind);
      setMsg(null);
      try {
        await postJson('/api/public/table/call', { guest_token: session.guest_token, kind });
        setMsg(kind === 'STAFF' ? 'Đã báo nhân viên.' : 'Đã báo quán tính tiền.');
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setCalling(null);
      }
    },
    [session],
  );

  return (
    <div className="dinein-scrim" onClick={onClose}>
      <div className="dinein-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dinein-head">
          <b>Món của {data?.table_name ?? session.table_name}</b>
          <button type="button" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dinein-body dinein-scroll">
          {/* M7.R10 — mã hiện THƯỜNG TRỰC, không chỉ một lần lúc sinh: localStorage có thể hỏng
              và khách cần đọc lại mã cho người cùng bàn bất cứ lúc nào. */}
          {data?.guest_code ? (
            <div className="dinein-code-box">
              <span>Mã bàn của bạn</span>
              <strong>{data.guest_code}</strong>
              <p>Người cùng bàn muốn gọi thêm thì đưa mã này cho họ.</p>
            </div>
          ) : null}

          {data?.waiting.length ? (
            <div className="dinein-waiting">
              <b>Đang chờ quán xác nhận</b>
              {data.waiting.map((w) => (
                <div key={w.request_id}>
                  {w.items.map((i, k) => (
                    <div key={k} className="dinein-wline">
                      {i.qty}× {i.name}
                      {i.note ? <i> — {i.note}</i> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {data?.ordered.length ? (
            data.ordered.map((o, i) => (
              <div key={i} className="dinein-line-top">
                <span className="dinein-line-name">{o.qty}× {o.name}</span>
                <span className="dinein-line-price">{vnd(o.line_total)}</span>
              </div>
            ))
          ) : (
            <p className="dinein-hint">Bàn chưa có món nào được quán nhận.</p>
          )}

          {msg ? <p className="dinein-ok">{msg}</p> : null}
        </div>

        <div className="dinein-foot">
          <div className="dinein-total">
            <span>Tạm tính</span>
            <b>{vnd(data?.subtotal ?? 0)}</b>
          </div>
          <div className="dinein-foot--row">
            <button type="button" disabled={calling !== null} onClick={() => call('STAFF')}>
              🔔 Gọi nhân viên
            </button>
            <button type="button" disabled={calling !== null} onClick={() => call('BILL')}>
              💵 Xin tính tiền
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CSS của toàn bộ lớp phủ gọi món tại bàn. Xuất ra chuỗi để `MenuBookPage` nhúng cùng chỗ với
 * `BOOK_CARD_CSS` / `BOOK_PREVIEW_CSS` — trang này chạy ở `menu.<domain>` không có router nên
 * cũng không có AppShell để gắn stylesheet chung.
 *
 * ⚠ Dùng `dvh` chứ KHÔNG `vh`: `vh` tính theo khung nhìn LỚN, nên trên iPhone phần đỉnh hộp
 *   trôi khỏi màn hình và nhìn ra tưởng sticky hỏng.
 * ⚠ Ô nhập chữ tối thiểu 16px, nếu không iOS tự phóng to cả trang khi bấm vào.
 */
export const DINEIN_CSS = `
.dinein-scrim{
  position:fixed; inset:0; z-index:310; background:rgb(42 29 20 / 55%);
  display:flex; align-items:flex-end; justify-content:center;
}
.dinein-sheet{
  width:100%; max-width:520px; background:#fffdfa;
  border-radius:20px 20px 0 0;
  /* Ba tầng cứng: đầu + giữa cuộn + chân. 85dvh để còn thấy mép trang phía sau. */
  display:flex; flex-direction:column; max-height:85dvh;
  box-shadow:0 -6px 24px rgb(42 29 20 / 16%);
}
.dinein-sheet--center{ align-self:center; border-radius:20px; margin:0 16px; }
.dinein-head{
  flex:none; display:flex; align-items:center; justify-content:space-between;
  gap:12px; padding:16px; border-bottom:1px solid #efe6d8; font-size:17px; color:#2a1d14;
}
.dinein-head button{
  flex:none; min-width:44px; min-height:44px; border:none; background:transparent;
  font-size:20px; color:#6e5c4c; cursor:pointer;
}
/* min-height:0 là BẮT BUỘC — thiếu nó flex item không co nhỏ hơn nội dung được và cả tấm
   giỏ phình quá màn hình. Đây đúng là lỗi "giỏ bị vỡ" nếu quên. */
.dinein-body{ padding:16px; color:#3a2b1f; }
.dinein-scroll{ flex:1; min-height:0; overflow-y:auto; }
.dinein-foot{
  flex:none; padding:16px; padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));
  border-top:1px solid #efe6d8; background:#fffdfa;
}
.dinein-foot--row{ display:flex; gap:10px; }
.dinein-foot--row button{ flex:1; min-height:48px; border-radius:8px;
  border:1px solid #ddd0bd; background:#fffdfa; font-size:16px; color:#2a1d14; cursor:pointer; }
.dinein-primary{
  width:100%; min-height:52px; border:none; border-radius:8px;
  background:#b82a1e; color:#fff; font-size:18px; font-weight:700; cursor:pointer;
}
.dinein-primary:disabled{ opacity:.5; cursor:default; }
.dinein-num,.dinein-code{
  width:100%; min-height:56px; border:1px solid #ddd0bd; border-radius:8px;
  background:#f7efe2; text-align:center; color:#2a1d14;
  font-size:28px; font-weight:700; letter-spacing:.12em;
}
.dinein-code{ letter-spacing:.5em; }
/* Hai ô cạnh nhau ở bước "đã có mã": phải có NHÃN, không thì hai ô số to giống hệt nhau và
   khách lại gõ nhầm ô — đúng cái lỗi bước này sinh ra để chữa. */
.dinein-field{ display:block; margin-bottom:12px; }
.dinein-field span{
  display:block; margin-bottom:4px; font-size:14px; font-weight:700; color:#6e5c4c;
}
/* Nút dạng chữ. Vẫn là <button> thật (bàn phím tab tới được, trình đọc màn hình đọc đúng),
   chỉ bỏ dáng nút. min-height 44px vì đây là ngưỡng chạm, không phải chữ trang trí. */
.dinein-link{
  display:block; width:100%; min-height:44px; margin-top:12px; padding:0;
  border:none; background:none; cursor:pointer;
  font-size:15px; color:#b82a1e; text-align:left; text-decoration:underline;
}
.dinein-hint{ margin:10px 0 0; font-size:15px; color:#6e5c4c; }
.dinein-hint--sm{ font-size:13px; margin:6px 0 10px; }
.dinein-hint--lead{ font-size:16px; color:var(--text-body,#3a2b1f); margin-bottom:10px; }
.dinein-steps{ margin:0 0 14px; padding-left:20px; }
.dinein-steps li{ font-size:14px; color:#6e5c4c; line-height:1.5; margin-bottom:6px; }
.dinein-err{ margin:10px 0 0; font-size:15px; color:#b82a1e; }
.dinein-ok{ margin:10px 0 0; font-size:15px; color:#3a6320; }
.dinein-confirm{ text-align:center; }
.dinein-confirm strong{ display:block; font-size:30px; color:#8f1d14; margin:6px 0; }
.dinein-line{ padding:12px 0; border-bottom:1px solid #efe6d8; }
.dinein-line-top{ display:flex; gap:12px; justify-content:space-between; align-items:baseline; padding:6px 0; }
.dinein-line-name{ flex:1; min-width:0; font-size:17px; color:#2a1d14; }
.dinein-line-price{ flex:none; font-size:17px; font-weight:700; color:#cf3323; white-space:nowrap;
  font-variant-numeric:tabular-nums; }
.dinein-line-ctl{ display:flex; align-items:center; gap:8px; margin-top:8px; }
.dinein-line-ctl button{
  flex:none; min-width:44px; min-height:44px; border:1px solid #ddd0bd; border-radius:8px;
  background:#fffdfa; font-size:20px; color:#2a1d14; cursor:pointer;
}
.dinein-line-ctl b{ min-width:28px; text-align:center; font-size:18px; }
.dinein-line-ctl input{
  flex:1; min-width:0; min-height:44px; padding:0 10px;
  border:1px solid #ddd0bd; border-radius:8px; background:#f7efe2;
  font-size:16px; color:#2a1d14; /* 16px: dưới mức này iOS tự phóng to trang */
}
.dinein-total{ display:flex; justify-content:space-between; align-items:baseline; font-size:17px; }
.dinein-total b{ font-size:22px; color:#cf3323; font-variant-numeric:tabular-nums; }
.dinein-code-box{
  text-align:center; padding:14px; margin-bottom:14px;
  background:#fef6f3; border:1px solid #fbe4de; border-radius:12px;
}
.dinein-code-box span{ font-size:14px; color:#6e5c4c; }
.dinein-code-box strong{ display:block; font-size:40px; letter-spacing:.2em; color:#8f1d14; margin:4px 0; }
.dinein-code-box p{ margin:0; font-size:13px; color:#6e5c4c; }
.dinein-waiting{
  padding:12px; margin-bottom:12px; border-radius:10px;
  background:#f6ecd9; border:1px solid #e8a33d;
}
.dinein-waiting b{ display:block; font-size:15px; color:#8c5610; margin-bottom:6px; }
.dinein-wline{ font-size:16px; color:#3a2b1f; }
.dinein-wline i{ color:#6e5c4c; }
.dinein-add{
  display:block; width:100%; min-height:52px; margin-top:14px;
  border:none; border-radius:10px; background:#b82a1e; color:#fff;
  font-size:18px; font-weight:700; cursor:pointer;
}
.dinein-fab{
  position:fixed; left:0; right:0; bottom:0; z-index:200;
  display:flex; gap:10px; padding:12px 16px;
  padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
  pointer-events:none;
}
.dinein-fab-btn{
  pointer-events:auto; flex:1; min-height:52px; border-radius:999px;
  border:1px solid #ddd0bd; background:#fffdfa; color:#2a1d14;
  font-size:16px; font-weight:700; cursor:pointer;
  box-shadow:0 4px 16px rgb(42 29 20 / 14%);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.dinein-fab-btn--primary{ background:#b82a1e; color:#fff; border-color:#b82a1e; }
`;
