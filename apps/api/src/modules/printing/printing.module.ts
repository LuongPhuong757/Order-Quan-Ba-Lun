// In hoá đơn ra máy in nhiệt 58mm đặt trong LAN của quán (2026-09-19).
//
// Sơ đồ đường đi, vì nó KHÔNG hiển nhiên:
//
//   điện thoại nhân viên (iPhone/Android)
//        │ thanh toán như bình thường
//        ▼
//   VPS — `PrintingService.enqueue()` xếp một dòng vào `print_jobs`
//        ▲
//        │ hỏi mỗi 2 giây qua `/print/next` (token thiết bị)
//   cầu in: script Node chạy trong Termux trên máy tính bảng ở quầy
//        │ TCP tới <printer_host>:9100
//        ▼
//   Xprinter 58mm
//
// Vì sao vòng vèo như vậy: iPhone không có bất kỳ API nào để nói chuyện với máy in Bluetooth
// (Safari không hỗ trợ Web Bluetooth/USB/Serial), còn trình duyệt — trên MỌI hệ điều hành —
// không mở được socket thô tới máy in mạng. VPS thì nằm ngoài NAT của quán nên cũng không với
// vào được. Chiều duy nhất đi lọt là từ trong quán gọi ra, nên cầu in phải là bên chủ động hỏi.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrintJob } from './entities/print-job.entity.js';
import { PrintDevice } from './entities/print-device.entity.js';
import { PrintingService } from './printing.service.js';
import { PrintDeviceGuard } from './print-device.guard.js';
import { PrintingController } from './printing.controller.js';
import { PrintingAdminController } from './printing-admin.controller.js';
import { PrintPairController } from './print-pair.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([PrintJob, PrintDevice]), SettingsModule, AuthModule],
  controllers: [PrintingController, PrintingAdminController, PrintPairController],
  providers: [PrintingService, PrintDeviceGuard],
  // `OrdersModule` cần service này để xếp job ngay sau khi thu tiền xong.
  exports: [PrintingService],
})
export class PrintingModule {}
