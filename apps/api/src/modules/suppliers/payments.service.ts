// Thanh toán cho NCC + công nợ (M3.D-39→41, bước 3 của Milestone 3).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity.js';
import { SupplierPayment, type PaymentMethod } from './entities/supplier-payment.entity.js';
import { SupplierDelivery } from './entities/supplier-delivery.entity.js';
import { toDateString } from './suppliers.service.js';
import { computeBalance, type SupplierBalance } from './balance.js';

export type Actor = { id: string; full_name: string; is_owner?: boolean };

export type BalanceRow = SupplierBalance & { supplier_id: string };

/** Công nợ một NCC kèm những dòng đã cấu thành nên nó — để màn hình trả lời được câu "con số này
 * ở đâu ra". */
export type SupplierBalanceDetail = SupplierBalance & {
  opening_balance_note: string | null;
  /** `balance_after_snapshot`: công nợ đã đóng dấu lúc phiếu vào sổ, NULL với phiếu có trước
   *  2026-09-09. Xem docblock của cột trong `supplier-delivery.entity.ts`. */
  counted_deliveries: Array<{
    id: string;
    date: string;
    amount: number;
    source: string;
    balance_after_snapshot: number | null;
  }>;
  counted_payments: Array<{ id: string; date: string; amount: number; method: string }>;
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SupplierPayment) private readonly paymentRepo: Repository<SupplierPayment>,
    @InjectRepository(SupplierDelivery) private readonly deliveryRepo: Repository<SupplierDelivery>,
  ) {}

  /** Công nợ của MỌI nhà cung cấp đang hoạt động.
   *
   * Hai câu GROUP BY cho toàn bộ danh sách, không phải hai câu cho mỗi NCC. Mốc số dư đầu kỳ
   * khác nhau theo từng NCC nên điều kiện cắt nằm ngay trong JOIN — cách duy nhất để giữ nó ở
   * một câu mà vẫn đúng cho từng người.
   */
  async balances(): Promise<Map<string, BalanceRow>> {
    const suppliers = await this.supplierRepo.find({ where: { is_active: true } });
    const out = new Map<string, BalanceRow>();
    if (suppliers.length === 0) return out;

    const purchased = await this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.supplier_id', 'supplier_id')
      .addSelect('SUM(d.total_amount)', 'total')
      // Chỉ phiếu ĐÃ DUYỆT vào công nợ (M3.D-41): số NCC tự khai mà quán chưa kiểm không được
      // tự động thành nợ của quán.
      .where("d.status = 'CONFIRMED'")
      // KHÔNG lọc theo `opening_balance_date` nữa (2026-09-07) — số dư đầu kỳ là nợ cũ ngoài hệ
      // thống, mọi phiếu trong hệ thống đều là phát sinh. Xem docblock đầu `balance.ts`.
      .groupBy('d.supplier_id')
      .getRawMany<{ supplier_id: string; total: string | null }>();

    const paid = await this.paymentRepo
      .createQueryBuilder('p')
      .select('p.supplier_id', 'supplier_id')
      .addSelect('SUM(p.amount)', 'total')
      // Cùng lý lẽ với phiếu: MỌI lần trả đều trừ vào nợ, kể cả lần trả trước mốc số dư đầu kỳ.
      .groupBy('p.supplier_id')
      .getRawMany<{ supplier_id: string; total: string | null }>();

    const pMap = new Map(purchased.map((r) => [r.supplier_id, Number(r.total ?? 0)]));
    const qMap = new Map(paid.map((r) => [r.supplier_id, Number(r.total ?? 0)]));

    for (const s of suppliers) {
      const opening_balance = Number(s.opening_balance ?? 0);
      const purchasedAmt = pMap.get(s.id) ?? 0;
      const paidAmt = qMap.get(s.id) ?? 0;
      out.set(s.id, {
        supplier_id: s.id,
        opening_balance,
        purchased: purchasedAmt,
        paid: paidAmt,
        balance: opening_balance + purchasedAmt - paidAmt,
        opening_balance_date: toDateString(s.opening_balance_date),
      });
    }
    return out;
  }

  /** Công nợ một NCC, KÈM danh sách đã cấu thành nên nó.
   *
   * Trả cả chi tiết chứ không chỉ con số tổng: "còn phải trả 4.250.000đ" mà không nói được gồm
   * phiếu nào, đã trả những lần nào thì đến lúc ngồi đối chiếu với NCC là bó tay — và người ta
   * sẽ quay về dùng sổ tay, tức là tính năng thất bại.
   *
   * Dùng `computeBalance` trên dữ liệu thô thay vì SUM dưới SQL: số dòng của một NCC là vài chục
   * tới vài trăm, và đi qua đúng hàm đã có test là cách chắc chắn nhất để con số ở màn chi tiết
   * không lệch với con số ngoài danh sách.
   */
  async balanceOf(supplier_id: string): Promise<SupplierBalanceDetail> {
    const s = await this.supplierRepo.findOne({ where: { id: supplier_id } });
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });

    const [deliveries, payments] = await Promise.all([
      this.deliveryRepo.find({ where: { supplier_id, status: 'CONFIRMED' } }),
      this.paymentRepo.find({ where: { supplier_id } }),
    ]);

    const base = computeBalance({
      opening_balance: Number(s.opening_balance ?? 0),
      opening_balance_date: toDateString(s.opening_balance_date),
      deliveries: deliveries.map((d) => ({
        date: toDateString(d.delivery_date) ?? '',
        amount: d.total_amount,
      })),
      payments: payments.map((p) => ({
        date: toDateString(p.paid_on) ?? '',
        amount: p.amount,
      })),
    });

    // Liệt kê TẤT CẢ, vì từ 2026-09-07 tất cả đều được cộng/trừ. Danh sách này phải khớp đúng
    // với con số tổng ở trên nó — lệch một dòng là người đối chiếu kết luận hệ thống tính sai.
    const counted = <T extends { date: string }>(rows: T[]) =>
      [...rows].sort((a, b) => b.date.localeCompare(a.date));

    return {
      ...base,
      opening_balance_note: s.opening_balance_note,
      counted_deliveries: counted(
        deliveries.map((d) => ({
          id: d.id,
          date: toDateString(d.delivery_date) ?? '',
          amount: d.total_amount,
          source: d.source,
          balance_after_snapshot: d.balance_after_snapshot,
        })),
      ),
      counted_payments: counted(
        payments.map((p) => ({
          id: p.id,
          date: toDateString(p.paid_on) ?? '',
          amount: p.amount,
          method: p.method,
        })),
      ),
    };
  }

  async list(supplier_id: string): Promise<SupplierPayment[]> {
    const rows = await this.paymentRepo.find({
      where: { supplier_id },
      order: { paid_on: 'DESC', created_at: 'DESC' },
    });
    return rows.map((p) => ({ ...p, paid_on: toDateString(p.paid_on) ?? '' }));
  }

  async create(
    input: {
      supplier_id: string;
      paid_on?: string;
      amount: number;
      method?: PaymentMethod;
      note?: string | null;
    },
    actor: Actor,
    today: string,
  ): Promise<SupplierPayment> {
    const s = await this.supplierRepo.findOne({ where: { id: input.supplier_id } });
    if (!s || !s.is_active) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });
    }
    if (!(input.amount > 0)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Số tiền phải lớn hơn 0' });
    }
    return this.paymentRepo.save(
      this.paymentRepo.create({
        supplier_id: input.supplier_id,
        paid_on: input.paid_on || today,
        amount: Math.round(input.amount),
        method: input.method ?? 'CASH',
        note: input.note?.trim() || null,
        created_by_user_id: actor.id,
        created_by_name: actor.full_name,
      }),
    );
  }

  /** Xoá một lần trả tiền ghi nhầm. Xoá hẳn chứ không xoá mềm: dòng tiền ghi nhầm để lại trong
   * sổ chỉ làm người đối chiếu bối rối, và audit log đã giữ vết ai xoá lúc nào. */
  async remove(id: string): Promise<void> {
    const p = await this.paymentRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy lần thanh toán' });
    await this.paymentRepo.delete(id);
  }

  /** Đặt số dư đầu kỳ (M3.D-40). Sửa lại bao nhiêu lần cũng được — đối chiếu sổ với NCC là việc
   * làm nhiều nhịp, chốt cứng một lần thì sai một chữ số là phải sửa thẳng vào DB.
   *
   * Chủ quán chốt 2026-09-07: MỌI admin đặt được, không chỉ owner. Chốt cũ (`!actor.is_owner` →
   * 403) đã bỏ cùng `OwnerGuard` ở controller. Vẫn là con số duy nhất hệ thống không tự kiểm
   * chứng được và mọi báo cáo công nợ đứng trên nó, nên thứ thay thế lớp chặn đó là NHẬT KÝ:
   * `audit.interceptor` ghi `supplier.opening_balance_set` kèm tên người sửa. Đừng bỏ nốt nó.
   */
  async setOpeningBalance(
    supplier_id: string,
    input: {
      opening_balance: number;
      opening_balance_date: string | null;
      opening_balance_note?: string | null;
    },
    actor: Actor,
  ): Promise<Supplier> {
    const s = await this.supplierRepo.findOne({ where: { id: supplier_id } });
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });

    s.opening_balance = Math.round(input.opening_balance);
    s.opening_balance_date = input.opening_balance_date || null;
    if (input.opening_balance_note !== undefined) {
      s.opening_balance_note = input.opening_balance_note?.trim() || null;
    }
    return this.supplierRepo.save(s);
  }
}
