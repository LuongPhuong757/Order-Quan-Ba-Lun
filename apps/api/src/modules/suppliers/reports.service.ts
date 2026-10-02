// Báo cáo giá & mặt hàng nhập (2026-09-05, bước 2 của Milestone 3).
//
// Ba màn của mục 4 và bảng thống kê ở mục 3.3 đều đọc từ `supplier_delivery_lines` — bảng đó là
// nguồn duy nhất, và mọi con số so sánh đều là `unit_price_base` (đồng/đơn vị gốc). Không màn
// nào được phép so trên `unit_price`: NCC đổi đơn vị báo giá hoặc đổi cỡ đóng gói là hai chuyện
// xảy ra thật, và cả hai làm `unit_price` mất tính so sánh (M3.D-36, 37).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';
import { SupplierDeliveryLine } from './entities/supplier-delivery-line.entity.js';
import { SupplierDelivery } from './entities/supplier-delivery.entity.js';
import { SupplierItem } from './entities/supplier-item.entity.js';
import { SupplierPayment } from './entities/supplier-payment.entity.js';
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
    @InjectRepository(SupplierDelivery) private readonly deliveryRepo: Repository<SupplierDelivery>,
    @InjectRepository(SupplierItem) private readonly itemRepo: Repository<SupplierItem>,
    @InjectRepository(SupplierPayment) private readonly paymentRepo: Repository<SupplierPayment>,
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
  async pairs(opts: { from?: string; to?: string; supplier_id?: string }): Promise<PairReport[]> {
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
      .where("d.status = 'CONFIRMED'");
    // Thiếu mốc = không chặn đầu đó. Mặc định của màn /suppliers là không truyền gì cả.
    if (opts.from) qb.andWhere('d.delivery_date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('d.delivery_date <= :to', { to: opts.to });
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

  /** Chi tiêu nhập hàng theo NGÀY × NCC (2026-09-06).
   *
   * Gộp ở DB chứ không kéo hết phiếu về rồi gộp bằng JS: bảng phiếu lớn dần theo thời gian mà
   * màn này không cắt theo kỳ, nên đây là chỗ duy nhất trong module đọc toàn bộ lịch sử phiếu.
   *
   * Trả về từng cặp (ngày, NCC) chứ không gộp sẵn theo ngày: màn hình cần CẢ hai mức — dòng
   * tổng của ngày để liếc, và tách theo NCC khi bấm mở ra. Gộp sẵn ở server thì mất mức thứ hai
   * và phải gọi thêm một lượt nữa.
   *
   * CHỈ phiếu đã duyệt (M3.D-41), cùng luật với mọi con số tiền khác của module: phiếu NCC tự
   * khai mà quán chưa kiểm không được làm phồng chi tiêu.
   *
   * `from`/`to` là của riêng tab Thống kê (2026-09-08). Thiếu cả hai = toàn bộ lịch sử, giữ
   * nguyên hành vi cũ — các tab so giá vẫn gọi không tham số.
   */
  async daily(opts: { supplier_id?: string; from?: string; to?: string } = {}): Promise<DailyRow[]> {
    const qb = this.deliveryRepo
      .createQueryBuilder('d')
      .innerJoin('suppliers', 's', 's.id = d.supplier_id')
      .select('d.delivery_date', 'delivery_date')
      .addSelect('d.supplier_id', 'supplier_id')
      .addSelect('s.name', 'supplier_name')
      .addSelect('SUM(d.total_amount)', 'amount')
      .addSelect('COUNT(*)', 'deliveries')
      .where("d.status = 'CONFIRMED'");
    if (opts.supplier_id) qb.andWhere('d.supplier_id = :sid', { sid: opts.supplier_id });
    if (opts.from) qb.andWhere('d.delivery_date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('d.delivery_date <= :to', { to: opts.to });
    const raw = await qb
      .groupBy('d.delivery_date')
      .addGroupBy('d.supplier_id')
      .addGroupBy('s.name')
      .orderBy('d.delivery_date', 'DESC')
      .getRawMany<Record<string, unknown>>();
    return raw.map((r) => ({
      delivery_date: dateStr(r.delivery_date),
      supplier_id: String(r.supplier_id),
      supplier_name: String(r.supplier_name),
      amount: Number(r.amount),
      deliveries: Number(r.deliveries),
    }));
  }

  /**
   * BIẾN ĐỘNG CÔNG NỢ NCC theo ngày (2026-10-02) — nguồn của biểu đồ "nợ mới vs đã trả".
   *
   * Trả về ba thứ, và cả ba phải tính CÙNG MỘT CHỖ chứ không để màn hình tự ghép từ
   * `daily()` + `payments()`: đường dư nợ luỹ kế chỉ đúng khi điểm gốc (`opening`) và các
   * khoản phát sinh dùng chung một bộ luật về "ngày nào tính vào đâu" và "phiếu nào được
   * tính". Ghép ở FE thì hai nguồn sẽ lệch nhau vào đúng ngày không ai để ý.
   *
   * ── Ngày nào tính vào đâu ──
   * Một phiếu nhập và lần trả tiền cho nó rơi vào HAI ngày khác nhau, và đó chính là thứ biểu
   * đồ này sinh ra để cho thấy. `incurred` theo `delivery_date` (ngày GIAO HÀNG, không phải
   * ngày nhập liệu), `paid` theo `paid_on`. Đừng "đơn giản hoá" bằng cách quy cả hai về một
   * mốc — làm thế là xoá mất nửa bài toán.
   *
   * ── Phiếu nào tính ──
   * CHỈ `CONFIRMED`, cùng luật với `daily()` và mọi con số tiền khác của module. Hệ quả phải
   * biết: hàng đã về kho nhưng phiếu còn `PENDING_PRICE` (chưa chốt giá) KHÔNG lên biểu đồ —
   * đúng về sổ sách (chưa có giá thì chưa biết nợ bao nhiêu), nhưng nghĩa là biểu đồ có thể
   * thấp hơn lượng hàng thực nhận.
   *
   * ── `opening` ──
   * Dư nợ ngay TRƯỚC `from`, để FE cộng dồn ra đường luỹ kế. Gồm cả `suppliers.opening_balance`
   * (nợ cũ ngoài hệ thống, khai tay) — nhờ vậy đường luỹ kế TRÙNG với ô "Còn phải trả" đang
   * hiện trên cùng màn. Bỏ nó ra thì hai con số trên một màn sẽ nói hai chuyện khác nhau, và
   * đó là loại lệch không ai giải thích nổi cho chủ quán. Xem thêm docblock `balance.ts`:
   * số dư đầu kỳ KHÔNG có ngày, nên nó luôn nằm trong `opening` bất kể kỳ bắt đầu từ đâu.
   *
   * Không có `from` = xem toàn bộ lịch sử → `opening` chỉ còn số dư đầu kỳ.
   */
  async debtFlow(opts: { supplier_id?: string; from?: string; to?: string } = {}): Promise<{
    items: DebtFlowRow[];
    opening: number;
  }> {
    const sid = opts.supplier_id;

    // ── Nợ phát sinh theo ngày giao hàng ──
    const incurredQb = this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.delivery_date', 'day')
      .addSelect('SUM(d.total_amount)', 'amount')
      .where("d.status = 'CONFIRMED'");
    if (sid) incurredQb.andWhere('d.supplier_id = :sid', { sid });
    if (opts.from) incurredQb.andWhere('d.delivery_date >= :from', { from: opts.from });
    if (opts.to) incurredQb.andWhere('d.delivery_date <= :to', { to: opts.to });
    const incurredRaw = await incurredQb
      .groupBy('d.delivery_date')
      .getRawMany<Record<string, unknown>>();

    // ── Tiền đã trả theo ngày trả ──
    const paidQb = this.paymentRepo
      .createQueryBuilder('p')
      .select('p.paid_on', 'day')
      .addSelect('SUM(p.amount)', 'amount');
    if (sid) paidQb.andWhere('p.supplier_id = :sid', { sid });
    if (opts.from) paidQb.andWhere('p.paid_on >= :from', { from: opts.from });
    if (opts.to) paidQb.andWhere('p.paid_on <= :to', { to: opts.to });
    const paidRaw = await paidQb.groupBy('p.paid_on').getRawMany<Record<string, unknown>>();

    // ── Điểm gốc của đường luỹ kế ──
    const openingQb = this.deliveryRepo.manager
      .createQueryBuilder()
      .select('COALESCE(SUM(s.opening_balance), 0)', 'v')
      .from('suppliers', 's');
    if (sid) openingQb.where('s.id = :sid', { sid });
    const openingBalance = Number((await openingQb.getRawOne<{ v: unknown }>())?.v ?? 0);

    let opening = openingBalance;
    if (opts.from) {
      const truocQb = this.deliveryRepo
        .createQueryBuilder('d')
        .select('COALESCE(SUM(d.total_amount), 0)', 'v')
        .where("d.status = 'CONFIRMED'")
        .andWhere('d.delivery_date < :from', { from: opts.from });
      if (sid) truocQb.andWhere('d.supplier_id = :sid', { sid });

      const traTruocQb = this.paymentRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'v')
        .where('p.paid_on < :from', { from: opts.from });
      if (sid) traTruocQb.andWhere('p.supplier_id = :sid', { sid });

      const [muaTruoc, traTruoc] = await Promise.all([
        truocQb.getRawOne<{ v: unknown }>(),
        traTruocQb.getRawOne<{ v: unknown }>(),
      ]);
      opening += Number(muaTruoc?.v ?? 0) - Number(traTruoc?.v ?? 0);
    }

    const byDay = new Map<string, DebtFlowRow>();
    const cham = (day: string): DebtFlowRow => {
      let row = byDay.get(day);
      if (!row) {
        row = { day, incurred: 0, paid: 0 };
        byDay.set(day, row);
      }
      return row;
    };
    for (const r of incurredRaw) cham(dateStr(r.day)).incurred = Number(r.amount);
    for (const r of paidRaw) cham(dateStr(r.day)).paid = Number(r.amount);

    return { items: layDayNgay(byDay, opts.from, opts.to), opening };
  }

  /** Từng PHIẾU nhập trong kỳ, kèm tên các mặt hàng có trong phiếu (2026-09-08).
   *
   * `daily()` cộng tiền theo ngày nên một ngày ba NCC giao là MỘT con số; bảng "phiếu nhập nào
   * nhiều nhất" cần đúng mức dưới đó — từng phiếu một, xếp theo giá trị.
   *
   * Trả kèm `items` (tên mặt hàng) vì ô tìm kiếm của tab này lọc phiếu THEO MÓN: gõ "cá" phải
   * ra danh sách phiếu có cá. Không có tên món trong tay thì màn hình phải gọi thêm một lượt
   * `/supplier-deliveries/:id` cho mỗi phiếu — hàng trăm lượt gọi cho một lần gõ phím.
   *
   * Hai truy vấn chứ không GROUP_CONCAT: giới hạn mặc định 1024 byte của MySQL sẽ CẮT CỤT
   * chuỗi tên ở phiếu nhiều dòng, và cắt cụt thì tìm kiếm im lặng bỏ sót — kiểu lỗi không ai
   * phát hiện ra. Cũng không dùng `IN (:...ids)`: kỳ "tất cả" cho ra hàng nghìn id, dán hết
   * vào một câu SQL là tự tạo truy vấn dài chục nghìn ký tự. Lọc lại bằng chính điều kiện của
   * truy vấn trên rẻ hơn và luôn khớp.
   */
  async deliveryStats(opts: {
    from?: string;
    to?: string;
    supplier_id?: string;
  }): Promise<DeliveryStatRow[]> {
    const scope = <T extends ObjectLiteral>(qb: SelectQueryBuilder<T>): SelectQueryBuilder<T> => {
      qb.where("d.status = 'CONFIRMED'");
      if (opts.from) qb.andWhere('d.delivery_date >= :from', { from: opts.from });
      if (opts.to) qb.andWhere('d.delivery_date <= :to', { to: opts.to });
      if (opts.supplier_id) qb.andWhere('d.supplier_id = :sid', { sid: opts.supplier_id });
      return qb;
    };

    const heads = await scope(
      this.deliveryRepo
        .createQueryBuilder('d')
        .innerJoin('suppliers', 's', 's.id = d.supplier_id')
        .select([
          'd.id AS delivery_id',
          'd.delivery_date AS delivery_date',
          'd.supplier_id AS supplier_id',
          's.name AS supplier_name',
          'd.total_amount AS amount',
          'd.note AS note',
        ]),
    )
      .orderBy('d.delivery_date', 'DESC')
      .addOrderBy('d.created_at', 'DESC')
      .getRawMany<Record<string, unknown>>();

    if (heads.length === 0) return [];

    const lines = await scope(
      this.lineRepo
        .createQueryBuilder('l')
        .innerJoin('supplier_deliveries', 'd', 'd.id = l.delivery_id')
        .select('l.delivery_id', 'delivery_id')
        .addSelect('l.ingredient_name_snapshot', 'name'),
    ).getRawMany<{ delivery_id: string; name: string }>();

    const byDelivery = new Map<string, string[]>();
    for (const l of lines) {
      const arr = byDelivery.get(l.delivery_id);
      if (arr) arr.push(l.name);
      else byDelivery.set(l.delivery_id, [l.name]);
    }

    return heads.map((r) => {
      const items = byDelivery.get(String(r.delivery_id)) ?? [];
      return {
        delivery_id: String(r.delivery_id),
        delivery_date: dateStr(r.delivery_date),
        supplier_id: String(r.supplier_id),
        supplier_name: String(r.supplier_name),
        note: r.note === null || r.note === undefined ? null : String(r.note),
        amount: Number(r.amount),
        lines: items.length,
        items,
      };
    });
  }

  /** Từng lần TRẢ TIỀN cho NCC trong kỳ — khối "Đã trả cho NCC" của tab Thống kê (2026-09-14).
   *
   * Đường riêng chứ không dùng lại `GET /suppliers/:id/payments`: đường kia trả lần trả của MỘT
   * NCC và không có bộ lọc thời gian, nên để dựng bảng "trong tháng quán đã trả ai bao nhiêu"
   * màn hình phải gọi nó một lượt cho mỗi NCC rồi tự cắt kỳ — hàng chục lượt gọi cho một câu
   * hỏi vốn chỉ là một câu SQL.
   *
   * Cắt kỳ theo `paid_on` (ngày ĐƯA TIỀN) chứ không theo `created_at`: ghi bù lần trả hôm qua là
   * chuyện thường ở quán, cắt theo ngày nhập liệu sẽ đẩy khoản đó sang kỳ sau.
   *
   * KHÔNG lọc theo `opening_balance_date` — cùng lệ với công nợ: mọi lần trả đều là tiền quán đã
   * đưa, kể cả lần trả trước mốc số dư đầu kỳ (xem docblock `balance.ts`).
   */
  async payments(opts: { from?: string; to?: string; supplier_id?: string }): Promise<PaymentStatRow[]> {
    const qb = this.paymentRepo
      .createQueryBuilder('p')
      .innerJoin('suppliers', 's', 's.id = p.supplier_id')
      .select([
        'p.id AS payment_id',
        'p.paid_on AS paid_on',
        'p.supplier_id AS supplier_id',
        's.name AS supplier_name',
        'p.amount AS amount',
        'p.method AS method',
        'p.note AS note',
        'p.created_by_name AS created_by_name',
      ]);
    if (opts.supplier_id) qb.andWhere('p.supplier_id = :sid', { sid: opts.supplier_id });
    if (opts.from) qb.andWhere('p.paid_on >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('p.paid_on <= :to', { to: opts.to });

    const raw = await qb
      .orderBy('p.paid_on', 'DESC')
      .addOrderBy('p.created_at', 'DESC')
      .getRawMany<Record<string, unknown>>();

    return raw.map((r) => ({
      payment_id: String(r.payment_id),
      paid_on: dateStr(r.paid_on),
      supplier_id: String(r.supplier_id),
      supplier_name: String(r.supplier_name),
      amount: Number(r.amount),
      method: r.method === 'TRANSFER' ? ('TRANSFER' as const) : ('CASH' as const),
      note: r.note === null || r.note === undefined ? null : String(r.note),
      created_by_name: String(r.created_by_name ?? ''),
    }));
  }
}

/** Một lần trả tiền cho NCC trong kỳ (tab Thống kê). */
export type PaymentStatRow = {
  payment_id: string;
  paid_on: string;
  supplier_id: string;
  supplier_name: string;
  amount: number;
  method: 'CASH' | 'TRANSFER';
  note: string | null;
  /** Tên người ghi phiếu chi, đã snapshot lúc ghi — nhân viên nghỉ việc vẫn đọc được. */
  created_by_name: string;
};

/** Cột DATE về từ mysql2 lúc là `Date`, lúc là chuỗi tuỳ hàm gộp — ép về 'YYYY-MM-DD' một chỗ. */
export type DailyRow = {
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  amount: number;
  deliveries: number;
};

/** Một phiếu nhập đã duyệt trong kỳ (tab Thống kê). */
export type DeliveryStatRow = {
  delivery_id: string;
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  note: string | null;
  /** Tổng tiền của phiếu. */
  amount: number;
  /** Số dòng hàng trong phiếu. */
  lines: number;
  /** Tên các mặt hàng trong phiếu — nguồn cho ô tìm kiếm theo món. */
  items: string[];
};

/** Một ngày trên biểu đồ biến động công nợ. `incurred` = nợ mới, `paid` = tiền đã trả. */
export type DebtFlowRow = { day: string; incurred: number; paid: number };

/** Số ngày tối đa được ĐIỀN cho đủ dãy liên tục.
 *
 *  Dãy liên tục là thứ đường luỹ kế cần: thiếu ngày thì đoạn dốc giữa hai điểm trông như nợ
 *  tăng từ từ trong khi thực tế nó nhảy một nhát. Nhưng kỳ dài vài năm thì điền đủ ngày là
 *  hàng nghìn điểm cho một biểu đồ rộng vài trăm pixel — vừa vô ích vừa nặng. Quá ngưỡng thì
 *  chỉ trả những ngày CÓ số liệu: đường vẫn đi qua đúng các mốc, chỉ là các đoạn nối thẳng
 *  hơn thực tế. Ở kỳ dài như vậy người ta xem xu hướng chứ không soi từng ngày.
 */
const MAX_NGAY_DIEN = 400;

/** Dãy ngày của biểu đồ, cũ → mới, đã điền ngày trống trong `[from, to]`. */
function layDayNgay(
  byDay: Map<string, DebtFlowRow>,
  from?: string,
  to?: string,
): DebtFlowRow[] {
  const coSo = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  // Thiếu mốc đầu hoặc cuối thì lấy theo dữ liệu — kỳ "toàn bộ lịch sử" không có from/to.
  const dau = from || coSo[0]?.day;
  const cuoi = to || coSo[coSo.length - 1]?.day;
  if (!dau || !cuoi || dau > cuoi) return coSo;

  const MS_NGAY = 86_400_000;
  const soNgay = Math.round((Date.parse(`${cuoi}T00:00:00Z`) - Date.parse(`${dau}T00:00:00Z`)) / MS_NGAY) + 1;
  if (!Number.isFinite(soNgay) || soNgay <= 0 || soNgay > MAX_NGAY_DIEN) return coSo;

  const out: DebtFlowRow[] = [];
  for (let i = 0; i < soNgay; i++) {
    const day = new Date(Date.parse(`${dau}T00:00:00Z`) + i * MS_NGAY).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, incurred: 0, paid: 0 });
  }
  return out;
}

function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}
