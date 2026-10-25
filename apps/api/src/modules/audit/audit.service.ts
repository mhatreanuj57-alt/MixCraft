import type { PrismaClient } from "@mixcraft/database";

export interface AuditInput {
  userId?: string | null;
  connectionId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: string;
  requestId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function recordAuditEvent(db: PrismaClient, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      userId: input.userId ?? null,
      connectionId: input.connectionId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
