// Đăng nhập NCC: khoá sau nhiều lần sai, phiên trượt, reset PIN thu hồi phiên (M3.D-02, 03, 04).
//
// Dùng repository giả trong RAM thay vì MySQL — logic cần kiểm ở đây là ĐẾM SAI và THU HỒI
// PHIÊN, không phải SQL. Chạy được cả khi máy chưa dựng DB.
import { describe, expect, it, vi } from 'vitest';
import { SupplierAuthService } from './supplier-auth.service.js';

// bcrypt là native module; băm thật ở đây chỉ làm test chậm và bắt phải build binary. Thứ cần
// kiểm là MÁY TRẠNG THÁI khoá tài khoản và vòng đời phiên — không phải thuật toán băm.
vi.mock('bcrypt', () => ({
  default: {
    hash: async (v: string) => `hashed:${v}`,
    compare: async (v: string, h: string) => `hashed:${v}` === h,
  },
}));

const bcrypt = { hash: async (v: string) => `hashed:${v}` };

type Row = Record<string, unknown>;

/** Repository giả: đủ `findOne` / `save` / `update` / `count` cho service này dùng. */
function fakeRepo(rows: Row[] = []) {
  const match = (r: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      // `IsNull()` của TypeORM là object có `@instanceof` — ở đây chỉ cần biết "cột này phải null".
      if (v && typeof v === 'object' && '_type' in (v as Row)) return r[k] === null || r[k] === undefined;
      return r[k] === v;
    });
  return {
    rows,
    async findOne({ where }: { where: Row }) {
      return rows.find((r) => match(r, where)) ?? null;
    },
    create(v: Row) {
      return { id: `id-${rows.length + 1}`, ...v };
    },
    async save(v: Row) {
      const i = rows.findIndex((r) => r.id === v.id);
      // Ghi TẠI CHỖ, không thay bằng object mới: TypeORM thật trả về cùng một thực thể cho mỗi
      // lần đọc trong một luồng, và test giữ tham chiếu để soi trạng thái. Thay object là làm
      // tham chiếu đó thành bản cũ, rồi test đọc ra số liệu đứng im.
      if (i >= 0) Object.assign(rows[i], v);
      else rows.push(v);
      return v;
    },
    async update(where: Row, patch: Row) {
      for (const r of rows) if (match(r, where)) Object.assign(r, patch);
    },
    async count() {
      return rows.length;
    },
  };
}

const NOW = 1_800_000_000_000;

async function build(pin = '123456') {
  const supplier = { id: 'sup-1', name: 'Chị Tư rau', is_active: true, phone: '' };
  const user = {
    id: 'su-1',
    supplier_id: 'sup-1',
    phone: '0901234567',
    pin_hash: await bcrypt.hash(pin),
    failed_attempts: 0,
    locked_until: null as number | null,
    is_active: true,
  };
  const supplierRepo = fakeRepo([supplier]);
  const userRepo = fakeRepo([user]);
  const sessionRepo = fakeRepo([]);
  const svc = new SupplierAuthService(
    supplierRepo as never,
    userRepo as never,
    sessionRepo as never,
  );
  return { svc, supplier, user, sessionRepo, userRepo };
}

describe('login — khoá sau 5 lần sai (M3.D-04)', () => {
  it('vào đúng thì cấp phiên và reset bộ đếm', async () => {
    const { svc, user, sessionRepo } = await build();
    user.failed_attempts = 3;
    const out = await svc.login('0901234567', '123456', NOW);
    expect(out.token).toHaveLength(64);
    expect(out.supplier_name).toBe('Chị Tư rau');
    expect(user.failed_attempts).toBe(0);
    expect(sessionRepo.rows).toHaveLength(1);
  });

  it('chuẩn hoá SĐT — gõ +84 hay 0 đều vào được cùng tài khoản', async () => {
    const { svc } = await build();
    await expect(svc.login('+84901234567', '123456', NOW)).resolves.toBeTruthy();
  });

  it('sai PIN thì tăng bộ đếm, đủ 5 lần thì khoá 15 phút', async () => {
    const { svc, user } = await build();
    for (let i = 0; i < 4; i++) {
      await expect(svc.login('0901234567', '000000', NOW)).rejects.toThrow();
    }
    expect(user.failed_attempts).toBe(4);
    expect(user.locked_until).toBeNull();

    await expect(svc.login('0901234567', '000000', NOW)).rejects.toThrow();
    expect(user.locked_until).toBe(NOW + 15 * 60_000);
  });

  it('đang khoá thì PIN ĐÚNG cũng không vào được, và báo còn bao nhiêu phút', async () => {
    const { svc, user } = await build();
    user.locked_until = NOW + 5 * 60_000;
    await expect(svc.login('0901234567', '123456', NOW)).rejects.toThrow(/5 phút/);
  });

  it('hết hạn khoá thì vào lại bình thường', async () => {
    const { svc, user } = await build();
    user.locked_until = NOW - 1;
    await expect(svc.login('0901234567', '123456', NOW)).resolves.toBeTruthy();
  });

  it('số không tồn tại báo GIỐNG HỆT sai PIN — không tiết lộ số nào có tài khoản', async () => {
    const { svc } = await build();
    const a = await svc.login('0999999999', '123456', NOW).catch((e) => e.getResponse());
    const b = await svc.login('0901234567', '000000', NOW).catch((e) => e.getResponse());
    expect(a.message).toBe(b.message);
    expect(a.code).toBe(b.code);
  });

  it('tài khoản bị tắt thì không vào được', async () => {
    const { svc, user } = await build();
    user.is_active = false;
    await expect(svc.login('0901234567', '123456', NOW)).rejects.toThrow();
  });
});

