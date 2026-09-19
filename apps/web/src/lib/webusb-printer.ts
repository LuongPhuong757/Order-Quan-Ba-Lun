// Đẩy byte ESC/POS sang máy in nối USB, bằng WebUSB.
//
// Vì sao là WebUSB chứ không phải một script như bản chạy LAN: máy POS chạy Android, và trên
// Android KHÔNG có đường nào cho một script thường ghi vào máy in USB. Nhân Linux có
// `/dev/usb/lp0` nhưng Android không mở quyền đó cho ứng dụng thường; Termux chỉ chạm được
// USB qua `termux-usb`, mà đường đó cần libusb chứ không dùng được từ Node. WebUSB là API
// DUY NHẤT vừa nói được với máy in USB vừa không đòi cài app hay root máy.
//
// Đánh đổi đi kèm, đã biết trước: trang phải mở trong Chrome và màn hình phải sáng. Android
// bóp cổ tab chạy nền. Vì vậy trang cầu in giữ Wake Lock và hiển thị trạng thái cỡ lớn để
// người đứng quầy liếc qua là biết nó còn sống.

/** Lớp thiết bị USB 7 = Printer. Mọi máy in hoá đơn ESC/POS đều khai lớp này. */
const USB_CLASS_PRINTER = 7;

/** Cắt nhỏ khi gửi. Máy in rẻ tiền có bộ đệm vài KB; đẩy một cục 40KB dễ làm firmware nuốt
 *  nửa chừng rồi in ra rác — cùng lý do `cmdRaster` chia ảnh thành băng ở phía server. */
const CHUNK_BYTES = 4096;

// ── Kiểu tối thiểu của WebUSB ────────────────────────────────────────────────
// Khai tay thay vì thêm `@types/w3c-web-usb`: chỉ một file dùng tới, và thêm một dependency
// cho 20 dòng type là cái giá không đáng ở một repo mà `node_modules` đã lớn sẵn.
type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: string };
type UsbAlternate = { interfaceClass: number; endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; alternate: UsbAlternate; claimed: boolean };
type UsbConfiguration = { interfaces: UsbInterface[] };
export type UsbDevice = {
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: UsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  // Khai `Uint8Array` chứ không `BufferSource`: TypeScript 5.7 đổi `Uint8Array` thành kiểu có
  // tham số (`Uint8Array<ArrayBufferLike>`), và bản trả về của `.subarray()` không còn khớp
  // `BufferSource` nữa. Đây là thứ duy nhất ta từng truyền vào, nên khai hẹp lại là đúng hơn.
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
};
type Usb = {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(opts: { filters: Array<Record<string, number>> }): Promise<UsbDevice>;
};

export function usbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

function usb(): Usb {
  const u = (navigator as unknown as { usb?: Usb }).usb;
  if (!u) throw new Error('Trình duyệt này không hỗ trợ WebUSB. Hãy dùng Chrome trên máy POS.');
  return u;
}

/** Máy in đã được cấp quyền từ trước — Chrome nhớ quyền theo tên miền, nên sau khi tải lại
 *  trang (mất điện, Chrome tự khởi động lại) cầu in tự nối lại mà KHÔNG cần ai bấm nút. Thiếu
 *  hàm này thì mỗi lần máy POS khởi động lại là hoá đơn ngừng ra cho tới khi có người để ý. */
export async function getGrantedPrinter(): Promise<UsbDevice | null> {
  if (!usbSupported()) return null;
  const devices = await usb().getDevices();
  return devices.find(isPrinter) ?? devices[0] ?? null;
}

/** Mở hộp thoại chọn thiết bị. BẮT BUỘC gọi từ một cú bấm thật của người dùng — Chrome từ
 *  chối nếu không có cử chỉ, và lỗi trả về không nói rõ lý do đó. */
export async function requestPrinter(): Promise<UsbDevice> {
  // Lọc thêm lớp 0xFF (vendor-specific): `classCode` trong bộ lọc so với lớp khai ở cấp THIẾT
  // BỊ, mà rất nhiều máy in để cấp thiết bị = 0 hoặc 0xFF rồi mới khai lớp 7 ở cấp GIAO DIỆN.
  // Chỉ lọc mỗi lớp 7 thì hộp thoại chọn máy in hiện ra RỖNG, người dùng đành bấm Huỷ, và lỗi
  // báo về là "không tìm thấy thiết bị" — nghe như máy in hỏng chứ không phải bộ lọc sai.
  return usb().requestDevice({ filters: [{ classCode: USB_CLASS_PRINTER }, { classCode: 0xff }] });
}

/** Mở hộp thoại KHÔNG lọc gì — đường lùi khi máy in khai lớp lạ và không hiện trong danh sách. */
export async function requestAnyUsbDevice(): Promise<UsbDevice> {
  return usb().requestDevice({ filters: [], acceptAllDevices: true } as never);
}

