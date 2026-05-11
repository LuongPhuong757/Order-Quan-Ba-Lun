// class-validator DTOs (P01.D-14 NestJS native, mirrors @order/schemas zod)
import { IsString, MinLength, MaxLength, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
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

export class RecoverDto {
  @IsString()
  @Length(16, 16)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password!: string;
}

export class SetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
