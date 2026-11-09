// Cửa gọi sang MISA meInvoice để phát hành hoá đơn BÁN HÀNG khởi tạo từ máy tính tiền (ký hiệu
// dạng 2C26M…) cho đơn thu vào mã QR hộ kinh doanh.
//
// Viết theo tài liệu developer.misa.vn/products-openapi/MEINVOICE (bản 2026-11-06, ClientID +
// ClientSecret thay cho appid cũ). Luồng:
//   1. POST /invoice/token — header ClientID + ClientSecret, body MST + tài khoản + mật khẩu.
//      Token sống 14 ngày → giữ trong bộ nhớ, hết hạn/bị từ chối thì lấy lại MỘT lần.
//   2. GET /invoice/templates — tìm ký hiệu hoá đơn M (giữ trong bộ nhớ theo năm).
//   3. POST /invoice/publishing — SignType 5 (máy tính tiền, không chữ ký số), 1 hoá đơn/request.
//   4. Lỗi bất kỳ → tra POST /invoice/status theo RefID: nếu MISA thực ra đã phát hành (lần trước
//      mất mạng lúc chờ trả lời, giờ gửi lại bị báo trùng) thì coi là THÀNH CÔNG, không báo lỗi.
//      RefID = orders.id, MISA bắt RefID duy nhất → gọi lại không bao giờ ra hai hoá đơn.
//
// Tài liệu bắt xử lý TUẦN TỰ theo từng ký hiệu (số hoá đơn liên tục). Poller đã tuần tự, nhưng
// nút "Phát hành lại" chạy song song với poller → provider tự xếp hàng (`serial`).
//
// Thông tin đăng nhập nằm ở BIẾN MÔI TRƯỜNG máy chủ, không nằm trong DB / màn Cài đặt (chủ quán
// chốt): không ai xem được mật khẩu qua web. KHÔNG ghi token/mật khẩu ra log.
//
// ⚠ Tài liệu chỉ có MỘT base URL (cổng developer.misa.vn) — thử hay thật là do TÀI KHOẢN (tài
// khoản sandbox MISA cấp vs tài khoản thật của quán). Gọi bằng tài khoản thật = hoá đơn thật lên
// cơ quan thuế, không rút lại được.

import { Injectable, Logger } from '@nestjs/common';
import type { EInvoiceDraft } from './einvoice-rules.js';
import {
  MEINVOICE_SIGN_TYPE_MTT,
  buildInvoiceData,
  chooseTemplate,
  misaErrorText,
  parsePublishResult,
  parseStatusResult,
  parseTemplates,
  pick,
  str,
  vnDate,
  type MeInvoiceTemplate,
} from './meinvoice-payload.js';

export type EInvoiceIssueResult = {
  /** Số hoá đơn hiện cho người đứng quầy + ghi vào `orders.misa_ref`. ≤ 64 ký tự. */
  invoice_no: string;
};

/** Lỗi có câu tiếng Việt đọc được — hiện NGUYÊN VĂN ở màn Lịch sử cạnh nút "Phát hành lại".
 *
 *  `uncertain = true`: KHÔNG BIẾT hoá đơn đã ra hay chưa (mất mạng giữa lúc gửi, MISA đang xử lý,
 *  báo thành công mà không có số, báo trùng mà tra không ra). Khác hẳn lỗi chắc chắn (MISA từ chối
 *  rõ ràng, thiếu cấu hình): với lỗi "không biết", người thu mà XUẤT TAY là có thể ra hoá đơn thứ
 *  hai — nên service giữ đơn ở PENDING để máy tự tra lại theo RefID, và màn hình dặn đừng xuất tay. */
export class EInvoiceError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}

export interface EInvoiceProvider {
  issue(draft: EInvoiceDraft): Promise<EInvoiceIssueResult>;
}

export const MEINVOICE_DEFAULT_BASE_URL = 'https://developer.misa.vn/apis/itg/meinvoice';
/** Token sống 14 ngày theo tài liệu — tự làm mới sớm 1 ngày cho chắc. */
const TOKEN_TTL_MS = 13 * 24 * 3600_000;
const HTTP_TIMEOUT_MS = 30_000;

