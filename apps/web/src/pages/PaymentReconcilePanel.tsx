// Hai mảnh đối soát tiền của màn Lịch sử (2026-09-14).
//
// `DoiSoatStrip` (trước là `PaymentSummaryBox`) — "két phải có bao nhiêu, ngân hàng phải về bao nhiêu", tách theo từng mã
// QR. Đây là lý do cả tính năng chuyển khoản tồn tại: có ba tài khoản thì cuối ngày mở ba sao kê,
// mỗi cái chỉ dò đúng phần của nó thay vì dò chéo tất cả.
//
// `PaymentPhotos` — ảnh bill khách đưa. Tải TRỄ, chỉ khi người ta mở chi tiết một đơn: kéo ảnh
// của cả trang danh sách là hàng chục tấm không ai nhìn.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

type Summary = {
  total: number;
  cash: number;
  transfer: number;
  orders: number;
  by_account: Array<{ account_id: string | null; label: string; amount: number; orders: number }>;
  /** Đang nợ — MỌI THỜI GIAN, không ăn theo bộ lọc (2026-09-25, D-06). */
  debt_outstanding: { orders: number; amount: number };
};

/** Nhận NGUYÊN chuỗi query đã dựng bằng `historyQuery` của màn Lịch sử, không tự ghép lại từ
 *  from/to: docblock của `historyQuery` ghi rõ ba khối `URLSearchParams` chép tay ở màn này đã
 *  từng lệch nhau ở khoảng ngày. Khối đối soát nói về tiền — lệch ngày ở đây là lệch cả con số
 *  người ta mang đi đếm két. `filterKey` là deps để đổi trang không bắt tải lại.
 *
 *  DẢI 4 Ô LUÔN HIỆN (chủ quán duyệt bản xem thử 2026-11-13) — thay khối "Hiện đối soát tiền"
 *  mặc định đóng (chốt 2026-09-14). Lý do đổi: cuối ca người ta mở màn này chính để lấy hai con số
 *  mang đi đếm két, phải bấm thêm một nút mới thấy là thừa một bước mỗi ngày. Khối vẫn CHỈ admin
 *  (chỗ gọi gác `canSeeReconcile`). Bảng từng tài khoản chuyển vào tấm trượt khi chạm ô
 *  "Chuyển khoản" — dải trên cùng chỉ giữ 4 con số. */
