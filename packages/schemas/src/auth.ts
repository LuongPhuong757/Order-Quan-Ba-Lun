// P01.D-04, D-08 — Auth DTOs + response shapes
import { z } from 'zod';

export const LoginDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const ChangePasswordDto = z.object({
  old: z.string().min(1).max(128),
  new: z.string().min(8).max(128),
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

export const RecoverDto = z.object({
  code: z.string().length(16),
  new_password: z.string().min(8).max(128),
});
export type RecoverDto = z.infer<typeof RecoverDto>;

export const SetupDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});
export type SetupDto = z.infer<typeof SetupDto>;

export const SetupResponse = z.object({
  data: z.object({
    user_id: z.string().uuid(),
    recovery_code: z.string().length(16),
    warning: z.string(),
  }),
});

// User shape returned by /auth/me + /auth/login
export const UserPublic = z.object({
  sub: z.string().uuid(),
  name: z.string(),
  is_owner: z.boolean(),
});
export type UserPublic = z.infer<typeof UserPublic>;

export const LoginResponse = z.object({
  data: z.object({
    user: UserPublic,
  }),
});

export const WhoamiResponse = z.object({
  data: UserPublic,
});
