// Chữ cái cho avatar + tách nhãn [TEST] khỏi tên (2026-11-10).
//
// Avatar "[TEST] test_admin" từng hiện chữ "[" — lấy ký tự đầu thô. Tài khoản thử gắn tiền tố
// [TEST] để không lẫn với người thật; tiền tố đó là NHÃN, hiện thành badge riêng, không phải tên.

const TEST_TAG = /^\s*\[test\]\s*/i;

/** Tách tiền tố [TEST]: `{ name: 'test_admin', isTest: true }`. */
export function splitTestTag(raw: string): { name: string; isTest: boolean } {
  return TEST_TAG.test(raw) ? { name: raw.replace(TEST_TAG, ''), isTest: true } : { name: raw, isTest: false };
}

/** Chữ cái avatar: bỏ [TEST] + ký tự không phải chữ/số, lấy chữ đầu của TỪ CUỐI (tên người Việt —
 *  "Lương Tuấn Phương" → "P"). Không còn gì thì "?". */
export function initialOf(raw: string): string {
  const words = splitTestTag(raw)
    .name.split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  return words[words.length - 1][0].toUpperCase();
}
