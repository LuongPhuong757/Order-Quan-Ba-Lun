// Phiếu nhập hàng từ NCC + cảnh báo đổi giá (2026-09-05) — trọng tâm của Milestone 3.
//
// Luồng tạo phiếu cố ý đi hai nhịp (M3.D-21): nhịp một trả về danh sách dòng lệch giá và KHÔNG
// ghi gì; người dùng xem popup rồi bấm đồng ý; nhịp hai gửi lại kèm danh sách đã duyệt thì mới
// ghi. Server TÍNH LẠI TOÀN BỘ ở cả hai nhịp — không tin con số nào từ client, kể cả những con
// số chính nó vừa trả về ở nhịp một.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity.js';
import { SupplierItem } from './entities/supplier-item.entity.js';
import { SupplierDelivery } from './entities/supplier-delivery.entity.js';
import { SupplierDeliveryLine } from './entities/supplier-delivery-line.entity.js';
import {
  SupplierDeliveryPhoto,
  type DeliveryPhotoKind,
} from './entities/supplier-delivery-photo.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { toDateString } from './suppliers.service.js';
import type { AlertLevel } from './purchase-units.js';
import {
  alertLevel,
  computeLineAmounts,
  packSizeChanged,
  priceChangePct,
} from './purchase-units.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export type Actor = { id: string; full_name: string };

/** Một dòng người dùng gõ vào màn nhập.
 *
 * `ingredient_id` rỗng nghĩa là mặt hàng chưa có trong danh mục — dùng `ingredient_name` +
 * `base_unit` để tạo tại chỗ (M3.D-13). Đây là đường đi bình thường, không phải trường hợp lỗi.
 */
export type DeliveryLineInput = {
  ingredient_id?: string | null;
  ingredient_name?: string | null;
  base_unit?: string | null;
  purchase_unit: string;
  qty_base_per_unit: number;
  qty_purchase: number;
  unit_price: number;
};

/** Một dòng lệch giá, đúng những gì popup cần hiện (M3.D-21). */
export type PriceChange = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  prev_unit_price: number;
  unit_price: number;
  prev_unit_price_base: string;
  unit_price_base: string;
  price_change_pct: string;
  level: AlertLevel;
  /** Giá thùng không đổi mà giá thật vẫn tăng — popup phải nói rõ nguyên nhân là đổi cỡ đóng
   * gói, nếu không người xem sẽ tưởng hệ thống tính sai (M3.D-37). */
  pack_size_changed: boolean;
  prev_qty_base_per_unit: string | null;
  qty_base_per_unit: string;
};

/** Phiếu cùng NCC cùng ngày đã tồn tại (M3.D-11). */
export type DuplicateHint = {
  id: string;
  delivery_date: string;
  total_amount: number;
  created_by_name: string;
};

export type CreateResult =
  | { created: false; price_changes: PriceChange[]; duplicate: DuplicateHint | null }
  | { created: true; delivery: SupplierDelivery; lines: SupplierDeliveryLine[] };

