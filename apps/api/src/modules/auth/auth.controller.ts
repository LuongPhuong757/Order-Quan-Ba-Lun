import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { JwtService } from './jwt.service.js';
import { LoginDto, ChangePasswordDto, RecoverDto } from './dto/auth.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly svc: AuthService,
    private readonly jwtSvc: JwtService,
  ) {}

  /** E-01 POST /auth/login */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.svc.loginByCredentials(dto.username, dto.password);
    res.cookie(this.jwtSvc.cookieName, token, this.jwtSvc.cookieOptions);
    return {
      data: {
        user: {
          sub: user.id,
          name: user.username,
          is_owner: user.is_owner,
        },
      },
    };
  }

  /** E-02 POST /auth/logout */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.user?.jti) {
      const exp = Math.floor(Date.now() / 1000) + 7 * 86_400;
      await this.svc.logout(req.user.jti, exp);
    }
    res.clearCookie(this.jwtSvc.cookieName, { path: '/' });
  }

  /** E-03 GET /auth/me */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  whoami(@Req() req: Request) {
    return {
      data: {
        sub: req.user!.sub,
        name: req.user!.name,
        full_name: req.user!.full_name,
        is_owner: req.user!.is_owner,
        role: req.user!.role,
      },
    };
  }

  /** E-04 POST /auth/change-password */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.svc.changePassword(req.user!.sub, dto.old, dto.new, req.user!.jti);
    // Re-issue cookie with fresh tv
    const { token } = this.jwtSvc.sign({
      id: user.id,
      username: user.username,
      is_owner: user.is_owner,
      token_version: Number(user.token_version),
    });
    res.cookie(this.jwtSvc.cookieName, token, this.jwtSvc.cookieOptions);
    return { data: { message: 'Password changed successfully' } };
  }

  /** E-05 POST /auth/recover */
  @Post('recover')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async recover(@Body() dto: RecoverDto) {
    await this.svc.recover(dto.code, dto.new_password);
    return { data: { message: 'Password reset via recovery code. Please login.' } };
  }
}
