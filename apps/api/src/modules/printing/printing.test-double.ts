// Bản giả của PrintingService cho các test integration dựng `OrdersService` BẰNG TAY.
//
// Những test đó không bootstrap Nest nên không có DI: thêm một dependency vào OrdersService là
// phải sửa tay từng file. Gom về một chỗ để lần sau thêm dependency nữa thì sửa đúng một dòng,
// thay vì sáu file lặp lại cùng một khối giả.
//
// KHÔNG in gì cả, và đó là đúng: các test này kiểm đếm bàn / chuyển bàn / thống kê, hoàn toàn
// không liên quan tới máy in. Một bản giả im lặng giữ chúng đúng phạm vi.
import type { PrintingService } from './printing.service.js';

export function noOpPrintingService(): PrintingService {
  return {
    enqueue: async () => null,
    enqueueTest: async () => null,
  } as unknown as PrintingService;
}
