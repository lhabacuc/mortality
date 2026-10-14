import { db, schema } from "./db";

export async function audit(e: {
  userId?: string | null; deviceId?: string | null; clientId?: string | null;
  actor: string; action: string; tool?: string; argsSummary?: string; ok?: boolean; ip?: string;
}) {
  await db().insert(schema.auditLog).values({
    userId: e.userId ?? null, deviceId: e.deviceId ?? null, clientId: e.clientId ?? null,
    actor: e.actor, action: e.action, tool: e.tool ?? null,
    argsSummary: e.argsSummary?.slice(0, 300) ?? null, ok: e.ok ?? true, ip: e.ip ?? null,
  });
}
