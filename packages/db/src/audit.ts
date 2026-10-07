import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';
import { prisma } from './client';

export interface AuditInput {
  workspaceId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  details?: Prisma.InputJsonValue;
}

/** The authenticated user of the current request (set by the API per request). */
export const actorContext = new AsyncLocalStorage<{ userId: string; workspaceId: string }>();
export const currentActorId = (): string | null => actorContext.getStore()?.userId ?? null;

export async function recordAuditEvent(e: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId: e.workspaceId ?? actorContext.getStore()?.workspaceId ?? null,
      userId: e.userId ?? currentActorId(),
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      details: e.details
    }
  });
}

export async function listAuditEvents(workspaceId: string | undefined, take = 100) {
  return prisma.auditEvent.findMany({
    where: workspaceId ? { workspaceId } : {},
    orderBy: { createdAt: 'desc' },
    take,
    include: { user: { select: { email: true, name: true } } }
  });
}
