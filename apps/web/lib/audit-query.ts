import { and, desc, eq, gte, ilike, lt, type SQL } from "drizzle-orm";
import { db, schema } from "./db";

export interface AuditFilters {
  email?: string; action?: string; tool?: string; failed?: boolean; from?: Date; to?: Date; limit: number;
}

export function parseFilters(sp: URLSearchParams | Record<string, string | undefined>, limit = 200): AuditFilters {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) || undefined;
  const date = (v?: string) => { const d = v ? new Date(v) : undefined; return d && !isNaN(d.getTime()) ? d : undefined; };
  return {
    email: get("email")?.slice(0, 100), action: get("action")?.slice(0, 60), tool: get("tool")?.slice(0, 60),
    failed: get("failed") === "1", from: date(get("from")), to: date(get("to")), limit,
  };
}

export async function queryAudit(f: AuditFilters) {
  const w: (SQL | undefined)[] = [
    f.email ? ilike(schema.users.email, `%${f.email.replace(/[%_]/g, "\\$&")}%`) : undefined,
    f.action ? ilike(schema.auditLog.action, `${f.action.replace(/[%_]/g, "\\$&")}%`) : undefined,
    f.tool ? eq(schema.auditLog.tool, f.tool) : undefined,
    f.failed ? eq(schema.auditLog.ok, false) : undefined,
    f.from ? gte(schema.auditLog.createdAt, f.from) : undefined,
    f.to ? lt(schema.auditLog.createdAt, f.to) : undefined,
  ];
  return db().select({
    a: schema.auditLog, email: schema.users.email, device: schema.devices.name,
  }).from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.devices, eq(schema.devices.id, schema.auditLog.deviceId))
    .where(and(...w)).orderBy(desc(schema.auditLog.createdAt)).limit(f.limit);
}