@Injectable()
export class DeliveriesService {
  constructor(
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SupplierItem) private readonly itemRepo: Repository<SupplierItem>,
    @InjectRepository(SupplierDelivery) private readonly deliveryRepo: Repository<SupplierDelivery>,
    @InjectRepository(SupplierDeliveryLine) private readonly lineRepo: Repository<SupplierDeliveryLine>,
    @InjectRepository(SupplierDeliveryPhoto)
    private readonly photoRepo: Repository<SupplierDeliveryPhoto>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    private readonly ingredients: IngredientsService,
    private readonly ds: DataSource,
  ) {}

  /** Hôm nay theo giờ Việt Nam, 'YYYY-MM-DD'.
   *
   * Không dùng ngày của máy chủ: VPS chạy UTC nên từ 0h đến 7h sáng giờ VN nó vẫn coi là "hôm
   * qua" — phiếu nhập rau lúc 5h sáng sẽ rơi nhầm sang ngày trước và báo cáo kỳ lệch. */
  static today(): string {
    return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
  }

  async list(opts: {
    supplier_id?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<Array<SupplierDelivery & { supplier_name: string }>> {
    const qb = this.deliveryRepo.createQueryBuilder('d');
    if (opts.supplier_id) qb.andWhere('d.supplier_id = :sid', { sid: opts.supplier_id });
    if (opts.from) qb.andWhere('d.delivery_date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('d.delivery_date <= :to', { to: opts.to });
    const rows = await qb
      // Cùng ngày thì phiếu nhập sau nằm trên — nhân viên vừa nhập xong muốn thấy nó ngay đầu
      // danh sách để đối chiếu, không phải cuộn tìm.
      .orderBy('d.delivery_date', 'DESC')
      .addOrderBy('d.created_at', 'DESC')
      .limit(opts.limit ?? 200)
      .getMany();
    if (rows.length === 0) return [];

    const suppliers = await this.supplierRepo.find({
      where: { id: In([...new Set(rows.map((r) => r.supplier_id))]) },
    });
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return rows.map((r) => ({
      ...r,
      delivery_date: toDateString(r.delivery_date) ?? '',
      supplier_name: names.get(r.supplier_id) ?? '(đã xoá)',
    }));
  }

  async get(id: string): Promise<{
    delivery: SupplierDelivery & { supplier_name: string };
    lines: SupplierDeliveryLine[];
    photos: SupplierDeliveryPhoto[];
  }> {
    const d = await this.deliveryRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Phiếu nhập không tồn tại' });
    const [supplier, lines, photos] = await Promise.all([
      this.supplierRepo.findOne({ where: { id: d.supplier_id } }),
      this.lineRepo.find({ where: { delivery_id: id }, order: { created_at: 'ASC' } }),
      this.photoRepo.find({ where: { delivery_id: id }, order: { created_at: 'ASC' } }),
    ]);
    return {
      delivery: {
        ...d,
        delivery_date: toDateString(d.delivery_date) ?? '',
        supplier_name: supplier?.name ?? '(đã xoá)',
      },
      lines,
      photos,
    };
  }

  /** Gắn ảnh vào phiếu. Ảnh đã được resize/nén và ghi đĩa trước khi vào đây — tham số là URL
   * công khai, không phải bytes.
   *
   * Gắn được vào phiếu Ở BẤT KỲ trạng thái nào, kể cả CONFIRMED: ảnh là bằng chứng chứ không
   * phải số liệu, thêm ảnh không đụng tới kho hay công nợ. Chặn ở đây chỉ tạo ra tình huống
   * "quên chụp hoá đơn, phiếu đã duyệt, thôi khỏi lưu". */
  async addPhotos(
    deliveryId: string,
    urls: string[],
    kind: DeliveryPhotoKind,
  ): Promise<SupplierDeliveryPhoto[]> {
    const d = await this.deliveryRepo.findOne({ where: { id: deliveryId } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Phiếu nhập không tồn tại' });
    const rows = urls.map((url) => this.photoRepo.create({ delivery_id: deliveryId, url, kind }));
    return this.photoRepo.save(rows);
  }

  async listPhotos(deliveryId: string): Promise<SupplierDeliveryPhoto[]> {
    return this.photoRepo.find({ where: { delivery_id: deliveryId }, order: { created_at: 'ASC' } });
  }

  /** Xoá một ảnh khỏi phiếu.
   *
   * CHỈ xoá dòng trong DB, KHÔNG xoá file trên đĩa. Cố ý: một tấm ảnh vài chục KB không đáng để
   * đánh đổi lấy rủi ro xoá nhầm file mà một phiếu khác đang trỏ tới, và ảnh mồ côi thì dọn được
   * bằng tay bất cứ lúc nào — ngược lại thì không. */
  async deletePhoto(photoId: string): Promise<{ deleted: true }> {
    const ph = await this.photoRepo.findOne({ where: { id: photoId } });
    if (!ph) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ảnh không tồn tại' });
    await this.photoRepo.delete({ id: photoId });
    return { deleted: true };
  }

  /** Tạo phiếu nhập. Xem docblock đầu file về luồng hai nhịp.
   *
   * `approved_ingredient_ids` là danh sách mặt hàng người dùng đã bấm đồng ý ở popup. Server đối
   * chiếu lại: dòng nào cần duyệt mà KHÔNG có trong danh sách thì quay về nhịp một. Không dùng
   * một cờ boolean "đã xác nhận" — cờ đó chỉ chứng minh người dùng đã bấm một cái nút nào đó,
   * không chứng minh họ nhìn thấy đúng những dòng này.
   */
  async create(
    input: {
      supplier_id: string;
      delivery_date?: string;
      note?: string | null;
      lines: DeliveryLineInput[];
      approved_ingredient_ids?: string[];
      allow_duplicate?: boolean;
    },
    actor: Actor,
  ): Promise<CreateResult> {
    const supplier = await this.supplierRepo.findOne({ where: { id: input.supplier_id } });
    if (!supplier || !supplier.is_active) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });
    }
    if (!input.lines?.length) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Phiếu chưa có mặt hàng nào' });
    }
    const delivery_date = input.delivery_date || DeliveriesService.today();

    const prepared = await this.prepareLines(input.supplier_id, input.lines);

    // Dòng cần duyệt = vượt ngưỡng. Đối chiếu với danh sách người dùng đã bấm đồng ý.
    const approved = new Set(input.approved_ingredient_ids ?? []);
    const unapproved = prepared.filter((p) => p.level !== 'none' && !approved.has(p.ingredient.id));

    const duplicate = input.allow_duplicate ? null : await this.findDuplicate(input.supplier_id, delivery_date);

    if (unapproved.length > 0 || duplicate) {
      return {
        created: false,
        price_changes: unapproved.map((p) => p.change),
        duplicate,
      };
    }

    return this.ds.transaction(async (mgr) => {
      const deliveries = mgr.getRepository(SupplierDelivery);
      const lines = mgr.getRepository(SupplierDeliveryLine);
      const items = mgr.getRepository(SupplierItem);

      const total_amount = prepared.reduce((sum, p) => sum + p.amounts.amount, 0);
      const delivery = await deliveries.save(
        deliveries.create({
          supplier_id: input.supplier_id,
          delivery_date,
          // Nhân viên nhập hộ thì chính họ đang cầm hàng và đếm — không còn ai để "kiểm" nữa
          // (M3.D-07). Phiếu do NCC tự gửi ở bước 3 sẽ vào `PENDING_REVIEW`.
          status: 'CONFIRMED',
          source: 'STAFF',
          created_by_user_id: actor.id,
          created_by_name: actor.full_name,
          note: input.note?.trim() || null,
          total_amount,
        }),
      );

      const saved: SupplierDeliveryLine[] = [];
      for (const p of prepared) {
        saved.push(
          await lines.save(
            lines.create({
              delivery_id: delivery.id,
              ingredient_id: p.ingredient.id,
              ingredient_name_snapshot: p.ingredient.name,
              unit_snapshot: p.ingredient.unit,
              purchase_unit_snapshot: p.purchase_unit,
              qty_base_per_unit_snapshot: String(p.qty_base_per_unit),
              qty_purchase: String(p.qty_purchase),
              unit_price: p.unit_price,
              amount: p.amounts.amount,
              qty_base: String(p.amounts.qty_base),
              unit_price_base: String(p.amounts.unit_price_base),
              prev_unit_price_base: p.prev?.last_unit_price_base ?? null,
              price_change_pct: p.pct === null ? null : String(p.pct),
              prev_qty_base_per_unit: p.prev?.qty_base_per_unit ?? null,
              // Chỉ ghi người duyệt lên dòng THẬT SỰ phải duyệt. Ghi lên mọi dòng thì cột này mất
              // nghĩa: sáu tháng sau không phân biệt được "ai đó đã cân nhắc mức giá này" với
              // "dòng này vốn chẳng có gì để cân nhắc".
              price_approved_by_user_id: p.level === 'none' ? null : actor.id,
            }),
          ),
        );

      }

      // Giá tham chiếu chỉ dịch theo phiếu ĐÃ DUYỆT — xem `applyItemReferences`.
      await applyItemReferences(items, input.supplier_id, delivery_date, saved);

      return { created: true, delivery, lines: saved };
    });
  }

  /** NCC tự gửi phiếu (bước 4). KHÔNG vào kho ngay — nó là ĐỀ NGHỊ (M3.D-08).
   *
   * Khác đường nhân viên nhập hộ ở ba chỗ, và cả ba đều cố ý:
   * 1. Không có popup duyệt giá. NCC không được tự quyết giá mới (M3.D-26) — lệch giá thì phiếu
   *    dừng ở `PENDING_PRICE` cho quán xử lý, chứ không phải hỏi chính người đang bán.
   * 2. Ngày giao luôn là hôm nay: NCC không sửa được ngày, tránh phiếu lùi ngày vào kỳ đã chốt.
   * 3. Không cập nhật `supplier_items` — mốc giá chỉ dịch khi quán duyệt.
   */
  async submitBySupplier(
    supplier_id: string,
    input: { note?: string | null; lines: DeliveryLineInput[] },
  ): Promise<{ delivery: SupplierDelivery; lines: SupplierDeliveryLine[] }> {
    if (!input.lines?.length) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Phiếu chưa có mặt hàng nào' });
    }
    const delivery_date = DeliveriesService.today();
    const prepared = await this.prepareLines(supplier_id, input.lines);
    const flagged = prepared.some((p) => p.level !== 'none');

    return this.ds.transaction(async (mgr) => {
      const deliveries = mgr.getRepository(SupplierDelivery);
      const lines = mgr.getRepository(SupplierDeliveryLine);

      const delivery = await deliveries.save(
        deliveries.create({
          supplier_id,
          delivery_date,
          status: flagged ? 'PENDING_PRICE' : 'PENDING_REVIEW',
          source: 'SUPPLIER',
          created_by_user_id: null,
          created_by_name: '',
          note: input.note?.trim() || null,
          total_amount: prepared.reduce((sum, p) => sum + p.amounts.amount, 0),
        }),
      );

      const saved: SupplierDeliveryLine[] = [];
      for (const p of prepared) {
        saved.push(
          await lines.save(
            lines.create({
              delivery_id: delivery.id,
              ingredient_id: p.ingredient.id,
              ingredient_name_snapshot: p.ingredient.name,
              unit_snapshot: p.ingredient.unit,
              purchase_unit_snapshot: p.purchase_unit,
              qty_base_per_unit_snapshot: String(p.qty_base_per_unit),
              qty_purchase: String(p.qty_purchase),
              unit_price: p.unit_price,
              amount: p.amounts.amount,
              qty_base: String(p.amounts.qty_base),
              unit_price_base: String(p.amounts.unit_price_base),
              prev_unit_price_base: p.prev?.last_unit_price_base ?? null,
              price_change_pct: p.pct === null ? null : String(p.pct),
              prev_qty_base_per_unit: p.prev?.qty_base_per_unit ?? null,
              price_approved_by_user_id: null,
            }),
          ),
        );
      }
      return { delivery, lines: saved };
    });
  }

  /** Quán duyệt một phiếu NCC gửi → vào kho và vào công nợ (M3.D-08, 41).
   *
   * Đây là chỗ `supplier_items` mới được dịch mốc giá, và cũng là chỗ đóng dấu ai chịu trách
   * nhiệm cho mức giá lệch.
   */
  async confirm(id: string, actor: Actor): Promise<SupplierDelivery> {
    return this.ds.transaction(async (mgr) => {
      const deliveries = mgr.getRepository(SupplierDelivery);
      const lineRepo = mgr.getRepository(SupplierDeliveryLine);
      const items = mgr.getRepository(SupplierItem);

      const d = await deliveries.findOne({ where: { id } });
      if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Phiếu nhập không tồn tại' });
      if (d.status === 'CONFIRMED') return d;
      if (d.status === 'CANCELLED') {
        throw new BadRequestException({ code: 'BAD_STATE', message: 'Phiếu đã huỷ, không duyệt được' });
      }

      const lines = await lineRepo.find({ where: { delivery_id: id } });
      // Đóng dấu người duyệt lên đúng những dòng lệch giá — cùng lý lẽ với luồng nhân viên nhập.
      for (const l of lines) {
        if (l.price_change_pct !== null && l.price_approved_by_user_id === null) {
          await lineRepo.update(l.id, { price_approved_by_user_id: actor.id });
        }
      }

      d.status = 'CONFIRMED';
      await deliveries.save(d);
      await applyItemReferences(items, d.supplier_id, toDateString(d.delivery_date) ?? '', lines);
      return d;
    });
  }

  /** Huỷ phiếu. Giữ lại để truy vết chứ không xoá — phiếu biến mất là câu hỏi không ai trả lời
   * được ở lần đối chiếu sau. */
  async cancel(id: string): Promise<SupplierDelivery> {
    const d = await this.deliveryRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Phiếu nhập không tồn tại' });
    if (d.status === 'CONFIRMED') {
      throw new BadRequestException({
        code: 'BAD_STATE',
        message: 'Phiếu đã duyệt rồi — không huỷ được, nó đã vào kho và công nợ',
      });
    }
    d.status = 'CANCELLED';
    return this.deliveryRepo.save(d);
  }

  /** Tính lại toàn bộ một phiếu: quy đổi, so với lần trước, xếp mức cảnh báo.
   *
   * Tách riêng vì chạy ở CẢ HAI nhịp của luồng tạo phiếu — nhịp một để dựng popup, nhịp hai để
   * ghi. Một chỗ tính duy nhất thì không có đường cho hai nhịp lệch nhau.
   */
  private async prepareLines(supplier_id: string, inputs: DeliveryLineInput[]) {
    const prepared = [];
    // Mặt hàng trùng trong cùng một phiếu: hai dòng "rau muống" thì dòng sau ghi đè bảng giá của
    // dòng trước và tồn kho cộng hai lần. Chặn ngay, người nhập đang định sửa số lượng chứ không
    // phải thêm dòng — giống hệt lý do `recipe_lines` UNIQUE (món, nguyên liệu).
    const seen = new Set<string>();

    for (const raw of inputs) {
      const qty_purchase = Number(raw.qty_purchase);
      const unit_price = Number(raw.unit_price);
      const qty_base_per_unit = Number(raw.qty_base_per_unit);
      const purchase_unit = (raw.purchase_unit ?? '').trim();

      if (!purchase_unit) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Thiếu đơn vị mua' });
      }
      if (!(qty_purchase > 0)) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Số lượng phải lớn hơn 0' });
      }
      if (!(unit_price >= 0)) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Đơn giá không hợp lệ' });
      }
      if (!(qty_base_per_unit > 0)) {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message: `"${purchase_unit}" quy ra bao nhiêu đơn vị gốc? Hệ số phải lớn hơn 0`,
        });
      }

      const ingredient = await this.resolveIngredient(raw);
      if (seen.has(ingredient.id)) {
        throw new BadRequestException({
          code: 'DUPLICATE_LINE',
          message: `"${ingredient.name}" xuất hiện hai lần trong phiếu — gộp lại thành một dòng`,
        });
      }
      seen.add(ingredient.id);

      const amounts = computeLineAmounts({ qty_purchase, unit_price, qty_base_per_unit });
      const prev = await this.itemRepo.findOne({
        where: { supplier_id, ingredient_id: ingredient.id },
      });
      const prev_base = prev ? Number(prev.last_unit_price_base) : null;
      const pct = priceChangePct(prev_base, amounts.unit_price_base);
      // decimal về từ mysql2 là chuỗi — ép số ở đây, đúng một chỗ.
      const threshold =
        ingredient.price_alert_threshold_pct === null
          ? null
          : Number(ingredient.price_alert_threshold_pct);
      const level = alertLevel(pct, threshold);

      prepared.push({
        ingredient,
        purchase_unit,
        qty_base_per_unit,
        qty_purchase,
        unit_price,
        amounts,
        prev,
        pct,
        level,
        change: {
          ingredient_id: ingredient.id,
          ingredient_name: ingredient.name,
          base_unit: ingredient.unit,
          purchase_unit,
          prev_unit_price: prev?.last_unit_price ?? 0,
          unit_price,
          prev_unit_price_base: prev?.last_unit_price_base ?? '0',
          unit_price_base: String(amounts.unit_price_base),
          price_change_pct: String(pct ?? 0),
          level,
          pack_size_changed: packSizeChanged(
            prev ? Number(prev.qty_base_per_unit) : null,
            qty_base_per_unit,
          ),
          prev_qty_base_per_unit: prev?.qty_base_per_unit ?? null,
          qty_base_per_unit: String(qty_base_per_unit),
        } satisfies PriceChange,
      });
    }
    return prepared;
  }

  /** Mặt hàng có sẵn thì lấy ra, chưa có thì tạo tại chỗ (M3.D-13).
   *
   * Tạo mới BẮT BUỘC có đơn vị gốc (M3.D-16) — `IngredientsService` đã chặn đơn vị lạ, ở đây chỉ
   * cần chặn trường hợp bỏ trống để thông báo lỗi nói đúng chuyện đang xảy ra.
   */
  private async resolveIngredient(raw: DeliveryLineInput): Promise<Ingredient> {
    if (raw.ingredient_id) {
      const ing = await this.ingredientRepo.findOne({ where: { id: raw.ingredient_id } });
      if (!ing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mặt hàng không tồn tại' });
      }
      return ing;
    }
    const name = (raw.ingredient_name ?? '').trim();
    const unit = (raw.base_unit ?? '').trim();
    if (!name) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Thiếu tên mặt hàng' });
    }
    if (!unit) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `"${name}" là mặt hàng mới — phải khai đơn vị tính (kg, lít, bó...)`,
      });
    }
    const { ingredient } = await this.ingredients.findOrCreate(name, unit);
    return ingredient;
  }

  /** Phiếu cùng NCC cùng ngày (M3.D-11) — không có cái này thì sinh phiếu đôi và tồn kho phồng
   * lên mà không ai biết. Chỉ gợi ý, không chặn: NCC giao hai chuyến trong ngày là chuyện có
   * thật, nên quyết định cuối cùng thuộc về người nhập. */
  private async findDuplicate(supplier_id: string, delivery_date: string): Promise<DuplicateHint | null> {
    const d = await this.deliveryRepo.findOne({
      where: { supplier_id, delivery_date },
      order: { created_at: 'DESC' },
    });
    if (!d) return null;
    return {
      id: d.id,
      delivery_date: toDateString(d.delivery_date) ?? delivery_date,
      total_amount: d.total_amount,
      created_by_name: d.created_by_name,
    };
  }
}

