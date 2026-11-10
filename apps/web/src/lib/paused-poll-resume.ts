// Tự nối lại nhịp poll SAU KHI màn đã tạm dừng vì lỗi mạng liên tiếp (2026-11-10, QA BUG-05).
//
// Lỗi gốc: màn Bếp poll 2 giây; 10 lỗi mạng liên tiếp (~20 giây wifi chập) thì tắt hẳn poll để
// khỏi xả request vô ích — nhưng KHÔNG có đường nào bật lại ngoài nút "làm mới" ở thanh dưới.
// Toast báo dừng tự tắt sau vài giây, nên bếp không biết: màn hình đứng ở "Chưa có món nào chờ
// làm" trong khi nhân viên đã gọi món. Đo bằng E2E: có mạng lại 20 giây vẫn không hiện món.
//
// Cách nối lại (không thêm UI nào):
//   - có mạng lại / quay lại tab / bấm vào màn hình → thử ngay 1 lần,
//   - không có tín hiệu nào (API khởi động lại, wifi chập mà trình duyệt vẫn tưởng còn mạng)
//     → thử 1 lần mỗi `PAUSED_RETRY_MS`.
// Mỗi lần thử là MỘT lượt tải (không bật lại nhịp 2 giây ngay): server còn chết thì một máy bếp
// chỉ tốn 6 lượt/phút thay vì 30. Thử được thì `resume()` bật lại nhịp 2 giây như cũ.
//
// Nhận `win`/`doc` qua tham số chỉ để test chạy được trong Node (apps/web không có jsdom).

/** Nhịp thử lại khi đang tạm dừng. 10 giây: bếp thấy món mới chậm nhất ~10s sau khi mạng về. */
export const PAUSED_RETRY_MS = 10_000;

export function attachPausedPollResume(opts: {
  /** Poll có đang bị tạm dừng không. `false` thì không làm gì cả. */
  isPaused: () => boolean;
  /** Tải lại 1 lần, trả `true` nếu thành công. Không được ném lỗi. */
  probe: () => Promise<boolean>;
  /** Bật lại nhịp poll thường. */
  resume: () => void;
  win?: EventTarget;
  doc?: EventTarget & { hidden: boolean };
  retryMs?: number;
}): () => void {
  const win = opts.win ?? window;
  const doc = opts.doc ?? document;
  let inFlight = false;
  let stopped = false;

  const tryResume = async (): Promise<void> => {
    if (stopped || inFlight || doc.hidden || !opts.isPaused()) return;
    inFlight = true;
    try {
      if ((await opts.probe()) && !stopped) opts.resume();
    } finally {
      inFlight = false;
    }
  };
  const onSignal = (): void => {
    void tryResume();
  };

  win.addEventListener('online', onSignal);
  win.addEventListener('focus', onSignal);
  doc.addEventListener('visibilitychange', onSignal);
  const timer = setInterval(onSignal, opts.retryMs ?? PAUSED_RETRY_MS);

  return () => {
    stopped = true;
    win.removeEventListener('online', onSignal);
    win.removeEventListener('focus', onSignal);
    doc.removeEventListener('visibilitychange', onSignal);
    clearInterval(timer);
  };
}
