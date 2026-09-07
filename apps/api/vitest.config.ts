import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Các file test chạy TUẦN TỰ, không song song.
     *
     * Nhiều test tích hợp ở đây nói chuyện với CÙNG một MySQL thật và đo bằng CHÊNH LỆCH số
     * dòng trước/sau khi chèn (`open-count.integration`, `admin-online-orders.integration`,
     * `cancel-order`…) — cách đo đó là đúng, vì DB dev có sẵn đơn thật nên khẳng định số tuyệt
     * đối sẽ đỏ vì lý do không liên quan.
     *
     * Nhưng vitest mặc định chạy các FILE song song, nên trong lúc file A đo mốc "trước" thì
     * file B đã chèn/đổi trạng thái đơn, và phép trừ ra số vô lý:
     *     open-count.integration.test.ts:131  AssertionError: expected 8 to be 9
     *     admin-online-orders.integration.test.ts:755  AssertionError: expected -3 to be 1
     * Đỏ ngẫu nhiên khoảng 2/4 lần chạy full suite, mỗi lần một test khác — đủ để CHẶN DEPLOY
     * vì `ci.yml` coi test đỏ là hỏng, dù chẳng có gì hỏng cả.
     *
     * Chạy tuần tự là cách rẻ nhất chữa đúng gốc: không phải viết lại logic đo của từng test,
     * và giữ được cách đo bằng chênh lệch. Giá phải trả đo thực tế: 5s → 16s cho 675 test.
     * (Cách đắt hơn — mỗi file một schema/DB riêng — chỉ đáng làm nếu suite phình tới mức 16s
     * thành vướng.)
     */
    fileParallelism: false,
  },
});
