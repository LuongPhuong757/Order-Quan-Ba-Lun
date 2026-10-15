import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { BankTxnAssignment } from './entities/bank-txn-assignment.entity.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { BANK_VERIFIED_EXISTS_SQL } from './bank-verified-sql.js';
import {
  orderStateOf,
  rankCandidates,
  reviewReasonOf,
  type LinkedOrderState,
  type ReviewReason,
} from './bank-ledger-link.js';

/** Một đơn, gọn đủ để chủ quán nhận ra "à bàn đó" mà không phải mở màn Lịch sử. */
export type OrderBrief = {
  id: string;
  table: string;
  opened_at: number;
  closed_at: number | null;
  transfer_amount: number;
  state: LinkedOrderState;
  /** Người bấm thanh toán — để biết đi hỏi ai. `null` khi bàn còn mở. */
  cashier: string | null;
};

/**
 * Khoản tiền này thuộc bàn nào.
 *
 *  - `auto`   bộ khớp nối qua mã QR (`BAN05ABC`) trong nội dung CK.
 *  - `manual` chủ quán gán tay.
 *  - `none`   chưa nối được — tiền lạ, chờ người gán.
 *  - `other`  có nối mã nhưng không ra đơn tại quầy nào (đơn đã bị xoá, hoặc luồng online cũ).
 */
export type TxnLink = {
  via: 'auto' | 'manual' | 'none' | 'other';
  order: OrderBrief | null;
  review: ReviewReason | null;
  manual_by: string | null;
  manual_at: number | null;
};

export type Candidate = OrderBrief & { exact: boolean };

/** Đơn được nhận tiền gán tay: đã thu, có phần chuyển khoản, CHƯA ✓ (chủ quán chốt 2026-10-15).
 *  Đúng tập "Chưa xác thực" của bộ lọc màn Lịch sử — gán xong là đơn rời khỏi tập đó. */
const ELIGIBLE_SQL = `o.closed_at IS NOT NULL AND o.is_paid = 1 AND o.transfer_amount > 0
  AND NOT ${BANK_VERIFIED_EXISTS_SQL}`;

/** Cửa sổ tìm đơn quanh giờ tiền về. Khách hay chuyển TRƯỚC khi bàn đóng (quét QR rồi ngồi chơi
 *  tiếp) hoặc SAU (về nhà mới nhớ ra) — 24 giờ mỗi phía phủ cả một đêm bán tới 3h sáng. */
const CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Đủ để cuộn chọn trên điện thoại; quá số này thì đơn đúng tiền đã nằm hết ở đầu danh sách. */
const CANDIDATE_LIMIT = 30;

/**
 * Nối tiền về với bàn/đơn cho màn sổ webhook, và gán/gỡ tay tiền lạ (2026-10-15).
 *
 * Service này KHÔNG sửa đơn. Gán tay chỉ làm đơn thành ✓ ở cột "Xác thực" — `transfer_amount`,
 * `is_paid`, `closed_at` vẫn là thứ nhân viên ghi. Cùng nguyên tắc "máy chỉ gắn cờ, không sửa
 * tiền" của `PaymentsApplyService`.
 */
