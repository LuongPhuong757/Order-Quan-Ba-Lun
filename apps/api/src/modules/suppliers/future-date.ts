// Luật "ngày này có nằm ở tương lai không" của module nhà cung cấp (2026-10-02).
//
// Dùng cho HAI chỗ, và cố ý chung một file: ngày giao của phiếu nhập, và ngày trả tiền cho NCC.
// Cả hai ghi lại một việc ĐÃ XẢY RA — hàng đã về, tiền đã đưa — nên ngày tương lai luôn là gõ
// nhầm. Chép luật ra hai nơi thì sẽ có ngày một bên chặn còn bên kia lọt.
//
// Tách khỏi service vì đây là luật nghiệp vụ thuần, không cần DB cũng không cần Nest — kiểm nó
// bằng test chạy vài mili giây, thay vì dựng MySQL thật chỉ để biết một chuỗi ngày có bị từ
// chối hay không.

import { BadRequestException } from '@nestjs/common';

/** Múi giờ VN cố định +7, không có DST. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Hôm nay theo giờ Việt Nam, 'YYYY-MM-DD'.
 *
 * KHÔNG dùng ngày của máy chủ: VPS chạy UTC, nên từ 0h tới 7h sáng giờ VN nó vẫn đang ở "hôm
 * qua". Mà quán này bán tới 3h sáng — nhập phiếu hay ghi tiền lúc 1h sáng là chuyện thường. Lấy
 * ngày theo UTC thì đúng những bản ghi đó bị từ chối với lý do "ngày trong tương lai", trong khi
 * người nhập đang chọn đúng ngày hôm nay của mình.
 *
 * `DeliveriesService.today()` gọi thẳng hàm này — một nguồn duy nhất cho cả module.
 */
export function todayVn(nowMs: number = Date.now()): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Ngày có nằm ở tương lai không, so với `todayIso`.
 *
 * So sánh CHUỖI 'YYYY-MM-DD' chứ không parse ra `Date`: hai chuỗi cùng định dạng đó so theo thứ
 * tự từ điển ra đúng thứ tự thời gian, và không đẻ thêm một lần quy đổi múi giờ nữa — mỗi lần
 * quy đổi là một lần có thể lệch một ngày.
 *
 * Chuỗi rỗng / sai định dạng trả `false`: việc của hàm này là bắt NGÀY TƯƠNG LAI, không phải bắt
 * dữ liệu rác. Định dạng đã có `@IsString() @MaxLength(10)` ở DTO canh, và ngày rỗng thì service
 * tự lấy hôm nay.
 */
export function isFutureDate(date: string | undefined | null, todayIso: string): boolean {
  const d = (date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d > todayIso;
}

/**
 * Chặn một ngày nằm ở tương lai (chủ quán chốt 2026-10-02).
 *
 * Vì sao chặn: ngày là mốc mà MỌI con số tiền của module này bám vào — chi tiêu theo ngày, công
 * nợ phát sinh, giá bình quân của mặt hàng, biểu đồ biến động nợ. Một bản ghi lạc sang năm sau
 * (gõ 2027 thay vì 2026 là trượt đúng một phím) nằm im ngoài mọi kỳ báo cáo người ta đang xem,
 * trong khi công nợ đã cộng hoặc trừ tiền của nó. Lúc phát hiện, với phiếu nhập còn phải sửa rồi
 * chạy `price-replay.ts` phát lại cả chuỗi giá của NCC đó.
 *
 * Ghi BÙ việc cũ vẫn được — chỉ chặn MỘT CHIỀU. Nhân viên bận thì tối mới ngồi nhập phiếu của
 * sáng; đưa tiền hôm qua mà tối nay mới ghi cũng là chuyện thường ngày.
 *
 * ⚠ `code` truyền vào CỐ Ý không được nằm trong dict `FRIENDLY_VN` của
 * `global-exception.filter.ts`: câu dưới mang hai con số động (ngày họ gõ và ngày hôm nay), mà
 * dict đó tra tĩnh và sẽ ghi đè mất cả hai, để lại một câu chung chung không ai sửa theo được.
 */
export function assertNotFutureDate(
  date: string | undefined | null,
  todayIso: string,
  opts: {
    /** Mã lỗi riêng cho từng chỗ gọi. KHÔNG thêm vào `FRIENDLY_VN` — xem trên. */
    code: string;
    /** Tên ô trên màn hình, đúng chữ người dùng đang nhìn: 'Ngày giao', 'Ngày trả'. */
    nhan: string;
    /** Câu nói VÌ SAO không hợp lệ, viết theo nghiệp vụ của chỗ gọi. */
    viSao: string;
  },
): void {
  if (!isFutureDate(date, todayIso)) return;
  throw new BadRequestException({
    code: opts.code,
    message: `${opts.nhan} ${(date ?? '').trim()} nằm ở tương lai (hôm nay là ${todayIso}). ${opts.viSao}`,
  });
}