function isPrinter(d: UsbDevice): boolean {
  return (d.configuration?.interfaces ?? []).some(
    (i) => i.alternate.interfaceClass === USB_CLASS_PRINTER,
  );
}

type Claimed = { iface: number; endpointOut: number };

/** Mở thiết bị và chiếm cổng ghi. Idempotent: gọi lại trên thiết bị đã mở vẫn an toàn. */
export async function openPrinter(device: UsbDevice): Promise<Claimed> {
  try {
    return await openPrinterOnce(device);
  } catch (err) {
    // Nguyên nhân thường gặp nhất: một TAB CŨ của chính trang này vẫn đang giữ giao diện USB.
    // Android hay để tab nền sống, nên đóng trang rồi mở lại là gặp ngay. Đóng hẳn thiết bị
    // rồi mở lại một lần là lấy lại được; không làm thế thì người dùng phải tự tìm và đóng
    // tab cũ — thứ không ai đoán ra.
    try {
      await device.close();
    } catch {
      /* thiết bị chưa mở, không sao */
    }
    try {
      return await openPrinterOnce(device);
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

async function openPrinterOnce(device: UsbDevice): Promise<Claimed> {
  if (!device.opened) await device.open();
  // Thiết bị vừa cắm chưa chọn cấu hình nào; bỏ bước này thì `configuration` là null và
  // không tìm ra endpoint.
  if (device.configuration === null) await device.selectConfiguration(1);

  const iface =
    device.configuration?.interfaces.find((i) => i.alternate.interfaceClass === USB_CLASS_PRINTER) ??
    device.configuration?.interfaces[0];
  if (!iface) throw new Error('Không tìm thấy cổng máy in trên thiết bị USB này');
  if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);

  const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
  if (!out) throw new Error('Thiết bị USB này không có đường ghi dữ liệu (bulk OUT)');
  return { iface: iface.interfaceNumber, endpointOut: out.endpointNumber };
}

/** Gửi nguyên một job. Ném lỗi nếu máy in từ chối — nơi gọi báo ngược về server. */
export async function sendToPrinter(
  device: UsbDevice,
  claimed: Claimed,
  bytes: Uint8Array,
): Promise<void> {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    const res = await device.transferOut(claimed.endpointOut, chunk);
    if (res.status !== 'ok') {
      throw new Error(`Máy in từ chối dữ liệu (${res.status}) ở byte ${offset}`);
    }
  }
}

/** base64 → byte. `atob` trả chuỗi ký tự 8-bit; không có bước này thì payload bị hiểu thành
 *  UTF-16 và mọi byte > 127 của ảnh raster hỏng hết. */
export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Byte cho tờ IN THỬ TẠI CHỖ — dựng ngay trong trình duyệt, KHÔNG đi qua server.
 *
 * Đây là công cụ chẩn đoán quan trọng nhất của chế độ USB, vì nó tách hai thứ có thể hỏng:
 * nếu tờ này ra giấy thì đường POS → USB → máy in đã thông, và mọi trục trặc còn lại nằm ở
 * phía server hoặc token. Không có nó thì một lần "không ra giấy" có ba bốn nguyên nhân và
 * không cách nào thu hẹp.
 *
 * Cố ý in chữ KHÔNG DẤU bằng lệnh text thô, không phải ảnh raster như hoá đơn thật: mục tiêu
 * ở đây là chứng minh đường truyền thông, càng ít thứ có thể sai càng tốt. Dấu tiếng Việt là
 * việc của ảnh raster do server dựng, đã có test riêng.
 */
export function buildLocalTestBytes(): Uint8Array {
  const ESC = 0x1b, GS = 0x1d;
  const text =
    'IN THU TAI CHO\n' +
    'Duong POS -> USB -> may in: OK\n' +
    new Date().toLocaleString('vi-VN') +
    '\n';
  const body = new TextEncoder().encode(text);
  const head = new Uint8Array([ESC, 0x40]); // ESC @ — reset máy in
  // Đẩy 4 dòng rồi cắt. Máy không có dao sẽ lặng lẽ bỏ qua lệnh cắt, không lỗi, không kẹt.
  const tail = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 66, 3]);
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head, 0);
  out.set(body, head.length);
  out.set(tail, head.length + body.length);
  return out;
}

/** Nhả thiết bị khi rời trang. Không nhả thì tab vừa đóng vẫn giữ giao diện USB, và lần mở
 *  trang sau báo "không chiếm được" — đúng lỗi người dùng gặp sau khi thoát rồi vào lại. */
export async function releasePrinter(device: UsbDevice | null): Promise<void> {
  if (!device) return;
  try {
    await device.close();
  } catch {
    /* đã đóng hoặc đã bị rút — không có gì để làm */
  }
}
