// Báo cáo giá & mặt hàng nhập (2026-09-05, bước 2 của Milestone 3).
//
// Ba màn của mục 4 và bảng thống kê ở mục 3.3 đều đọc từ `supplier_delivery_lines` — bảng đó là
// nguồn duy nhất, và mọi con số so sánh đều là `unit_price_base` (đồng/đơn vị gốc). Không màn
// nào được phép so trên `unit_price`: NCC đổi đơn vị báo giá hoặc đổi cỡ đóng gói là hai chuyện
// xảy ra thật, và cả hai làm `unit_price` mất tính so sánh (M3.D-36, 37).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SupplierDeliveryLine } from './entities/supplier-delivery-line.entity.js';
import { SupplierItem } from './entities/supplier-item.entity.js';
import { RecipeLine } from '../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { computeFoodCost, ingredientPrices, type FoodCostRow } from './food-cost.js';
import {
  aggregateByPair,
  buildPriceMatrix,
  type MatrixRow,
  type PairReport,
  type ReportLine,
} from './price-report.js';

/** Một lần nhập trong lịch sử giá của một mặt hàng (mục 4.3). */
export type PricePoint = {
  delivery_id: string;
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  purchase_unit: string;
  qty_purchase: string;
  unit_price: number;
  unit_price_base: number;
  created_by_name: string;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(SupplierDeliveryLine) private readonly lineRepo: Repository<SupplierDeliveryLine>,
    @InjectRepository(SupplierItem) private readonly itemRepo: Repository<SupplierItem>,
    @InjectRepository(RecipeLine) private readonly recipeRepo: Repository<RecipeLine>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
  ) {}

  /** Giá vốn từng món theo giá nguyên liệu đang mua (bước 5).
   *
   * `windowDays` là cửa sổ lấy bình quân giá — mặc định 90 ngày. Ngắn quá thì một đợt hàng đắt
   * kéo lệch cả bảng; dài quá thì giá vốn phản ánh chuyện của quý trước.
   */
  async foodCost(windowDays = 90): Promise<{ from: string; rows: FoodCostRow[] }> {
    const from = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

    const [recipeLines, purchases, fallback] = await Promise.all([
      this.recipeRepo.find(),
      this.lineRepo
        .createQueryBuilder('l')
        .innerJoin('supplier_deliveries', 'd', 'd.id = l.delivery_id')
        .select('l.ingredient_id', 'ingredient_id')
        .addSelect('SUM(l.qty_base)', 'qty_base')
        .addSelect('SUM(l.amount)', 'amount')
        // Chỉ phiếu ĐÃ DUYỆT (M3.D-41) — giá vốn không được tính theo số NCC tự khai mà quán
        // chưa kiểm.
        .where("d.status = 'CONFIRMED'")
        .andWhere('d.delivery_date >= :from', { from })
        .groupBy('l.ingredient_id')
        .getRawMany<{ ingredient_id: string; qty_base: string; amount: string }>(),
      this.itemRepo
        .createQueryBuilder('si')
        .select('si.ingredient_id', 'ingredient_id')
        // Một nguyên liệu có thể mua từ nhiều NCC; lấy giá RẺ NHẤT đang biết làm giá dự phòng —
        // đó là mức quán thật sự mua được nếu cần đặt lại hôm nay.
        .addSelect('MIN(si.last_unit_price_base)', 'unit_price_base')
        .groupBy('si.ingredient_id')
        .getRawMany<{ ingredient_id: string; unit_price_base: string }>(),
    ]);

    if (recipeLines.length === 0) return { from, rows: [] };

    const ingIds = [...new Set(recipeLines.map((r) => r.ingredient_id))];
    const itemIds = [...new Set(recipeLines.map((r) => r.menu_item_id))];
    const [ingredients, menuItems] = await Promise.all([
      this.ingredientRepo.find({ where: { id: In(ingIds) } }),
      this.menuRepo.find({ where: { id: In(itemIds) } }),
    ]);
    const ingById = new Map(ingredients.map((i) => [i.id, i]));

    const prices = ingredientPrices(
      purchases.map((p) => ({
        ingredient_id: p.ingredient_id,
        qty_base: Number(p.qty_base),
        amount: Number(p.amount),
      })),
      fallback.map((f) => ({
        ingredient_id: f.ingredient_id,
        unit_price_base: Number(f.unit_price_base),
      })),
    );

    const rows = computeFoodCost(
      menuItems
        // Món đã xoá mềm thì không còn bán — để lại chỉ làm bảng dài ra.
        .filter((m) => m.is_active)
        .map((m) => ({ id: m.id, name: m.name, price: m.price })),
      recipeLines
        .filter((r) => ingById.has(r.ingredient_id))
        .map((r) => ({
          menu_item_id: r.menu_item_id,
          ingredient_id: r.ingredient_id,
          ingredient_name: ingById.get(r.ingredient_id)!.name,
          base_unit: ingById.get(r.ingredient_id)!.unit,
          qty_per_serving: Number(r.qty_per_serving),
        })),
      prices,
    );

    return { from, rows };
  }

  /** Số liệu theo cặp (NCC, mặt hàng) trong kỳ — nguồn chung của mục 4.1 và 3.3.
   *
   * Một truy vấn phẳng rồi gộp trong bộ nhớ, không GROUP BY dưới SQL: `prev_base` phải lấy từ
   * dòng ĐẦU TIÊN của kỳ và `last_base` từ dòng CUỐI, thứ mà GROUP BY thuần không cho được nếu
   * không viết window function. Quy mô ở đây là một quán ăn — vài trăm tới vài nghìn dòng mỗi
   * tháng, gộp trong RAM rẻ hơn nhiều so với một câu SQL không ai đọc nổi.
   */
  async pairs(opts: { from: string; to: string; supplier_id?: string }): Promise<PairReport[]> {
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('supplier_deliveries', 'd', 'd.id = l.delivery_id')
      .innerJoin('suppliers', 's', 's.id = d.supplier_id')
      .select([
        'd.supplier_id AS supplier_id',
        's.name AS supplier_name',
        'l.ingredient_id AS ingredient_id',
        'l.ingredient_name_snapshot AS ingredient_name',
        'l.unit_snapshot AS base_unit',
        'l.purchase_unit_snapshot AS purchase_unit',
        'd.delivery_date AS delivery_date',
        'l.created_at AS created_at',
        'l.qty_base AS qty_base',
        'l.amount AS amount',
        'l.unit_price AS unit_price',
        'l.unit_price_base AS unit_price_base',
        'l.prev_unit_price_base AS prev_unit_price_base',
      ])
      // Chỉ phiếu ĐÃ DUYỆT (M3.D-41) — phiếu NCC gửi mà quán chưa kiểm không được làm lệch báo
      // cáo giá, đúng cùng nguyên tắc với tổng mua theo kỳ.
      .where("d.status = 'CONFIRMED'")
      .andWhere('d.delivery_date >= :from', { from: opts.from })
      .andWhere('d.delivery_date <= :to', { to: opts.to });
    if (opts.supplier_id) qb.andWhere('d.supplier_id = :sid', { sid: opts.supplier_id });

    const raw = await qb.getRawMany<Record<string, unknown>>();
    const lines: ReportLine[] = raw.map((r) => ({
      supplier_id: String(r.supplier_id),
      supplier_name: String(r.supplier_name),
      ingredient_id: String(r.ingredient_id),
      ingredient_name: String(r.ingredient_name),
      base_unit: String(r.base_unit),
      purchase_unit: String(r.purchase_unit),
      delivery_date: dateStr(r.delivery_date),
      created_at: new Date(r.created_at as string | Date).getTime(),
      qty_base: Number(r.qty_base),
      amount: Number(r.amount),
      unit_price: Number(r.unit_price),
      unit_price_base: Number(r.unit_price_base),
      prev_unit_price_base:
        r.prev_unit_price_base === null || r.prev_unit_price_base === undefined
          ? null
          : Number(r.prev_unit_price_base),
    }));
    return aggregateByPair(lines);
  }

  /** Ma trận so giá giữa các NCC (mục 4.2).
   *
   * Đọc từ `supplier_items` chứ không quét lại lịch sử: bảng đó đã giữ sẵn giá gần nhất của mỗi
   * cặp, cập nhật mỗi lần nhập. Câu hỏi ở màn này là "hôm nay ai bán rẻ hơn", không phải "hồi
   * tháng 5 ai rẻ hơn".
   */
  async matrix(): Promise<MatrixRow[]> {
    const raw = await this.itemRepo
      .createQueryBuilder('si')
      .innerJoin('ingredients', 'i', 'i.id = si.ingredient_id')
      .innerJoin('suppliers', 's', 's.id = si.supplier_id')
      // Nguyên liệu đã gộp đi hoặc NCC đã ngừng hợp tác thì không còn là lựa chọn để đàm phán —
      // để lại chỉ làm bảng dài ra mà không dùng được.
      .where('i.is_active = 1')
      .andWhere('s.is_active = 1')
      .select([
        'si.ingredient_id AS ingredient_id',
        'i.name AS ingredient_name',
        'i.unit AS base_unit',
        'si.supplier_id AS supplier_id',
        's.name AS supplier_name',
        'si.last_unit_price_base AS unit_price_base',
        'si.purchase_unit AS purchase_unit',
        'si.last_unit_price AS unit_price',
        'si.last_delivery_date AS last_delivery_date',
      ])
      .getRawMany<Record<string, unknown>>();

    return buildPriceMatrix(
      raw.map((r) => ({
        ingredient_id: String(r.ingredient_id),
        ingredient_name: String(r.ingredient_name),
        base_unit: String(r.base_unit),
        supplier_id: String(r.supplier_id),
        supplier_name: String(r.supplier_name),
        unit_price_base: Number(r.unit_price_base),
        purchase_unit: String(r.purchase_unit),
        unit_price: Number(r.unit_price),
        last_delivery_date: dateStr(r.last_delivery_date),
      })),
    );
  }

  /** Lịch sử giá một mặt hàng qua mọi NCC (mục 4.3).
   *
   * Không giới hạn theo kỳ đang xem: cả điểm của màn này là nhìn ra kiểu trượt giá đều đặn 2%
   * mỗi tháng — thứ không lần nào chạm ngưỡng cảnh báo, và cắt theo tháng thì không bao giờ thấy.
   */
  async history(ingredient_id: string, limit = 120): Promise<PricePoint[]> {
    const raw = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('supplier_deliveries', 'd', 'd.id = l.delivery_id')
      .innerJoin('suppliers', 's', 's.id = d.supplier_id')
      .where('l.ingredient_id = :id', { id: ingredient_id })
      .andWhere("d.status = 'CONFIRMED'")
      .select([
        'd.id AS delivery_id',
        'd.delivery_date AS delivery_date',
        'd.supplier_id AS supplier_id',
        's.name AS supplier_name',
        'd.created_by_name AS created_by_name',
        'l.purchase_unit_snapshot AS purchase_unit',
        'l.qty_purchase AS qty_purchase',
        'l.unit_price AS unit_price',
        'l.unit_price_base AS unit_price_base',
      ])
      .orderBy('d.delivery_date', 'ASC')
      .addOrderBy('l.created_at', 'ASC')
      .limit(limit)
      .getRawMany<Record<string, unknown>>();

    return raw.map((r) => ({
      delivery_id: String(r.delivery_id),
      delivery_date: dateStr(r.delivery_date),
      supplier_id: String(r.supplier_id),
      supplier_name: String(r.supplier_name),
      created_by_name: String(r.created_by_name ?? ''),
      purchase_unit: String(r.purchase_unit),
      qty_purchase: String(r.qty_purchase),
      unit_price: Number(r.unit_price),
      unit_price_base: Number(r.unit_price_base),
    }));
  }
}

/** Cột DATE về từ mysql2 lúc là `Date`, lúc là chuỗi tuỳ hàm gộp — ép về 'YYYY-MM-DD' một chỗ. */
function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}
