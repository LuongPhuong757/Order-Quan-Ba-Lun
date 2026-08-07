// Lưới an toàn cho MỌI dữ liệu sống bằng SSE.
//
// Bài học 2026-08-06 (hai lần, hai chỗ): SSE CHẾT IM LẶNG. Proxy đóng stream, iPad khoá màn hình,
// wifi rớt mà `onerror` không bắn — `EventSource` trông vẫn "đang mở" và không bao giờ có event
// nữa. Bất cứ màn nào lấy SSE làm nguồn DUY NHẤT sẽ treo ở dữ liệu cũ mà nhìn thì vẫn bình
// thường: badge đơn chờ treo số cũ, rồi tới hàng chờ duyệt hiện "Không có đơn nào đang chờ" trong
// khi DB có đơn thật.
//
// Nên: SSE là đường NHANH, không phải đường duy nhất. Module này gắn 3 lưới luôn chạy song song —
//   1. poll định kỳ (bỏ nhịp khi tab ẩn),
//   2. quay lại tab / focus lại cửa sổ,
//   3. có mạng lại.
//
// Dùng chung 1 chỗ chứ không copy vào từng màn: đây là bất biến của cả hệ, và nơi duy nhất
// biết cách tự chữa khi stream chết.

/** Khoảng cách tối thiểu giữa 2 lần refresh do tín hiệu dồn dập (event SSE liên tiếp, alt-tab
 * liên tục). Không có phanh này thì 5 tín hiệu trong 1 giây thành 5 lượt GET. */
export const MIN_REFRESH_GAP_MS = 400;

export type RefreshTriggers = {
  /** Gỡ hết listener + timer. `useEffect` PHẢI gọi khi unmount. */
  stop(): void;
  /**
   * Refresh NGAY qua cùng cửa throttle với poll/visibility — dùng cho tín hiệu bên ngoài (event
   * SSE, người dùng bấm làm mới). Cho SSE đi qua đây thay vì gọi thẳng `refresh` để một tràng
   * event dồn dập không thành một tràng request.
   */
  fire(): void;
  /**
   * Báo "dữ liệu VỪA được làm mới bằng đường khác" (SSE vừa đẩy về, trang tự fetch theo nhịp
   * riêng, người dùng bấm làm mới). Tác dụng: dời nhịp poll về sau và chặn tín hiệu trùng trong
   * cửa sổ throttle — nhờ vậy poll chỉ thực sự chạy khi KHÔNG còn đường nào khác hoạt động.
   */
  noteFresh(): void;
};

export function attachRefreshTriggers(opts: {
  /** Gọi để tải lại dữ liệu. Đã qua throttle, cứ chạy. */
  refresh: () => void;
  /** Nhịp poll dự phòng. */
  pollMs: number;
  minGapMs?: number;
}): RefreshTriggers {
  const minGap = opts.minGapMs ?? MIN_REFRESH_GAP_MS;
  let lastFreshMs = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function noteFresh(): void {
    lastFreshMs = Date.now();
    // Dời nhịp poll: đường khác đang nuôi dữ liệu thì poll không cần chen vào.
    if (pollTimer) restartPoll();
  }

  function fire(): void {
    if (stopped) return;
    if (Date.now() - lastFreshMs < minGap) return;
    lastFreshMs = Date.now();
    opts.refresh();
  }

  function restartPoll(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      // Tab ẩn → khỏi poll (điện thoại nhân viên khoá màn hình cả tiếng). Lúc hiện lại,
      // `onVisible` refresh ngay nên không mất cập nhật nào.
      if (document.hidden) return;
      fire();
    }, opts.pollMs);
  }

  const onVisible = (): void => {
    if (!document.hidden) fire();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', fire);
  restartPoll();

  return {
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', fire);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
    fire,
    noteFresh,
  };
}
