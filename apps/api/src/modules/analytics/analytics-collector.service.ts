// Bộ thu ping truy cập. Điểm cốt tử của module này là: ĐƯỜNG REQUEST CỦA KHÁCH KHÔNG CHẠM DB.
//
// `record()` chỉ ghi vào Map trong RAM rồi trả về ngay (controller trả 204 không body), một
// `@Interval` 10 giây gộp cả Map thành 2 câu UPSERT nhiều dòng. Vì sao phải làm vậy chứ không
// ghi thẳng:
//   - Pool MySQL của app là 50 connection và ĐANG bị chia cho các UI polling 2s
//     (xem `data-source.ts`). Thêm 1 INSERT đồng bộ mỗi lượt xem trang là thêm một nguồn
//     tranh chấp connection vào đúng cái pool đang phục vụ màn bếp/màn order.
//   - Khách vào bằng 3G: thống kê không bao giờ được đứng trước nội dung. Ping là
//     fire-and-forget ở FE + ghi trễ ở BE, hỏng cả hai đầu thì mất SỐ, không mất TRẢI NGHIỆM.
//
// Đánh đổi đã biết và chấp nhận: app restart/deploy giữa 2 nhịp flush thì mất tối đa 10 giây
// ping. Thống kê marketing không cần đúng đến từng lượt, đơn hàng thì đã có bảng riêng.
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { mergeHit, pageViewDeltas, type BufferedSession, type VisitHit } from './visit-hit.js';

const FLUSH_MS = 10_000;

// Trần bộ đệm — chống phình RAM khi bị bắn spam (hoặc khi DB chết làm flush fail liên tục).
// 5000 phiên ≈ vài trăm KB. Vượt trần thì DROP ping của phiên MỚI (phiên đã có trong đệm vẫn
// được cập nhật), vì mất số của khách thứ 5001 là hậu quả nhẹ nhất trong các lựa chọn.
const MAX_SESSIONS_BUFFER = 5_000;
// `web_page_views_daily` bị chặn cardinality từ trước bởi `KNOWN_PATHS` (≈8 đường dẫn), trần
// này chỉ là dây bảo hiểm thứ hai.
const MAX_PV_BUFFER = 2_000;

// Số dòng tối đa trong một câu INSERT. Giữ nhỏ để không đụng `max_allowed_packet` và để một
// câu chậm không giữ connection quá lâu.
const CHUNK = 200;

