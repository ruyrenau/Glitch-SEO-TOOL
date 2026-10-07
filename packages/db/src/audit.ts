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

export async function recordAuditEvent(e: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId: e.workspaceId,
      userId: e.userId,
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