export type MeInvoiceConfig = {
  base_url: string;
  client_id: string;
  client_secret: string;
  tax_code: string;
  username: string;
  password: string;
  /** Ký hiệu hoá đơn muốn dùng; `null` = tự chọn khi tài khoản chỉ có một ký hiệu M. */
  inv_series: string | null;
};

/** Đọc cấu hình từ env. Thiếu biến BẮT BUỘC → `null` (chưa cài, không phải lỗi lập trình).
 *  `MEINVOICE_BASE_URL` và `MEINVOICE_INV_SERIES` không bắt buộc. */
export function readMeInvoiceConfig(env: NodeJS.ProcessEnv = process.env): MeInvoiceConfig | null {
  const required = {
    client_id: env.MEINVOICE_CLIENT_ID ?? '',
    client_secret: env.MEINVOICE_CLIENT_SECRET ?? '',
    tax_code: env.MEINVOICE_TAX_CODE ?? '',
    username: env.MEINVOICE_USERNAME ?? '',
    password: env.MEINVOICE_PASSWORD ?? '',
  };
  if (!Object.values(required).every((v) => v.trim() !== '')) return null;
  return {
    ...required,
    base_url: (env.MEINVOICE_BASE_URL?.trim() || MEINVOICE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    inv_series: env.MEINVOICE_INV_SERIES?.trim() || null,
  };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

@Injectable()
export class MeInvoiceProvider implements EInvoiceProvider {
  private readonly logger = new Logger(MeInvoiceProvider.name);
  private token: { value: string; expires_at: number } | null = null;
  private templateCache: { year: string; tpl: MeInvoiceTemplate } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Tách ra để test thay bằng bản giả — không phải tham số constructor vì Nest DI sẽ đi tìm nó. */
  fetchFn: FetchFn = (url, init) => fetch(url, init);
  now: () => number = () => Date.now();
  env: NodeJS.ProcessEnv = process.env;

  async issue(draft: EInvoiceDraft): Promise<EInvoiceIssueResult> {
    // Chỉ để thử trọn luồng ở MÁY DEV: trả số hoá đơn giả, không gọi mạng. Cấm bật ở prod/dev
    // server — đơn sẽ hiện "đã phát hành" trong khi bên thuế không có gì.
    if (this.env.MEINVOICE_DRIVER === 'fake') {
      // Chốt chặn: đặt nhầm biến này trên production là mọi đơn ghi "đã phát hành" mà bên thuế
      // không có gì — chặn cứng thay vì tin người cấu hình.
      if (this.env.NODE_ENV === 'production') {
        throw new EInvoiceError('MEINVOICE_DRIVER=fake bị cấm trên production — gỡ biến này trên máy chủ');
      }
      return { invoice_no: `TEST-${draft.ref_id.slice(0, 8)}` };
    }
    const cfg = readMeInvoiceConfig(this.env);
    if (!cfg) {
      throw new EInvoiceError('Chưa cài kết nối meInvoice trên máy chủ (thiếu ClientID / ClientSecret / MST / tài khoản)');
    }
    if (draft.lines.length === 0 || draft.total <= 0) {
      throw new EInvoiceError('Đơn không có món tính tiền — không phát hành hoá đơn');
    }
    return this.serial(() => this.issueNow(cfg, draft));
  }

  // ─── Dùng cho script thử `src/cli/meinvoice-thu.ts` — KHÔNG phát hành gì ───────────────

  /** Đăng nhập thử: trả về độ dài token (không trả token — khỏi lộ ra màn hình/log). */
  async checkLogin(): Promise<number> {
    const cfg = this.requireConfig();
    this.token = null;
    return (await this.getToken(cfg)).length;
  }

  /** Mọi mẫu/ký hiệu tài khoản đang có + ký hiệu app sẽ chọn (hoặc lý do không chọn được). */
  async listTemplates(): Promise<{ all: MeInvoiceTemplate[]; chosen: MeInvoiceTemplate | string }> {
    const cfg = this.requireConfig();
    const year = vnDate(this.now()).slice(0, 4);
    const body = await this.call(cfg, `/invoice/templates?invoiceWithCode=true&year=${year}`, { method: 'GET' });
    const all = parseTemplates(body);
    if (all.length === 0) {
      throw new EInvoiceError(`Không đọc được danh sách mẫu: ${misaErrorText(body) ?? JSON.stringify(body).slice(0, 300)}`);
    }
    return { all, chosen: chooseTemplate(all, cfg.inv_series) };
  }

  /** Xem trước hoá đơn (`/invoice/unpublishview`) — KHÔNG phát hành. Trả link PDF sống 5 phút. */
  async preview(draft: EInvoiceDraft): Promise<string> {
    const cfg = this.requireConfig();
    const tpl = await this.template(cfg);
    const body = await this.call(cfg, '/invoice/unpublishview', {
      method: 'POST',
      body: buildInvoiceData(draft, tpl, this.now()),
    });
    const link = str(pick(body, 'Data'));
    if (!link) throw new EInvoiceError(`Xem trước lỗi: ${misaErrorText(body) ?? JSON.stringify(body).slice(0, 300)}`);
    return link;
  }

  private requireConfig(): MeInvoiceConfig {
    const cfg = readMeInvoiceConfig(this.env);
    if (!cfg) throw new EInvoiceError('Thiếu biến MEINVOICE_* (ClientID / ClientSecret / MST / tài khoản / mật khẩu)');
    return cfg;
  }

  /** Xếp hàng: lần gọi sau chờ lần trước xong (thành công hay lỗi) mới chạy. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async issueNow(cfg: MeInvoiceConfig, draft: EInvoiceDraft): Promise<EInvoiceIssueResult> {
    // Lỗi ở đây (đăng nhập, mẫu) xảy ra TRƯỚC khi gửi hoá đơn → chắc chắn chưa phát hành.
    const tpl = await this.template(cfg);
    let failure: string;
    // Mặc định "không biết": chỉ hạ xuống "chắc chắn" khi MISA từ chối rõ ràng bằng mã lỗi.
    let uncertain = true;
    try {
      const { status, body } = await this.callRaw(cfg, '/invoice/publishing', {
        method: 'POST',
        body: { SignType: MEINVOICE_SIGN_TYPE_MTT, InvoiceData: [buildInvoiceData(draft, tpl, this.now())] },
      });
      const out = parsePublishResult(body, draft.ref_id);
      if (out.ok) {
        if (out.invoice_no) return { invoice_no: out.invoice_no };
        failure = 'meInvoice báo thành công nhưng chưa trả số hoá đơn';
      } else {
        failure = `meInvoice từ chối: ${out.message}`;
        // CHẮC CHẮN chưa ra chỉ khi: HTTP 2xx + lỗi nằm trong kết quả CỦA CHÍNH HOÁ ĐƠN NÀY (MISA đã
        // nhìn và từ chối) + không phải báo trùng. Cổng 5xx/429/504 kèm JSON, hay lỗi cả request,
        // thì có thể MISA đã xử lý xong phía sau rồi mới hỏng ở cổng → "không biết" (review
        // 2026-11-09: coi những lỗi đó là chắc chắn là đẩy người thu đi xuất tay ra hoá đơn thứ hai).
        const isDup = /dup|trùng/i.test(`${out.error_code ?? ''} ${out.message}`);
        uncertain = !(status >= 200 && status < 300 && out.item_level && !isDup);
        // Ký hiệu có thể vừa đổi/ngừng trên meInvoice → lần sau đọc lại danh sách mẫu.
        this.templateCache = null;
      }
    } catch (err) {
      if (!(err instanceof EInvoiceError)) throw err;
      // Mất mạng / MISA không trả lời giữa lúc gửi: hoá đơn có thể đã ra.
      failure = err.message;
    }
    // Chốt chặn phát hành trùng: hỏi lại theo RefID trước khi báo lỗi.
    const st = await this.lookup(cfg, draft.ref_id).catch(() => null);
    if (st && (st.status === 'ISSUED' || st.status === 'PROCESSING') && st.invoice_no) {
      this.logger.log(`meinvoice: đơn ${draft.ref_id} đã có hoá đơn ${st.invoice_no} (tra theo RefID)`);
      return { invoice_no: st.invoice_no };
    }
    if (st && (st.status === 'ISSUED' || st.status === 'PROCESSING')) {
      // Hoá đơn TỒN TẠI bên MISA nhưng chưa có số (máy tính tiền cấp mã thuế bất đồng bộ).
      throw new EInvoiceError('MISA đã nhận hoá đơn, đang chờ cấp số — máy sẽ tra lại', true);
    }
    throw new EInvoiceError(failure, uncertain);
  }

  /** Ký hiệu hoá đơn cho năm hiện tại (giờ VN). MISA tự đổi ký hiệu theo năm của InvDate. */
  private async template(cfg: MeInvoiceConfig): Promise<MeInvoiceTemplate> {
    const year = vnDate(this.now()).slice(0, 4);
    if (this.templateCache?.year === year) return this.templateCache.tpl;
    const body = await this.call(cfg, `/invoice/templates?invoiceWithCode=true&year=${year}`, { method: 'GET' });
    const ok = pick(body, 'Success');
    if (ok === false || ok === 'false') {
      throw new EInvoiceError(`Không lấy được mẫu hoá đơn: ${misaErrorText(body) ?? 'không rõ lý do'}`);
    }
    const chosen = chooseTemplate(parseTemplates(body), cfg.inv_series);
    if (typeof chosen === 'string') throw new EInvoiceError(chosen);
    this.templateCache = { year, tpl: chosen };
    return chosen;
  }

  /** Tra trạng thái hoá đơn theo RefID (inputType=2), loại máy tính tiền có mã. */
  private async lookup(cfg: MeInvoiceConfig, refId: string) {
    const body = await this.call(cfg, '/invoice/status?inputType=2&invoiceWithCode=true&invoiceCalcu=true', {
      method: 'POST',
      body: [refId],
    });
    return parseStatusResult(body);
  }

  /** Như `callRaw` nhưng chỉ lấy body — cho các lời gọi không cần phân biệt mã HTTP. */
  private async call(cfg: MeInvoiceConfig, path: string, req: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    return (await this.callRaw(cfg, path, req)).body;
  }

  /** Gọi API nghiệp vụ kèm token. Token hết hạn / bị từ chối → lấy token mới, thử lại ĐÚNG MỘT lần. */
  private async callRaw(
    cfg: MeInvoiceConfig,
    path: string,
    req: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(cfg);
      const { status, body } = await this.http(cfg, path, req.method, req.body, {
        ClientID: cfg.client_id,
        Authorization: `Bearer ${token}`,
      });
      const tokenRejected = status === 401 || /token/i.test(str(pick(body, 'ErrorCode')) ?? '');
      if (tokenRejected && attempt === 0) {
        this.token = null;
        continue;
      }
      if (status === 401 || status === 403) {
        throw new EInvoiceError(`meInvoice từ chối quyền truy cập (HTTP ${status}) — kiểm ClientID / tài khoản`);
      }
      if (status >= 400 && body === null) throw new EInvoiceError(`meInvoice lỗi HTTP ${status}`);
      return { status, body };
    }
  }

  private async getToken(cfg: MeInvoiceConfig): Promise<string> {
    if (this.token && this.token.expires_at > this.now()) return this.token.value;
    const { status, body } = await this.http(
      cfg,
      '/invoice/token',
      'POST',
      { taxcode: cfg.tax_code, username: cfg.username, password: cfg.password },
      { ClientID: cfg.client_id, ClientSecret: cfg.client_secret },
    );
    const value = str(pick(body, 'Data'));
    const ok = pick(body, 'Success');
    if (value && ok !== false && ok !== 'false') {
      this.token = { value, expires_at: this.now() + TOKEN_TTL_MS };
      return value;
    }
    // Tài khoản bật xác thực 2 bước: /token trả CustomData.Id và đòi mã OTP — máy chủ chạy tự
    // động không nhập OTP được.
    if (str(pick(pick(body, 'CustomData'), 'Id'))) {
      throw new EInvoiceError('Tài khoản meInvoice đang bật xác thực 2 bước — tắt 2FA cho tài khoản dùng để kết nối');
    }
    const why = misaErrorText(body) ?? (status >= 400 ? `HTTP ${status}` : 'không rõ lý do');
    throw new EInvoiceError(`Không đăng nhập được meInvoice: ${why}`);
  }

  private async http(
    cfg: MeInvoiceConfig,
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${cfg.base_url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      // Không ghi `err` đầy đủ: một số lỗi fetch kèm cả request (header có ClientSecret).
      this.logger.warn(`meinvoice: không gọi được ${path} — ${(err as Error).name}`);
      throw new EInvoiceError('Không kết nối được meInvoice (mạng chập hoặc MISA không trả lời)');
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  }
}
