// class-validator DTOs (P01.D-14 NestJS native, mirrors @order/schemas zod)
import { IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  // MinLength(1), KHÔNG phải 8 (đổi 2026-11-09): đăng nhập chỉ SO mật khẩu, không đặt mới. Đòi 8
  // ký tự ở đây thì ai gõ nhầm một mật khẩu ngắn nhận câu "Dữ liệu thiếu hoặc sai định dạng" thay
  // vì "Sai mật khẩu" — khó hiểu, mà còn lộ ra luật độ dài. Luật 8 ký tự giữ ở chỗ đặt mật khẩu.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  old!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new!: string;
}

export class SetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  full_name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