@Injectable()
export class BankLedgerLinkService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
    @InjectRepository(BankTxnAssignment) private readonly assigns: Repository<BankTxnAssignment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(RestaurantTable) private readonly tables: Repository<RestaurantTable>,
  ) {}

  /** Liên kết cho cả trang sổ — vài truy vấn gộp, không phải mỗi dòng một lần tra. Tiền RA không
   *  có liên kết (chỉ để xem, xem `bank-transaction.entity.ts` cột `direction`). */
  async linksFor(txns: readonly BankTransaction[]): Promise<Map<string, TxnLink>> {
    const ins = txns.filter((t) => t.direction === 'in');
    if (ins.length === 0) return new Map();

    const intentIds = [...new Set(ins.map((t) => t.applied_intent_id).filter((v): v is string => !!v))];
    const [intents, manual] = await Promise.all([
      intentIds.length > 0 ? this.intents.findBy({ id: In(intentIds) }) : Promise.resolve([]),
      this.assigns.findBy({ bank_txn_id: In(ins.map((t) => t.id)) }),
    ]);
    const intentById = new Map(intents.map((i) => [i.id, i]));
    const manualByTxn = new Map(manual.map((a) => [a.bank_txn_id, a]));

    const orderIds = [
      ...intents.filter((i) => i.target_type === 'POS').map((i) => i.target_id),
      ...manual.map((a) => a.order_id),
    ];
    const briefs = await this.briefs(orderIds);

    const out = new Map<string, TxnLink>();
    for (const t of ins) {
      const a = manualByTxn.get(t.id);
      if (a) {
        out.set(t.id, {
          via: 'manual',
          order: briefs.get(a.order_id) ?? null,
          review: null,
          manual_by: a.assigned_by_name,
          manual_at: a.created_at,
        });
        continue;
      }
      const i = t.applied_intent_id ? intentById.get(t.applied_intent_id) : undefined;
      if (!i) {
        out.set(t.id, { via: 'none', order: null, review: null, manual_by: null, manual_at: null });
        continue;
      }
      const order = i.target_type === 'POS' ? briefs.get(i.target_id) ?? null : null;
      out.set(t.id, {
        via: order ? 'auto' : 'other',
        order,
        review: reviewReasonOf(i, t.account_no),
        manual_by: null,
        manual_at: null,
      });
    }
    return out;
  }

  /** Các đơn có thể nhận khoản tiền lạ này, đúng số tiền lên đầu. */
  async candidates(txnId: string): Promise<Candidate[]> {
    const txn = await this.ds.getRepository(BankTransaction).findOne({ where: { id: txnId } });
    if (!txn) throw notFoundTxn();
    await this.assertAssignable(this.ds.manager, txn);

    const rows = await this.orders
      .createQueryBuilder('o')
      .where(ELIGIBLE_SQL)
      .andWhere('o.closed_at BETWEEN :from AND :to', {
        from: new Date(txn.occurred_at - CANDIDATE_WINDOW_MS),
        to: new Date(txn.occurred_at + CANDIDATE_WINDOW_MS),
      })
      .getMany();
    const ranked = rankCandidates(
      rows.map((o) => ({ ...o, closed_at: o.closed_at ?? 0 })),
      txn.amount,
      txn.occurred_at,
    ).slice(0, CANDIDATE_LIMIT);

    const names = await this.tableNames(ranked.map((o) => o.table_id));
    return ranked.map((o) => ({ ...toBrief(o, names), exact: o.transfer_amount === txn.amount }));
  }

  /**
   * Gán tay. Mọi điều kiện kiểm lại ở SERVER trong cùng transaction có khoá hàng — danh sách gợi ý
   * ở màn có thể đã cũ (người khác vừa gán, bộ khớp vừa nối mã, đơn vừa được ✓).
   */
  async assign(
    txnId: string,
    orderId: string,
    by: { id: string | null; name: string | null },
  ): Promise<{ bank_txn_id: string; order_id: string; amount: number; table: string }> {
    if (!orderId) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Chưa chọn đơn để gán.' });
    }
    return this.ds.transaction(async (m) => {
      const txn = await m.findOne(BankTransaction, {
        where: { id: txnId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!txn) throw notFoundTxn();
      await this.assertAssignable(m, txn);

      const order = await m
        .getRepository(Order)
        .createQueryBuilder('o')
        .where('o.id = :id', { id: orderId })
        .andWhere(ELIGIBLE_SQL)
        // Khoá cả hàng đơn: hai khoản tiền KHÁC nhau gán cùng lúc vào cùng một đơn thì cả hai đều
        // qua được `ELIGIBLE_SQL` trước khi bên kia ghi — đơn nhận hai khoản. Khoá thì người sau
        // đợi, rồi thấy đơn đã ✓ và bị từ chối.
        .setLock('pessimistic_write')
        .getOne();
      if (!order) {
        throw new ConflictException({
          code: 'BANK_TXN_ORDER_NOT_ELIGIBLE',
          message: 'Đơn này không nhận gán được: chỉ gán vào đơn đã thanh toán, có chuyển khoản, chưa ✓.',
        });
      }

      try {
        await m.insert(BankTxnAssignment, {
          bank_txn_id: txn.id,
          order_id: order.id,
          assigned_by_user_id: by.id,
          assigned_by_name: by.name,
          created_at: Date.now(),
        });
      } catch (e) {
        // Khoá hàng ở trên đã xếp hàng hai người gán cùng khoản; UNIQUE(bank_txn_id) là lưới cuối.
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw alreadyAssigned();
        throw e;
      }

      const names = await this.tableNames([order.table_id]);
      return {
        bank_txn_id: txn.id,
        order_id: order.id,
        amount: txn.amount,
        table: names.get(order.table_id) || order.table_code,
      };
    });
  }

  /** Gỡ gán: khoản tiền quay về "Chưa khớp", đơn quay về ✗. Trả lại thứ vừa gỡ để audit log giữ
   *  được "đã gỡ khoản nào khỏi đơn nào" — sau lệnh này bảng không còn dấu vết gì nữa. */
  async unassign(txnId: string): Promise<{ bank_txn_id: string; order_id: string }> {
    return this.ds.transaction(async (m) => {
      const a = await m.findOne(BankTxnAssignment, {
        where: { bank_txn_id: txnId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!a) {
        throw new NotFoundException({
          code: 'BANK_TXN_NOT_ASSIGNED',
          message: 'Khoản tiền này chưa được gán tay vào đơn nào.',
        });
      }
      await m.delete(BankTxnAssignment, { id: a.id });
      return { bank_txn_id: a.bank_txn_id, order_id: a.order_id };
    });
  }

  /** Chỉ tiền VÀO, chưa được bộ khớp nối mã, chưa ai gán. */
  private async assertAssignable(m: EntityManager, txn: BankTransaction): Promise<void> {
    if (txn.direction !== 'in') {
      throw new BadRequestException({ code: 'BANK_TXN_OUTGOING', message: 'Tiền ra không gán vào đơn được.' });
    }
    if (txn.applied_intent_id) {
      throw new ConflictException({
        code: 'BANK_TXN_AUTO_MATCHED',
        message: 'Khoản này đã tự khớp theo mã bàn, không cần gán tay.',
      });
    }
    if (await m.exists(BankTxnAssignment, { where: { bank_txn_id: txn.id } })) throw alreadyAssigned();
  }

  private async briefs(ids: readonly string[]): Promise<Map<string, OrderBrief>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const rows = await this.orders.findBy({ id: In(uniq) });
    const names = await this.tableNames(rows.map((o) => o.table_id));
    return new Map(rows.map((o) => [o.id, toBrief(o, names)]));
  }

  private async tableNames(ids: readonly string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const rows = await this.tables.find({ where: { id: In(uniq) }, select: ['id', 'name'] });
    return new Map(rows.map((t) => [t.id, t.name]));
  }
}

/** Tên bàn hiện tại, lùi về `table_code` snapshot khi bàn đã bị xoá/đổi — cùng lệ màn Lịch sử. */
function toBrief(o: Order, names: ReadonlyMap<string, string>): OrderBrief {
  return {
    id: o.id,
    table: names.get(o.table_id) || o.table_code,
    opened_at: o.opened_at,
    closed_at: o.closed_at,
    transfer_amount: o.transfer_amount,
    state: orderStateOf(o),
    cashier: o.closed_at === null ? null : o.checked_out_by_full_name,
  };
}

// Mã lỗi riêng, NGOÀI `FRIENDLY_VN`, để câu giải thích tới được tay người dùng (CLAUDE.md §5).
function notFoundTxn() {
  return new NotFoundException({ code: 'BANK_TXN_NOT_FOUND', message: 'Không tìm thấy khoản tiền này.' });
}
function alreadyAssigned() {
  return new ConflictException({
    code: 'BANK_TXN_ALREADY_ASSIGNED',
    message: 'Khoản này vừa được gán vào một đơn khác. Tải lại trang để xem.',
  });
}