describe('phiên (M3.D-02)', () => {
  it('phiên còn hạn tra ra đúng NCC', async () => {
    const { svc } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);
    const p = await svc.resolveSession(token, NOW + 1000);
    expect(p?.supplier_id).toBe('sup-1');
  });

  it('phiên hết hạn thì không tra ra', async () => {
    const { svc } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);
    expect(await svc.resolveSession(token, NOW + 91 * 24 * 3600_000)).toBeNull();
  });

  it('gia hạn TRƯỢT: dùng tới đâu đẩy hạn tới đó', async () => {
    const { svc, sessionRepo } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);
    const before = sessionRepo.rows[0].expires_at as number;
    await svc.touch(token, NOW + 30 * 24 * 3600_000);
    expect(sessionRepo.rows[0].expires_at as number).toBeGreaterThan(before);
  });

  it('logout giết phiên ngay', async () => {
    const { svc } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);
    await svc.logout(token, NOW);
    expect(await svc.resolveSession(token, NOW + 1000)).toBeNull();
  });

  it('NCC bị vô hiệu hoá thì phiên đang mở chết theo', async () => {
    const { svc, supplier } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);
    supplier.is_active = false;
    expect(await svc.resolveSession(token, NOW + 1000)).toBeNull();
  });
});

describe('cấp / đặt lại PIN (M3.D-03)', () => {
  it('sinh PIN 6 chữ số và THU HỒI mọi phiên đang mở', async () => {
    // Đặt lại mà không thu hồi phiên thì người vừa bị lấy lại quyền vẫn còn đăng nhập trên máy
    // cũ — việc đặt lại thành vô nghĩa.
    const { svc } = await build();
    const { token } = await svc.login('0901234567', '123456', NOW);

    const issued = await svc.issueAccount('sup-1', '0901234567', NOW);
    expect(issued.pin).toMatch(/^\d{6}$/);
    expect(await svc.resolveSession(token, NOW + 1000)).toBeNull();

    await expect(svc.login('0901234567', issued.pin, NOW)).resolves.toBeTruthy();
    await expect(svc.login('0901234567', '123456', NOW)).rejects.toThrow();
  });

  it('gỡ khoá luôn khi đặt lại — NCC bị khoá gọi điện là để được vào lại ngay', async () => {
    const { svc, user } = await build();
    user.locked_until = NOW + 10 * 60_000;
    const issued = await svc.issueAccount('sup-1', '0901234567', NOW);
    await expect(svc.login('0901234567', issued.pin, NOW)).resolves.toBeTruthy();
  });

  it('không cho hai NCC dùng chung một số điện thoại', async () => {
    const { svc, userRepo } = await build();
    userRepo.rows.push({
      id: 'su-2',
      supplier_id: 'sup-2',
      phone: '0907777777',
      pin_hash: 'x',
      failed_attempts: 0,
      locked_until: null,
      is_active: true,
    });
    await expect(svc.issueAccount('sup-1', '0907777777', NOW)).rejects.toThrow(/nhà cung cấp khác/);
  });

  it('không trả PIN qua đường xem trạng thái', async () => {
    const { svc } = await build();
    const st = await svc.accountStatus('sup-1', NOW);
    expect(JSON.stringify(st)).not.toContain('pin_hash');
    expect(st).not.toHaveProperty('pin');
  });
});
