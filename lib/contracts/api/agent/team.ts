/**
 * lib/contracts/api/agent/team.ts — /api/agent/tools/team
 * Actions: list_sectors, list_members, get_member, capacity_today
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

const RoleSchema = z.enum(['founder', 'admin', 'manager', 'operator', 'viewer']);

const SectorShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  name: z.string(),
  isActive: z.boolean(),
}).passthrough();

const UserShape = z.object({
  id: DocIdSchema,
  uid: DocIdSchema.optional(),
  name: z.string(),
  email: z.string().email().optional(),
  role: RoleSchema.optional(),
  sectorIds: z.array(DocIdSchema).optional(),
  isProfessional: z.boolean().optional(),
  serviceIds: z.array(DocIdSchema).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  userStatus: z.enum(['online', 'busy', 'invisible', 'offline']).optional(),
  lastSeenAt: z.string().optional(),
  workingHours: z.object({}).passthrough().optional(),
  photoURL: z.string().url().optional(),
}).passthrough();

export const TeamListSectorsParamsSchema = z.object({});
export const TeamListSectorsDataSchema = z.array(SectorShape);

export const TeamListMembersParamsSchema = z.object({
  sectorId: DocIdSchema.optional(),
  role: RoleSchema.optional(),
  isProfessional: z.boolean().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const TeamListMembersDataSchema = z.array(UserShape);

export const TeamGetMemberParamsSchema = z.object({ id: DocIdSchema });
export const TeamGetMemberDataSchema = UserShape.nullable();

export const TeamCapacityTodayParamsSchema = z.object({ userId: DocIdSchema.optional() });
export const TeamCapacityTodayDataSchema = z.array(z.object({
  userId: DocIdSchema,
  userName: z.string(),
  appointments: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  kanbanCards: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
}));

export const TeamToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_sectors'),    params: TeamListSectorsParamsSchema }),
  z.object({ action: z.literal('list_members'),    params: TeamListMembersParamsSchema }),
  z.object({ action: z.literal('get_member'),      params: TeamGetMemberParamsSchema }),
  z.object({ action: z.literal('capacity_today'),  params: TeamCapacityTodayParamsSchema }),
]);

export const TEAM_DATA_SCHEMAS = {
  list_sectors:   TeamListSectorsDataSchema,
  list_members:   TeamListMembersDataSchema,
  get_member:     TeamGetMemberDataSchema,
  capacity_today: TeamCapacityTodayDataSchema,
} as const;
