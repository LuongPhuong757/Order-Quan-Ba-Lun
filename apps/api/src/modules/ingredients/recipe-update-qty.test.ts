// Sửa định lượng một dòng công thức tại chỗ (`PATCH /recipes/lines/:id`, góp ý 2026-11-11: trước
// muốn đổi 500g thành 400g phải xoá dòng rồi nhập lại).
//
// Canh 3 điều: quy về đơn vị GỐC như lúc thêm dòng (0,4kg → 400 g), chặn đơn vị lệch nhóm (ml cho
// thứ đo bằng g), và không đụng nguyên liệu / NCC của dòng. Repo giả — không đụng DB.
import { describe, it, expect, vi } from 'vitest';
import { RecipesService } from './recipes.service.js';

function dung(line: Record<string, unknown> | null, ingredient: Record<string, unknown> | null) {
  const save = vi.fn(async (l: unknown) => l);
  const repo = { findOne: vi.fn(async () => line), save };
  const ingredientRepo = { findOne: vi.fn(async () => ingredient) };
  const ds = { getRepository: () => ({ find: vi.fn(async () => [{ id: 'sup-1', name: 'NCC A' }]) }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new RecipesService(repo as any, ingredientRepo as any, {} as any, {} as any, ds as any);
  return { svc, save };
}

const thit = { id: 'ing-1', name: 'Thịt bò', unit: 'g' };

describe('sửa định lượng một dòng công thức', () => {
  it('nhập kg cho nguyên liệu đo bằng g thì lưu theo g', async () => {
    const line = { id: 'l-1', ingredient_id: 'ing-1', supplier_id: 'sup-1', qty_per_serving: '500' };
    const { svc, save } = dung(line, thit);
    const v = await svc.updateQty('l-1', 0.4, 'kg');
    expect(v.qty_per_serving).toBe(400);
    expect(save).toHaveBeenCalledOnce();
    expect(line.qty_per_serving).toBe('400');
    // Không đổi nguyên liệu / NCC của dòng.
    expect(v.ingredient_id).toBe('ing-1');
    expect(v.supplier_id).toBe('sup-1');
  });

  it('đơn vị lệch nhóm bị chặn, không ghi gì', async () => {
    const line = { id: 'l-1', ingredient_id: 'ing-1', supplier_id: null, qty_per_serving: '500' };
    const { svc, save } = dung(line, thit);
    await expect(svc.updateQty('l-1', 1, 'ml')).rejects.toMatchObject({ response: { code: 'UNIT_MISMATCH' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('định lượng 0 hoặc âm bị chặn', async () => {
    const { svc, save } = dung({ id: 'l-1', ingredient_id: 'ing-1', supplier_id: null, qty_per_serving: '1' }, thit);
    await expect(svc.updateQty('l-1', 0, 'g')).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('dòng không tồn tại thì báo không tìm thấy', async () => {
    const { svc } = dung(null, thit);
    await expect(svc.updateQty('x', 1, 'g')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });
});
