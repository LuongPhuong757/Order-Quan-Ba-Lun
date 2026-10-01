import { useState } from 'react';
import type { GuestCard, PendingCall } from '../lib/kds-guest-cards.js';
import { describeAge } from '../lib/kds-guest-cards.js';
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
  onAck: (callId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  if (cards.length === 0 && calls.length === 0) return null;

  const open = cards.find((c) => c.request_id === openId) ?? null;

  return (
    <>
      <div className="kds-guest-rail">
        {calls.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`kds-guest-chip kds-guest-chip--call${c.kind === 'BILL' ? ' is-bill' : ''}`}
            disabled={busyId === c.id}
            onClick={() => onAck(c.id)}
            // Chuông chỉ là lời nhắn, không phải quyết định — bấm một phát là xong, không mở
            // thêm màn nào.
            title="Bấm để báo đã nghe"
          >
            <span aria-hidden>{c.kind === 'STAFF' ? '🔔' : '💵'}</span>
            <b>{tableSpeechName(c.table_name)}</b>
            <i>{c.kind === 'STAFF' ? 'gọi thêm đồ' : 'thanh toán'}</i>
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
                  <button
                    type="button"
                    onClick={() => {
                      onReject(open.request_id);
                      setOpenId(null);
                    }}
                  >
                    Bỏ thật
                  </button>
                  <button type="button" onClick={() => setConfirmReject(false)}>Không</button>
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
