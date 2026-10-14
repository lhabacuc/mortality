import { and, eq, isNull, or, gt } from "drizzle-orm";
import { ONLINE_THRESHOLD_MS, toolsForPreset, type EffectivePermissions, type Preset } from "@mortality/shared";
import { db, schema } from "./db";
import { bearer, sha256 } from "./tokens";

export interface McpContext {
  userId: string;
  userEmail: string;
  tokenId: string;
  /** Identidade usada nos grants: client OAuth ou id do PAT. */
  clientKey: string;
  kind: "oauth" | "pat";
}

export class AccessError extends Error {}

export async function authenticateMcp(req: Request, resource?: string): Promise<McpContext | null> {
  const raw = bearer(req);
  if (!raw) return null;
  const now = new Date();
  const [row] = await db().select({ t: schema.accessTokens, u: schema.users })
    .from(schema.accessTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.accessTokens.userId))
    .where(and(
      eq(schema.accessTokens.tokenHash, sha256(raw)),
      isNull(schema.accessTokens.revokedAt),
      or(isNull(schema.accessTokens.expiresAt), gt(schema.accessTokens.expiresAt, now)),
    )).limit(1);
  if (!row || row.u.status !== "active" || row.u.mustChangePassword) return null;
  // Token OAuth é ligado ao resource (RFC 8707): não vale para outro servidor.
  if (row.t.kind === "oauth" && resource && row.t.resource?.replace(/\/$/, "") !== resource) return null;
  await db().update(schema.accessTokens).set({ lastUsedAt: now }).where(eq(schema.accessTokens.id, row.t.id));
  return {
    userId: row.u.id, userEmail: row.u.email, tokenId: row.t.id,
    clientKey: row.t.clientId ?? row.t.id, kind: row.t.kind,
  };
}

export interface ActiveGrant {
  grantId: string;
  device: typeof schema.devices.$inferSelect;
  tools: string[];
  permissions: EffectivePermissions;
  requireApprovalFor: string[];
  expiresAt: Date | null;
}

/** Grants ativos do cliente (deny-by-default: sem linha = sem acesso). */
export async function activeGrants(ctx: McpContext): Promise<ActiveGrant[]> {
  const now = new Date();
  const rows = await db().select({ g: schema.clientGrants, d: schema.devices })
    .from(schema.clientGrants)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.clientGrants.deviceId))
    .where(and(
      eq(schema.clientGrants.clientId, ctx.clientKey),
      eq(schema.clientGrants.userId, ctx.userId), // isolamento entre utilizadores
      eq(schema.devices.userId, ctx.userId),
      isNull(schema.clientGrants.revokedAt),
      isNull(schema.devices.revokedAt),
      or(isNull(schema.clientGrants.expiresAt), gt(schema.clientGrants.expiresAt, now)),
    ));
  return rows.map(({ g, d }) => {
    const preset = g.preset as Preset;
    const tools = preset === "custom" ? g.allowedTools : toolsForPreset(preset);
    return {
      grantId: g.id, device: d, tools: g.readOnly ? tools.filter((t) => toolsForPreset("read_only").includes(t)) : tools,
      permissions: { allowedDirs: g.allowedDirs, blockedCommands: g.blockedCommands, readOnly: g.readOnly },
      requireApprovalFor: g.requireApprovalFor, expiresAt: g.expiresAt,
    };
  });
}

/** Escolhe o dispositivo pedido (ou o único possível) e valida tool + estado. */
export function resolveDevice(grants: ActiveGrant[], tool: string, deviceArg?: string): ActiveGrant {
  const candidates = grants.filter((g) => g.tools.includes(tool));
  if (!candidates.length) throw new AccessError(`Sem acesso à tool "${tool}".`);
  let g: ActiveGrant | undefined;
  if (deviceArg) {
    g = candidates.find((c) => c.device.name === deviceArg || c.device.id === deviceArg);
    if (!g) throw new AccessError(`Sem acesso ao dispositivo "${deviceArg}".`);
  } else if (candidates.length === 1) {
    g = candidates[0];
  } else {
    throw new AccessError("Vários dispositivos disponíveis: indica o parâmetro `device`.");
  }
  if (!g.device.enabled) throw new AccessError("Dispositivo desativado no painel.");
  if (g.device.pausedLocally) throw new AccessError("Dispositivo pausado localmente.");
  if (!g.device.lastSeenAt || Date.now() - g.device.lastSeenAt.getTime() > ONLINE_THRESHOLD_MS) {
    throw new AccessError("Dispositivo offline.");
  }
  return g;
}
