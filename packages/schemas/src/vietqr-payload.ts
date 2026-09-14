// Dựng chuỗi mã QR chuyển khoản theo chuẩn EMVCo / VietQR (2026-09-14).
//
// VÌ SAO TỰ DỰNG THAY VÌ GỌI `img.vietqr.io`:
// đây là lúc khách đang đứng chờ trả tiền. Phụ thuộc một domain bên ngoài nghĩa là mạng quán chậm
// hoặc nhà mạng chặn là KHÔNG THU ĐƯỢC TIỀN. Repo này đã có tiền lệ đúng loại đó: openstreetmap.org
// bị chặn DNS ở Việt Nam và bản đồ chết. Chuỗi dựng ở đây chạy offline hoàn toàn, và vì nó thuần
// nên có test riêng thay vì phải quét thử mới biết đúng sai.
//
// Cấu trúc EMVCo là các khối TLV lồng nhau: mỗi trường = mã 2 chữ số + ĐỘ DÀI 2 chữ số + nội dung.

/** Mã định danh của hệ thống chuyển tiền nhanh Napas trong trường 38. */
const GUID_NAPAS = 'A000000727';
/** Chuyển khoản tới TÀI KHOẢN (khác `QRIBFTTC` là tới số thẻ). */
const SERVICE_TRANSFER_TO_ACCOUNT = 'QRIBFTTA';
const CURRENCY_VND = '704';
const COUNTRY_VN = 'VN';

/** `11` = QR tĩnh (quét nhiều lần), `12` = QR động (một giao dịch, thường kèm số tiền).
 *  Ta luôn dựng QR cho ĐÚNG một lần thu của đúng một bàn nên luôn là động. */
const POINT_OF_INITIATION_DYNAMIC = '12';

/** Một khối TLV. Độ dài luôn 2 chữ số → nội dung tối đa 99 ký tự, đúng giới hạn của chuẩn. */
function tlv(id: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`Trường ${id} dài ${value.length} ký tự, chuẩn EMVCo chỉ cho tối đa 99`);
  }
  return id + String(value.length).padStart(2, '0') + value;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — chuẩn EMVCo bắt buộc ở trường 63.
 *
 * Tính trên TOÀN BỘ chuỗi ĐÃ BAO GỒM "6304" (mã + độ dài của chính trường CRC), rồi mới nối 4 ký
 * tự hex vào sau. Đây là chỗ dễ sai nhất của cả chuẩn: quên "6304" thì QR vẫn hiện ra hình vuông
 * đẹp đẽ và app ngân hàng báo "mã không hợp lệ" mà không nói vì sao.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type VietQrInput = {
  /** Mã BIN 6 số của ngân hàng nhận. */
  bankBin: string;
  accountNo: string;
  /** Số tiền VND, số nguyên. `0`/bỏ trống = QR không kèm tiền, khách tự gõ. */
  amount?: number;
  /** Nội dung chuyển khoản — đã chuẩn hoá sẵn bằng `buildTransferNote`, tối đa 25 ký tự. */
  note?: string;
};

/**
 * Trả về chuỗi để vẽ thành QR. KHÔNG vẽ ảnh ở đây: vẽ là việc của thư viện phía giao diện, còn
 * nội dung mã là luật nghiệp vụ và phải test được mà không cần trình duyệt.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  const { bankBin, accountNo } = input;
  if (!/^\d{6}$/.test(bankBin)) throw new Error('Mã ngân hàng (BIN) phải là 6 chữ số');
  if (!accountNo) throw new Error('Thiếu số tài khoản');

  const beneficiary = tlv('00', bankBin) + tlv('01', accountNo);
  const merchantAccount =
    tlv('00', GUID_NAPAS) + tlv('01', beneficiary) + tlv('02', SERVICE_TRANSFER_TO_ACCOUNT);

  let payload =
    tlv('00', '01') +
    tlv('01', POINT_OF_INITIATION_DYNAMIC) +
    tlv('38', merchantAccount) +
    tlv('53', CURRENCY_VND);

  // Số tiền là CHUỖI THẬP PHÂN, không có dấu phân cách nghìn. Số lẻ thì làm tròn — tiền Việt
  // không có đơn vị nhỏ hơn đồng, mà một dấu chấm thừa ở đây là QR hỏng.
  if (input.amount && input.amount > 0) {
    payload += tlv('54', String(Math.round(input.amount)));
  }

  payload += tlv('58', COUNTRY_VN);

  if (input.note) {
    // 62.08 = "Purpose of Transaction". Cắt ở 25 để không bao giờ ném lỗi giữa lúc thu tiền —
    // `buildTransferNote` đã lo phần cắt có chủ đích, đây chỉ là lưới an toàn cuối.
    payload += tlv('62', tlv('08', input.note.slice(0, 25)));
  }

  const withCrcTag = payload + '6304';
  return withCrcTag + crc16ccitt(withCrcTag);
}

/** Tách ngược chuỗi TLV thành map — dùng cho test và cho việc soi lỗi khi một app ngân hàng
 *  không đọc được mã. Không dùng trong luồng chạy thật. */
export function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}
