import { z } from 'zod';

export const TableKind = z.enum(['dine-in', 'takeaway', 'delivery']);
export type TableKind = z.infer<typeof TableKind>;

export const RestaurantTable = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: TableKind,
  // Position trên sơ đồ (grid cell coords)
  x: z.number().int(),
  y: z.number().int(),
  is_active: z.boolean(),
});
export type RestaurantTable = z.infer<typeof RestaurantTable>;
