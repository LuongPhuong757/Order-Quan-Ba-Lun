import { describe, expect, it } from 'vitest';
import {
  DOTS_58MM,
  DOTS_80MM,
  dotsForPaperWidth,
  buildJob,
  cmdCut,
  cmdFeed,
  cmdInit,
  cmdRaster,
  describeBlockingStatus,
  parseStatus,
} from './escpos.js';

describe('cmdRaster — đóng gói ảnh 1-bit', () => {
  it('xếp bit theo MSB-first: chấm trái nhất là bit cao nhất', () => {
    // 8x1, chỉ chấm đầu tiên là đen → phải ra 0b10000000.
    const mono = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const out = cmdRaster(mono, 8, 1);
    expect(out.subarray(0, 8)).toEqual(Buffer.from([0x1d, 0x76, 0x30, 0x00, 1, 0, 1, 0]));
    expect(out[8]).toBe(0b10000000);
  });

  it('chấm phải nhất là bit thấp nhất', () => {
    const mono = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(cmdRaster(mono, 8, 1)[8]).toBe(0b00000001);
  });

  it('coi mọi giá trị khác 0 là chấm đen', () => {
    const mono = new Uint8Array([255, 0, 7, 0, 0, 0, 0, 0]);
    expect(cmdRaster(mono, 8, 1)[8]).toBe(0b10100000);
  });

  it('chia thành nhiều băng, mỗi băng là một lệnh trọn vẹn', () => {
    const mono = new Uint8Array(8 * 5); // 8 chấm ngang, 5 hàng
    const out = cmdRaster(mono, 8, 5, 2); // băng 2 hàng → 2 + 2 + 1
    // 3 lệnh: mỗi lệnh 8 byte header + (1 byte/hàng * số hàng)
    expect(out.length).toBe(8 + 2 + 8 + 2 + 8 + 1);
    expect(out[0]).toBe(0x1d);
    expect(out[8 + 2]).toBe(0x1d); // lệnh thứ hai bắt đầu ngay sau băng đầu
    expect(out[8 + 2 + 6]).toBe(2); // yL của băng thứ hai = 2 hàng
    expect(out[8 + 2 + 8 + 2 + 6]).toBe(1); // băng cuối chỉ còn 1 hàng
  });

  it('ghi số byte mỗi hàng theo little-endian', () => {
    const width = 384; // 48 byte/hàng
    const out = cmdRaster(new Uint8Array(width), width, 1);
    expect(out[4]).toBe(48);
    expect(out[5]).toBe(0);
  });

  it('từ chối chiều rộng không chia hết cho 8', () => {
    expect(() => cmdRaster(new Uint8Array(9), 9, 1)).toThrow(/chia hết cho 8/);
  });

  it('từ chối khi số chấm không khớp kích thước', () => {
    expect(() => cmdRaster(new Uint8Array(7), 8, 1)).toThrow(/không khớp/);
  });
});

describe('dotsForPaperWidth', () => {
  it('58mm → 384 chấm, 80mm → 576 chấm', () => {
    expect(dotsForPaperWidth(58)).toBe(DOTS_58MM);
    expect(dotsForPaperWidth(80)).toBe(DOTS_80MM);
  });

  it('cả hai khổ đều chia hết cho 8 — bắt buộc để đóng gói raster', () => {
    expect(DOTS_58MM % 8).toBe(0);
    expect(DOTS_80MM % 8).toBe(0);
  });

  it('giá trị lạ rơi về 80 — sai theo hướng TRÀN LỀ để người ta nhìn ra ngay', () => {
    expect(dotsForPaperWidth(0)).toBe(DOTS_80MM);
    expect(dotsForPaperWidth(57)).toBe(DOTS_80MM);
  });
});

describe('parseStatus — đọc byte trạng thái máy in', () => {
  // Byte trạng thái ESC/POS luôn có bit1 = 1, bit0 = 0 (0b……10).
  const BASE = 0b00010010;

  it('máy khoẻ thì không cờ nào bật', () => {
    expect(parseStatus(BASE, BASE)).toEqual({
      coverOpen: false,
      paperOut: false,
      paperNearEnd: false,
      error: false,
    });
  });

  it('nhận ra nắp máy đang mở', () => {
    expect(parseStatus(BASE | 0x04, BASE).coverOpen).toBe(true);
  });

  it('nhận ra hết giấy từ cảm biến giấy', () => {
    expect(parseStatus(BASE, BASE | 0x60).paperOut).toBe(true);
  });

  it('nhận ra hết giấy từ byte offline', () => {
    expect(parseStatus(BASE | 0x20, BASE).paperOut).toBe(true);
  });

  it('phân biệt SẮP hết giấy với ĐÃ hết giấy', () => {
    const s = parseStatus(BASE, BASE | 0x0c);
    expect(s.paperNearEnd).toBe(true);
    expect(s.paperOut).toBe(false);
  });

  it('máy câm lặng (null) được coi là bình thường, không chặn in', () => {
    const s = parseStatus(null, null);
    expect(describeBlockingStatus(s)).toBeNull();
  });

  it('bỏ qua byte rác không phải byte trạng thái', () => {
    // 0xFF có bit0 = 1 → không phải byte trạng thái hợp lệ, phải bị bỏ qua thay vì
    // bật sạch mọi cờ và làm máy in khoẻ bị báo hỏng.
    expect(parseStatus(0xff, 0xff)).toEqual({
      coverOpen: false,
      paperOut: false,
      paperNearEnd: false,
      error: false,
    });
  });
});

describe('describeBlockingStatus', () => {
  const mk = (p: Partial<ReturnType<typeof parseStatus>>) => ({
    coverOpen: false,
    paperOut: false,
    paperNearEnd: false,
    error: false,
    ...p,
  });

  it('sắp hết giấy KHÔNG chặn in', () => {
    expect(describeBlockingStatus(mk({ paperNearEnd: true }))).toBeNull();
  });

  it('hết giấy thì chặn', () => {
    expect(describeBlockingStatus(mk({ paperOut: true }))).toMatch(/hết giấy/);
  });

  it('nắp mở được báo trước cả hết giấy — đó là thứ người ta sửa được ngay', () => {
    expect(describeBlockingStatus(mk({ coverOpen: true, paperOut: true }))).toMatch(/nắp/i);
  });
});

describe('buildJob', () => {
  const mono = new Uint8Array(8);

  it('luôn mở đầu bằng ESC @ để xoá trạng thái còn sót của job trước', () => {
    const job = buildJob(mono, 8, 1, { autoCut: false });
    expect(job.subarray(0, 2)).toEqual(cmdInit());
  });

  it('bật cắt thì kết thúc bằng lệnh cắt', () => {
    const job = buildJob(mono, 8, 1, { autoCut: true, feedLines: 3 });
    expect(job.subarray(job.length - 4)).toEqual(cmdCut(3));
  });

  it('tắt cắt thì vẫn đẩy giấy — nếu không mép dưới còn kẹt trong máy', () => {
    const job = buildJob(mono, 8, 1, { autoCut: false, feedLines: 4 });
    expect(job.subarray(job.length - 3)).toEqual(cmdFeed(4));
  });
});
