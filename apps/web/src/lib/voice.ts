/**
 * M7.D-12 — màn bếp ĐỌC THÀNH TIẾNG VIỆT khi khách bấm "Gọi nhân viên" / "Xin tính tiền".
 *
 * Dựng theo ĐÚNG khuôn `bell.ts`: `unlock()` / `speak()` / `dispose()`, mọi hàm bọc try/catch
 * và KHÔNG BAO GIỜ throw. Giọng nói là lớp phụ trợ — thẻ chữ trên màn mới là nguồn sự thật.
 * Nó hỏng thì màn bếp vẫn phải dùng được bình thường.
 *
 * ⚠⚠ NHIỀU MÁY BẾP — công tắc đọc MẶC ĐỊNH TẮT, chủ quán bật trên ĐÚNG MỘT máy. ⚠⚠
 * Thiếu dòng này thì sẽ bị báo là bug "3 máy đọc chồng nhau". Lựa chọn lưu localStorage theo
 * MÁY, không theo tài khoản — hai máy cùng đăng nhập một tài khoản là chuyện thường ở quán.
 *
 * Hai cái bẫy của Web Speech API đã xử:
 *  1. `getVoices()` trả MẢNG RỖNG ở lần gọi đầu trên Chrome — danh sách giọng nạp bất đồng bộ,
 *     phải chờ sự kiện `voiceschanged`. Chọn giọng ngay lúc khởi tạo là luôn trượt.
 *  2. Windows thường KHÔNG có giọng `vi-VN`. Khi đó vẫn đọc bằng giọng mặc định (nghe như người
 *     nước ngoài đọc tiếng Việt, nhưng vẫn phân biệt được số bàn) và LUÔN kèm tiếng chuông
 *     trước câu nói — để trường hợp xấu nhất vẫn còn một tín hiệu nghe được.
 */

export type Voice = {
  /** Gọi TRONG handler của user gesture. Giống `bell.unlock`: trình duyệt chặn phát âm thanh
   *  trước khi người dùng chạm vào trang. */
  unlock(opts?: { silent?: boolean }): 'ok' | 'blocked';
  /** Chưa mở khoá → im lặng bỏ qua, không throw, không log ồn. */
  speak(text: string): void;
  dispose(): void;
};

const LANG = 'vi-VN';

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

export function createVoice(): Voice {
  let unlocked = false;
  let viVoice: SpeechSynthesisVoice | null = null;
  let onVoicesChanged: (() => void) | null = null;

  const pickVoice = () => {
    try {
      const s = synth();
      if (!s) return;
      const all = s.getVoices();
      if (!all || all.length === 0) return; // bẫy 1 — chờ `voiceschanged`
      viVoice = all.find((v) => v.lang === LANG) ?? all.find((v) => v.lang?.startsWith('vi')) ?? null;
    } catch {
      viVoice = null;
    }
  };

  try {
    const s = synth();
    if (s) {
      pickVoice();
      onVoicesChanged = () => pickVoice();
      s.addEventListener?.('voiceschanged', onVoicesChanged);
    }
  } catch {
    /* không có speechSynthesis — speak() sẽ im lặng bỏ qua */
  }

  return {
    unlock(opts) {
      try {
        const s = synth();
        if (!s) return 'blocked';
        // Phát một câu RỖNG để "mồi" quyền phát âm thanh trong chính cú chạm này — cùng ngữ
        // nghĩa `ctx.resume()` của bell.ts. Không await gì trước đó, user activation ngắn hạn.
        const u = new SpeechSynthesisUtterance(opts?.silent ? ' ' : 'Đã bật đọc');
        u.lang = LANG;
        if (viVoice) u.voice = viVoice;
        u.volume = opts?.silent ? 0 : 1;
        s.speak(u);
        unlocked = true;
        pickVoice();
        return 'ok';
      } catch {
        return 'blocked';
      }
    },

    speak(text) {
      try {
        if (!unlocked) return;
        const s = synth();
        if (!s || !text) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LANG;
        if (viVoice) u.voice = viVoice;
        u.rate = 0.95; // chậm hơn mặc định một chút — quán ồn, số bàn phải nghe rõ
        s.speak(u);
      } catch {
        /* giọng nói là lớp phụ — nuốt lỗi, thẻ chữ trên màn vẫn còn */
      }
    },

    dispose() {
      try {
        const s = synth();
        if (s && onVoicesChanged) s.removeEventListener?.('voiceschanged', onVoicesChanged);
        s?.cancel();
      } catch {
        /* bỏ qua */
      }
    },
  };
}

const VOICE_ENABLED_KEY = 'qbl.kds.voice.v1';

/** M7 §3.7 — MẶC ĐỊNH TẮT. Nhiều máy bếp cùng bật là đọc chồng nhau. */
export function isVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setVoiceEnabled(on: boolean): void {
  try {
    localStorage.setItem(VOICE_ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* bỏ qua — phiên này vẫn chạy, chỉ không nhớ được lựa chọn */
  }
}
