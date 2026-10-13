import { useState } from 'react';
import type { GuestCard, PendingCall } from '../lib/kds-guest-cards.js';
import { describeAge, describeGroup, groupCallsByTable } from '../lib/kds-guest-cards.js';
import { tableSpeechName } from '../lib/voice-text.js';

/**
 * M7.D-10 — lượt khách gọi chờ duyệt, hiển thị trên màn bếp.
 *
 * ── Vì sao DẢI CHIP NGANG chứ không phải thẻ lớn ──
 * Bản đầu là thẻ dọc đầy đủ (tên bàn + từng dòng món + tạm tính + 2 nút) chèn đầu cột Chờ chế
 * biến. Chủ quán xem và chốt 2026-10-01: *"hiển thị quá to, chưa hợp lý"* — mỗi lượt chiếm
 * ~200px chiều cao, hai bàn gọi cùng lúc là đẩy hết món đang nấu xuống dưới màn hình. Trong khi
 * thứ bếp cần nhìn liên tục là MÓN, không phải lượt chờ duyệt.
 *
 * Giờ: một dải ngang chỉ hiện TÊN BÀN + số món + đồng hồ chờ, cao ~44px cho mọi số lượng bàn.
 * Chạm vào chip mới mở danh sách món và nút duyệt. Thông tin không mất đi, chỉ đổi chỗ — và
 * tên bàn vẫn là thứ to nhất (M7.R1: chốt chặn duy nhất chống khách gõ nhầm bàn).
 */

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

