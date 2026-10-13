/**
 * M7.D-12 — màn bếp ĐỌC THÀNH TIẾNG: "Bàn 5 gọi thêm đồ" / "Bàn 5 thanh toán".
 * Câu nói dựng ở FE từ tên bàn — BE không cần biết cách đọc.
 */

/** `restaurant_tables.code` là 'B01'..'B12' còn `name` là 'Bàn 1'.. — chuẩn hoá về dạng đọc
 *  được, và KHÔNG nhân đôi chữ "Bàn" khi tên đã có sẵn. */
export function tableSpeechName(name: string): string {
  const t = (name ?? '').trim();
  if (/^bàn\s/i.test(t)) return t;
  const digits = t.replace(/\D/g, '');
  return digits ? `Bàn ${Number(digits)}` : t;
}

export type SpeechCall = { table_name: string; kind: 'STAFF' | 'BILL' };

/**
 * Gộp theo NHỊP: 5 bàn gọi cùng lúc phải ra MỘT câu, không phải 5 câu nối đuôi nhau — đọc nối
 * đuôi thì câu cuối vang lên khi nhân viên đã quên câu đầu.
 */
export function buildSpeech(calls: readonly SpeechCall[]): string[] {
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const out: string[] = [];
  for (const kind of ['STAFF', 'BILL'] as const) {
    const names = calls
      .filter((c) => c?.kind === kind)
      .map((c) => tableSpeechName(c.table_name))
      .filter(Boolean);
    if (names.length === 0) continue;
    const verb = kind === 'STAFF' ? 'gọi thêm đồ' : 'thanh toán';
    // "Bàn 3, bàn 5 gọi thêm đồ" — viết thường từ bàn thứ hai cho câu liền mạch khi đọc.
    const joined = names.map((n, i) => (i === 0 ? n : n.toLowerCase())).join(', ');
    out.push(`${joined} ${verb}`);
  }
  return out;
}
