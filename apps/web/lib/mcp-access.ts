import { and, eq, isNull, or, gt } from "drizzle-orm";
import { MIN_RELAY_BLOCKED_DIRS, ONLINE_THRESHOLD_MS, ceilingTools, versionAtLeast, toolsForPreset, type EffectivePermissions, type Preset } from "@mortality/shared";
import { appUrl } from "./app-url";
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
  preset: Preset;
  device: typeof schema.devices.$inferSelect;
  tools: string[];
  permissions: EffectivePermissions;
  requireApprovalFor: string[];
  expiresAt: Date | null;
}

/** Grants ativos do cliente (deny-by-default: sem linha = sem acesso). */
export async function activeGrants(ctx: McpContext): Promise<ActiveGrant[]> {
  const now = new Date();
  const [owner] = await db().select({ maxPreset: schema.users.maxPreset, disabledTools: schema.users.disabledTools, allowAllDirsOk: schema.users.allowAllDirsOk })
    .from(schema.users).where(eq(schema.users.id, ctx.userId)).limit(1);
  if (!owner) return [];
  const cap = ceilingTools(owner.maxPreset, owner.disabledTools);
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
    const raw = preset === "custom" ? g.allowedTools : toolsForPreset(preset);
    const tools = raw.filter((t) => cap.includes(t));
    return {
      grantId: g.id, preset, device: d, tools: g.readOnly ? tools.filter((t) => toolsForPreset("read_only").includes(t)) : tools,
      permissions: {
        allowedDirs: g.allowedDirs, blockedDirs: g.blockedDirs,
        // O teto do admin aplica-se também a grants já existentes.
        allowAllDirs: g.allowAllDirs && owner.allowAllDirsOk,
        blockedCommands: g.blockedCommands, readOnly: g.readOnly,
      },
      // sudo-for-all = «sem pedir permissão»: nunca exige aprovação humana.
      requireApprovalFor: preset === "sudo_for_all" ? [] : g.requireApprovalFor, expiresAt: g.expiresAt,
    };
  });
}

/** Escolhe o dispositivo pedido (ou o único possível) e valida tool + estado. */
export function resolveDevice(grants: ActiveGrant[], tool: string, deviceArg?: string): ActiveGrant {
  const panel = `${appUrl()}/clients`;
  if (!grants.length) {
    throw new AccessError(`Este cliente não tem acesso a nenhum dispositivo. O utilizador pode conceder acesso em ${panel}.`);
  }
  const candidates = grants.filter((g) => g.tools.includes(tool));
  if (!candidates.length) {
    const have = [...new Set(grants.map((g) => g.preset))].join(", ");
    throw new AccessError(
      `A tool "${tool}" não está permitida com as permissões atuais (${have}). ` +
      `O utilizador pode alterá-las em ${panel}; a mudança aplica-se de imediato, sem reconectar.`,
    );
  }
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
  // Relays antigos ignoravam `blockedDirs`: nunca correr com bloqueios que não seriam impostos.
  if (g.permissions.blockedDirs.length && !versionAtLeast(g.device.relayVersion, MIN_RELAY_BLOCKED_DIRS)) {
    throw new AccessError(`O relay deste dispositivo é antigo (${g.device.relayVersion ?? "?"}) e não impõe diretórios bloqueados. Atualiza para ${MIN_RELAY_BLOCKED_DIRS} ou superior.`);
  }
  return g;
}