export function GuestRequestCards({
  cards,
  calls,
  busyId,
  onApprove,
  onReject,
  onAck,
}: {
  cards: GuestCard[];
  calls: PendingCall[];
  busyId: string | null;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  /** Nhận NHIỀU id: một chuyến đi tới bàn giải quyết mọi lời nhắn của bàn đó cùng lúc. */
  onAck: (callIds: string[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  /* Thẻ gọi: bấm vào là MỞ RA XEM, không phải "Đã nghe" ngay.
   *
   * Từ khi khách ghi được lý do ("thêm bát đũa"), một cú chạm nhầm vào chip sẽ vừa xoá thẻ
   * vừa xoá luôn thứ duy nhất nói cho nhân viên biết phải mang gì xuống. Nên tách làm hai:
   * chạm để đọc, rồi mới bấm "Đã nghe". */
  /* Mở theo BÀN, không theo từng lời nhắn: chip giờ là một bàn. */
  const [openTable, setOpenTable] = useState<string | null>(null);

  if (cards.length === 0 && calls.length === 0) return null;

  const open = cards.find((c) => c.request_id === openId) ?? null;
  const groups = groupCallsByTable(calls);
  const openGroup = groups.find((g) => g.table_code === openTable) ?? null;

  return (
    <>
      <div className="kds-guest-rail">
        {/* MỘT BÀN MỘT CHIP. Trước đây mỗi lời nhắn một chip, nên một bàn bấm gọi 5 lần là
            đẩy hết bàn khác ra khỏi dải — đúng lúc những bàn kia cũng đang chờ. */}
        {groups.map((g) => (
          <button
            key={g.table_code}
            type="button"
            className={`kds-guest-chip kds-guest-chip--call${
              !g.has_staff && g.has_bill ? ' is-bill' : ''
            }`}
            disabled={g.items.some((i) => busyId === i.id)}
            onClick={() => setOpenTable(g.table_code)}
            title={
              g.items.length > 1
                ? `${g.items.length} lời nhắn của ${g.table_name} — bấm để xem hết`
                : g.items[0]!.note
                  ? `Khách nhắn: ${g.items[0]!.note}`
                  : 'Bấm để xem và báo đã nghe'
            }
          >
            {/* Bàn vừa gọi nhân viên vừa xin tính tiền thì hiện CẢ HAI biểu tượng: nhân viên
                phải biết cầm theo máy tính tiền trước khi đi, khỏi đi hai lượt. */}
            <span aria-hidden>
              {g.has_staff ? '🔔' : ''}
              {g.has_bill ? '💵' : ''}
            </span>
            <b>{tableSpeechName(g.table_name)}</b>
            <i>{describeGroup(g)}</i>
            {g.items.length > 1 ? <span className="kds-guest-n">{g.items.length}</span> : null}
          </button>
        ))}

        {cards.map((c) => (
          <button
            key={c.request_id}
            type="button"
            className={`kds-guest-chip${c.blink ? ' is-late' : ''}`}
            onClick={() => {
              setConfirmReject(false);
              setOpenId(c.request_id);
            }}
          >
            <span aria-hidden>👤</span>
            <b>{tableSpeechName(c.table_name)}</b>
            <i>
              {c.lines.reduce((t, l) => t + l.qty, 0)} món · {describeAge(c.ageMs)}
            </i>
          </button>
        ))}
      </div>

      {/* Mọi lời nhắn của MỘT BÀN, cũ trước mới sau. */}
      {openGroup ? (
        <div className="kds-guest-overlay" onClick={() => setOpenTable(null)}>
          <div className="kds-guest-modal kds-call-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kds-guest-modal-head">
              <b>
                {openGroup.has_staff ? '🔔' : ''}
                {openGroup.has_bill ? '💵' : ''} {tableSpeechName(openGroup.table_name).toUpperCase()}
              </b>
              <span>{openGroup.items.length} lời nhắn</span>
              <button type="button" onClick={() => setOpenTable(null)} aria-label="Đóng">✕</button>
            </div>

            <div className="kds-guest-modal-body">
              {openGroup.items.map((c) => (
                <div key={c.id} className="kds-call-row">
                  <div className="kds-call-row-main">
                    <span className="kds-call-kind">
                      {c.kind === 'STAFF' ? '🔔 Gọi nhân viên' : '💵 Xin tính tiền'}
                      {' · '}
                      {describeAge(Math.max(0, Date.now() - c.created_at))}
                    </span>
                    {c.note ? (
                      <p className="kds-call-note">{c.note}</p>
                    ) : (
                      <p className="kds-call-none">Khách không ghi lý do.</p>
                    )}
                  </div>
                  {/* Bỏ được TỪNG lời nhắn: bàn nhắn "thêm đá" rồi "tính tiền" thì nhân viên
                      mang đá xong vẫn còn việc tính tiền, không được xoá sạch một lượt. */}
                  <button
                    type="button"
                    className="kds-call-one"
                    disabled={busyId === c.id}
                    onClick={() => {
                      onAck([c.id]);
                      if (openGroup.items.length === 1) setOpenTable(null);
                    }}
                  >
                    ✓
                  </button>
                </div>
              ))}
            </div>

            <div className="kds-guest-modal-foot">
              <button
                type="button"
                className="kds-guest-approve"
                disabled={openGroup.items.some((i) => busyId === i.id)}
                onClick={() => {
                  onAck(openGroup.items.map((i) => i.id));
                  setOpenTable(null);
                }}
              >
                {openGroup.items.length > 1
                  ? `✓ Đã nghe tất cả (${openGroup.items.length})`
                  : '✓ Đã nghe'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Danh sách món + nút duyệt, chỉ hiện khi bấm vào chip. */}
      {open ? (
        <div className="kds-guest-overlay" onClick={() => setOpenId(null)}>
          <div className="kds-guest-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kds-guest-modal-head">
              {/* M7.R1 — tên bàn to nhất màn: khách gõ nhầm số bàn không phát hiện tự động được,
                  nhân viên liếc thấy tên bàn là chốt chặn cuối cùng. */}
              <b>👤 KHÁCH {tableSpeechName(open.table_name).toUpperCase()} GỌI</b>
              <span>{describeAge(open.ageMs)}</span>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Đóng">✕</button>
            </div>

            <div className="kds-guest-modal-body">
              {open.lines.map((l, i) => (
                <div key={i} className={`kds-guest-line${l.gone ? ' kds-guest-line--gone' : ''}`}>
                  <b>{l.qty}×</b> {l.name}
                  {l.auto ? <span className="kds-guest-auto">quán tự thêm</span> : null}
                  {l.note ? <i> — {l.note}</i> : null}
                  {/* Nhãn hiện TRƯỚC khi bấm, để một cú bấm vẫn là quyết định có hiểu biết. */}
                  {l.gone ? <span className="kds-guest-gone">hết — sẽ bỏ</span> : null}
                </div>
              ))}
              <div className="kds-guest-foot">Tạm tính theo giá hiện tại: {vnd(open.subtotal)}</div>
            </div>

            <div className="kds-guest-modal-foot">
              <button
                type="button"
                className="kds-guest-approve"
                disabled={busyId === open.request_id}
                onClick={() => {
                  onApprove(open.request_id);
                  setOpenId(null);
                }}
              >
                {busyId === open.request_id ? 'Đang gửi…' : '✓ Duyệt cả lượt'}
              </button>

              {confirmReject ? (
                <div className="kds-guest-confirm">
                  <span>Bỏ cả lượt này?</span>
                  {/* Nút AN TOÀN đứng trước, nút huỷ đứng sau — cùng thứ tự với mọi hộp xác
                      nhận khác của app (Chọn lại / Đúng rồi). Bản cũ để "Bỏ thật" bên trái,
                      tức ngón tay rơi vào đúng nút phá trước. */}
                  <button type="button" onClick={() => setConfirmReject(false)}>
                    Không, giữ lại
                  </button>
                  <button
                    type="button"
                    className="kds-confirm-yes"
                    onClick={() => {
                      onReject(open.request_id);
                      setOpenId(null);
                    }}
                  >
                    Bỏ thật
                  </button>
                </div>
              ) : (
                <button type="button" className="kds-guest-reject" onClick={() => setConfirmReject(true)}>
                  ✕ Bỏ lượt
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
