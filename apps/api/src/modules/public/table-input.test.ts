import { describe, expect, it } from 'vitest';
import { digitsOf, matchTableByInput, type TableLike } from './table-input.js';

// M7.D-02 — khách GÕ số bàn. Chuỗi khách gõ là dữ liệu bẩn nhất của cả milestone:
// gõ vội, gõ hoa, gõ kèm chữ "bàn", gõ số 0 đứng đầu theo đúng số dán trên bàn.
// M7.D-19/R1 — gõ nhầm bàn là rủi ro CAO không phát hiện tự động được, nên hàm này
// thà trả NONE còn hơn đoán bừa ra một bàn.

const t = (id: string, code: string, over: Partial<TableLike> = {}): TableLike => ({
  id,
  code,
  name: `Bàn ${code}`,
  kind: 'dine-in',
  is_active: true,
  ...over,
});

const TABLES: TableLike[] = [t('t1', 'B01'), t('t5', 'B05'), t('t12', 'B12')];

describe('digitsOf — rút chữ số khỏi chuỗi khách gõ', () => {
  it('giữ đúng các chữ số, bỏ mọi thứ khác', () => {
    expect(digitsOf('bàn 5')).toBe('5');
    expect(digitsOf('B05')).toBe('05');
    expect(digitsOf('  Bàn  12  ')).toBe('12');
  });

  it('chuỗi không có chữ số nào trả chuỗi rỗng', () => {
    expect(digitsOf('bàn')).toBe('');
    expect(digitsOf('')).toBe('');
  });
});

describe('matchTableByInput — các cách khách gõ cùng một bàn', () => {
  it('"5", "05", "bàn 5", " Bàn  5 " đều ra bàn B05', () => {
    for (const input of ['5', '05', 'bàn 5', ' Bàn  5 ', 'B05', 'b5']) {
      const r = matchTableByInput(input, TABLES);
      expect(r.kind, `input=${JSON.stringify(input)}`).toBe('ONE');
      if (r.kind === 'ONE') expect(r.table.id).toBe('t5');
    }
  });

  it('số 0 đứng đầu không làm lệch kết quả: "01" ra bàn B01', () => {
    const r = matchTableByInput('01', TABLES);
    expect(r.kind).toBe('ONE');
    if (r.kind === 'ONE') expect(r.table.id).toBe('t1');
  });
});

describe('matchTableByInput — từ chối thay vì đoán bừa (R1)', () => {
  it('không bàn nào khớp → NONE', () => {
    expect(matchTableByInput('99', TABLES).kind).toBe('NONE');
  });

  it('chuỗi không có chữ số → NONE', () => {
    expect(matchTableByInput('bàn', TABLES).kind).toBe('NONE');
    expect(matchTableByInput('', TABLES).kind).toBe('NONE');
  });

  it('chuỗi dài quá 16 ký tự → NONE, không phân tích gì thêm', () => {
    expect(matchTableByInput('5'.repeat(17), TABLES).kind).toBe('NONE');
  });

  it('hai bàn cùng ra một số → AMBIGUOUS, KHÔNG tự chọn cái đầu', () => {
    const dup = [...TABLES, t('tA', 'A5')];
    const r = matchTableByInput('5', dup);
    expect(r.kind).toBe('AMBIGUOUS');
    if (r.kind === 'AMBIGUOUS') expect(r.tables.map((x) => x.id).sort()).toEqual(['t5', 'tA']);
  });
});

describe('matchTableByInput — chỉ bàn ăn tại quán mới gọi được', () => {
  it('bàn takeaway / delivery không bao giờ khớp', () => {
    const tables = [t('tk', 'B07', { kind: 'takeaway' }), t('dl', 'B08', { kind: 'delivery' })];
    expect(matchTableByInput('7', tables).kind).toBe('NONE');
    expect(matchTableByInput('8', tables).kind).toBe('NONE');
  });

  it('bàn đã tắt (is_active=false) không bao giờ khớp', () => {
    const tables = [t('off', 'B09', { is_active: false })];
    expect(matchTableByInput('9', tables).kind).toBe('NONE');
  });

  it('bàn tắt không làm một bàn hợp lệ trùng số thành AMBIGUOUS', () => {
    const tables = [t('ok', 'B05'), t('off', 'A5', { is_active: false })];
    const r = matchTableByInput('5', tables);
    expect(r.kind).toBe('ONE');
    if (r.kind === 'ONE') expect(r.table.id).toBe('ok');
  });
});
