import { z } from 'zod';

export const MenuGroup = z.enum(['food', 'drink', 'side', 'other']);
export type MenuGroup = z.infer<typeof MenuGroup>;

export const MenuItem = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  group: MenuGroup,
  price: z.number().int().nonnegative(),
  unit: z.string(),
  image_url: z.string().nullable(),
  is_out_of_stock: z.boolean(),
  is_active: z.boolean(),
  created_at: z.number().int(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const CreateMenuItemDto = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  group: MenuGroup,
  price: z.number().int().nonnegative().max(100_000_000),
  unit: z.string().min(1).max(32),
  image_url: z.string().url().nullable().optional(),
});
export type CreateMenuItemDto = z.infer<typeof CreateMenuItemDto>;

export const UpdateMenuItemDto = CreateMenuItemDto.partial();
export type UpdateMenuItemDto = z.infer<typeof UpdateMenuItemDto>;
