// Cửa vào cũ của luật "món tự thêm" (khăn lạnh) cho apps/web.
//
// ⚠ 2026-10-01 (M7) — LUẬT ĐÃ CHUYỂN SANG `@order/schemas/auto-items`. Lý do: khách quét QR
// tự gọi thì KHÔNG có giỏ của nhân viên để bỏ sẵn khăn vào, chỉ có đúng một nút "Duyệt cả
// lượt" ở màn bếp, nên phía server cũng phải biết luật này. Hai bản sao là cách chắc chắn
// nhất để sau này quán đổi tên món rồi một bên nhận ra còn bên kia thì không.
//
// Giữ file này thay vì sửa mọi chỗ import: nó là cửa vào đã quen của apps/web, và
// `auto-items.test.ts` cũng trỏ vào đây.
export {
  AUTO_ITEM_NAME_KEYS,
  AUTO_ITEM_QTY,
  AUTO_ITEM_TABLE_KINDS,
  khongDau,
  pickAutoItem,
  type AutoItemCandidate,
} from '@order/schemas';
