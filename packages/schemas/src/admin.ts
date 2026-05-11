// Admin module DTOs + responses
import { z } from 'zod';

export const CreateUserDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});
export type CreateUserDto = z.infer<typeof CreateUserDto>;

export const UserAdminView = z.object({
  id: z.string().uuid(),
  username: z.string(),
  is_active: z.boolean(),
  is_owner: z.boolean(),
  created_at: z.number().int(),
});
export type UserAdminView = z.infer<typeof UserAdminView>;

export const UsersListResponse = z.object({
  data: z.object({
    items: z.array(UserAdminView),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  }),
});

export const ResetPasswordResponse = z.object({
  data: z.object({
    temp_password: z.string(),
    message: z.string(),
  }),
});

// Audit log row shape
export const AuditLogRow = z.object({
  id: z.string(),
  actor_id: z.string().uuid().nullable(),
  actor_name: z.string().nullable(),
  ip: z.string(),
  ts_ms: z.number().int(),
  action_kind: z.string(),
  target_kind: z.string().nullable(),
  target_id: z.string().nullable(),
  before_json: z.unknown().nullable(),
  after_json: z.unknown().nullable(),
});
export type AuditLogRow = z.infer<typeof AuditLogRow>;

export const AuditListResponse = z.object({
  data: z.object({
    items: z.array(AuditLogRow),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  }),
});

export const AuditFilterQuery = z.object({
  actor: z.string().optional(),
  action_kind: z.string().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
});
export type AuditFilterQuery = z.infer<typeof AuditFilterQuery>;
