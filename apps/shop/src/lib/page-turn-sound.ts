/**
 * Tiếng lật giấy của quyển menu điện tử — TỔNG HỢP tại chỗ bằng Web Audio, không tải một
 * file âm thanh nào.
 *
 * VÌ SAO KHÔNG DÙNG FILE MP3: một tiếng lật giấy nghe được là ~15–40 KB. Trang này mở trên
 * 3G ở quán, và mọi byte đang được đếm (xem `bundle:budget`) — đổi 30 KB để lấy một tiếng
 * "xoạt" là món đắt. Tiếng giấy lại đúng là loại âm dễ tổng hợp nhất: nó là NHIỄU TRẮNG
 * được lọc băng và tắt nhanh, không có cao độ, không có hoà âm. Vài dòng dưới đây tả đúng
 * hiện tượng vật lý đó.
 *
 * CÔNG THỨC: nhiễu trắng → lọc băng thông (bandpass) quét từ ~1,7 kHz xuống ~450 Hz →
 * đường bao âm lượng vào nhanh, tắt trong ~260 ms.
 *   · Quét tần số xuống thấp = tờ giấy đi từ chỗ căng (mép vừa bật ra) sang chỗ mềm (giấy
 *     đã nằm xuống). Giữ tần số cố định thì nghe như tiếng xì hơi, không ra tiếng giấy.
 *   · Q thấp (0,7) để băng rộng — giấy là tiếng ồn dải rộng, Q cao ra tiếng rít điện tử.
 *   · Cộng một cú "tách" cực ngắn ở đầu: tiếng mép giấy bật khỏi ngón tay. Thiếu nó thì
 *     tiếng lật bắt đầu một cách mềm oặt, không ai tin là giấy.
 */

/** Một `AudioContext` dùng chung cho cả trang. Tạo LẦN ĐẦU khi khách thật sự lật một trang:
 *  mọi trình duyệt đều chặn âm thanh khởi tạo ngoài một cử chỉ của người dùng. */
let ctx: AudioContext | null = null;
/** Đệm nhiễu trắng 1 giây — dựng một lần rồi dùng lại, không dựng mỗi cú lật. */
let noise: AudioBuffer | null = null;

type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function audioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const g = globalThis as WithWebkit;
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Bật tiếng lật một cái.
 *
 * KHÔNG BAO GIỜ NÉM LỖI: âm thanh là thứ trang trí, và có đủ lý do để nó không chạy được
 * (máy tắt tiếng, trình duyệt chưa cho phép, Safari đang khoá context). Một trang menu
 * không được sập vì cái loa.
 *
 * Máy bật "giảm chuyển động" thì im: ở chế độ đó `--dur-page-turn` còn 0,01 ms nên trang
 * đổi tức thì, một tiếng xoạt 260 ms phát sau khi trang đã đổi xong chỉ là tiếng lạ.
 */
export function playPageTurn(): void {
  try {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const Ctor = audioContextClass();
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const audio = ctx;

    if (!noise) {
      const frames = Math.floor(audio.sampleRate);
      noise = audio.createBuffer(1, frames, audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const buffer = noise;
    const now = audio.currentTime;

    /**
     * Một lớp nhiễu đã lọc: dùng cho cả tiếng miết dài lẫn từng hạt lạo xạo.
     * `from`/`to` là tần số tâm của bộ lọc băng, quét trong đúng khoảng thời gian của lớp.
     */
    const layer = (
      at: number,
      dur: number,
      peak: number,
      from: number,
      to: number,
      q: number,
    ): void => {
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const band = audio.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = q;
      band.frequency.setValueAtTime(from, at);
      band.frequency.exponentialRampToValueAtTime(to, at + dur);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      // Vào chậm hơn ra: giấy phải chạm rồi mới miết, không bật ra tiếng ngay như tiếng gõ.
      gain.gain.linearRampToValueAtTime(peak, at + dur * 0.34);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(band).connect(gain).connect(audio.destination);
      src.start(at, Math.random() * 0.85, dur);
      src.stop(at + dur);
    };

    /*
     * VÌ SAO BẢN TRƯỚC NGHE GIẢ (chủ quán: "rất giả chân"): nó là MỘT lớp nhiễu trắng lọc
     * băng, tắt dần đều — tai người nghe ra ngay "tiếng xì", vì âm thật của giấy không phải
     * một dải ồn liên tục.
     *
     * Tiếng giấy thật gồm ba thứ xảy ra cùng lúc:
     *   1. TIẾNG MIẾT dài, phổ rộng, tần số tụt dần khi tờ giấy từ căng sang mềm;
     *   2. HÀNG CHỤC HẠT LẠO XẠO rời rạc — mỗi sợi giấy bật khỏi sợi bên cạnh là một hạt
     *      cực ngắn (3–12 ms), thời điểm và cao độ đều lệch nhau. Đây là thứ quyết định
     *      "thật hay giả": bỏ nó ra là quay về tiếng xì.
     *   3. CÚ ĐẶT XUỐNG ở cuối: tờ giấy chạm mặt bàn, một tiếng trầm ngắn.
     *
     * 14 hạt rải theo phân bố lệch (`t*t`) nên dày ở đầu, thưa dần về sau — đúng lúc mép
     * giấy vừa bung ra là lúc nhiều sợi bật cùng nhau nhất.
     */
    const dur = 0.46;

    // 1. Tiếng miết.
    layer(now, dur, 0.1, 1500, 380, 0.6);
    layer(now + 0.02, dur * 0.7, 0.055, 3400, 900, 1.1);

    // 2. Hạt lạo xạo.
    for (let i = 0; i < 14; i += 1) {
      const t = i / 14;
      const at = now + t * t * dur * 0.95 + Math.random() * 0.012;
      const grain = 0.003 + Math.random() * 0.009;
      const freq = 2200 + Math.random() * 4200;
      layer(at, grain, 0.05 + Math.random() * 0.07, freq, freq * 0.7, 3.2);
    }

    // 3. Cú đặt xuống — trầm, rất ngắn, và chỉ ở cuối.
    const thud = audio.createBufferSource();
    thud.buffer = buffer;
    const low = audio.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const thudGain = audio.createGain();
    thudGain.gain.setValueAtTime(0.0001, now + dur * 0.82);
    thudGain.gain.linearRampToValueAtTime(0.075, now + dur * 0.86);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.06);
    thud.connect(low).connect(thudGain).connect(audio.destination);
    thud.start(now + dur * 0.82, Math.random() * 0.85, 0.14);
    thud.stop(now + dur + 0.08);
  } catch {
    // Im lặng là hành vi đúng ở đây — xem ghi chú trên.
  }
}
