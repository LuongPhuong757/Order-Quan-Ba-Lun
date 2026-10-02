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
  /* M7.D-05 — MỘT đường đi duy nhất, hai bước, do SERVER quyết định có bước hai hay không:
   *
   *    gõ số bàn → bàn trống   → vào gọi món luôn
   *               → bàn có người → hiện ô mã bàn, nhập mã mới gọi thêm được
   *
   * Khách không phải tự biết bàn mình trống hay không, và không phải chọn lối vào nào cả.
   * `needCode` giữ TÊN BÀN server trả về, nên bước hai nói được "Bàn 05 đang có người" chứ
   * không nói chung chung.
   *
   * ⚠ Bước hai KHÔNG hiện mã bàn ra — nó hiện Ô ĐỂ NHẬP mã. Gõ số bàn mà đọc được mã thì mã
   *   mất sạch ý nghĩa: ai đi ngang quán cũng xem được bill và gọi món vào bàn người khác
   *   (spec D-05/D-16). Người quên mã thì hỏi nhân viên — nhân viên đọc mã từ màn quản lý. */
  const [needCode, setNeedCode] = useState<string | null>(null);
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
      /* ⚠ `setBusy(false)` TRƯỚC khi gọi `onDone`, không phải sau — và tuyệt đối không bỏ.
       *
       * Tấm này KHÔNG bị gỡ khỏi cây sau `onDone`: nơi gọi chỉ dựng thêm tấm xác nhận bàn đè
       * lên trên. Khách bấm "Chọn lại" ở tấm đó là quay về đúng tấm này với `busy` còn true —
       * nút kẹt ở chữ "Đang kiểm…" và mờ vĩnh viễn, không còn đường nào đi tiếp ngoài tải lại
       * trang. Đã xảy ra thật khi chạy thử 2026-10-01.
       *
       * Và KHÔNG `writeTableSession` ở đây: khách còn phải xác nhận đúng tên bàn đã (M7.R1,
       * chốt chặn duy nhất chống gõ nhầm bàn). Ghi sớm thì khách bấm "Chọn lại" xong, phiên
       * của bàn SAI vẫn nằm trong localStorage, và lần mở trang sau họ vào thẳng bàn đó mà
       * không ai hỏi gì nữa. Nơi ghi phiên là bước xác nhận. */
      setBusy(false);
      onDone(session);
    } catch (e) {
      const failed = e as Error & { code?: string };
      // Gõ đúng 4 chữ số mà không ra bàn nào thì gần như chắc chắn khách đang cầm MÃ BÀN và
      // gõ nhầm vào ô số bàn. Câu từ chối trần ("Không thấy bàn 8386") để khách tắc ở đó,
      // nên nói thẳng thứ tự đúng thay vì bắt họ tự đoán.
      if (failed.code === 'TABLE_NOT_FOUND' && /^\d{4}$/.test(input.trim())) {
        setErr(
          'Đây trông như MÃ BÀN 4 SỐ. Ô này điền SỐ BÀN bạn đang ngồi (1, 2, 3…) — ' +
            'nếu bàn đang có người, bước sau mới hỏi mã.',
        );
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
          <b>{needCode ? `${needCode} đang có người` : 'Bạn ngồi bàn số mấy?'}</b>
          {dismissible ? (
            <button type="button" onClick={onClose} aria-label="Đóng">✕</button>
          ) : null}
        </div>

        <div className="dinein-body">
          {needCode ? (
            <>
              <p className="dinein-hint dinein-hint--lead">
                Bàn này đang có người dùng. Vui lòng <b>nhập thêm mã bàn 4 số</b> để gọi thêm món.
              </p>
              <input
                className="dinein-code"
                inputMode="numeric"
                maxLength={4}
                placeholder="● ● ● ●"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                autoFocus
              />
              <ul className="dinein-steps">
                <li>Mã đang hiện trên điện thoại của người đã gọi món ở bàn bạn.</li>
                <li>
                  <b>Nếu bạn quên mã bàn, hãy hỏi lại nhân viên</b> — nhân viên xem được mã của
                  bàn và đọc lại cho bạn.
                </li>
              </ul>
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
              <p className="dinein-hint">Nhập số dán trên mặt bàn của bạn.</p>
              <p className="dinein-hint dinein-hint--sm">
                Bàn đang có người thì bước sau sẽ hỏi thêm <b>mã bàn 4 số</b>.
              </p>
            </>
          )}
          {err ? <p className="dinein-err">{err}</p> : null}
        </div>

        {/* Bước nhập mã có HAI nút: quay lại + đi tiếp. Nút quay lại là lối thoát bắt buộc —
            gõ nhầm sang bàn người khác mà không có nó thì khách kẹt cứng ở một bàn mình không
            có mã, đóng tấm ra lại bị cổng bắt buộc đẩy vào đúng chỗ cũ. Đặt ở chân tấm, cùng
            khuôn với tấm xác nhận bàn, chứ không để lẫn thành một dòng chữ trong thân. */}
        <div className={`dinein-foot${needCode ? ' dinein-foot--row' : ''}`}>
          {needCode ? (
            <button
              type="button"
              onClick={() => {
                setNeedCode(null);
                setCode('');
                setErr(null);
              }}
            >
              ← Quay lại
            </button>
          ) : null}
          <button
            type="button"
            className="dinein-primary"
            disabled={busy || (needCode ? code.length !== 4 : input.trim() === '')}
            onClick={submit}
          >
            {busy ? 'Đang kiểm…' : 'Tiếp tục'}
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

/* Gợi ý lý do gọi. Đây là những thứ khách hay phải gọi nhân viên nhất ở một quán ăn — chọn
 * sẵn để một cú chạm là xong. Chủ quán đọc lại rồi sửa cho khớp cách nói ở quán mình. */
const CALL_REASONS = [
  'Thêm bát đũa',
  'Thêm đá',
  'Thêm giấy ăn',
  'Thêm nước chấm',
  'Dọn bàn',
] as const;

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
  onSwitchTable,
  onTableRenamed,
}: {
  session: TableSession;
  onClose: () => void;
  onEnded: () => void;
  /** Khách tự nhận ra mình khai nhầm bàn và muốn khai lại. */
  onSwitchTable: () => void;
  /** Bàn của phiên này nay mang tên khác — nhân viên đã dời khách sang bàn khác trên màn quản
   *  lý. Nơi gọi phải ghi đè tên đã lưu trong máy, không thì chip ở đầu trang còn in tên cũ. */
  onTableRenamed: (tableName: string) => void;
}) {
  const [data, setData] = useState<StatePayload | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  /* Kết quả của lần bấm gọi gần nhất. Phải mang theo CÓ PHẢI LỖI KHÔNG: bản đầu nhét cả câu
   * thành công lẫn câu lỗi vào cùng một ô màu xanh, nên "Đợi 45 giây nữa nhé" hiện ra y như
   * một lời xác nhận đã gọi được. */
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /* Đổi bàn — hai bước khi bàn ĐÃ có món, một bước khi chưa.
   *
   * Chỗ dễ hiểu nhầm nhất của tính năng này: đổi bàn ở đây chỉ đổi BÀN CỦA MÁY NÀY. Món đã
   * gửi rồi thì nằm ở đơn của bàn cũ, máy khách không có quyền dời nó sang bàn khác — dời đơn
   * là việc của nhân viên trên màn quản lý. Nếu im lặng cho đổi, khách sẽ tưởng món cũng
   * theo mình sang bàn mới rồi ngồi chờ một phần ăn không bao giờ tới. Nên khi bàn đã có món,
   * phải nói thẳng điều đó ra trước khi đổi. */
  const [confirmSwitch, setConfirmSwitch] = useState(false);

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
        if (json.data) {
          setData(json.data);
          /* Tên bàn là thứ DUY NHẤT trong phiên có thể đổi sau lưng máy khách: nhân viên bấm
           * "chuyển bàn" trên màn quản lý thì đơn sang bàn mới và phiên thiết bị đi theo
           * (orders.service.ts cập nhật table_id của phiên), nhưng cái tên nằm trong
           * localStorage của máy khách thì không ai sửa hộ. Hậu quả: màn này in "Bàn 45" đúng
           * trong khi chip ở đầu trang vẫn in "Bàn 26", và khách không biết tin cái nào. */
          if (json.data.table_name && json.data.table_name !== session.table_name) {
            onTableRenamed(json.data.table_name);
          }
        }
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
  }, [session, onEnded, onTableRenamed]);

  /* Lý do gọi — khách chọn một gợi ý hoặc tự gõ.
   *
   * Mục đích là nhân viên MANG LUÔN thứ khách cần xuống bàn, khỏi xuống hỏi rồi đi lên lấy.
   * Nên luôn có đường đi KHÔNG lý do ("Chỉ gọi nhân viên thôi"): bắt gõ mới gọi được là dựng
   * thêm rào cho người chỉ muốn vẫy tay, và họ sẽ quay lại vẫy tay thật. */
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const call = useCallback(
    async (kind: 'STAFF' | 'BILL', note?: string) => {
      setCalling(kind);
      setMsg(null);
      try {
        await postJson('/api/public/table/call', {
          guest_token: session.guest_token,
          kind,
          ...(note && note.trim() ? { note: note.trim().slice(0, 120) } : {}),
        });
        setAsking(false);
        setReason('');
        setMsg({
          ok: true,
          text:
            kind === 'BILL'
              ? 'Đã báo quán tính tiền.'
              : note && note.trim()
                ? `Đã báo nhân viên: ${note.trim()}`
                : 'Đã báo nhân viên.',
        });
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
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
          {confirmSwitch ? (
            <div className="dinein-warn">
              <b>Bạn ngồi bàn khác?</b>
              <p>
                Máy sẽ hỏi lại số bàn. Những món <b>đã gửi</b> thì vẫn nằm ở{' '}
                <b>{data?.table_name ?? session.table_name}</b> — máy của bạn không tự chuyển
                được. Nếu bạn gửi nhầm bàn thì báo nhân viên để quán chuyển giúp.
              </p>
              <div className="dinein-foot--row">
                <button type="button" onClick={() => setConfirmSwitch(false)}>
                  Không, ở lại
                </button>
                <button type="button" className="dinein-primary" onClick={onSwitchTable}>
                  Đổi bàn
                </button>
              </div>
            </div>
          ) : null}

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

          {/* Đổi bàn nằm Ở ĐÂY, cuối phần nội dung, chứ không phải trong chân tấm: chân tấm là
              chỗ của hai nút khách dùng thường xuyên (gọi nhân viên, xin tính tiền). Đổi bàn
              là việc làm đúng một lần và chỉ khi lỡ khai nhầm — để nó cạnh hai nút kia là mời
              người ta bấm nhầm vào nó. */}
          {!confirmSwitch ? (
            <button
              type="button"
              className="dinein-link"
              onClick={() => {
                // Bàn chưa có món nào thì không có gì để nhầm lẫn — đổi thẳng, khỏi hỏi.
                const coMon = (data?.ordered.length ?? 0) > 0 || (data?.waiting.length ?? 0) > 0;
                if (coMon) setConfirmSwitch(true);
                else onSwitchTable();
              }}
            >
              Tôi ngồi bàn khác — đổi số bàn
            </button>
          ) : null}
        </div>

        <div className="dinein-foot">
          <div className="dinein-total">
            <span>Tạm tính</span>
            <b>{vnd(data?.subtotal ?? 0)}</b>
          </div>

          {/* Câu trả lời đứng NGAY TRÊN nút vừa bấm. Trước đây nó nằm trong vùng nội dung cuộn
              phía trên, mà bàn gọi vài món là nó đã trôi khỏi màn — bấm gọi xong không thấy gì
              phản hồi, nhìn ra đúng là "chức năng gọi nhân viên không hoạt động". */}
          {msg ? <p className={msg.ok ? 'dinein-ok' : 'dinein-err'}>{msg.text}</p> : null}
          {asking ? (
            <div className="dinein-ask">
              <b>Bạn cần gì ạ?</b>
              {/* Chạm MỘT phát là gửi luôn, không phải gõ rồi bấm thêm nút. Đây là đường đi
                  của gần hết các lần gọi, nên nó phải ngắn nhất. */}
              <div className="dinein-chips">
                {CALL_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={calling !== null}
                    onClick={() => call('STAFF', r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                placeholder="Hoặc gõ điều bạn cần…"
                value={reason}
                maxLength={120}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="dinein-foot--row">
                <button
                  type="button"
                  onClick={() => {
                    setAsking(false);
                    setReason('');
                  }}
                >
                  ← Quay lại
                </button>
                <button
                  type="button"
                  className="dinein-primary"
                  disabled={calling !== null}
                  onClick={() => call('STAFF', reason)}
                >
                  {reason.trim() ? 'Gọi kèm lời nhắn' : 'Chỉ gọi nhân viên thôi'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dinein-foot--row">
              <button type="button" disabled={calling !== null} onClick={() => setAsking(true)}>
                🔔 Gọi nhân viên
              </button>
              {/* Xin tính tiền KHÔNG hỏi lý do: lý do đã nằm ngay trong tên nút. Thêm một bước
                  ở đây là bắt khách trả giá cho tính năng của nút bên cạnh. */}
              <button type="button" disabled={calling !== null} onClick={() => call('BILL')}>
                💵 Xin tính tiền
              </button>
            </div>
          )}
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
/* ⚠ PHẢI viết button.dinein-primary, không được viết .dinein-primary trần.
   Rule ngay trên kia là .dinein-foot--row button — một class + một thẻ, nên nó MẠNH HƠN
   một class trần và sẽ đè mất màu đỏ của nút chính. Đo bằng trình duyệt: nút chính đứng một
   mình ra rgb(184,42,30), nhưng nằm trong hàng hai nút thì ra rgb(255,253,250) — tức là nút
   "Đúng rồi" ở tấm xác nhận bàn lâu nay vẫn trắng chứ không đỏ. Cùng cái bẫy đã ghi trong
   CLAUDE.md về nút secondary. */
.dinein-foot--row button.dinein-primary{
  border:none; background:#b82a1e; color:#fff; font-size:18px; font-weight:700;
}
.dinein-primary{
  width:100%; min-height:52px; border:none; border-radius:8px;
  background:#b82a1e; color:#fff; font-size:18px; font-weight:700; cursor:pointer;
}
.dinein-primary:disabled{ opacity:.5; cursor:default; }
/* Vuốt hết nội dung trong tấm thì DỪNG, không đẩy tiếp sang thực đơn phía sau. Đây là lớp
   chặn thứ hai, đi cùng với khoá cuộn body ở lib/body-scroll-lock.ts: khoá body lo trang
   nền, dòng này lo chính vùng cuộn trong tấm (và cả cú kéo quá đà trên iOS). */
.dinein-scroll,.dinein-sheet,.dinein-scrim{ overscroll-behavior:contain; }
.dinein-num,.dinein-code{
  width:100%; min-height:56px; border:1px solid #ddd0bd; border-radius:8px;
  background:#f7efe2; text-align:center; color:#2a1d14;
  font-size:28px; font-weight:700; letter-spacing:.12em;
}
.dinein-code{ letter-spacing:.5em; }
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
/* Bước hỏi lý do gọi. Chip to, xuống dòng thoải mái — người lớn tuổi bấm bằng cả ngón cái. */
.dinein-ask > b{ display:block; margin-bottom:8px; font-size:16px; color:#2a1d14; }
.dinein-chips{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
.dinein-chips button{
  min-height:44px; padding:0 14px; border-radius:999px; cursor:pointer;
  border:1px solid #ddd0bd; background:#fffdfa; color:#2a1d14; font-size:15px;
}
.dinein-chips button:disabled{ opacity:.5; cursor:default; }
.dinein-ask input{
  width:100%; min-height:48px; margin-bottom:10px; padding:0 12px;
  border:1px solid #ddd0bd; border-radius:8px; background:#fffdfa;
  font-size:16px; color:#2a1d14; /* 16px: dưới mức này iOS tự phóng to trang */
}

/* Hộp cảnh báo trước khi đổi bàn. Vàng chứ không đỏ: đây không phải lỗi, chỉ là một điều
   khách cần biết trước khi bấm. */
.dinein-warn{
  margin-bottom:14px; padding:12px; border-radius:10px;
  background:#fef6e7; border:1px solid #f0d9a8;
}
.dinein-warn > b{ display:block; margin-bottom:6px; font-size:17px; color:#8c5610; }
.dinein-warn p{ margin:0 0 12px; font-size:15px; line-height:1.5; color:#5c4420; }

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
