import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { BankTxnAssignment } from './entities/bank-txn-assignment.entity.js';
import { BankTxnClass } from './entities/bank-txn-class.entity.js';
import { SupplierPayment } from '../suppliers/entities/supplier-payment.entity.js';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { PaymentQrAccount } from '../settings/entities/payment-qr-account.entity.js';
import {
  AUTO_MATCH_DAYS,
  CANDIDATE_DAYS,
  autoMatchPairs,
  dayGap,
  rankNccCandidates,
  vnDay,
} from './bank-ledger-ncc.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Đủ để cuộn chọn trên điện thoại. */
const CANDIDATE_LIMIT = 20;

/** Lần trả NCC, gọn đủ để chủ quán nhận ra "à tiền rau hôm thứ Hai". */
export type NccBrief = {
  payment_id: string;
  supplier: string;
  paid_on: string;
  amount: number;
  /** Tên tài khoản nguồn ghi trên phiếu, `null` với phiếu ghi trước 2026-10-15. */
  from_label: string | null;
};

/** Kết luận của chủ quán / máy về một khoản tiền, trả kèm mỗi dòng sổ. */
export type TxnClassInfo = {
  kind: 'NCC' | 'OUTSIDE' | 'UNSURE';
  via: 'auto' | 'manual';
  by_name: string | null;
  at: number;
  /** Chỉ khi `kind = 'NCC'` và lần trả còn tồn tại. */
  ncc: NccBrief | null;
};

export type NccCandidate = NccBrief & { exact: boolean; same_account: boolean; day_gap: number };

type By = { id: string | null; name: string | null };

/** 'YYYY-MM-DD' của một số ngày VN. */
function ymdOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Phân loại tiền ở sổ webhook: khoản nào là trả NCC, khoản nào ngoài quán (2026-11-18).
 *
 * Cùng nguyên tắc `BankLedgerLinkService`: KHÔNG sửa tiền ở đâu cả. Khớp NCC không đổi
 * `supplier_payments`, không đổi công nợ — chỉ nói "khoản ngân hàng này chính là lần trả đó".
 */
@Injectable()
export class BankLedgerClassService {
  constructor(private readonly ds: DataSource) {}

