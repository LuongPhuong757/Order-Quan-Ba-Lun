/**
 * Nạp trước đường đi mua hàng (chunk trang Giỏ + Đặt hàng) — gọi khi giỏ VỪA CÓ MÓN.
 *
 * Tách chunk giúp lần tải đầu nhẹ, nhưng đổi lại lần đầu bấm vào giỏ là một vòng request
 * mới. Giỏ → Đặt hàng là luồng KIẾM TIỀN, không được phép có nhịp chờ nào.
 *
 * ĐỔI THỜI ĐIỂM 2026-10-30: trước đây kéo về ngay khi máy rảnh sau lúc mở trang (main.tsx).
 * Đo prod: đó là ~9 request / ~65 kB chen vào lần tải đầu, trong khi đa số người bấm quảng cáo
 * chỉ xem menu rồi đi — khách công nhân đi 4G trả băng thông cho thứ họ không bao giờ mở. Giờ
 * kéo khi giỏ có món đầu tiên (hoặc giỏ cũ còn món lúc quay lại): từ lúc bấm "+" tới lúc bấm
 * vào giỏ luôn có vài giây, đủ để 2 chunk về máy — người mua vẫn không phải chờ.
 *
 * Gọi bao nhiêu lần cũng chỉ kéo một lần. Lỗi bỏ qua có chủ ý — đây chỉ là nạp trước, lát nữa
 * `React.lazy` sẽ tự thử lại thật.
 */
let started = false;

export function prefetchBuyingPath(): void {
  if (started) return;
  started = true;
  void import('../pages/CartPage.tsx').catch(() => {});
  void import('../pages/CheckoutPage.tsx').catch(() => {});
}
