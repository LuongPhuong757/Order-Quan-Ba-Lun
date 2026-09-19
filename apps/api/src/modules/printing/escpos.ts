// Lệnh ESC/POS cho máy in nhiệt khổ 58mm / 80mm (Xprinter). Module THUẦN — không I/O, không canvas —
// để test được mà không cần máy in lẫn thư viện đồ hoạ.
//
// Vì sao in ẢNH chứ không in TEXT (quyết định 2026-09-19):
// In text qua ESC/POS bắt máy in tự dựng chữ từ code page trong firmware. Tiếng Việt nằm ở
// CP1258, mà mỗi đời Xprinter đánh số trang mã một kiểu và không có cách nào hỏi máy đang
// hỗ trợ trang nào. Sai một con số là cả tờ hoá đơn ra "M? Qu?ng" — hỏng im lặng, chỉ phát
// hiện khi khách cầm tờ giấy. Dựng sẵn ảnh đen trắng rồi bắn raster thì máy in chỉ còn việc
// đổ mực theo từng chấm: dấu tiếng Việt luôn đúng, đổi font/cỡ chữ không phải đụng firmware.
// Cái giá là vài chục KB mỗi tờ thay vì vài trăm byte — không đáng kể trên LAN.

/** Chiều ngang in được ở 203dpi. Cả hai đều chia hết cho 8 nên mỗi hàng ảnh vừa đúng số byte,
 *  không phải đệm bit thừa.
 *
 *  Khổ GIẤY và khổ IN ĐƯỢC không bằng nhau — máy chừa lề hai bên:
 *    giấy 58mm → in được 48mm → 384 chấm
 *    giấy 80mm → in được 72mm → 576 chấm
 *  Đặt nhầm con số này là lỗi câm: máy vẫn in, chữ vẫn đẹp, chỉ nằm gọn nửa trái tờ giấy. */
export const DOTS_58MM = 384;
export const DOTS_80MM = 576;

/** Khổ giấy (mm) → số chấm in được. Chỉ nhận 58 và 80; giá trị lạ rơi về 80 vì đó là khổ phổ
 *  biến của máy để bàn — chọn sai theo hướng này thì chữ tràn ra lề, dễ thấy ngay lập tức,
 *  còn chọn sai theo hướng kia thì tờ hoá đơn trông "vẫn ổn" và không ai để ý. */
export function dotsForPaperWidth(mm: number): number {
  return mm === 58 ? DOTS_58MM : DOTS_80MM;
}

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const EOT = 0x04;

/** `ESC @` — reset máy in về mặc định (căn lề, cỡ chữ, đảo màu...).
 *  Bắt buộc mở đầu mọi job: job trước lỗi giữa chừng có thể để máy ở trạng thái lạ. */