/** Cập nhật bảng giá tham chiếu `supplier_items` từ các dòng của một phiếu (M3.D-18, 20).
 *
 * CHỈ gọi khi phiếu ở trạng thái đã duyệt. Phiếu NCC tự gửi mà chưa ai kiểm thì không được phép
 * dịch mốc giá: cho dịch thì NCC gửi một phiếu giá cao, lần sau hệ thống so với chính con số họ
 * vừa khai, và cảnh báo đổi giá im lặng — đúng cái nó sinh ra để chặn (M3.D-08, 26).
 */
async function applyItemReferences(
  items: Repository<SupplierItem>,
  supplier_id: string,
  delivery_date: string,
  lines: SupplierDeliveryLine[],
): Promise<void> {
  for (const l of lines) {
    const prev = await items.findOne({ where: { supplier_id, ingredient_id: l.ingredient_id } });
    const patch = {
      purchase_unit: l.purchase_unit_snapshot,
      qty_base_per_unit: l.qty_base_per_unit_snapshot,
      last_unit_price: l.unit_price,
      last_unit_price_base: l.unit_price_base,
      last_delivery_date: delivery_date,
    };
    if (prev) {
      // Nhập bù phiếu ngày cũ KHÔNG được ghi đè giá của lần giao mới hơn: mốc tham chiếu phải
      // luôn là lần giao gần nhất theo NGÀY GIAO, không phải theo thứ tự ai ngồi nhập trước.
      const prevDate = toDateString(prev.last_delivery_date) ?? '';
      if (prevDate > delivery_date) continue;
      await items.update(prev.id, patch);
    } else {
      await items.save(items.create({ supplier_id, ingredient_id: l.ingredient_id, ...patch }));
    }
  }
}
