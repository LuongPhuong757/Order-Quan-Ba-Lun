import { describe, expect, it } from 'vitest';
import { buildBodyRows, templateFilename, type TemplateItem } from './invoice-template.ts';

const item = (name: string, p: Partial<TemplateItem> = {}): TemplateItem => ({
  ingredient_id: name,
  ingredient_name: name,
  purchase_unit: 'kg',
  times: 1,
  last_delivery_date: '2026-10-01',
  hidden: false,
  is_new: false,
  ...p,
});

describe('buildBodyRows', () => {
  it('bỏ món đã tắt, giữ thứ tự, ba cột cuối để trống cho NCC điền', () => {
    const rows = buildBodyRows(
      [item('Thịt ba chỉ'), item('Hành', { hidden: true }), item('Bia', { purchase_unit: 'thùng' })],
      0,
    );
    expect(rows).toEqual([
      ['1', 'Thịt ba chỉ', 'KG', '', '', ''],
      ['2', 'Bia', 'THÙNG', '', '', ''],
    ]);
  });

  it('dòng trống nối tiếp STT của danh sách', () => {
    const rows = buildBodyRows([item('A'), item('B')], 3);
    expect(rows).toHaveLength(5);
    expect(rows.slice(2).map((r) => r[0])).toEqual(['3', '4', '5']);
    expect(rows[4].slice(1).every((c) => c === '')).toBe(true);
  });

  it('mặc định chừa 10 dòng trống', () => {
    expect(buildBodyRows([])).toHaveLength(10);
  });
});

describe('templateFilename', () => {
  it('bỏ dấu tiếng Việt, kể cả chữ đ', () => {
    expect(templateFilename('Chị Đào — Rau củ', 'xlsx')).toBe('mau-hoa-don-chi-dao-rau-cu.xlsx');
  });

  it('tên toàn ký tự lạ vẫn ra tên file dùng được', () => {
    expect(templateFilename('***', 'csv')).toBe('mau-hoa-don-ncc.csv');
  });
});
