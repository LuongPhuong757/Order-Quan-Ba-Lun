// Quản lý nhà cung cấp + bảng giá mặt hàng của từng NCC (2026-09-05).
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity.js';
import { SupplierItem } from './entities/supplier-item.entity.js';
import { SupplierDelivery } from './entities/supplier-delivery.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';
import { normalizeName } from '../ingredients/ingredient-units.js';

/** NCC kèm số liệu kỳ đang xem — đúng những cột tab "Nhà cung cấp" hiển thị (mục 3 của spec). */
export type SupplierWithStats = Supplier & {
  /** Tổng tiền các phiếu ĐÃ DUYỆT trong kỳ (M3.D-41). */
  period_amount: number;
  period_deliveries: number;
  /** 'YYYY-MM-DD' của lần giao gần nhất, bất kể kỳ. NULL khi chưa từng giao. */
  last_delivery_date: string | null;
};

/** Một dòng trong bảng giá mặt hàng của NCC (mục 3.2). */
export type SupplierItemRow = {
  ingredient_id: string;
  ingredient_name: string;
  /** Đơn vị GỐC của nguyên liệu (g/ml/bó...) — mẫu số của `last_unit_price_base`. */
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  last_unit_price: number;
  last_unit_price_base: string;
  last_delivery_date: string;
};

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier) private readonly repo: Repository<Supplier>,
    @InjectRepository(SupplierItem) private readonly itemRepo: Repository<SupplierItem>,
    @InjectRepository(SupplierDelivery) private readonly deliveryRepo: Repository<SupplierDelivery>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
  ) {}

  /** Danh sách NCC + số liệu kỳ. `from`/`to` dạng 'YYYY-MM-DD', bao gồm cả hai đầu.
   *
   * Gộp bằng HAI câu GROUP BY rồi ghép trong bộ nhớ, không truy vấn lẻ từng NCC: 30 NCC mà đếm
   * lẻ là 60 lượt truy vấn cho một lần mở màn hình. Cùng cách làm với `IngredientsService.list`.
   */
  async list(opts: { from?: string; to?: string; include_inactive?: boolean } = {}): Promise<SupplierWithStats[]> {
    const qb = this.repo.createQueryBuilder('s');
    if (!opts.include_inactive) qb.where('s.is_active = 1');
    const suppliers = await qb.orderBy('s.name', 'ASC').getMany();
    if (suppliers.length === 0) return [];
    const ids = suppliers.map((s) => s.id);

    const periodQb = this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.supplier_id', 'supplier_id')
      .addSelect('SUM(d.total_amount)', 'amount')
      .addSelect('COUNT(*)', 'cnt')
      .where('d.supplier_id IN (:...ids)', { ids })
      // Chỉ phiếu đã duyệt vào số liệu tiền (M3.D-41) — phiếu NCC gửi mà quán chưa kiểm không
      // được phép làm phồng con số "tháng này mua của ai bao nhiêu".
      .andWhere("d.status = 'CONFIRMED'");
    if (opts.from) periodQb.andWhere('d.delivery_date >= :from', { from: opts.from });
    if (opts.to) periodQb.andWhere('d.delivery_date <= :to', { to: opts.to });
    const periodRows = await periodQb
      .groupBy('d.supplier_id')
      .getRawMany<{ supplier_id: string; amount: string | null; cnt: string }>();
    const period = new Map(periodRows.map((r) => [r.supplier_id, r]));

    // Lần giao gần nhất KHÔNG lọc theo kỳ: câu hỏi "NCC này lâu rồi không giao à" chỉ trả lời
    // được khi nhìn toàn bộ lịch sử, không phải nhìn tháng đang xem.
    const lastRows = await this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.supplier_id', 'supplier_id')
      .addSelect('MAX(d.delivery_date)', 'last_date')
      .where('d.supplier_id IN (:...ids)', { ids })
      .andWhere("d.status = 'CONFIRMED'")
      .groupBy('d.supplier_id')
      .getRawMany<{ supplier_id: string; last_date: string | Date | null }>();
    const last = new Map(lastRows.map((r) => [r.supplier_id, r.last_date]));

    return suppliers.map((s) => ({
      ...s,
      period_amount: Number(period.get(s.id)?.amount ?? 0),
      period_deliveries: Number(period.get(s.id)?.cnt ?? 0),
      last_delivery_date: toDateString(last.get(s.id) ?? null),
    }));
  }

  async get(id: string): Promise<Supplier> {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });
    return s;
  }

  /** Tạo NCC.
   *
   * `opening_*` chỉ được ghi khi người tạo là CHỦ QUÁN (M3.D-40) — controller đã chặn, ở đây
   * nhận `is_owner` để chặn lần nữa. Cho nhập ngay lúc tạo là vì đó đúng là lúc chủ quán đang
   * cầm sổ đối chiếu với NCC; bắt tạo xong rồi mở chi tiết ra đặt tiếp là ba bước, và bước cuối
   * rất dễ quên — quên thì công nợ của NCC đó âm thầm tính từ 0.
   */
  async create(input: {
    name: string;
    phone?: string;
    note?: string | null;
    opening_balance?: number;
    opening_balance_date?: string | null;
    opening_balance_note?: string | null;
    is_owner?: boolean;
  }): Promise<Supplier> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Tên nhà cung cấp trống' });
    const name_key = normalizeName(name);

    const existing = await this.repo.findOne({ where: { name_key } });
    if (existing) {
      // NCC đã ngừng hợp tác rồi quay lại thì HỒI SINH dòng cũ, giữ nguyên lịch sử giá và phiếu
      // nhập của họ. Tạo dòng mới sẽ xẻ đôi lịch sử của cùng một người. Cùng cách xử lý với
      // `IngredientsService.create`.
      if (!existing.is_active) {
        existing.is_active = true;
        if (input.phone !== undefined) existing.phone = input.phone.trim();
        if (input.note !== undefined) existing.note = input.note?.trim() || null;
        return this.repo.save(existing);
      }
      throw new ConflictException({
        code: 'SUPPLIER_EXISTS',
        message: `Nhà cung cấp "${existing.name}" đã có trong danh sách`,
      });
    }

    // Số dư đầu kỳ chỉ ghi khi CHỦ QUÁN tạo. Admin thường tạo NCC thì bỏ qua ba trường này chứ
    // không ném lỗi: họ vẫn nên tạo được NCC, chỉ là phần tiền để chủ quán đặt sau.
    const opening = input.is_owner
      ? {
          opening_balance: Math.max(0, Math.round(input.opening_balance ?? 0)),
          opening_balance_date: input.opening_balance_date || null,
          opening_balance_note: input.opening_balance_note?.trim() || null,
        }
      : {};

    return this.repo.save(
      this.repo.create({
        name,
        name_key,
        phone: input.phone?.trim() || '',
        note: input.note?.trim() || null,
        is_active: true,
        ...opening,
      }),
    );
  }

  async update(
    id: string,
    input: { name?: string; phone?: string; note?: string | null },
  ): Promise<Supplier> {
    const s = await this.get(id);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Tên nhà cung cấp trống' });
      const key = normalizeName(name);
      if (key !== s.name_key) {
        const clash = await this.repo.findOne({ where: { name_key: key } });
        if (clash) {
          throw new ConflictException({
            code: 'SUPPLIER_EXISTS',
            message: `Đã có nhà cung cấp "${clash.name}"`,
          });
        }
      }
      s.name = name;
      s.name_key = key;
    }
    if (input.phone !== undefined) s.phone = input.phone.trim();
    if (input.note !== undefined) s.note = input.note?.trim() || null;
    return this.repo.save(s);
  }

  /** Xoá mềm. Chặn khi đã có phiếu nhập — NCC có lịch sử giao dịch mà biến mất khỏi danh sách
   * thì các phiếu cũ mồ côi, và tổng mua theo kỳ hụt đi mà không ai biết vì sao. */
  async remove(id: string): Promise<void> {
    const s = await this.get(id);
    const count = await this.deliveryRepo.count({ where: { supplier_id: id } });
    if (count > 0) {
      throw new ConflictException({
        code: 'SUPPLIER_IN_USE',
        message: `"${s.name}" đã có ${count} phiếu nhập — không xoá được, dữ liệu lịch sử sẽ mồ côi`,
      });
    }
    s.is_active = false;
    await this.repo.save(s);
  }

  /** Bảng giá mặt hàng của một NCC (mục 3.2) — tự sinh từ lịch sử nhập (M3.D-18).
   *
   * Đây cũng là nguồn để màn nhập phiếu điền sẵn đơn vị mua + giá lần trước (M3.D-20).
   */
  async items(supplier_id: string): Promise<SupplierItemRow[]> {
    await this.get(supplier_id);
    const items = await this.itemRepo.find({
      where: { supplier_id },
      order: { last_delivery_date: 'DESC' },
    });
    if (items.length === 0) return [];

    const ingredients = await this.ingredientRepo.find({
      where: { id: In(items.map((i) => i.ingredient_id)) },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));

    return items
      .map((it) => {
        const ing = byId.get(it.ingredient_id);
        // Nguyên liệu bị gộp đi thì bản ghi cấu hình này trỏ vào dòng đã ẩn. Bỏ qua thay vì hiện
        // dòng trống — bảng giá là thứ chủ quán nhìn trước khi gọi điện đặt hàng, không phải chỗ
        // để lộ rác dữ liệu.
        if (!ing) return null;
        return {
          ingredient_id: it.ingredient_id,
          ingredient_name: ing.name,
          base_unit: ing.unit,
          purchase_unit: it.purchase_unit,
          qty_base_per_unit: it.qty_base_per_unit,
          last_unit_price: it.last_unit_price,
          last_unit_price_base: it.last_unit_price_base,
          last_delivery_date: toDateString(it.last_delivery_date) ?? '',
        };
      })
      .filter((r): r is SupplierItemRow => r !== null);
  }
}

/** MySQL trả cột DATE lúc là `Date`, lúc là string tuỳ driver/hàm gộp. Ép về 'YYYY-MM-DD' một
 * chỗ để phía web không phải đoán. */
export function toDateString(v: string | Date | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  // `toISOString` là UTC; cột DATE không có giờ nên không lệch ngày.
  return v.toISOString().slice(0, 10);
}
