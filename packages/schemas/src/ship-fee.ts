import { z } from 'zod';

/**
 * Bảng phí giao hàng theo BẬC GIÁ TRỊ ĐƠN (chủ dự án chốt 2026-08-07).
 *
 * Ví dụ bảng quán đang muốn:
 *   đơn dưới 100k     → miễn phí 3 km,  vượt 5.000đ/km
 *   đơn từ 100k       → miễn phí 5 km,  vượt 5.000đ/km
 *   đơn từ 300k       → miễn phí 7 km,  vượt 5.000đ/km
 *   đơn từ 500k       → miễn phí 10 km, vượt 5.000đ/km
 *
 * ── VÌ SAO FILE NÀY NẰM Ở `packages/schemas` ──
 * Ba nơi phải ra CÙNG một con số cho cùng một đơn:
 *   1. trang khách  — phí tạm tính ở bước đặt hàng + bảng giá khách đọc,
 *   2. màn quản trị — số điền sẵn ô "Phí ship" lúc duyệt đơn,
 *   3. `apps/api`   — nguồn sự thật, tính từ `distance_km` đã lưu trong đơn.
 * `@order/schemas` là package DUY NHẤT mà cả ba đều đã phụ thuộc sẵn. Đặt công thức ở
 * `apps/api` rồi chép sang FE là cách chắc chắn nhất để một hôm nào đó khách đọc một giá và
 * nhân viên gọi lại báo một giá khác.
 *
 * File này KHÔNG có logic đo khoảng cách: `distance_km` luôn do BE tính (Haversine × hệ số
 * đường bộ, M2.D-49/D-50) và đi vào đây như một tham số.
 */

/** Làm tròn LÊN bội số 1.000đ — quán thu tiền mặt, không ai trả 12.347đ. Lên chứ không xuống:
 *  thà quán thu đủ còn hơn hụt, và số hiện cho khách không được thấp hơn số quán sẽ báo. */
const ROUND_TO_VND = 1_000;

export const ShipFeeTier = z.object({
  /**
   * Áp dụng cho đơn có TIỀN MÓN ≥ mốc này (không gồm phí ship). Bậc đầu tiên PHẢI là 0 —
   * thiếu nó thì đơn nhỏ rơi vào khoảng trống không có luật nào và hệ thống im lặng không tính
   * phí, đúng lúc quán cần thu nhất.
   */
  min_subtotal: z.number().int().nonnegative(),
  /** Bán kính miễn phí của bậc này. */
  free_km: z.number().int().nonnegative().max(100),
  /** Giá mỗi km VƯỢT ngoài bán kính miễn phí. 0 = bậc này miễn phí ship không giới hạn km. */
  per_km: z.number().int().nonnegative().max(200_000),
});
export type ShipFeeTier = z.infer<typeof ShipFeeTier>;

/** Trần số bậc — 6 dòng đã quá đủ cho một quán ăn, và bảng dài hơn thì khách không đọc nữa. */
export const MAX_SHIP_FEE_TIERS = 6;

/**
 * Bậc áp dụng cho một đơn, hoặc `null` khi bảng rỗng / không bậc nào phủ được số tiền này.
 *
 * Chọn bậc CAO NHẤT có `min_subtotal <= subtotal` (mốc là cận DƯỚI, tính cả bằng): đơn đúng
 * 100.000đ hưởng bậc "từ 100k", không phải bậc dưới nó.
 *
 * Không tin thứ tự mảng lưu trong DB — tự sắp lại. Chủ quán có thể đã thêm dòng xen giữa, và một
 * bảng "đúng nội dung, sai thứ tự" mà trả sai bậc là lỗi không ai nhìn ra được từ giao diện.
 */
export function resolveShipTier(tiers: ShipFeeTier[], subtotal: number): ShipFeeTier | null {
  const eligible = tiers
    .filter((t) => subtotal >= t.min_subtotal)
    .sort((a, b) => a.min_subtotal - b.min_subtotal);
  return eligible.length === 0 ? null : eligible[eligible.length - 1];
}