export function DoiSoatStrip({
  query,
  filterKey,
  onDebt,
  oChinh,
  anTien = false,
  anNo = false,
}: {
  query: string;
  filterKey: string;
  /** Chạm ô "Đang nợ" → nhảy sang tab Đang nợ, nơi thu nợ được. */
  onDebt: () => void;
  /** Thay ô "Tổng thu" bằng số tiền của tab đang chọn (Chưa TT / Nợ / Huỷ / Misa). `tien: null` =
   *  đang tải. Không truyền = giữ "Tổng thu". */
  oChinh?: { nhan: string; tien: number | null; phu: string };
  /** Ẩn 2 ô Tiền mặt + Chuyển khoản (tab Chưa TT / Đang nợ — chủ quán chốt 2026-11-17): đơn ở hai
   *  tab đó chưa thu đồng nào, để số tiền đã thu nằm cạnh dễ đọc nhầm là tiền của các đơn này. */
  anTien?: boolean;
  /** Ẩn ô "Đang nợ" (tab Đang nợ — 2026-11-17): ô chính đã là "Khách đang nợ", hai ô trùng số. */
  anNo?: boolean;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [moTk, setMoTk] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    api
      .get<{ data: Summary }>(`/orders/payment-summary?${query}`)
      .then((res) => alive && setData(res.data.data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  if (failed) return <div className="ls-note">Không tải được số liệu đối soát — thử tải lại trang.</div>;

  // Đang tải: giữ đủ 4 ô với "…" thay vì nhảy từ trống sang có — dải đứng yên, danh sách bên dưới
  // không bị đẩy xuống một nhịp.
  const v = (n: number | undefined) => (data ? fmt(n ?? 0) : '…');
  const soTk = data?.by_account.length ?? 0;
  const no = data?.debt_outstanding ?? { orders: 0, amount: 0 };

  return (
    <>
      <div className={`ls-ds${anNo && anTien ? ' is-mot' : anTien ? ' is-gon' : ''}`} aria-label="Đối soát tiền">
        {oChinh ? (
          <div className="ls-ds__o is-main">
            <span className="ls-ds__l">{oChinh.nhan}</span>
            <span className="ls-ds__v">{oChinh.tien == null ? '…' : fmt(oChinh.tien)}</span>
            <span className="ls-ds__s">{oChinh.phu}</span>
          </div>
        ) : (
          <div className="ls-ds__o is-main">
            <span className="ls-ds__l">Tổng thu</span>
            <span className="ls-ds__v">{v(data?.total)}</span>
            <span className="ls-ds__s">{data ? `${data.orders} đơn đã thanh toán` : ' '}</span>
          </div>
        )}
        {!anTien && (<>
        <div className="ls-ds__o">
          <span className="ls-ds__l">Tiền mặt</span>
          <span className="ls-ds__v">{v(data?.cash)}</span>
          <span className="ls-ds__s">phải có trong két</span>
        </div>
        {/* Ô chuyển khoản bấm được khi có ít nhất một tài khoản: mở bảng tiền về TỪNG tài khoản —
            có ba tài khoản thì cuối ngày mở ba sao kê, mỗi cái chỉ dò đúng phần của nó. */}
        {soTk > 0 ? (
          <button type="button" className="ls-ds__o" onClick={() => setMoTk(true)}
                  aria-label={`Chuyển khoản ${v(data?.transfer)} — xem từng tài khoản`}>
            <span className="ls-ds__l">Chuyển khoản</span>
            <span className="ls-ds__v">{v(data?.transfer)}</span>
            <span className="ls-ds__s is-lk">{soTk} tài khoản ›</span>
          </button>
        ) : (
          <div className="ls-ds__o">
            <span className="ls-ds__l">Chuyển khoản</span>
            <span className="ls-ds__v">{v(data?.transfer)}</span>
            <span className="ls-ds__s">phải về ngân hàng</span>
          </div>
        )}
        </>)}
        {/* Nợ là số MỌI THỜI GIAN, không ăn theo bộ lọc (D-06): câu admin cần trả lời là "quán đang
            bị nợ bao nhiêu". Không cộng vào Tổng thu — chưa thu thì không phải thu. */}
        {!anNo && (
        <button type="button" className={`ls-ds__o is-debt${no.amount > 0 ? ' is-co' : ''}`} onClick={onDebt}
                aria-label={`Đang nợ ${v(no.amount)} — xem các đơn đang nợ`}>
          <span className="ls-ds__l">Đang nợ</span>
          <span className="ls-ds__v">{v(no.amount)}</span>
          <span className="ls-ds__s">{no.orders} đơn · mọi thời gian</span>
        </button>
        )}
      </div>

      {moTk && data && (
        <Sheet
          title="Tiền về từng tài khoản"
          giuaKhiRong
          onClose={() => setMoTk(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoTk(false)}>Đóng</button></div>}
        >
          <div className="ls-ds__tk">
            {data.by_account.map((a) => (
              <div key={a.account_id ?? a.label}>
                <span>{a.label} <small>· {a.orders} đơn</small></span>
                <b>{fmt(a.amount)}</b>
              </div>
            ))}
          </div>
          <p className="ls-ds__note">
            Đây là số nhân viên đã ghi nhận lúc thu. Ngân hàng có báo về hay không xem ở dấu ✓/✗ từng
            đơn, hoặc ở Sổ webhook ngân hàng.
          </p>
        </Sheet>
      )}
    </>
  );
}

type Photo = { id: string; url: string; created_at: number; created_by_full_name: string | null };

export function PaymentPhotos({ orderId }: { orderId: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: Photo[] } }>(`/orders/${orderId}/payment-photos`)
      .then((res) => alive && setPhotos(res.data.data.items))
      .catch((e) => alive && setErr(extractError(e).message));
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (err) return <div style={{ fontSize: 13, color: '#dc2626' }}>Không tải được ảnh bill: {err}</div>;
  if (!photos || photos.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Ảnh bill khách đưa</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          // Mở tấm gốc ở tab mới để phóng to đọc số tiền và mã giao dịch — đó là việc duy nhất
          // người ta làm với mấy tấm ảnh này.
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
            <img
              src={p.url}
              alt={`Ảnh bill ${i + 1}`}
              style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Badge hình thức thanh toán của MỘT đơn (2026-09-14, chủ quán: "để rõ hơn").
 *
 * Ba lựa chọn thiết kế, đều có lý do:
 *
 *  1. MÀU NỀN là tín hiệu chính, icon chỉ phụ hoạ. Ở cỡ chữ nhỏ trong bảng, 💵 và 🏦 gần như
 *     không phân biệt được — nhất là trên điện thoại và với người mắt kém, vốn là người dùng
 *     thật của app này. Ba mảng màu khác hẳn nhau thì liếc là thấy.
 *  2. CHỮ ĐẦY ĐỦ, không viết tắt "CK". Bản đầu dùng "🏦 CK" cỡ 11px và đó chính là cái bị chê
 *     không rõ.
 *  3. Hiện cho MỌI đơn đã thu, kể cả tiền mặt. Bản đầu chỉ hiện khi có chuyển khoản, nghĩa là
 *     "không có badge" = tiền mặt — một quy ước ngầm mà người đọc bảng phải tự biết. Nói thẳng
 *     ra thì không phải đoán.
 *
 * KHÔNG hiện với đơn chưa thu hoặc đơn huỷ: chúng chưa có hình thức thanh toán nào cả.
 */
export function PaymentMethodBadge({ total, transferAmount }: { total: number; transferAmount: number }) {
  // inline-flex (trước là inline-block) để icon nét (Đợt 0, thay 💵 🏦) thẳng hàng với chữ.
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
    padding: '1px 6px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.5,
  };
  if (!transferAmount || transferAmount <= 0) {
    return (
      <span style={{ ...style, background: '#d1fae5', color: '#065f46' }}>
        <Icon name="tien-mat" size={14} />
        Tiền mặt
      </span>
    );
  }
  if (transferAmount >= total) {
    return (
      <span style={{ ...style, background: '#e0f2fe', color: '#075985' }}>
        <Icon name="chuyen-khoan" size={14} />
        Chuyển khoản
      </span>
    );
  }
  // Cam, KHÔNG phải một sắc xanh thứ ba: đây là trường hợp người đếm két phải để ý nhất — chỉ
  // một phần số tiền nằm trong két — nên nó cần nhảy ra khỏi hai màu kia.
  return (
    <span style={{ ...style, background: '#ffedd5', color: '#9a3412' }}>
      <Icon name="tien-mat" size={14} />+<Icon name="chuyen-khoan" size={14} />
      Cả hai
    </span>
  );
}