  /**
   * Máy tự khớp tiền RA trong kỳ đang xem với lần trả NCC. Gọi mỗi lần mở sổ — rẻ: chỉ đụng
   * khoản ra CHƯA có kết luận và phiếu CK CHƯA khớp, mỗi tháng vài chục dòng. Ghi hẳn xuống DB
   * (`via = 'auto'`) để số liệu không nhảy theo lần tải, và để chủ quán gỡ được.
   */
  async autoMatch(fromMs: number, toMs: number): Promise<void> {
    const pad = (AUTO_MATCH_DAYS + 1) * DAY_MS;
    const txns = await this.ds
      .getRepository(BankTransaction)
      .createQueryBuilder('t')
      .where("t.direction = 'out'")
      .andWhere('t.occurred_at BETWEEN :from AND :to', { from: new Date(fromMs - pad), to: new Date(toMs + pad) })
      .andWhere('NOT EXISTS (SELECT 1 FROM bank_txn_classes c WHERE c.bank_txn_id COLLATE utf8mb4_unicode_ci = t.id)')
      .getMany();
    if (txns.length === 0) return;

    const days = txns.map((t) => vnDay(t.occurred_at));
    const payments = await this.openPayments(
      ymdOfDay(Math.min(...days) - AUTO_MATCH_DAYS),
      ymdOfDay(Math.max(...days) + AUTO_MATCH_DAYS),
    );
    const accNo = await this.accountNos(payments.map((p) => p.paid_from_account_id));
    const pairs = autoMatchPairs(
      txns,
      payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paid_on: String(p.paid_on).slice(0, 10),
        account_no: p.paid_from_account_id ? accNo.get(p.paid_from_account_id) ?? null : null,
      })),
    );
    for (const pair of pairs) {
      try {
        await this.ds.getRepository(BankTxnClass).insert({
          bank_txn_id: pair.txn_id,
          kind: 'NCC',
          supplier_payment_id: pair.payment_id,
          via: 'auto',
          by_user_id: null,
          by_name: null,
          created_at: Date.now(),
        });
      } catch (e) {
        // Hai lần mở sổ cùng lúc cùng khớp một cặp — UNIQUE chặn người sau, không sao.
        if ((e as { code?: string }).code !== 'ER_DUP_ENTRY') throw e;
      }
    }
  }

  /** Kết luận cho cả trang sổ, vài truy vấn gộp. */
  async infoFor(txnIds: readonly string[]): Promise<Map<string, TxnClassInfo>> {
    if (txnIds.length === 0) return new Map();
    const rows = await this.ds.getRepository(BankTxnClass).findBy({ bank_txn_id: In([...txnIds]) });
    const briefs = await this.nccBriefs(rows.map((r) => r.supplier_payment_id).filter((v): v is string => !!v));
    return new Map(
      rows.map((r) => [
        r.bank_txn_id,
        {
          kind: r.kind,
          via: r.via,
          by_name: r.by_name,
          at: r.created_at,
          ncc: r.supplier_payment_id ? briefs.get(r.supplier_payment_id) ?? null : null,
        },
      ]),
    );
  }

  /** Lần trả NCC có thể là khoản tiền ra này: CK, ±3 ngày, chưa khớp khoản nào khác. */
  async nccCandidates(txnId: string): Promise<NccCandidate[]> {
    const txn = await this.outTxn(this.ds.manager, txnId);
    const day = vnDay(txn.occurred_at);
    const payments = await this.openPayments(ymdOfDay(day - CANDIDATE_DAYS), ymdOfDay(day + CANDIDATE_DAYS));
    const accNo = await this.accountNos(payments.map((p) => p.paid_from_account_id));
    const lite = payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paid_on: String(p.paid_on).slice(0, 10),
      account_no: p.paid_from_account_id ? accNo.get(p.paid_from_account_id) ?? null : null,
    }));
    const ranked = rankNccCandidates(txn, lite).slice(0, CANDIDATE_LIMIT);
    const briefs = await this.nccBriefs(ranked.map((p) => p.id));
    return ranked.flatMap((p) => {
      const b = briefs.get(p.id);
      if (!b) return [];
      return [{
        ...b,
        exact: p.amount === txn.amount,
        same_account: !!p.account_no && p.account_no === txn.account_no?.trim(),
        day_gap: dayGap(txn, p),
      }];
    });
  }

  /** Gán tay khoản tiền ra vào một lần trả NCC. Ghi đè "Chưa rõ" / "Ngoài quán" nếu có. */
  async assignNcc(txnId: string, paymentId: string, by: By): Promise<{ bank_txn_id: string; supplier_payment_id: string }> {
    if (!paymentId) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Chưa chọn lần trả NCC để gán.' });
    }
    return this.ds.transaction(async (m) => {
      const txn = await this.outTxn(m, txnId, true);
      const cur = await m.findOne(BankTxnClass, { where: { bank_txn_id: txn.id }, lock: { mode: 'pessimistic_write' } });
      if (cur?.kind === 'NCC') {
        throw new ConflictException({
          code: 'BANK_TXN_NCC_ALREADY',
          message: 'Khoản này đã khớp một lần trả NCC. Gỡ khớp trước rồi gán lại.',
        });
      }
      const pay = await m.findOne(SupplierPayment, { where: { id: paymentId } });
      if (!pay || pay.method !== 'TRANSFER') {
        throw new NotFoundException({ code: 'SUPPLIER_PAYMENT_NOT_FOUND', message: 'Không tìm thấy lần trả NCC bằng chuyển khoản này.' });
      }
      if (cur) await m.delete(BankTxnClass, { id: cur.id });
      try {
        await m.insert(BankTxnClass, {
          bank_txn_id: txn.id,
          kind: 'NCC',
          supplier_payment_id: pay.id,
          via: 'manual',
          by_user_id: by.id,
          by_name: by.name,
          created_at: Date.now(),
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictException({
            code: 'BANK_TXN_PAYMENT_TAKEN',
            message: 'Lần trả NCC này đã khớp một khoản ngân hàng khác. Tải lại trang để xem.',
          });
        }
        throw e;
      }
      return { bank_txn_id: txn.id, supplier_payment_id: pay.id };
    });
  }

  /** Gỡ khớp NCC: khoản quay về "Chưa rõ" và máy KHÔNG tự khớp lại nó nữa (hàng `UNSURE`). */
  async clearNcc(txnId: string, by: By): Promise<{ bank_txn_id: string; supplier_payment_id: string | null }> {
    return this.ds.transaction(async (m) => {
      const cur = await m.findOne(BankTxnClass, { where: { bank_txn_id: txnId }, lock: { mode: 'pessimistic_write' } });
      if (!cur || cur.kind !== 'NCC') {
        throw new NotFoundException({ code: 'BANK_TXN_NCC_NONE', message: 'Khoản này chưa khớp lần trả NCC nào.' });
      }
      await m.update(BankTxnClass, { id: cur.id }, {
        kind: 'UNSURE',
        supplier_payment_id: null,
        via: 'manual',
        by_user_id: by.id,
        by_name: by.name,
        created_at: Date.now(),
      });
      return { bank_txn_id: txnId, supplier_payment_id: cur.supplier_payment_id };
    });
  }

  /**
   * Đánh dấu "không phải tiền quán". Tiền vào chỉ đánh dấu được khi còn là tiền lạ (đã nối bàn
   * thì rõ ràng là tiền quán); tiền ra thì phải gỡ khớp NCC trước — một nút không được lặng lẽ
   * xoá một kết luận khác.
   */
  async markOutside(txnId: string, by: By): Promise<{ bank_txn_id: string }> {
    return this.ds.transaction(async (m) => {
      const txn = await m.findOne(BankTransaction, { where: { id: txnId }, lock: { mode: 'pessimistic_write' } });
      if (!txn) throw notFoundTxn();
      if (txn.direction === 'in') {
        const linked = !!txn.applied_intent_id || (await m.exists(BankTxnAssignment, { where: { bank_txn_id: txn.id } }));
        if (linked) {
          throw new ConflictException({
            code: 'BANK_TXN_LINKED_TABLE',
            message: 'Khoản này đã khớp bàn nên là tiền của quán. Gỡ gán bàn trước nếu muốn đổi.',
          });
        }
      }
      const cur = await m.findOne(BankTxnClass, { where: { bank_txn_id: txn.id }, lock: { mode: 'pessimistic_write' } });
      if (cur?.kind === 'OUTSIDE') return { bank_txn_id: txn.id };
      if (cur?.kind === 'NCC') {
        throw new ConflictException({
          code: 'BANK_TXN_NCC_ALREADY',
          message: 'Khoản này đang khớp một lần trả NCC. Gỡ khớp trước rồi mới đánh dấu ngoài quán.',
        });
      }
      if (cur) await m.delete(BankTxnClass, { id: cur.id });
      await m.insert(BankTxnClass, {
        bank_txn_id: txn.id,
        kind: 'OUTSIDE',
        supplier_payment_id: null,
        via: 'manual',
        by_user_id: by.id,
        by_name: by.name,
        created_at: Date.now(),
      });
      return { bank_txn_id: txn.id };
    });
  }

  /** Bỏ đánh dấu ngoài quán: tiền vào quay về tiền lạ, tiền ra quay về "Chưa rõ". */
  async unmarkOutside(txnId: string): Promise<{ bank_txn_id: string }> {
    const res = await this.ds.getRepository(BankTxnClass).delete({ bank_txn_id: txnId, kind: 'OUTSIDE' });
    if (!res.affected) {
      throw new NotFoundException({ code: 'BANK_TXN_NOT_OUTSIDE', message: 'Khoản này chưa được đánh dấu ngoài quán.' });
    }
    return { bank_txn_id: txnId };
  }

  private async outTxn(m: EntityManager, txnId: string, lock = false): Promise<BankTransaction> {
    const txn = await m.findOne(BankTransaction, {
      where: { id: txnId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!txn) throw notFoundTxn();
    if (txn.direction !== 'out') {
      throw new BadRequestException({ code: 'BANK_TXN_INCOMING', message: 'Chỉ tiền ra mới gán vào lần trả NCC được.' });
    }
    return txn;
  }

  /** Lần trả NCC bằng CK trong khoảng ngày, chưa khớp khoản ngân hàng nào. */
  private async openPayments(fromYmd: string, toYmd: string): Promise<SupplierPayment[]> {
    return this.ds
      .getRepository(SupplierPayment)
      .createQueryBuilder('sp')
      .where("sp.method = 'TRANSFER'")
      .andWhere('sp.paid_on BETWEEN :from AND :to', { from: fromYmd, to: toYmd })
      .andWhere(`NOT EXISTS (SELECT 1 FROM bank_txn_classes c
        WHERE c.supplier_payment_id COLLATE utf8mb4_unicode_ci = sp.id COLLATE utf8mb4_unicode_ci)`)
      .getMany();
  }

  /** `payment_qr_accounts.id` → số tài khoản. */
  private async accountNos(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((v): v is string => !!v))];
    if (uniq.length === 0) return new Map();
    const rows = await this.ds.getRepository(PaymentQrAccount).findBy({ id: In(uniq) });
    return new Map(rows.filter((r) => r.account_no).map((r) => [r.id, r.account_no!.trim()]));
  }

  private async nccBriefs(paymentIds: readonly string[]): Promise<Map<string, NccBrief>> {
    const uniq = [...new Set(paymentIds)];
    if (uniq.length === 0) return new Map();
    const pays = await this.ds.getRepository(SupplierPayment).findBy({ id: In(uniq) });
    if (pays.length === 0) return new Map();
    const sups = await this.ds
      .getRepository(Supplier)
      .find({ where: { id: In([...new Set(pays.map((p) => p.supplier_id))]) }, select: ['id', 'name'] });
    const name = new Map(sups.map((s) => [s.id, s.name]));
    return new Map(
      pays.map((p) => [
        p.id,
        {
          payment_id: p.id,
          supplier: name.get(p.supplier_id) ?? 'NCC đã xoá',
          paid_on: String(p.paid_on).slice(0, 10),
          amount: p.amount,
          from_label: p.paid_from_label,
        },
      ]),
    );
  }
}

// Mã lỗi riêng, NGOÀI `FRIENDLY_VN`, để câu giải thích tới được tay người dùng (CLAUDE.md §5).
function notFoundTxn() {
  return new NotFoundException({ code: 'BANK_TXN_NOT_FOUND', message: 'Không tìm thấy khoản tiền này.' });
}