export function cmdInit(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

/** `ESC d n` — đẩy giấy n dòng. */
export function cmdFeed(lines: number): Buffer {
  const n = Math.max(0, Math.min(255, Math.round(lines)));
  return Buffer.from([ESC, 0x64, n]);
}

/** `GS V 66 n` — cắt giấy kiểu partial, đẩy trước n dòng.
 *
 *  Máy ĐỂ BÀN thường có dao; máy CẦM TAY thì không. Máy không có dao nhận lệnh này
 *  và lặng lẽ bỏ qua (không lỗi, không kẹt) — nên an toàn khi gửi nhầm. Dù vậy vẫn để
 *  `autoCut` là một công tắc trong cài đặt: máy không dao mà bật cắt thì tờ hoá đơn dính
 *  liền nhau, người đứng quầy sẽ tưởng máy hỏng.
 */
export function cmdCut(feedLines = 3): Buffer {
  const n = Math.max(0, Math.min(255, Math.round(feedLines)));
  return Buffer.from([GS, 0x56, 66, n]);
}

/** `DLE EOT n` — hỏi trạng thái THỜI GIAN THỰC.
 *
 *  Khác mọi lệnh khác ở chỗ máy in trả lời NGAY cả khi đang bận in, vì firmware xử lý nó ở
 *  tầng dưới hàng đợi. Đây là cách duy nhất biết được "hết giấy" / "mở nắp" qua cổng 9100 —
 *  bản thân việc ghi byte vào socket luôn thành công dù khay giấy rỗng không.
 *
 *  n = 2 → nguyên nhân offline (nắp mở, hết giấy dừng máy)
 *  n = 4 → cảm biến giấy (sắp hết / đã hết)
 */
export function cmdQueryStatus(n: 1 | 2 | 3 | 4): Buffer {
  return Buffer.from([DLE, EOT, n]);
}

export type PrinterStatus = {
  /** Nắp máy đang mở — giấy sẽ không ra dù lệnh gửi thành công. */
  coverOpen: boolean;
  /** Hết giấy hẳn, máy đã dừng. */
  paperOut: boolean;
  /** Cảm biến báo sắp hết giấy — vẫn in được, nhưng nên thay cuộn. */
  paperNearEnd: boolean;
  /** Máy báo có lỗi cơ khí / dao cắt kẹt. */
  error: boolean;
};

/** Mọi byte trạng thái ESC/POS đều có bit0=0 và bit1=1 (0b……10). Dùng để phân biệt byte
 *  trạng thái thật với rác còn sót trong buffer của lần đọc trước. */
function isStatusByte(b: number): boolean {
  return (b & 0b11) === 0b10;
}

/**
 * Giải mã byte trả về của `DLE EOT 2` (nguyên nhân offline) và `DLE EOT 4` (cảm biến giấy).
 *
 * Truyền `null` cho máy không trả lời: phần lớn Xprinter có hỗ trợ, nhưng một số đời câm
 * lặng. Khi đó trả về "mọi thứ bình thường" thay vì chặn — thà in mù còn hơn từ chối in
 * trên một máy hoàn toàn khoẻ mạnh chỉ vì nó không biết cách tự khai bệnh.
 */
export function parseStatus(offlineByte: number | null, paperByte: number | null): PrinterStatus {
  const off = offlineByte !== null && isStatusByte(offlineByte) ? offlineByte : 0;
  const paper = paperByte !== null && isStatusByte(paperByte) ? paperByte : 0;
  return {
    coverOpen: (off & 0x04) !== 0,
    // Bit 5 của DLE EOT 2 = "dừng máy vì hết giấy". Bit 5+6 của DLE EOT 4 = cảm biến hết.
    paperOut: (off & 0x20) !== 0 || (paper & 0x60) === 0x60,
    paperNearEnd: (paper & 0x0c) === 0x0c,
    error: (off & 0x40) !== 0,
  };
}

/** Câu mô tả tiếng Việt cho trạng thái xấu — `null` nghĩa là in được.
 *  Sắp-hết-giấy KHÔNG chặn in: đó là lời nhắc thay cuộn, không phải lỗi. */
export function describeBlockingStatus(s: PrinterStatus): string | null {
  if (s.coverOpen) return 'Nắp máy in đang mở';
  if (s.paperOut) return 'Máy in hết giấy';
  if (s.error) return 'Máy in báo lỗi (kẹt giấy hoặc kẹt dao cắt)';
  return null;
}

/**
 * Đóng gói ảnh 1-bit thành lệnh raster `GS v 0`.
 *
 * `mono` là mảng 1 byte / 1 điểm ảnh: khác 0 = CHẤM ĐEN. Dùng 1 byte/điểm thay vì bit-field
 * ở đầu vào cho dễ dựng từ canvas; việc nén xuống bit do hàm này làm.
 *
 * Chia thành nhiều băng ngang thay vì một lệnh khổng lồ: bộ đệm ảnh của máy in rẻ tiền chỉ
 * vài chục KB, đẩy cả tờ hoá đơn 1500 dòng trong một lệnh là máy nuốt được nửa tờ rồi in ra
 * rác. Mỗi băng là một lệnh trọn vẹn nên máy in xong băng nào nhả giấy băng đó.
 */
export function cmdRaster(mono: Uint8Array, width: number, height: number, bandRows = 128): Buffer {
  if (width % 8 !== 0) throw new Error(`Chiều rộng ảnh phải chia hết cho 8, nhận ${width}`);
  if (mono.length !== width * height) {
    throw new Error(`Kích thước mono (${mono.length}) không khớp ${width}x${height}`);
  }
  const bytesPerRow = width / 8;
  const out: Buffer[] = [];
  for (let top = 0; top < height; top += bandRows) {
    const rows = Math.min(bandRows, height - top);
    const data = Buffer.alloc(bytesPerRow * rows);
    for (let y = 0; y < rows; y++) {
      const srcRow = (top + y) * width;
      const dstRow = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        if (mono[srcRow + x]) {
          // Bit cao nhất của byte là điểm ảnh TRÁI NHẤT (MSB first) — đảo thứ tự này thì
          // mỗi 8 chấm bị lật gương, chữ vẫn "có vẻ" là chữ nên rất dễ nhìn nhầm là font lỗi.
          data[dstRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    out.push(
      Buffer.from([
        GS,
        0x76,
        0x30,
        0x00, // m = 0: kích thước bình thường
        bytesPerRow & 0xff,
        (bytesPerRow >> 8) & 0xff,
        rows & 0xff,
        (rows >> 8) & 0xff,
      ]),
      data,
    );
  }
  return Buffer.concat(out);
}

/** Ghép một job hoàn chỉnh: reset → ảnh → đẩy giấy → (cắt). */
export function buildJob(
  mono: Uint8Array,
  width: number,
  height: number,
  opts: { autoCut: boolean; feedLines?: number },
): Buffer {
  const feed = opts.feedLines ?? 4;
  const parts = [cmdInit(), cmdRaster(mono, width, height)];
  // Không cắt thì vẫn phải đẩy giấy, nếu không mép dưới tờ hoá đơn còn nằm trong máy và
  // người đứng quầy xé vào giữa dòng chữ cuối.
  parts.push(opts.autoCut ? cmdCut(feed) : cmdFeed(feed));
  return Buffer.concat(parts);
}