/** Bậc NGAY TRÊN bậc đang áp dụng — để nói với khách "mua thêm X nữa thì được miễn phí Y km".
 *  `null` khi khách đã ở bậc cao nhất. */
export function nextShipTier(tiers: ShipFeeTier[], subtotal: number): ShipFeeTier | null {
  const above = tiers
    .filter((t) => t.min_subtotal > subtotal)
    .sort((a, b) => a.min_subtotal - b.min_subtotal);
  return above.length === 0 ? null : above[0];
}

export type ShipFeeInput = {
  /** Km đường bộ ước tính (đã nhân `distance_factor`). `null` = chưa đo được. */
  distanceKm: number | null;
  /** TIỀN MÓN của đơn, không gồm phí ship (M2.D-62) — thứ quyết định bậc. */
  subtotal: number;
  /** Bảng bậc từ setting `ship_fee_tiers`. Rỗng = quán chưa cấu hình. */
  tiers: ShipFeeTier[];
};

export type ShipFeeResult = {
  /**
   * Phí giao, hoặc `null` khi KHÔNG được phép hứa với khách một con số nào:
   *   - `distanceKm === null` — quán chưa có toạ độ, hoặc khách không chia sẻ vị trí;
   *   - bảng bậc rỗng / không bậc nào phủ (quán chưa cấu hình).
   * `0` KHÁC HẲN `null`: nó là lời khẳng định "miễn phí".
   */
  fee: number | null;
  /** Bậc đã áp dụng — chỗ gọi dùng để viết câu "Đơn từ 100.000đ được miễn phí 5 km". */
  tier: ShipFeeTier | null;
};

/**
 * Phí giao tạm tính.
 *
 * Phần km vượt làm tròn LÊN km chẵn trước khi nhân giá (quán tính theo km chẵn; tính chặt hơn là
 * chỗ hụt tiền không ai để ý), rồi tiền làm tròn LÊN 1.000đ.
 *
 * LUÔN là ước tính: phí chốt thật là số nhân viên gõ lúc duyệt đơn (M2.D-62). Mọi chỗ hiển thị
 * con số này phải nói ra điều đó.
 */
export function computeShipFee({ distanceKm, subtotal, tiers }: ShipFeeInput): ShipFeeResult {
  const tier = resolveShipTier(tiers, subtotal);
  if (tier === null) return { fee: null, tier: null };
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return { fee: null, tier };
  }
  // Bậc miễn phí không giới hạn km: nói "0đ" chứ không phải "không biết" — đây là một luật rõ
  // ràng chủ quán đã đặt, không phải chỗ thiếu dữ liệu.
  if (tier.per_km <= 0) return { fee: 0, tier };

  const billableKm = Math.max(0, distanceKm - tier.free_km);
  if (billableKm <= 0) return { fee: 0, tier };

  const raw = Math.ceil(billableKm) * tier.per_km;
  return { fee: Math.ceil(raw / ROUND_TO_VND) * ROUND_TO_VND, tier };
}

/**
 * Bảng bậc đọc từ DB (`store_settings.value` là text, chủ quán/DBA có thể sửa tay) → mảng SẠCH,
 * đã sắp xếp, đã bỏ dòng hỏng và dòng trùng mốc.
 *
 * Dữ liệu rác KHÔNG được làm 500 trang khách: xấu nhất là bảng rỗng → hệ thống quay về hành vi
 * "không tự tính phí ship" như trước khi có tính năng này.
 */
export function normalizeShipFeeTiers(raw: unknown): ShipFeeTier[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw
    .map((row) => ShipFeeTier.safeParse(row))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .sort((a, b) => a.min_subtotal - b.min_subtotal)
    .filter((tier) => {
      if (seen.has(tier.min_subtotal)) return false; // Trùng mốc: giữ dòng đầu, bỏ dòng sau.
      seen.add(tier.min_subtotal);
      return true;
    })
    .slice(0, MAX_SHIP_FEE_TIERS);
}