@Injectable()
export class AnalyticsCollectorService implements OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsCollectorService.name);

  /** session_id → dòng đang gộp. */
  private sessions = new Map<string, BufferedSession>();
  /** `${day_key}|${path}` → số lượt cộng thêm. */
  private pageViews = new Map<string, { day_key: string; path: string; views: number }>();
  private dropped = 0;
  private flushing = false;

  // Dùng pool có sẵn của Nest — TUYỆT ĐỐI không tự tạo DataSource thứ hai
  // (xem cảnh báo ở `maintenance-cron.service.ts`).
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Gọi từ controller. Đồng bộ, không I/O, không throw. */
  record(hit: VisitHit): void {
    try {
      const existing = this.sessions.get(hit.session_id);
      if (!existing && this.sessions.size >= MAX_SESSIONS_BUFFER) {
        this.dropped += 1;
        return;
      }
      this.sessions.set(hit.session_id, mergeHit(existing, hit));

      for (const d of pageViewDeltas(hit)) {
        const key = `${d.day_key}|${d.path}`;
        const cur = this.pageViews.get(key);
        if (!cur) {
          if (this.pageViews.size >= MAX_PV_BUFFER) continue;
          this.pageViews.set(key, d);
        } else {
          cur.views += d.views;
        }
      }
    } catch (err) {
      // Thống kê KHÔNG được làm lỗi request của khách trong bất kỳ trường hợp nào.
      this.logger.warn(`analytics record failed: ${(err as Error).message}`);
    }
  }

  @Interval(FLUSH_MS)
  async flushTick(): Promise<void> {
    await this.flush();
  }

  // Deploy/restart: cố gắng ghi nốt phần đang đệm thay vì bỏ luôn 10s cuối.
  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  async flush(): Promise<void> {
    // Nhịp trước còn đang chạy (DB chậm) → bỏ nhịp này, không xếp hàng chồng nhau.
    if (this.flushing) return;
    if (this.sessions.size === 0 && this.pageViews.size === 0) return;
    this.flushing = true;

    // Đổi bộ đệm TRƯỚC khi await: ping đến trong lúc đang ghi rơi vào Map mới, không bị mất
    // và cũng không bị ghi hai lần.
    const sessions = [...this.sessions.values()];
    const pageViews = [...this.pageViews.values()];
    const dropped = this.dropped;
    this.sessions = new Map();
    this.pageViews = new Map();
    this.dropped = 0;

    try {
      for (let i = 0; i < sessions.length; i += CHUNK) {
        await this.upsertSessions(sessions.slice(i, i + CHUNK));
      }
      for (let i = 0; i < pageViews.length; i += CHUNK) {
        await this.upsertPageViews(pageViews.slice(i, i + CHUNK));
      }
      if (dropped > 0) {
        this.logger.warn(`analytics: bỏ ${dropped} ping vì bộ đệm đầy (trần ${MAX_SESSIONS_BUFFER})`);
      }
    } catch (err) {
      // Mất một nhịp thống kê là chấp nhận được; KHÔNG retry (retry lúc DB đang ngộp là đổ
      // thêm dầu vào lửa) và KHÔNG throw (throw trong @Interval làm bẩn log, không ai xử lý).
      this.logger.error(`analytics flush failed (mất ${sessions.length} phiên): ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  private async upsertSessions(rows: BufferedSession[]): Promise<void> {
    const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const params: unknown[] = [];
    for (const r of rows) {
      params.push(
        r.session_id, r.app, r.first_seen_ms, r.last_seen_ms, r.page_views,
        r.entry_path, r.last_path, r.referrer_host, r.device, r.ip_hash, r.customer_phone,
      );
    }
    // 3 quy tắc gộp dưới đây PHẢI khớp `mergeHit()` (min/max/max) — xem docblock hàm đó.
    // `VALUES(col)` là cú pháp cũ nhưng vẫn chạy trên MySQL 8.0 (bản đang dùng ở
    // docker-compose*.yml); cú pháp mới `AS new` chỉ có từ 8.0.19 nên không dùng để câu SQL
    // này còn chạy được nếu ai đó hạ image xuống 5.7.
    await this.ds.query(
      `INSERT INTO web_visit_sessions
         (session_id, app, first_seen_ms, last_seen_ms, page_views,
          entry_path, last_path, referrer_host, device, ip_hash, customer_phone)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         first_seen_ms  = LEAST(first_seen_ms, VALUES(first_seen_ms)),
         last_seen_ms   = GREATEST(last_seen_ms, VALUES(last_seen_ms)),
         page_views     = GREATEST(page_views, VALUES(page_views)),
         last_path      = VALUES(last_path),
         customer_phone = COALESCE(customer_phone, VALUES(customer_phone))`,
      params,
    );
  }

  private async upsertPageViews(
    rows: Array<{ day_key: string; path: string; views: number }>,
  ): Promise<void> {
    const placeholders = rows.map(() => '(?,?,?)').join(',');
    const params: unknown[] = [];
    for (const r of rows) params.push(r.day_key, r.path, r.views);
    await this.ds.query(
      `INSERT INTO web_page_views_daily (day_key, path, views)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE views = views + VALUES(views)`,
      params,
    );
  }

  /** Chỉ dùng cho test/chẩn đoán. */
  bufferSize(): { sessions: number; page_views: number } {
    return { sessions: this.sessions.size, page_views: this.pageViews.size };
  }
}
